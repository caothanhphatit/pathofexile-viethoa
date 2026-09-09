/* Leveling Guide & Quest Companion Tab for POEVH Dashboard */
(function () {
  const $ = (id) => document.getElementById(id);
  const token = () => window.__API_TOKEN__ || '';

  const COMPLETED_KEY = 'poevh.leveling.completed';
  const routes = window.levelingRouteZones || [];

  let currentActFilter = 'all';
  let searchQuery = '';
  let lastLiveZone = '';

  function loadCompleted() {
    try {
      const raw = localStorage.getItem(COMPLETED_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  function saveCompleted(arr) {
    try {
      localStorage.setItem(COMPLETED_KEY, JSON.stringify(arr));
    } catch (_) {}
  }

  function isTaskDone(taskId, completedSet) {
    return completedSet.has(taskId);
  }

  function toggleTask(taskId) {
    const completed = new Set(loadCompleted());
    if (completed.has(taskId)) {
      completed.delete(taskId);
    } else {
      completed.add(taskId);
    }
    const arr = Array.from(completed);
    saveCompleted(arr);
    updateProgress(arr);
  }

  function getZoneAct(zone, index) {
    if (zone.act) return zone.act.toLowerCase();
    if (index < 18) return 'act1';
    if (index < 43) return 'act2';
    if (index < 68) return 'act3';
    if (index < 87) return 'act4';
    return 'interlude';
  }

  function updateProgress(completedArr) {
    const completed = completedArr || loadCompleted();
    const completedSet = new Set(completed);
    let totalTasks = 0;
    let doneTasks = 0;

    routes.forEach((z) => {
      (z.tasks || []).forEach((t) => {
        if (!t.tip) {
          totalTasks++;
          if (completedSet.has(t.id)) doneTasks++;
        }
      });
    });

    const percent = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;
    const countEl = $('leveling-progress-text');
    const barEl = $('leveling-progress-bar');
    if (countEl) countEl.textContent = `${doneTasks} / ${totalTasks} nhiệm vụ (${percent}%)`;
    if (barEl) barEl.style.width = `${percent}%`;
  }

  function renderZones() {
    const container = $('leveling-zones-container');
    if (!container) return;

    if (!routes.length) {
      container.innerHTML = '<div style="color:var(--sub);font-style:italic;padding:16px">Đang tải dữ liệu nhiệm vụ...</div>';
      return;
    }

    const completedSet = new Set(loadCompleted());
    const query = searchQuery.trim().toLowerCase();

    let html = '';
    let visibleCount = 0;

    const activeLiveIndex = lastLiveZone ? matchZoneIndex(lastLiveZone) : -1;

    routes.forEach((zone, idx) => {
      const act = getZoneAct(zone, idx);
      if (currentActFilter !== 'all' && currentActFilter !== act) {
        return;
      }

      const titleMatch = (zone.title || '').toLowerCase().includes(query);
      const levelMatch = (zone.level || '').toLowerCase().includes(query);
      const taskMatch = (zone.tasks || []).some((t) => (t.text || '').toLowerCase().includes(query));

      if (query && !titleMatch && !levelMatch && !taskMatch) {
        return;
      }

      visibleCount++;
      const isCurrentZone = idx === activeLiveIndex;
      const hasWp = (zone.meta || '').toLowerCase().includes('waypoint');
      const isTown = (zone.meta || '').toLowerCase().includes('town');

      html += `
        <div class="card leveling-zone-card ${isCurrentZone ? 'active-live-zone' : ''}" id="zone-card-${idx}" style="margin-bottom:12px;border:1px solid ${isCurrentZone ? 'var(--cyan)' : 'var(--border)'};background:${isCurrentZone ? 'rgba(78,205,196,0.06)' : 'var(--card-bg)'};">
          <div class="card-header" style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:var(--bg2);border-radius:6px 6px 0 0">
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
              <span style="font-weight:700;font-size:15px;color:${isCurrentZone ? 'var(--cyan)' : 'var(--text)'}">
                ${idx + 1}. ${escapeHtml(zone.title)}
              </span>
              <span class="badge" style="background:var(--bg3);font-size:11px;color:var(--gold-bright,#d4af37)">${escapeHtml(zone.level || '')}</span>
              ${hasWp ? '<span class="badge" style="background:#1b382b;color:#4ade80;font-size:11px">🏛 Waypoint</span>' : ''}
              ${isTown ? '<span class="badge" style="background:#2d1b4e;color:#c084fc;font-size:11px">🏰 Thị trấn</span>' : ''}
              ${isCurrentZone ? '<span class="badge" style="background:#0e4429;color:#3fb950;font-size:11px">● Đang ở map này</span>' : ''}
            </div>
            <div style="display:flex;gap:6px">
              <button class="btn btn-neutral btn-sm" onclick="jumpToZoneInHud(${idx})">▶ Xem trên HUD</button>
            </div>
          </div>
          <div style="padding:12px 14px">
            <div class="leveling-task-list" style="display:flex;flex-direction:column;gap:8px">
      `;

      let tipsList = [];

      (zone.tasks || []).forEach((task) => {
        if (task.tip) {
          tipsList.push(task);
          return;
        }

        const checked = isTaskDone(task.id, completedSet);
        html += `
          <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;font-size:13px;line-height:1.4;user-select:none">
            <input type="checkbox" style="margin-top:2px;cursor:pointer;accent-color:var(--gold,#c8a75b)" ${checked ? 'checked' : ''} onchange="onTabTaskCheck('${task.id}')">
            <span style="flex:1;color:${checked ? 'var(--dim)' : 'var(--text)'};text-decoration:${checked ? 'line-through' : 'none'}">
              ${task.text}
              ${renderBadges(task.badges)}
            </span>
          </label>
        `;
      });

      html += `</div>`;

      if (tipsList.length > 0) {
        html += `
          <div style="margin-top:10px;padding:8px 12px;background:rgba(200,167,91,0.08);border:1px dashed var(--gold,#c8a75b);border-radius:6px;font-size:12px;color:var(--gold-bright,#f0d887)">
            ${tipsList.map((t) => `<div style="margin-bottom:4px">💡 <strong>Lưu ý:</strong> ${t.text} ${renderBadges(t.badges)}</div>`).join('')}
          </div>
        `;
      }

      html += `
          </div>
        </div>
      `;
    });

    if (visibleCount === 0) {
      html = '<div style="color:var(--sub);font-style:italic;padding:24px;text-align:center">Không tìm thấy khu vực nào phù hợp với từ khóa tìm kiếm.</div>';
    }

    container.innerHTML = html;
  }

  function renderBadges(badges) {
    if (!badges || !badges.length) return '';
    return badges.map((b) => {
      let bg = 'rgba(255,255,255,0.08)';
      let fg = 'var(--text)';
      if (b.tone === 'red') { bg = 'rgba(239,68,68,0.18)'; fg = '#f87171'; }
      else if (b.tone === 'blue') { bg = 'rgba(59,130,246,0.18)'; fg = '#60a5fa'; }
      else if (b.tone === 'green') { bg = 'rgba(34,197,94,0.18)'; fg = '#4ade80'; }
      else if (b.tone === 'violet') { bg = 'rgba(168,85,247,0.18)'; fg = '#c084fc'; }
      else if (b.tone === 'amber') { bg = 'rgba(245,158,11,0.18)'; fg = '#fbbf24'; }
      return `<span style="display:inline-block;margin-left:4px;padding:1px 6px;border-radius:4px;font-size:11px;font-weight:600;background:${bg};color:${fg}">${escapeHtml(b.text)}</span>`;
    }).join('');
  }

  function escapeHtml(val) {
    return String(val || '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // Window bridge functions
  window.onTabTaskCheck = function (taskId) {
    toggleTask(taskId);
    renderZones();
  };

  window.filterLevelingAct = function (act, btn) {
    currentActFilter = act;
    document.querySelectorAll('.leveling-act-btn').forEach((b) => b.classList.remove('btn-primary'));
    if (btn) btn.classList.add('btn-primary');
    renderZones();
  };

  window.onLevelingSearchInput = function (val) {
    searchQuery = val || '';
    renderZones();
  };

  window.resetLevelingProgress = function () {
    if (confirm('Bạn có chắc muốn xóa toàn bộ tiến độ nhiệm vụ đã tick không?')) {
      localStorage.removeItem(COMPLETED_KEY);
      updateProgress([]);
      renderZones();
    }
  };

  function matchZoneIndex(gameZoneName) {
    if (!gameZoneName || typeof gameZoneName !== 'string') return -1;
    const clean = gameZoneName.toLowerCase().trim();
    if (!clean) return -1;

    // 1. Exact match
    const exact = routes.findIndex(z => (z.title || '').toLowerCase().trim() === clean);
    if (exact !== -1) return exact;

    const norm = (s) => (s || '')
      .toLowerCase()
      .replace(/^the\s+/, '')
      .replace(/[^a-z0-9]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const cleanNorm = norm(clean);

    // 2. Normalized match
    const normExact = routes.findIndex(z => norm(z.title) === cleanNorm);
    if (normExact !== -1) return normExact;

    // 3. Fallback prefix/contains
    const partial = routes.findIndex(z => {
      const tNorm = norm(z.title);
      return tNorm && (tNorm === cleanNorm || cleanNorm.startsWith(tNorm) || tNorm.startsWith(cleanNorm));
    });
    return partial;
  }

  window.jumpToCurrentZone = function () {
    if (!lastLiveZone) return;
    const target = matchZoneIndex(lastLiveZone);
    if (target !== -1) {
      jumpToZoneInHud(target);
      const el = $(`zone-card-${target}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  window.jumpToZoneInHud = function (idx) {
    try {
      localStorage.setItem('poevh.leveling.jump_index', String(idx));
    } catch (_) {}
  };

  // Toggle HUD Overlay from Tab
  window.toggleLevelingOverlay = async function (checked) {
    const badge = $('leveling-hud-status-badge');
    if (badge) badge.textContent = checked ? 'Đang bật' : 'Tắt';

    if (window.ipc) {
      window.ipc.postMessage(checked ? 'toggle-leveling' : 'hide-leveling');
    } else {
      try {
        await fetch('/api/leveling/set-visibility', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Api-Token': token()
          },
          body: JSON.stringify({ visible: checked })
        });
      } catch (_) {}
    }
  };

  // Sync visibility state from backend desktop app
  window.updateLevelingOverlayVisibility = function (visible) {
    const toggle = $('leveling-hud-toggle');
    const badge = $('leveling-hud-status-badge');
    if (toggle) toggle.checked = !!visible;
    if (badge) {
      badge.textContent = visible ? 'Đang bật' : 'Tắt';
      badge.className = visible ? 'badge badge-online' : 'badge';
    }
  };

  async function syncOverlayVisibility() {
    try {
      const res = await fetch('/api/leveling/visibility', {
        headers: { 'X-Api-Token': token() }
      });
      if (res.ok) {
        const data = await res.json();
        window.updateLevelingOverlayVisibility(data.visible);
      }
    } catch (_) {}
  }

  async function pollCurrentZone() {
    try {
      const res = await fetch('/api/leveling/current-zone', {
        headers: { 'X-Api-Token': token() },
        cache: 'no-store'
      });
      if (res.ok) {
        const data = await res.json();
        const zone = (data.zone || '').trim();
        const disp = $('leveling-current-zone-display');
        const jumpBtn = $('btn-jump-current-zone');

        if (zone) {
          if (zone !== lastLiveZone) {
            lastLiveZone = zone;
            renderZones();
          }
          if (disp) {
            disp.textContent = `📍 ${zone}`;
            disp.style.color = 'var(--cyan)';
          }
          if (jumpBtn) jumpBtn.style.display = 'inline-flex';
        } else {
          if (disp) {
            disp.textContent = 'Chưa vào map (chờ Client.txt)';
            disp.style.color = 'var(--sub)';
          }
          if (jumpBtn) jumpBtn.style.display = 'none';
        }
      }
    } catch (_) {}
  }

  // Initialize
  window.initLevelingTab = function () {
    updateProgress();
    renderZones();
    syncOverlayVisibility();
    pollCurrentZone();
    setInterval(pollCurrentZone, 1500);
  };

  document.addEventListener('DOMContentLoaded', () => {
    window.initLevelingTab();
  });
})();
