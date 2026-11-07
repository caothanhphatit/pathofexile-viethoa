// Safety nets shared by the poe2db crawlers. poe2db occasionally times out, rate-limits
// or ships a markup change; a crawl hit by that must not silently replace good data
// with a partial result.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// fetch() with a timeout and a few retries (exponential backoff) for transient failures.
// 4xx other than 408/429 is treated as permanent and not retried.
export const fetchWithRetry = async (url, init = {}, { retries = 3, timeoutMs = 30_000, backoffMs = 1000, fetchImpl = globalThis.fetch } = {}) => {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (response.ok) return response;
      lastError = new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText || ""}`.trim());
      lastError.status = response.status;
      const permanent = response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status);
      if (permanent) throw lastError;
    } catch (error) {
      if (error.status && error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status)) throw error;
      lastError = error;
    }
    if (attempt < retries) await sleep(backoffMs * 2 ** attempt);
  }
  throw lastError;
};

// Largest share of currently active rows one crawl may mark as removed. A real patch
// removes a handful of entries; losing a large share means the crawl itself broke
// (a page failed to load, a parser stopped matching). Override per run with
// CRAWL_MAX_REMOVED_SHARE=1 after checking the removal is real.
export const maxRemovedShare = (env = process.env) => {
  const value = Number(env.CRAWL_MAX_REMOVED_SHARE);
  return Number.isFinite(value) && value > 0 ? value : 0.2;
};

// Decides whether marking `wouldRemove` of `active` rows as removed looks like a real
// content change. Small tables (under 20 rows) are not guarded.
export const removalLooksSafe = ({ active, wouldRemove, maxShare = maxRemovedShare() }) => {
  if (!wouldRemove) return true;
  if (active < 20) return true;
  return wouldRemove / active <= maxShare;
};

// Counts how many active rows a "mark everything not seen as removed" update would hit
// and returns false (with a warning) when that is suspiciously many. `table` and
// `keyColumn` are fixed identifiers from the callers, never user input.
export const checkRemoval = async (client, { table, keyColumn, seenKeys, label = table, log = console }) => {
  const { rows } = await client.query(`
    select
      count(*)::int as active,
      count(*) filter (where not (${keyColumn} = any($1::text[])))::int as would_remove
    from ${table}
    where status = 'active'
  `, [seenKeys]);
  const active = rows[0]?.active || 0;
  const wouldRemove = rows[0]?.would_remove || 0;
  const maxShare = maxRemovedShare();
  if (removalLooksSafe({ active, wouldRemove, maxShare })) return { allowed: true, active, wouldRemove };
  log.warn?.(`[${label}] Not marking ${wouldRemove} of ${active} active rows as removed (more than ${Math.round(maxShare * 100)}%). `
    + "The crawl probably missed pages; rerun it, or set CRAWL_MAX_REMOVED_SHARE=1 if the removal is real.");
  return { allowed: false, active, wouldRemove };
};
