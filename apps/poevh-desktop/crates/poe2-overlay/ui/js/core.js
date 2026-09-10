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
async function apiPost(body) {
  try {
    const token = window.__API_TOKEN__ || '';
    const res = await fetch('/api/command', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Token': token
      },
      body: JSON.stringify(body)
    });
    const snap = await res.json();
    if (!res.ok) throw new Error(snap.error || ('HTTP ' + res.status));
    renderState(snap);
    return snap;
  } catch (e) {
    const el = document.getElementById('instance-command-status');
    if (el) el.textContent = 'Không lưu được: ' + e.message;
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
async function pollState() {
  try {
    const token = window.__API_TOKEN__ || '';
    const res = await fetch('/api/state', {
      headers: { 'X-Api-Token': token }
    });
    if (res.ok) {
      const snap = await res.json();
      renderState(snap);
    }
  } catch (e) {}
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
  window.poeevhMainInstanceId = s.settings?.multi_client?.main_instance_id ?? 1;
  if (typeof renderInstanceProfiles === 'function') {
    renderInstanceProfiles(profiles);
  }
  if (typeof renderInstanceProcesses === 'function') {
    renderInstanceProcesses(s.settings?.multi_client?.main_instance_id ?? 1);
  }

  const statuses = (s.instance_services && (s.instance_services.runtime_instances || s.instance_services.instances)) || [];
  const byId = new Map(profiles.map(profile => [profile.id, profile]));
  if (typeof renderRuntimeHud === 'function') {
    renderRuntimeHud(profiles, statuses, s.running, s.instance_services?.controllers || {});
  }
  if (typeof updateClientUIState === 'function') {
    for (const id of [1, 2, 3]) {
      const status = statuses.find(item => item.instance_id === id);
      updateClientUIState(id, byId.get(id), status, s.running);
    }
  }

  const c1Profile = byId.get(1);
  const c2Profile = byId.get(2);
  const c3Profile = byId.get(3);
  const c1Bound = statuses.find(item => item.instance_id === 1)?.status === 'bound';
  const c2Bound = statuses.find(item => item.instance_id === 2)?.status === 'bound';
  const c3Bound = statuses.find(item => item.instance_id === 3)?.status === 'bound';
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
