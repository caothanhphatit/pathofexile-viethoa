/* ==========================================================================
   POEVH Premium — nhập key, kiểm tra giấy phép và hiển thị trạng thái
   ========================================================================== */

const PREMIUM_ERROR_TEXT = {
  bad_key: 'Key không đúng định dạng. Key có dạng PVH-XXXXX-XXXXX-XXXXX-XXXXX.',
  unknown_key: 'Key không tồn tại hoặc đã bị thu hồi. Tạo key mới tại poeviethoa.net/premium.',
  premium_expired: 'Gói premium của tài khoản này đã hết hạn.',
  device_mismatch: 'Key này đang dùng trên máy khác. Vào poeviethoa.net/premium để đổi thiết bị (30 ngày một lần).',
  signing_unavailable: 'Máy chủ chưa bật cấp giấy phép premium. Thử lại sau.',
  rate_limited: 'Thử quá nhiều lần. Đợi một phút rồi thử lại.',
  network: 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.',
  bad_token: 'Giấy phép máy chủ trả về không hợp lệ.',
  token_expired: 'Giấy phép đã hết hạn và chưa làm mới được.',
  busy: 'Đang kiểm tra, đợi một chút.',
  no_key: 'Chưa có key nào được lưu trên máy này.'
};

const PREMIUM_STATE_TEXT = {
  no_key: { pill: 'PREMIUM: CHƯA CÓ KEY', line: 'Chưa nhập key. Dán key từ trang premium để kích hoạt.', cls: 'pill-stopped', dot: 'dot-off' },
  active: { pill: 'PREMIUM', line: 'Giấy phép hợp lệ trên máy này.', cls: 'pill-running', dot: 'dot-on' },
  expired: { pill: 'PREMIUM: HẾT HẠN', line: 'Giấy phép đã hết hạn hoặc chưa làm mới được. Bấm "Kiểm tra lại".', cls: 'pill-stopped', dot: 'dot-off' },
  rejected: { pill: 'PREMIUM: KEY BỊ TỪ CHỐI', line: 'Máy chủ từ chối key này.', cls: 'pill-stopped', dot: 'dot-off' }
};

const PREMIUM_POLL_MS = 60_000;
let premiumPollTimer = null;

function premiumErrorText(code, fallback) {
  return PREMIUM_ERROR_TEXT[code] || fallback || 'Lỗi không xác định';
}

function formatPremiumDate(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  return date.toLocaleString('vi-VN', { hour12: false });
}

async function premiumApi(path, body) {
  const requestId = newClientRequestId();
  const hasBody = body !== undefined;
  const res = await fetch(path, {
    method: hasBody ? 'POST' : 'GET',
    headers: clientRequestHeaders(requestId, hasBody ? { 'Content-Type': 'application/json' } : {}),
    body: hasBody ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (data.premium) renderPremium(data.premium);
  if (!res.ok || data.ok === false) {
    const error = new Error(premiumErrorText(data.code, data.error || ('HTTP ' + res.status)));
    error.code = data.code || null;
    error.requestId = res.headers.get('X-Request-Id') || requestId;
    throw error;
  }
  return data.premium;
}

function setPremiumBusy(busy) {
  ['premium-activate', 'premium-refresh', 'premium-deactivate'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = Boolean(busy);
  });
}

function renderPremium(p) {
  if (!p) return;
  const view = PREMIUM_STATE_TEXT[p.state] || PREMIUM_STATE_TEXT.no_key;

  const pill = document.getElementById('premiumPill');
  const pillDot = document.getElementById('premiumDot');
  const pillLabel = document.getElementById('premiumLabel');
  if (pill) pill.className = `status-pill ${view.cls}`;
  if (pillDot) pillDot.className = `pill-dot ${view.dot}`;
  if (pillLabel) pillLabel.textContent = p.verifying ? 'PREMIUM: ĐANG KIỂM TRA' : view.pill;

  const badge = document.getElementById('premium-state-badge');
  if (badge) {
    badge.className = `status-pill ${view.cls}`;
    badge.innerHTML = `<span class="pill-dot ${view.dot}"></span><span>${p.verifying ? 'ĐANG KIỂM TRA' : view.pill.replace('PREMIUM: ', '')}</span>`;
  }
  const line = document.getElementById('premium-state-line');
  if (line) line.textContent = view.line;

  const facts = {
    'premium-fact-key': p.key_prefix ? `${p.key_prefix}-…` : '—',
    'premium-fact-plan': p.plan ? ({ month: 'Tháng', year: 'Năm', lifetime: 'Trọn đời', custom: 'Tùy chỉnh' }[p.plan] || p.plan) : '—',
    'premium-fact-until': p.active ? (p.premium_until ? formatPremiumDate(p.premium_until) : 'Không giới hạn') : '—',
    'premium-fact-token': p.token_expires_at ? formatPremiumDate(p.token_expires_at) : '—',
    'premium-fact-verified': p.last_verified_at ? formatPremiumDate(p.last_verified_at) : 'Chưa từng',
    'premium-fact-device': p.device_label || '—'
  };
  Object.entries(facts).forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  });

  const error = document.getElementById('premium-error');
  if (error) {
    const hasError = Boolean(p.last_error_code) && p.state !== 'active';
    error.hidden = !hasError;
    error.textContent = hasError ? premiumErrorText(p.last_error_code, p.last_error) : '';
  }

  const hasKey = p.state !== 'no_key';
  const refresh = document.getElementById('premium-refresh');
  const deactivate = document.getElementById('premium-deactivate');
  if (refresh) refresh.hidden = !hasKey;
  if (deactivate) deactivate.hidden = !hasKey;
  const activateTitle = document.getElementById('premium-activate-title');
  if (activateTitle) activateTitle.textContent = hasKey ? 'Đổi sang key khác' : 'Nhập key';
  setPremiumBusy(p.verifying);
  applyPremiumLock(Boolean(p.active));
}

async function loadPremiumStatus() {
  try {
    await premiumApi('/api/premium/status');
  } catch (e) {
    console.warn('[POEVH] premium status failed', e);
  }
}

async function activatePremium(event) {
  if (event) event.preventDefault();
  const input = document.getElementById('premium-key-input');
  const status = document.getElementById('premium-activate-status');
  const key = (input?.value || '').trim();
  if (!key) {
    if (status) { status.style.color = 'var(--amber)'; status.textContent = 'Dán key vào ô trước.'; }
    return false;
  }
  setPremiumBusy(true);
  if (status) { status.style.color = 'var(--sub)'; status.textContent = 'Đang kiểm tra key với máy chủ…'; }
  try {
    const premium = await premiumApi('/api/premium/activate', { key });
    if (input) input.value = '';
    if (status) {
      status.style.color = 'var(--green)';
      status.textContent = premium?.active ? 'Kích hoạt thành công. Máy này đã được gắn với key.' : 'Máy chủ đã nhận key.';
    }
  } catch (e) {
    if (status) {
      status.style.color = 'var(--red)';
      status.textContent = `${e.message}${e.requestId ? ` [Mã: ${e.requestId}]` : ''}`;
    }
  } finally {
    setPremiumBusy(false);
  }
  return false;
}

async function refreshPremium() {
  const status = document.getElementById('premium-activate-status');
  setPremiumBusy(true);
  if (status) { status.style.color = 'var(--sub)'; status.textContent = 'Đang kiểm tra lại giấy phép…'; }
  try {
    await premiumApi('/api/premium/refresh', {});
    if (status) { status.style.color = 'var(--green)'; status.textContent = 'Giấy phép đã được làm mới.'; }
  } catch (e) {
    if (status) { status.style.color = 'var(--red)'; status.textContent = e.message; }
  } finally {
    setPremiumBusy(false);
  }
}

async function deactivatePremium() {
  if (!window.confirm('Gỡ key khỏi máy này? Bạn có thể dán lại key bất cứ lúc nào; máy này vẫn được tính là cùng một thiết bị.')) return;
  const status = document.getElementById('premium-activate-status');
  setPremiumBusy(true);
  try {
    await premiumApi('/api/premium/deactivate', {});
    if (status) { status.style.color = 'var(--sub)'; status.textContent = 'Đã gỡ key khỏi máy này.'; }
  } catch (e) {
    if (status) { status.style.color = 'var(--red)'; status.textContent = e.message; }
  } finally {
    setPremiumBusy(false);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadPremiumStatus();
  if (premiumPollTimer) clearInterval(premiumPollTimer);
  premiumPollTimer = setInterval(loadPremiumStatus, PREMIUM_POLL_MS);
});

// ── Follow bot lock ───────────────────────────────────────────────────────
// Every page in the FOLLOW BOT group needs premium. The server refuses their
// commands anyway (HTTP 402); the overlay only explains why.
let premiumActive = false;

function premiumLockedTabs() {
  return [...document.querySelectorAll('#acc-auto .nav-item')].map(navItemTabId).filter(Boolean);
}

function applyPremiumLock(active) {
  premiumActive = active;
  document.body.classList.toggle('premium-active', active);
  const locked = new Set(active ? [] : premiumLockedTabs());
  document.querySelectorAll('#acc-auto .nav-item').forEach(btn => {
    btn.classList.toggle('premium-locked', locked.has(navItemTabId(btn)));
  });
  updatePremiumLockOverlay();
}

function updatePremiumLockOverlay() {
  const overlay = document.getElementById('premium-lock');
  if (!overlay) return;
  const pane = document.querySelector('.tab-pane.active');
  const show = !premiumActive && Boolean(pane) && premiumLockedTabs().includes(pane.id);
  overlay.hidden = !show;
  if (pane) pane.inert = show;
}

function goToPremium() {
  const btn = document.querySelector('.nav-item[onclick*="tab-premium"]');
  if (btn) navTab('tab-premium', btn);
}

// navTab lives in core.js; re-check the lock after every page switch.
if (typeof navTab === 'function') {
  const baseNavTab = navTab;
  navTab = function (tabId, btn) {
    baseNavTab(tabId, btn);
    updatePremiumLockOverlay();
    if (tabId === 'tab-premium') loadPremiumOffer();
  };
}

// Start/stop also comes from the topbar and hotkeys; tell the user why a start
// did nothing instead of failing silently.
if (typeof apiPost === 'function') {
  const baseApiPost = apiPost;
  apiPost = async function (body) {
    const result = await baseApiPost(body);
    if (result === null && !premiumActive) {
      const el = document.getElementById('instance-command-status');
      if (el && /Premium/i.test(el.textContent)) goToPremium();
    }
    return result;
  };
}

// ── Buy screen ────────────────────────────────────────────────────────────
let premiumOfferLoaded = false;

function formatPremiumPrice(price, currency) {
  if (price === null || price === undefined || price === '') return null;
  const value = Number(price);
  if (!Number.isFinite(value)) return String(price);
  try {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: currency || 'VND', maximumFractionDigits: 0 }).format(value);
  } catch (_) {
    return `${value.toLocaleString('vi-VN')} ${currency || ''}`.trim();
  }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderPremiumOffer(offer) {
  const plans = document.getElementById('premium-plans');
  if (plans) {
    plans.replaceChildren();
    (offer.plans || []).forEach(plan => {
      const card = el('div', `premium-plan${plan.id === 'year' ? ' featured' : ''}`);
      card.appendChild(el('div', 'premium-plan-name', plan.name || plan.id));
      const price = formatPremiumPrice(plan.price, offer.currency);
      card.appendChild(el('div', `premium-plan-price${price ? '' : ' muted'}`, price || 'Liên hệ'));
      const note = plan.days ? `${plan.days} ngày, cộng dồn với gói đang dùng` : 'Dùng vĩnh viễn';
      card.appendChild(el('div', 'premium-plan-note', plan.note || note));
      plans.appendChild(card);
    });
  }

  const pay = offer.payment || {};
  const rows = [
    ['Hình thức', pay.method],
    ['Ngân hàng', pay.bank],
    ['Số tài khoản', pay.account, true],
    ['Chủ tài khoản', pay.holder],
    ['Nội dung CK', (pay.note_template || '').replace('{email}', '<email tài khoản>').replace('{plan}', '<gói>'), true],
    ['Liên hệ', pay.contact]
  ].filter(([, value]) => value);
  const box = document.getElementById('premium-pay');
  const list = document.getElementById('premium-pay-list');
  if (box && list) {
    list.replaceChildren();
    rows.forEach(([label, value, copyable]) => {
      list.appendChild(el('dt', '', label));
      const dd = el('dd');
      dd.appendChild(el('span', '', value));
      if (copyable) {
        const copy = el('button', 'btn btn-neutral btn-sm', 'Sao chép');
        copy.type = 'button';
        copy.onclick = () => copyPremiumText(value, copy);
        dd.appendChild(copy);
      }
      list.appendChild(dd);
    });
    // Only the method is known: the admin has not filled in bank details yet.
    box.hidden = rows.length <= 1;
  }

  const steps = document.getElementById('premium-steps');
  if (steps) {
    steps.replaceChildren(...(offer.steps || []).map(step => el('li', '', step)));
  }
}

async function copyPremiumText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    if (button) {
      const label = button.textContent;
      button.textContent = 'Đã chép';
      setTimeout(() => { button.textContent = label; }, 1500);
    }
  } catch (_) {
    window.prompt('Sao chép thủ công:', text);
  }
}

async function loadPremiumOffer(force = false) {
  if (premiumOfferLoaded && !force) return;
  const status = document.getElementById('premium-offer-status');
  try {
    const requestId = newClientRequestId();
    const res = await fetch('/api/premium/offer', { headers: clientRequestHeaders(requestId) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(premiumErrorText(data.code, data.error || ('HTTP ' + res.status)));
    renderPremiumOffer(data.offer || {});
    premiumOfferLoaded = true;
    if (status) status.textContent = '';
  } catch (e) {
    const plans = document.getElementById('premium-plans');
    if (plans) plans.replaceChildren(el('div', '', 'Không tải được bảng giá. Bấm "Mở trang Premium" để xem trên web.'));
    if (status) { status.style.color = 'var(--amber)'; status.textContent = e.message; }
  }
}

async function openPremiumPage() {
  const status = document.getElementById('premium-offer-status');
  try {
    const requestId = newClientRequestId();
    const res = await fetch('/api/premium/open-page', { method: 'POST', headers: clientRequestHeaders(requestId) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
    if (status) { status.style.color = 'var(--sub)'; status.textContent = `Đã mở ${data.url} trong trình duyệt.`; }
  } catch (e) {
    if (status) { status.style.color = 'var(--red)'; status.textContent = `Không mở được trình duyệt: ${e.message}`; }
  }
}
