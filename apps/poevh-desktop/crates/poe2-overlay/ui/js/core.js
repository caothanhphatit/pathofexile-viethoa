/* ==========================================================================
   POEVH Core — Runtime, API Client, Navigation & State Engine
   ========================================================================== */

let lastFeedRenderKey = '';

// ── Accordion Toggle Function ───────────────────────────────────────────────
function toggleAccordion(accId) {
  const el = document.getElementById(accId);
  if (el) {
    el.classList.toggle('collapsed');
    el.querySelector('.nav-accordion-header')?.setAttribute('aria-expanded', String(!el.classList.contains('collapsed')));
  }
}

// ── Navigation ────────────────────────────────────────────────────────────
function navTab(tabId, btn) {
  document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(el => { el.classList.remove('active'); el.removeAttribute('aria-current'); });
  document.getElementById(tabId).classList.add('active');
  btn.classList.add('active');
  btn.setAttribute('aria-current', 'page');
  if (tabId === 'tab-smoother' && typeof loadSmootherInfo === 'function') {
    loadSmootherInfo();
  }
}

// ── Risk level filter ─────────────────────────────────────────────────────
// How likely a feature is to get the account flagged, by what it does to the game:
//   1 low  – only reads logs, the clipboard or web data; never touches the game process
//   2 mid  – patches game files, reads game memory or attaches to game windows,
//            but never acts for the player
//   3 high – presses keys, moves, picks up or uses flasks on the player's behalf
// Menus above the level the user picked are hidden. The choice is stored locally.
const RISK_BY_TAB = {
  'tab-home': 1,
  'tab-trade': 1,
  'tab-expedition': 1,
  'tab-leveling': 1,
  'tab-physical-controllers': 1,
  'tab-smoother': 2,
  'tab-tracker': 2,
  'tab-keybinds': 2,
  'tab-client-mgr': 2,
  'tab-movement': 3,
  'tab-combat': 3,
  'tab-flasks': 3,
  'tab-timed': 3,
  'tab-pickup': 3,
  'tab-stash': 3,
  'tab-party': 3,
  'tab-waystones': 3,
  'tab-shared': 3
};
const RISK_LABEL = { 1: 'Rủi ro thấp', 2: 'Rủi ro vừa', 3: 'Rủi ro cao' };
const RISK_STORAGE_KEY = 'poevh.riskLevel';
const DEFAULT_RISK_LEVEL = 1;

function navItemTabId(btn) {
  const match = /navTab\('([^']+)'/.exec(btn.getAttribute('onclick') || '');
  return match ? match[1] : '';
}

function readRiskLevel() {
  try {
    const stored = Number(localStorage.getItem(RISK_STORAGE_KEY));
    if (stored >= 1 && stored <= 3) return stored;
  } catch (_) { /* storage blocked: fall back to the default */ }
  return DEFAULT_RISK_LEVEL;
}

function decorateRiskLevels() {
  document.querySelectorAll('.nav-item').forEach(btn => {
    const risk = RISK_BY_TAB[navItemTabId(btn)];
    if (!risk || btn.querySelector('.risk-dot')) return;
    btn.dataset.risk = String(risk);
    const dot = document.createElement('span');
    dot.className = 'risk-dot';
    dot.dataset.risk = String(risk);
    dot.title = RISK_LABEL[risk];
    btn.appendChild(dot);
  });
  Object.entries(RISK_BY_TAB).forEach(([tabId, risk]) => {
    const heading = document.querySelector(`#${tabId} .page-heading`);
    if (!heading || heading.querySelector('.risk-badge')) return;
    const badge = document.createElement('span');
    badge.className = 'risk-badge';
    badge.dataset.risk = String(risk);
    badge.textContent = RISK_LABEL[risk];
    heading.appendChild(badge);
  });
}

function setRiskLevel(value) {
  const level = Math.min(Math.max(Number(value) || DEFAULT_RISK_LEVEL, 1), 3);
  try { localStorage.setItem(RISK_STORAGE_KEY, String(level)); } catch (_) { /* not persisted */ }
  applyRiskLevel(level);
}

function applyRiskLevel(level) {
  const picker = document.getElementById('riskPicker');
  const select = document.getElementById('riskLevelSelect');
  if (picker) picker.dataset.level = String(level);
  if (select && select.value !== String(level)) select.value = String(level);

  let hidden = 0;
  document.querySelectorAll('.nav-item').forEach(btn => {
    const risk = Number(btn.dataset.risk || 1);
    const visible = risk <= level;
    btn.hidden = !visible;
    if (!visible) hidden += 1;
  });
  // Drop a whole group (header included) when none of its entries is allowed.
  document.querySelectorAll('.nav-accordion').forEach(group => {
    const items = group.querySelectorAll('.nav-item');
    group.hidden = items.length > 0 && [...items].every(btn => btn.hidden);
  });

  const note = document.getElementById('riskHiddenNote');
  if (note) {
    note.hidden = hidden === 0;
    note.textContent = hidden
      ? `${hidden} mục đang ẩn vì vượt mức rủi ro đã chọn. Đổi "Mức rủi ro" ở góc trên để hiện.`
      : '';
  }

  // Leaving the user on a page they just chose to hide would be confusing.
  const active = document.querySelector('.nav-item.active');
  if (active && active.hidden) {
    const home = document.querySelector('.nav-item[data-risk="1"]');
    if (home) navTab(navItemTabId(home), home);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  decorateRiskLevels();
  applyRiskLevel(readRiskLevel());
});

// ── Catalog Filter ────────────────────────────────────────────────────────
function filterCatalog(query) {
  const q = query.toLowerCase().trim();
  const rows = document.querySelectorAll('.catalog-row');
  for (const row of rows) {
    const name = row.querySelector('.catalog-name')?.textContent.toLowerCase() || '';
    const cat = row.querySelector('.catalog-cat')?.textContent.toLowerCase() || '';
    row.style.display = (!q || name.includes(q) || cat.includes(q)) ? 'flex' : 'none';
  }
}

// ── API Commands ──────────────────────────────────────────────────────────
function newClientRequestId() {
  try {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  } catch (_) { /* use the fallback below */ }
  return `ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function clientRequestHeaders(requestId, extra = {}) {
  return {
    ...extra,
    'X-Api-Token': window.__API_TOKEN__ || '',
    'X-Request-Id': requestId
  };
}

function commandLogContext(body) {
  const value = body?.value;
  return {
    command: body?.command || 'unknown',
    instance_id: body?.instance_id ?? null,
    account_profile_id: body?.account_profile_id ?? null,
    key: body?.key ?? null,
    value_type: Array.isArray(value) ? 'array' : (value === null ? 'null' : typeof value)
  };
}

function reportClientLog(level, message, details = {}) {
  const requestId = details.request_id || newClientRequestId();
  const body = {
    level,
    message: String(message || 'Unknown client error').slice(0, 4096),
    source: String(details.source || 'dashboard').slice(0, 512),
    line: Number.isInteger(details.line) ? details.line : undefined,
    column: Number.isInteger(details.column) ? details.column : undefined,
    stack: String(details.stack || '').slice(0, 6000),
    client_request_id: requestId
  };
  // Browser diagnostics must never prevent the original UI action from
  // completing. `keepalive` also lets an error report leave during unload.
  try {
    fetch('/api/client-log', {
      method: 'POST',
      keepalive: true,
      headers: clientRequestHeaders(requestId, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(body)
    }).catch(() => {});
  } catch (_) { /* diagnostics are best effort */ }
  return requestId;
}

async function apiPost(body) {
  const requestId = newClientRequestId();
  try {
    const res = await fetch('/api/command', {
      method: 'POST',
      headers: clientRequestHeaders(requestId, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(body)
    });
    const snap = await res.json();
    const serverRequestId = res.headers.get('X-Request-Id') || snap.request_id || requestId;
    if (!res.ok) {
      const error = new Error(snap.error || ('HTTP ' + res.status));
      error.requestId = serverRequestId;
      throw error;
    }
    renderState(snap);
    return snap;
  } catch (e) {
    const traceId = e.requestId || requestId;
    console.error('[POEVH] command failed', { request_id: traceId, ...commandLogContext(body), error: e });
    reportClientLog('error', `API command failed: ${e?.message || e}`, {
      request_id: traceId,
      source: '/api/command',
      stack: e?.stack
    });
    const el = document.getElementById('instance-command-status');
    if (el) el.textContent = `Không lưu được: ${e?.message || 'lỗi không xác định'} [Mã: ${traceId}]`;
    return null;
  }
}

function cmdRun(val) { apiPost({ command: 'run', value: val }); }
function cmdReset() { apiPost({ command: 'reset' }); }
function cmdToggle(key, val) { apiPost({ command: 'toggle', key: key, value: val }); }
function cmdResetTracker() { apiPost({ command: 'reset_tracker' }); }
function cmdBroadcastA() { apiPost({ command: 'broadcast_a' }); }
function cmdSetFocus(slot) { apiPost({ command: 'set_focus', value: slot }); }
function cmdSetMouseAction(button, action) { apiPost({ command: 'set_mouse_action', key: button, value: action }); }

function updateParam(key, val, labelId, suffix='', prefix='') {
  const el = document.getElementById(labelId);
  if (el) el.textContent = prefix + val + suffix;
  apiPost({ command: 'set_param', key: key, value: Number(val) });
}

function formatTime(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  return (h > 0 ? h + 'g ' : '') + m + 'p ' + (s < 10 ? '0' : '') + s + 's';
}

// ── Polling & State Dispatcher ─────────────────────────────────────────────
// Set while the status line shows a poll failure, so a successful poll can
// clear its own message without wiping an unrelated command error.
let pollErrorShown = false;

async function pollState() {
  const requestId = newClientRequestId();
  try {
    const res = await fetch('/api/state', {
      headers: clientRequestHeaders(requestId)
    });
    const snap = await res.json();
    if (!res.ok) {
      const error = new Error(snap.error || ('HTTP ' + res.status));
      error.requestId = res.headers.get('X-Request-Id') || requestId;
      throw error;
    }
    if (pollErrorShown) {
      const el = document.getElementById('instance-command-status');
      if (el) el.textContent = '';
      pollErrorShown = false;
    }
    renderState(snap);
  } catch (e) {
    const el = document.getElementById('instance-command-status');
    const traceId = e.requestId || requestId;
    console.warn('[POEVH] state poll failed', { request_id: traceId, error: e });
    if (el) {
      el.textContent = `Không đọc được trạng thái: ${e?.message || 'lỗi kết nối'} [Mã: ${traceId}]`;
      pollErrorShown = true;
    }
  }
}

function renderState(s) {
  const setChecked = (id, value) => {
    const el = document.getElementById(id);
    if (el && document.activeElement !== el) el.checked = Boolean(value);
  };
  const setRange = (id, value, labelId, suffix = '') => {
    const el = document.getElementById(id);
    if (!el || value == null || document.activeElement === el) return;
    el.value = String(value);
    const label = document.getElementById(labelId);
    if (label) label.textContent = String(value) + suffix;
  };

  const memory = s.memory_reader || {};
  const memoryBanner = document.getElementById('memory-compatibility');
  if (memoryBanner) {
    const compatible = memory.state === 'compatible';
    memoryBanner.style.display = compatible ? 'none' : 'block';
    memoryBanner.style.borderColor = memory.state === 'waiting_for_game' ? 'var(--amber)' : 'var(--red)';
    memoryBanner.textContent = memory.state === 'waiting_for_game'
      ? 'Đang chờ Path of Exile 2. Các tính năng tự động sẽ sẵn sàng sau khi kết nối game.'
      : `Phiên bản game hiện tại chưa được hỗ trợ. Các tính năng tự động đã tạm khóa để đảm bảo an toàn.${memory.message ? ` ${memory.message}` : ''}${memory.build_key ? ` · Mã phiên bản: ${memory.build_key}` : ''}`;
  }
  // Keep the quick-control checkbox in sync with the persisted runtime setting.
  // The initial HTML value is only a fallback before the first state snapshot.
  const kbmToggle = document.getElementById('tog-kbm');
  if (kbmToggle && document.activeElement !== kbmToggle) {
    kbmToggle.checked = Boolean(s.settings?.kbm_bridge);
  }

  // Follow controls must be projections of the persisted runtime snapshot.
  // Their HTML values are placeholders used only before the first API state.
  if (s.settings) {
    setChecked('tog-follow', s.settings.follow);
    setChecked('tog-prio-catch', s.config?.prioritize_catchup);
    setChecked('tog-party', s.settings.party?.enabled);
    setChecked('tog-combat', s.settings.party_combat?.enabled);
    setChecked('tog-waystones', s.settings.waystones?.enabled);
  }
  if (s.config) {
    setRange('follow-stop-distance', s.config.stop_distance, 'val-stop-dist', ' bước');
    setRange('follow-sprint-distance', s.config.catch_up_distance, 'val-sprint-dist', ' bước');
  }
  if (typeof instanceServices !== 'undefined') {
    instanceServices = s.instance_services || {};
  }
  if (typeof renderPhysicalControllers === 'function') {
    renderPhysicalControllers(s.instance_services?.controllers || {});
  }

  // Header Status
  const badge = document.getElementById('statusBadge');
  const dot = document.getElementById('statusDot');
  const label = document.getElementById('statusLabel');
  if (badge && dot && label) {
    if (s.running) {
      badge.className = 'status-pill pill-running';
      dot.className = 'pill-dot dot-on';
      label.textContent = 'BOT ĐANG CHẠY';
    } else {
      badge.className = 'status-pill pill-stopped';
      dot.className = 'pill-dot dot-off';
      label.textContent = 'BOT ĐANG TẮT';
    }
  }

  // Multi-Client / Instance UI
  // New snapshots expose persistent account profiles separately; retain the
  // legacy field as a compatibility fallback while the migration rolls out.
  const legacyProfiles = s.settings?.multi_client?.clients || [];
  const rawProfiles = s.instance_services?.account_profiles
    || s.settings?.multi_client?.account_profiles
    || legacyProfiles
    || [];
  // Graphics are runtime preferences in the new model. Merge them from the
  // compatibility profile only for controls that still expose them.
  const profiles = rawProfiles.map(profile => {
    const legacy = legacyProfiles.find(item => item.id === profile.id);
    return {
      ...profile,
      black_screen: profile.black_screen ?? legacy?.black_screen ?? false,
      bg_fps: profile.bg_fps ?? legacy?.bg_fps ?? 60,
    };
  });
  const statuses = (s.instance_services && (s.instance_services.runtime_instances || s.instance_services.instances)) || [];
  const mainInstanceId = s.settings?.multi_client?.main_instance_id
    ?? statuses?.find?.(item => item.is_main)?.instance_id
    ?? profiles[0]?.id
    ?? 1;
  window.poeevhMainInstanceId = mainInstanceId;
  window.poeevhPartyEnabled = Boolean(s.settings?.party?.enabled);
  if (typeof renderInstanceProfiles === 'function') {
    renderInstanceProfiles(profiles);
  }
  if (typeof renderInstanceProcesses === 'function') {
    renderInstanceProcesses(mainInstanceId);
  }
  const byId = new Map(profiles.map(profile => [profile.id, profile]));
  if (typeof renderRuntimeHud === 'function') {
    renderRuntimeHud(profiles, statuses, s.running, s.instance_services?.controllers || {}, window.poeevhPartyEnabled);
  }
  if (typeof updateClientUIState === 'function') {
    for (const id of profiles.map(profile => profile.id)) {
      const status = statuses.find(item => item.instance_id === id);
      const instanceRunning = Boolean(s.running) && (status?.automation_enabled ?? true);
      updateClientUIState(id, byId.get(id), status, instanceRunning);
    }
  }

  const orderedProfileIds = [
    mainInstanceId,
    ...profiles.map(profile => profile.id).filter(id => id !== mainInstanceId),
  ];
  const [client1Id, client2Id, client3Id] = orderedProfileIds;
  const c1Profile = byId.get(client1Id);
  const c2Profile = byId.get(client2Id);
  const c3Profile = byId.get(client3Id);
  const c1Bound = statuses.find(item => item.instance_id === client1Id)?.status === 'bound';
  const c2Bound = statuses.find(item => item.instance_id === client2Id)?.status === 'bound';
  const c3Bound = statuses.find(item => item.instance_id === client3Id)?.status === 'bound';
  const c1Active = c1Profile?.enabled ?? false;
  const c2Active = c2Profile?.enabled ?? false;
  const c3Active = c3Profile?.enabled ?? false;

  // Player 1 (Char 1 - Leader)
  const p1HpLabel = document.getElementById('p1-hp-label');
  const p1HpBar = document.getElementById('p1-hp-bar');
  if (p1HpLabel && p1HpBar) {
    if (!c1Active) {
      p1HpLabel.textContent = 'Chưa bật';
      p1HpLabel.style.color = 'var(--dim)';
      p1HpBar.style.width = '0%';
    } else if (!c1Bound) {
      p1HpLabel.textContent = 'Chờ game';
      p1HpLabel.style.color = 'var(--dim)';
      p1HpBar.style.width = '0%';
    } else if (s.leader) {
      p1HpLabel.textContent = s.leader.hp + '% HP';
      p1HpLabel.style.color = 'var(--green)';
      p1HpBar.style.width = s.leader.hp + '%';
    }
  }

  // Followers (Char 2 to Char 6)
  const followers = s.followers || [];
  const setFollowerUI = (fIndex, hpLabelId, hpBarId, isClientActive, isClientBound) => {
    const hpLabel = document.getElementById(hpLabelId);
    const hpBar = document.getElementById(hpBarId);
    if (!hpLabel || !hpBar) return;
    if (!isClientActive) {
      hpLabel.textContent = 'Chưa bật';
      hpLabel.style.color = 'var(--dim)';
      hpBar.style.width = '0%';
    } else if (!isClientBound) {
      hpLabel.textContent = 'Chờ game';
      hpLabel.style.color = 'var(--dim)';
      hpBar.style.width = '0%';
    } else if (followers[fIndex]) {
      const f = followers[fIndex];
      hpLabel.textContent = f.hp + '% HP';
      hpLabel.style.color = 'var(--green)';
      hpBar.style.width = f.hp + '%';
    }
  };

  setFollowerUI(0, 'p2-hp-label', 'p2-hp-bar', c1Active, c1Bound);
  setFollowerUI(1, 'p3-hp-label', 'p3-hp-bar', c2Active, c2Bound);
  setFollowerUI(2, 'p4-hp-label', 'p4-hp-bar', c2Active, c2Bound);
  setFollowerUI(3, 'p5-hp-label', 'p5-hp-bar', c3Active, c3Bound);
  setFollowerUI(4, 'p6-hp-label', 'p6-hp-bar', c3Active, c3Bound);

  // Per-Instance Resource Stats
  for (const id of [1, 2, 3]) {
    const process = statuses.find(st => st.instance_id === id && st.status === 'bound')?.process;
    const cpuEl = document.getElementById('c' + id + '-cpu');
    const ramEl = document.getElementById('c' + id + '-ram');
    const fpsEl = document.getElementById('c' + id + '-fps');
    const renderEl = document.getElementById('c' + id + '-render');
    if (cpuEl) cpuEl.textContent = process?.cpu_percent == null ? '--' : process.cpu_percent.toFixed(1) + '%';
    if (ramEl) ramEl.textContent = process?.working_set_bytes == null ? '--' : (process.working_set_bytes / 1048576).toFixed(1) + ' MB';
    if (fpsEl) fpsEl.textContent = '--';
    if (renderEl) renderEl.textContent = process?.window ? (process.window.minimized ? 'Đang thu nhỏ' : 'Cửa sổ (OS)') : 'Chưa đo theo PID';
  }

  // Currency Tracker
  if (s.settings && s.settings.tracker) {
    const t = s.settings.tracker;
    const divTot = document.getElementById('trackerTotalDiv');
    const divHr = document.getElementById('trackerDivHr');
    const dur = document.getElementById('trackerDuration');
    const cDiv = document.getElementById('countDiv');
    const cExalt = document.getElementById('countExalt');
    const cChaos = document.getElementById('countChaos');
    const cGold = document.getElementById('countGold');
    if (divTot) divTot.textContent = t.total_div_estimate.toFixed(2) + ' div';
    if (divHr) divHr.textContent = t.div_per_hour.toFixed(2) + ' div/giờ';
    if (dur) dur.textContent = formatTime(t.session_seconds);
    if (cDiv) cDiv.textContent = t.div_count;
    if (cExalt) cExalt.textContent = t.exalt_count;
    if (cChaos) cChaos.textContent = t.chaos_count;
    if (cGold) cGold.textContent = t.gold_count.toLocaleString();
  }

  // Mouse & Controller Settings
  if (s.settings && s.settings.mouse_bindings) {
    const mb = s.settings.mouse_bindings;
    const setVal = (id, val) => { const el = document.getElementById(id); if (el && val && document.activeElement !== el) el.value = val; };
    setChecked('tog-mouse-right-as-a', mb.right_click_as_a);
    setChecked('tog-mouse-right-broadcast', mb.right_click_broadcast);
    setChecked('tog-mouse-key-a-as-right', mb.key_a_as_right_click);
    setVal('sel-mouse-4', mb.mouse_4_action);
    setVal('sel-mouse-5', mb.mouse_5_action);
    setVal('sel-mouse-mid', mb.middle_click_action);
  }

  // Controller Mapping
  if (s.settings && s.settings.controller_mapping && typeof currentRecordingBtn !== 'undefined') {
    const cm = s.settings.controller_mapping;
    const btns = document.querySelectorAll('.keybind-btn');
    for (const b of btns) {
      const btn = b.dataset.btn;
      if (btn && cm[btn] !== undefined && b !== currentRecordingBtn) {
        b.dataset.currentVal = cm[btn];
        const vs = b.querySelector('.keybind-val');
        if (vs && typeof formatKeyDisplay === 'function') vs.textContent = formatKeyDisplay(cm[btn]);
      }
    }
  }

  // Auto-Revive
  if (s.settings) {
    const el = document.getElementById('tog-auto-revive');
    if (el && document.activeElement !== el) el.checked = !!s.settings.auto_revive;
  }

  // Session overview is a read-only projection of the same authenticated snapshot.
  if (typeof refreshOverview === 'function') {
    refreshOverview(s);
  }

  // PoeSmoother & GGPK Sync
  if (typeof syncSmootherState === 'function') {
    syncSmootherState(s);
  }

  // Live Feed
  if (Array.isArray(s.events)) {
    const fb = document.getElementById('feedBox');
    const feedKey = JSON.stringify(s.events.map(e => [e.tick, e.actor, e.action, e.detail, e.important]));
    if (fb && feedKey !== lastFeedRenderKey) {
      lastFeedRenderKey = feedKey;
      fb.replaceChildren();
      for (const e of s.events) {
        const item = document.createElement('div');
        item.className = 'feed-item';

        const tickSpan = document.createElement('span');
        tickSpan.style.color = 'var(--dim)';
        tickSpan.textContent = '#' + e.tick;

        const actorSpan = document.createElement('span');
        const safeActor = String(e.actor).replace(/[^a-zA-Z0-9_-]/g, '');
        actorSpan.className = 'badge-actor actor-' + safeActor;
        actorSpan.textContent = e.actor;

        const actB = document.createElement('b');
        actB.style.color = 'var(--text)';
        actB.textContent = e.action;

        const detailSpan = document.createElement('span');
        detailSpan.style.color = 'var(--sub)';
        detailSpan.textContent = e.detail || '';

        item.append(tickSpan, ' ', actorSpan, ' ', actB, ' ', detailSpan);
        fb.appendChild(item);
      }
    }
  }
}

// Keep JavaScript faults in the same session log as backend command failures.
// This covers event-handler exceptions and promises that a feature module
// forgot to catch, while avoiding any raw form contents or API token.
window.addEventListener('error', (event) => {
  reportClientLog('error', event.message || 'Unhandled browser error', {
    source: event.filename || 'dashboard',
    line: event.lineno,
    column: event.colno,
    stack: event.error?.stack || ''
  });
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  reportClientLog('error', reason?.message || String(reason || 'Unhandled promise rejection'), {
    source: 'dashboard',
    stack: reason?.stack || ''
  });
});

// Initialize on DOM load
window.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.toggle input').forEach(input => {
    const row = input.closest('.toggle-row') || input.parentElement.parentElement;
    const name = row.querySelector('.toggle-label') || row.querySelector('b') || row;
    input.setAttribute('aria-label', name.textContent.trim());
  });
  // Keep a single request in flight and back off while minimized/backgrounded.
  const pollLoop = async () => {
    await pollState();
    window.setTimeout(pollLoop, document.hidden ? 2000 : 500);
  };
  pollLoop();
  if (typeof loadSmootherInfo === 'function') loadSmootherInfo();
});

window.openLevelingOverlay = function () {
  window.open('/leveling-overlay', 'POEVH_Leveling', 'width=300,height=220,resizable=yes');
};
