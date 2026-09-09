const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const ui = path.join(root, 'crates', 'poe2-overlay', 'ui');
const output = path.join(root, 'target', 'trade-overlay-preview.png');
const outputResults = path.join(root, 'target', 'trade-overlay-results-preview.png');

const item = {
  raw_text: 'fixture', item_class: 'Gloves', rarity: 'rare', name: 'Gale Touch',
  base_type: 'Grand Bracers', quality: 20, item_level: 73, waystone_tier: null,
  sockets: 'S', armour: 0, evasion: 536, energy_shield: 0, spirit: 0,
  requirements_level: 70, requirements: ['Level 70', '73 Dex'],
  corrupted: false, unidentified: false, mirrored: false,
  mods: [
    { text: '+18% to Lightning Resistance', mod_type: 'rune', values: [18], is_selected: false, tier: null },
    { text: '+129(120-149) to maximum Life', mod_type: 'explicit', values: [129, 120, 149], is_selected: false, tier: 'P1' },
    { text: '45(43-55)% increased Evasion Rating', mod_type: 'explicit', values: [45, 43, 55], is_selected: false, tier: 'P5' },
    { text: '+153(147-176) to Evasion Rating', mod_type: 'explicit', values: [153, 147, 176], is_selected: false, tier: 'P1' },
    { text: '10(8-10)% increased Attack Speed', mod_type: 'explicit', values: [10, 8, 10], is_selected: false, tier: 'S3' },
    { text: '+29(26-30)% to Cold Resistance', mod_type: 'explicit', values: [29, 26, 30], is_selected: false, tier: 'S4' },
    { text: 'Gain 30(28-35) Mana per Enemy Killed', mod_type: 'explicit', values: [30, 28, 35], is_selected: false, tier: 'S2' },
  ],
};

function listing(index, price, level, seller) {
  return {
    id: `fixture-${index}`, amount: price, currency: 'exalted', account: seller,
    character: seller, indexed: `2026-09-08T0${Math.max(1, 9 - index)}:00:00Z`,
    online: true, item_level: level, quality: '20%', stack_size: null,
    item_name: `Gale Touch ${index}`, base_type: 'Grand Bracers', rarity: 'rare',
    properties: ['Evasion Rating: 520'], requirements: ['Level 70', '73 Dex'],
    implicit_mods: [], rune_mods: ['+20% to Lightning Resistance'],
    explicit_mods: ['+138 to maximum Life', '48% increased Evasion Rating', '+31% to Cold Resistance', '11% increased Attack Speed'],
  };
}

const market = {
  source: 'https://pathofexile.com/trade2', query_id: 'fixture-query',
  league: 'Rise of the Abyssal', total: 100, inexact: false, item,
  filters: item.mods.map((mod, index) => ({
    index, text: mod.text, trade_id: `explicit.fixture_${index}`,
    suggested_min: mod.values[0] * 0.8, selected: false,
  })),
  listings: [
    listing(1, 1, 77, 'MORI135#7281'), listing(2, 1, 74, 'Caffeine_jaf#231'),
    listing(3, 2, 72, 'sakawalan#342'), listing(4, 2, 67, 'Rayday#8949'),
    listing(5, 2, 80, 'makitaki11#688'), listing(6, 3, 75, 'Junkyard7#692'),
  ],
  trade_url: 'https://www.pathofexile.com/trade2/search/poe2/fixture',
};

(async () => {
  let html = fs.readFileSync(path.join(ui, 'trade-overlay.html'), 'utf8');
  const css = fs.readFileSync(path.join(ui, 'css', 'trade-overlay.css'), 'utf8');
  const js = fs.readFileSync(path.join(ui, 'js', 'trade-overlay.js'), 'utf8');
  html = html.replace('<link rel="stylesheet" href="/static/trade-overlay.css">', `<style>${css}</style>`);
  html = html.replace('<script src="/static/trade-overlay.js"></script>', `<script>${js}</script>`);

  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  });
  const page = await browser.newPage({ viewport: { width: 980, height: 980 }, deviceScaleFactor: 1 });
  page.on('console', (message) => console.log(`console[${message.type()}]: ${message.text()}`));
  page.on('pageerror', (error) => console.log(`pageerror: ${error.message}`));
  await page.route('**/api/trade/**', async (route) => {
    const url = route.request().url();
    let body;
    if (url.endsWith('/api/trade/leagues')) body = { leagues: ['Rise of the Abyssal', 'Standard'] };
    else if (url.endsWith('/api/trade/latest')) body = { revision: 1, status: 'ready', raw_text: 'fixture', item, error: null };
    else if (url.endsWith('/api/trade/search')) body = market;
    else return route.abort();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.route('http://poevh.local/static/fonts/*', async (route) => {
    const file = path.basename(new URL(route.request().url()).pathname);
    const fontPath = path.join(ui, 'fonts', file);
    return route.fulfill({
      status: 200,
      contentType: 'font/woff',
      body: fs.readFileSync(fontPath),
    });
  });
  await page.route('http://poevh.local/trade-overlay', (route) => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: html,
  }));

  await page.goto('http://poevh.local/trade-overlay', { waitUntil: 'networkidle' });
  await page.waitForSelector('#results-table:not([hidden])', { timeout: 10000 });
  await page.screenshot({ path: output });
  await page.locator('#results-section').scrollIntoViewIfNeeded();
  await page.screenshot({ path: outputResults });
  console.log(output);
  console.log(outputResults);
  await browser.close();
})();
