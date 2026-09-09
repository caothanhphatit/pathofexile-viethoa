// Dashboard companion for the in-game Trade overlay.
'use strict';

let currentTradeItem = null;
let currentTradeRaw = '';
let currentTradeFilters = [];
let tradeHistory = [];
window.tradeHistory = tradeHistory;

async function tradeApi(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('X-Api-Token', window.__API_TOKEN__ || '');
  if (options.body) headers.set('Content-Type', 'application/json');
  const response = await fetch(path, { ...options, headers });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

function setTradeStatus(message, color = 'var(--sub)') {
  const status = document.getElementById('trade-status');
  if (status) { status.textContent = message; status.style.color = color; }
}

async function checkTradeClipboard() {
  setTradeStatus('Đang đọc item từ Clipboard…', 'var(--cyan)');
  const result = await apiPost({ command: 'trade_check_clipboard' });
  if (!result?.item || !result.raw_text) {
    setTradeStatus('Clipboard không chứa item PoE2 hợp lệ.', 'var(--red)');
    return;
  }
  currentTradeItem = result.item;
  currentTradeRaw = result.raw_text;
  const searchButton = document.getElementById('trade-dashboard-search');
  if (searchButton) searchButton.disabled = false;
  await searchCurrentTradeItem();
}

function selectedDashboardMods() {
  return [...document.querySelectorAll('#trade-item-mods .trade-mod-row')]
    .filter((row) => row.querySelector('input[type=checkbox]').checked)
    .map((row) => ({ index: Number(row.dataset.index), min: null, max: null }));
}

async function searchCurrentTradeItem() {
  if (!currentTradeRaw) return;
  setTradeStatus('Đang truy vấn Path of Exile Trade…', 'var(--cyan)');
  try {
    const market = await tradeApi('/api/trade/search', {
      method: 'POST',
      body: JSON.stringify({
        raw_text: currentTradeRaw,
        league: 'Standard',
        selected_mods: selectedDashboardMods(),
        online_only: true
      })
    });
    currentTradeItem = market.item;
    currentTradeFilters = market.filters;
    renderTradeResult(market);
    addToTradeHistory(market);
    setTradeStatus(`Đã nhận ${market.total}${market.inexact ? '+' : ''} listing từ GGG.`, 'var(--green)');
    const searchButton = document.getElementById('trade-dashboard-search');
    if (searchButton) searchButton.disabled = false;
  } catch (error) {
    setTradeStatus(error.message, 'var(--red)');
  }
}

function renderTradeResult(market) {
  const item = market.item;
  const container = document.getElementById('trade-result-container');
  if (!container) return;
  container.style.display = 'block';
  document.getElementById('trade-item-title').textContent = item.name || item.base_type || 'Vật phẩm';
  document.getElementById('trade-item-base').textContent = item.name !== item.base_type ? item.base_type : item.item_class;
  document.getElementById('trade-item-rarity').textContent = (item.rarity || 'unknown').toUpperCase();

  const meta = document.getElementById('trade-item-meta');
  meta.replaceChildren();
  [`iLvl ${item.item_level || '—'}`, market.league, `${market.total}${market.inexact ? '+' : ''} listing`].forEach((value) => {
    const tag = document.createElement('span'); tag.className = 'trade-tag'; tag.textContent = value; meta.append(tag);
  });

  const mods = document.getElementById('trade-item-mods');
  mods.replaceChildren();
  market.filters.forEach((filter) => {
    const row = document.createElement('label');
    row.className = 'trade-mod-row'; row.dataset.index = String(filter.index);
    const check = document.createElement('input'); check.type = 'checkbox'; check.checked = filter.selected;
    // A missing GGG stat id is informational, not a disabled control. The
    // user may still select the row for inspection; only the explicit Search
    // action sends a new query, so toggling several rows never floods Trade2.
    check.addEventListener('change', () => {
      setTradeStatus('Điều kiện đã thay đổi — bấm Tìm trên thị trường để truy vấn lại.', 'var(--amber)');
    });
    const text = document.createElement('span'); text.textContent = filter.text;
    if (!filter.trade_id) text.title = 'GGG không có filter tương ứng';
    row.append(check, text); mods.append(row);
  });

  const priced = market.listings.filter((row) => Number.isFinite(row.amount) && row.currency);
  const priceEl = document.getElementById('trade-price-val');
  const chaosEl = document.getElementById('trade-chaos-val');
  const confidence = document.getElementById('trade-conf-badge');
  if (priced.length) {
    const currency = priced[0].currency;
    const values = priced.filter((row) => row.currency === currency).map((row) => row.amount).sort((a, b) => a - b);
    const median = values[Math.floor(values.length / 2)];
    priceEl.textContent = `${median} ${currency}`;
    chaosEl.textContent = `Trung vị ${values.length} listing cùng đơn vị`;
  } else {
    priceEl.textContent = 'Không có giá'; chaosEl.textContent = '';
  }
  confidence.textContent = 'Nguồn: GGG Trade2';
  document.getElementById('trade-note').textContent = 'Giá hiển thị lấy từ listing thật, không phải công thức ước tính. Ctrl+E trong game để mở cửa sổ overlay đầy đủ.';
}

function addToTradeHistory(market) {
  tradeHistory.unshift({ name: market.item.name || market.item.base_type, total: market.total, time: new Date().toLocaleTimeString('vi-VN') });
  tradeHistory = tradeHistory.slice(0, 10);
  window.tradeHistory = tradeHistory;
  renderTradeHistory();
}

function renderTradeHistory() {
  const container = document.getElementById('trade-history-list');
  if (!container) return;
  container.replaceChildren();
  tradeHistory.forEach((entry) => {
    const row = document.createElement('div'); row.className = 'trade-history-item';
    const name = document.createElement('b'); name.textContent = `${entry.name} · ${entry.time}`;
    const total = document.createElement('span'); total.textContent = `${entry.total} listing`;
    row.append(name, total); container.append(row);
  });
}

function recalculateTradeEstimate() { searchCurrentTradeItem(); }
