'use strict';

/**
 * PoE2 trade API price check (read-only).
 *
 * Requirements / setup the user must do ONCE:
 *   - Set the environment variable POESESSID to the value of the POESESSID cookie
 *     from a logged-in https://www.pathofexile.com session. (Open dev tools ->
 *     Application -> Cookies -> copy POESESSID, then set it as an env var before
 *     launching the overlay.) Without it the trade API will reject the request.
 *   - Optionally set POE2_LEAGUE to override the default league.
 *
 * The trade API is rate limited. We read the X-Rate-Limit-* / Retry-After
 * response headers, throttle between calls, and on HTTP 429 back off and retry once.
 *
 * Exports: { priceCheck }
 */

const LEAGUE = process.env.POE2_LEAGUE || 'Runes of Aldur';
const USER_AGENT = 'poe2-overlay/0.1 (contact: user)';
const TRADE_BASE = 'https://www.pathofexile.com/api/trade2';

// Simple module-level throttle so back-to-back price checks don't hammer the API.
let nextAllowedAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait until our self-imposed throttle window opens. The window is advanced
 * after each request based on rate-limit headers (or a conservative default).
 */
async function awaitThrottle() {
  const now = Date.now();
  if (now < nextAllowedAt) {
    await sleep(nextAllowedAt - now);
  }
}

/**
 * Inspect rate-limit headers on a response and set the next-allowed timestamp.
 * PoE rate-limit headers look like "X-Rate-Limit-Account: 8:10:60" meaning
 * 8 hits per 10 seconds (penalty 60s). We use the period to space out calls.
 */
function applyRateLimit(res) {
  let waitMs = 1000; // default minimum spacing between requests

  const limit =
    res.headers.get('x-rate-limit-account') ||
    res.headers.get('x-rate-limit-ip') ||
    res.headers.get('x-rate-limit-account-state');

  if (limit) {
    // Format like "max:period:penalty" possibly comma-separated for multiple rules.
    const firstRule = String(limit).split(',')[0];
    const parts = firstRule.split(':');
    const max = parseInt(parts[0], 10);
    const period = parseInt(parts[1], 10);
    if (Number.isFinite(max) && Number.isFinite(period) && max > 0) {
      // Space requests evenly across the window, with a small safety margin.
      waitMs = Math.ceil((period * 1000) / max) + 50;
    }
  }

  const retryAfter = res.headers.get('retry-after');
  if (retryAfter) {
    const secs = parseInt(retryAfter, 10);
    if (Number.isFinite(secs)) {
      waitMs = Math.max(waitMs, secs * 1000);
    }
  }

  nextAllowedAt = Date.now() + waitMs;
}

function buildHeaders(extra) {
  const sessid = process.env.POESESSID || '';
  const headers = {
    'User-Agent': USER_AGENT,
    Accept: 'application/json',
  };
  if (sessid) {
    headers.Cookie = 'POESESSID=' + sessid;
  }
  return Object.assign(headers, extra || {});
}

/**
 * fetch wrapper that respects the throttle, records rate-limit headers, and on
 * HTTP 429 backs off (honoring Retry-After) and retries exactly once.
 */
async function rateLimitedFetch(url, options) {
  await awaitThrottle();
  let res = await fetch(url, options);
  applyRateLimit(res);

  if (res.status === 429) {
    // Back off based on Retry-After (already folded into nextAllowedAt) then retry once.
    const retryAfter = res.headers.get('retry-after');
    let backoff = 2000;
    if (retryAfter) {
      const secs = parseInt(retryAfter, 10);
      if (Number.isFinite(secs)) backoff = Math.max(backoff, secs * 1000);
    }
    await sleep(backoff);
    res = await fetch(url, options);
    applyRateLimit(res);
  }

  return res;
}

/**
 * Parse the clipboard text PoE2 produces on Ctrl+C over an item.
 *
 * The text is multi-line, with sections separated by lines of dashes
 * ("--------"). The first section contains lines like:
 *   Item Class: ...
 *   Rarity: ...
 *   <Item Name>
 *   <Base Type>
 *
 * We try to extract a usable "type" string:
 *   - For Rarity: Currency / Gem / etc. (single name), use that name.
 *   - For magic/rare/unique items, the line after the name is usually the base type.
 *   - Otherwise fall back to the last non-metadata line in the first section.
 *
 * Returns the type string, or null if it cannot be parsed.
 */
function parseItemType(clipboardText) {
  if (typeof clipboardText !== 'string') return null;
  const normalized = clipboardText.replace(/\r\n/g, '\n').trim();
  if (!normalized) return null;

  // Split into sections on dash-separator lines.
  const sections = normalized
    .split(/\n-{3,}\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sections.length === 0) return null;

  const firstSection = sections[0];
  const rawLines = firstSection
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (rawLines.length === 0) return null;

  let rarity = null;
  const contentLines = [];
  for (const line of rawLines) {
    const lower = line.toLowerCase();
    if (lower.startsWith('item class:')) continue;
    const rarityMatch = line.match(/^Rarity:\s*(.+)$/i);
    if (rarityMatch) {
      rarity = rarityMatch[1].trim().toLowerCase();
      continue;
    }
    // Skip other metadata key:value lines that PoE sometimes places up top.
    contentLines.push(line);
  }

  if (contentLines.length === 0) return null;

  // Currency, gems, divination cards, etc. typically have a single name line:
  // the name IS the type we search for.
  if (rarity === 'currency' || rarity === 'gem' || rarity === 'divination card') {
    return contentLines[0];
  }

  // For normal items there is usually just the base type on one line.
  if (rarity === 'normal') {
    // A normal item's displayed name may include a prefix like "Superior";
    // strip a leading quality word if present.
    return contentLines[contentLines.length - 1].replace(/^Superior\s+/i, '');
  }

  // Magic / Rare / Unique: line[0] is the item name, line[1] is the base type.
  if (contentLines.length >= 2) {
    return contentLines[1];
  }

  // Fallback: use the single content line we have.
  return contentLines[0];
}

/**
 * Run a PoE2 trade search + fetch for the given item base type and return a
 * normalized result object:
 *   { ok:true, type, count, lowest:[{amount,currency,account}] }
 *   { ok:false, type?, error }
 */
async function priceCheck(clipboardText) {
  const type = parseItemType(clipboardText);
  if (!type) {
    return { ok: false, error: 'parse' };
  }

  if (!process.env.POESESSID) {
    return { ok: false, type, error: 'no-poesessid' };
  }

  const league = encodeURIComponent(LEAGUE);

  // 1) POST search
  const searchBody = {
    query: {
      status: { option: 'online' },
      type: type,
      stats: [{ type: 'and', filters: [] }],
    },
    sort: { price: 'asc' },
  };

  let searchRes;
  try {
    searchRes = await rateLimitedFetch(`${TRADE_BASE}/search/poe2/${league}`, {
      method: 'POST',
      headers: buildHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(searchBody),
    });
  } catch (err) {
    return { ok: false, type, error: 'network: ' + (err && err.message ? err.message : String(err)) };
  }

  if (searchRes.status === 429) {
    return { ok: false, type, error: 'rate-limited' };
  }
  if (!searchRes.ok) {
    return { ok: false, type, error: 'search-http-' + searchRes.status };
  }

  let searchJson;
  try {
    searchJson = await searchRes.json();
  } catch (err) {
    return { ok: false, type, error: 'search-parse' };
  }

  const searchId = searchJson && searchJson.id;
  const result = (searchJson && Array.isArray(searchJson.result)) ? searchJson.result : [];
  const total = (searchJson && typeof searchJson.total === 'number') ? searchJson.total : result.length;

  if (!searchId || result.length === 0) {
    return { ok: true, type, count: total || 0, lowest: [] };
  }

  // 2) GET fetch for the first up to 10 result ids.
  const ids = result.slice(0, 10).join(',');
  let fetchRes;
  try {
    fetchRes = await rateLimitedFetch(
      `${TRADE_BASE}/fetch/${ids}?query=${encodeURIComponent(searchId)}`,
      {
        method: 'GET',
        headers: buildHeaders(),
      }
    );
  } catch (err) {
    return { ok: false, type, error: 'network: ' + (err && err.message ? err.message : String(err)) };
  }

  if (fetchRes.status === 429) {
    return { ok: false, type, error: 'rate-limited' };
  }
  if (!fetchRes.ok) {
    return { ok: false, type, error: 'fetch-http-' + fetchRes.status };
  }

  let fetchJson;
  try {
    fetchJson = await fetchRes.json();
  } catch (err) {
    return { ok: false, type, error: 'fetch-parse' };
  }

  const entries = (fetchJson && Array.isArray(fetchJson.result)) ? fetchJson.result : [];
  const lowest = [];
  for (const entry of entries) {
    if (!entry || !entry.listing) continue;
    const listing = entry.listing;
    const price = listing.price;
    if (!price || typeof price.amount === 'undefined') continue;
    let account = '';
    if (listing.account) {
      account = listing.account.name || (listing.account.lastCharacterName || '');
    }
    lowest.push({
      amount: price.amount,
      currency: price.currency || '',
      account: account,
    });
    if (lowest.length >= 5) break;
  }

  return { ok: true, type, count: total, lowest };
}

module.exports = { priceCheck };
