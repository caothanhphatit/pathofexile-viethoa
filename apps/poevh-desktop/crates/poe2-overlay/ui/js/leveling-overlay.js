(() => {
  const $ = (id) => document.getElementById(id);
  const route = window.levelingRouteZones || [];

  let activeIndex = 0;
  let completedTasks = new Set(JSON.parse(localStorage.getItem('poevh.leveling.completed') || '[]'));
  let lastReportedZone = '';

  // ─── Render Zone ───────────────────────────────────────────────────────────
  function renderZone(index) {
    if (!route.length) return;
    if (index < 0) index = 0;
    if (index >= route.length) index = route.length - 1;
    activeIndex = index;

    const zone = route[index];
    $('zone-name').textContent = zone.title || 'Khu vực';
    $('zone-level').textContent = zone.level || '';

    // Render tasks
    const list = $('task-list');
    list.replaceChildren();

    const tasks = (zone.tasks || []).filter(t => !t.tip);
    const tipTask = (zone.tasks || []).find(t => t.tip);

    let doneCount = 0;
    tasks.forEach(task => {
      const isDone = completedTasks.has(task.id);
      if (isDone) doneCount++;

      const item = document.createElement('label');
      item.className = 'task-item' + (isDone ? ' is-done' : '');

      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.className = 'task-checkbox';
      chk.checked = isDone;
      chk.addEventListener('change', () => {
        if (chk.checked) {
          completedTasks.add(task.id);
        } else {
          completedTasks.delete(task.id);
        }
        localStorage.setItem('poevh.leveling.completed', JSON.stringify([...completedTasks]));
        renderZone(activeIndex);
      });

      const body = document.createElement('div');
      body.className = 'task-body';
      body.innerHTML = task.text;

      if (task.badges && task.badges.length) {
        const badgeRow = document.createElement('span');
        badgeRow.className = 'badge-row';
        task.badges.forEach(b => {
          const span = document.createElement('span');
          span.className = 'badge ' + (b.tone || 'amber');
          span.textContent = b.text;
          badgeRow.appendChild(span);
        });
        body.appendChild(badgeRow);
      }

      item.appendChild(chk);
      item.appendChild(body);
      list.appendChild(item);
    });

    $('zone-progress').textContent = `${doneCount}/${tasks.length}`;

    // Tip box
    const tipBox = $('tip-box');
    if (tipTask) {
      tipBox.hidden = false;
      $('tip-text').innerHTML = tipTask.text;
    } else {
      tipBox.hidden = true;
    }
  }

  // ─── Find Zone in Route ───────────────────────────────────────────────────
  function matchZone(gameZoneName) {
    if (!gameZoneName || typeof gameZoneName !== 'string') return -1;
    const clean = gameZoneName.toLowerCase().trim();
    if (!clean) return -1;

    // 1. Exact match (case-insensitive)
    const exact = route.findIndex(z => (z.title || '').toLowerCase().trim() === clean);
    if (exact !== -1) return exact;

    const norm = (s) => (s || '')
      .toLowerCase()
      .replace(/^the\s+/, '')
      .replace(/[^a-z0-9]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const cleanNorm = norm(clean);

    // 2. Normalized exact match (e.g. "Grelwood" vs "The Grelwood")
    const normExact = route.findIndex(z => norm(z.title) === cleanNorm);
    if (normExact !== -1) return normExact;

    // 3. Fallback: contains or prefix match (prefer longer/word boundaries)
    const partial = route.findIndex(z => {
      const tNorm = norm(z.title);
      return tNorm && (tNorm === cleanNorm || cleanNorm.startsWith(tNorm) || tNorm.startsWith(cleanNorm));
    });
    return partial;
  }

  // ─── Polling Client.txt Event from POEVH Backend (Zero-RAM) ───────────────
  async function pollZone() {
    try {
      const token = window.__API_TOKEN__ || '';
      const res = await fetch('/api/leveling/current-zone', {
        cache: 'no-store',
        headers: {
          'x-api-token': token
        }
      });
      if (res.ok) {
        const data = await res.json();
        const zone = (data.zone || '').trim();
        const ind = $('auto-indicator');
        if (ind) {
          ind.className = 'indicator-dot online';
          ind.textContent = '● Auto';
        }

        if (zone && zone !== lastReportedZone) {
          lastReportedZone = zone;
          const idx = matchZone(zone);
          if (idx !== -1) {
            renderZone(idx);
          }
        }
      } else {
        const ind = $('auto-indicator');
        if (ind) {
          ind.className = 'indicator-dot';
          ind.textContent = '○ Offline';
        }
      }
    } catch (_) {
      const ind = $('auto-indicator');
      if (ind) {
        ind.className = 'indicator-dot';
        ind.textContent = '○ Offline';
      }
    }
  }

  // ─── Drag Window via Tao ──────────────────────────────────────────────────
  const header = $('leveling-header');
  if (header) {
    header.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      if (window.ipc) {
        window.ipc.postMessage('drag-leveling');
      }
    });
  }

  // ─── Controls & Collapse ──────────────────────────────────────────────────
  $('btn-prev').addEventListener('click', () => {
    if (activeIndex > 0) renderZone(activeIndex - 1);
  });
  $('btn-next').addEventListener('click', () => {
    if (activeIndex < route.length - 1) renderZone(activeIndex + 1);
  });

  $('btn-collapse').addEventListener('click', () => {
    const shell = $('leveling-shell');
    const isCol = shell.classList.toggle('collapsed');
    $('btn-collapse').textContent = isCol ? '+' : '_';
    if (window.ipc) {
      window.ipc.postMessage(isCol ? 'collapse-leveling' : 'expand-leveling');
    }
  });

  $('btn-close').addEventListener('click', () => {
    if (window.ipc) {
      window.ipc.postMessage('hide-leveling');
    } else {
      $('leveling-shell').style.display = 'none';
    }
  });

  const indEl = $('auto-indicator');
  if (indEl) {
    indEl.style.cursor = 'pointer';
    indEl.title = 'Bấm để chuyển về map hiện tại';
    indEl.addEventListener('click', () => {
      if (lastReportedZone) {
        const idx = matchZone(lastReportedZone);
        if (idx !== -1) renderZone(idx);
      }
    });
  }

  // Init
  document.addEventListener('DOMContentLoaded', () => {
    let initIdx = 0;
    try {
      const saved = localStorage.getItem('poevh.leveling.jump_index');
      if (saved != null) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= 0 && parsed < route.length) {
          initIdx = parsed;
        }
      }
    } catch (_) {}

    renderZone(initIdx);
    pollZone();
    setInterval(pollZone, 1200);

    window.addEventListener('storage', (e) => {
      if (e.key === 'poevh.leveling.jump_index' && e.newValue != null) {
        const idx = parseInt(e.newValue, 10);
        if (!isNaN(idx)) renderZone(idx);
      }
    });
  });
})();
