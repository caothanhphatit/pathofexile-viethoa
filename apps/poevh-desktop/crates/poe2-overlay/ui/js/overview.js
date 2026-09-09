/* Tổng quan phiên. Read-only projection of the authenticated runtime snapshot. */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const setText = (id, value) => { const el = $(id); if (el) el.textContent = String(value ?? '—'); };
  let tradeHistoryRenderKey = '';

  function formatClock(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    return [hours, minutes, secs].map((part) => String(part).padStart(2, '0')).join(':');
  }

  function processUptimeSeconds(startedAt) {
    if (!startedAt || !/^[0-9a-f]{1,16}$/i.test(startedAt)) return 0;
    try {
      const windowsTicks = BigInt(`0x${startedAt}`);
      const unixEpochTicks = 116444736000000000n;
      if (windowsTicks <= unixEpochTicks) return 0;
      const startedMs = Number((windowsTicks - unixEpochTicks) / 10000n);
      return Math.max(0, Math.floor((Date.now() - startedMs) / 1000));
    } catch {
      return 0;
    }
  }

  function profilesFrom(snapshot) {
    return snapshot?.instance_services?.account_profiles
      || snapshot?.settings?.multi_client?.account_profiles
      || snapshot?.settings?.multi_client?.clients
      || [];
  }

  function liveInstances(snapshot) {
    const instances = snapshot?.instance_services?.runtime_instances
      || snapshot?.instance_services?.instances
      || [];
    return instances.filter((item) => item.status === 'bound' || item.status === 'launching');
  }

  function renderTradeHistory(events) {
    const host = $('overview-trade-history');
    if (!host) return;
    const eventHistory = (Array.isArray(events) ? events : [])
      .filter((entry) => entry.actor === 'TRADE' || entry.action === 'MARKET_SEARCH')
      .slice(-3)
      .reverse()
      .map((entry) => ({
        name: entry.detail || entry.action || 'Price-check',
        total: null,
        time: `tick #${entry.tick ?? '—'}`,
      }));
    const localHistory = Array.isArray(window.tradeHistory) ? window.tradeHistory.slice(0, 3) : [];
    const history = eventHistory.length ? eventHistory : localHistory;
    const renderKey = JSON.stringify(history);
    if (renderKey === tradeHistoryRenderKey) return;
    tradeHistoryRenderKey = renderKey;
    host.replaceChildren();
    if (!history.length) {
      const empty = document.createElement('p');
      empty.textContent = 'Chưa có lượt tra cứu nào trong phiên. Dùng Alt+E trong game để check giá.';
      host.append(empty);
      return;
    }
    for (const entry of history) {
      const card = document.createElement('div'); card.className = 'overview-trade-item';
      const name = document.createElement('strong'); name.textContent = entry.name || 'Vật phẩm';
      const meta = document.createElement('span');
      const time = document.createElement('i'); time.textContent = entry.time || 'Trong phiên';
      const count = document.createElement('b'); count.textContent = entry.total == null ? 'Trade2' : `${entry.total} listing`;
      meta.append(time, count); card.append(name, meta); host.append(card);
    }
  }

  function goToTab(tabId) {
    const button = [...document.querySelectorAll('.nav-item')]
      .find((candidate) => candidate.getAttribute('onclick') === `navTab('${tabId}', this)`);
    if (button) button.click();
  }

  function refreshOverview(snapshot) {
    const live = liveInstances(snapshot);
    const main = live.find((item) => item.is_main) || live[0];
    const profiles = profilesFrom(snapshot);
    const profileId = main?.account_profile_id ?? main?.instance_id;
    const profile = profiles.find((item) => item.id === profileId) || {};
    const tracker = snapshot?.settings?.tracker || {};
    const gameTime = processUptimeSeconds(main?.binding?.started_at || main?.process?.identity?.started_at);
    const botTime = Math.min(gameTime || Number.MAX_SAFE_INTEGER, Number(tracker.session_seconds) || 0);
    const idleTime = Math.max(0, gameTime - botTime);
    const activePercent = gameTime > 0 ? Math.min(100, (botTime / gameTime) * 100) : 0;

    const character = profile.char1_name || profile.label || (main ? `Cửa sổ game #${main.instance_id}` : 'Chưa có game đang chạy');
    setText('overview-session-title', character);
    setText('overview-session-identity', main?.binding?.pid
      ? `${profile.flavor || main.process?.flavor || 'PoE2'} · ${profile.char1_role || (main.is_main ? 'Nhân vật chính' : 'Nhân vật theo sau')}`
      : 'Mở game hoặc kết nối một cửa sổ đang chạy để bắt đầu.');

    const liveState = document.querySelector('.overview-session-state');
    const isLive = Boolean(main?.binding?.pid);
    liveState?.classList.toggle('live', isLive);
    setText('overview-live-label', isLive ? (snapshot?.running ? 'BOT ĐANG CHẠY' : 'GAME ĐANG CHẠY') : 'CHỜ GAME');
    setText('overview-game-time', formatClock(gameTime));
    setText('overview-bot-time', formatClock(Number(tracker.session_seconds) || 0));
    setText('overview-area', snapshot?.area_name_hint?.trim() || main?.process?.window?.title || 'Chưa xác định');
    setText('overview-area-note', snapshot?.area_name_hint?.trim() ? 'Đã đồng bộ với game' : 'Đang chờ dữ liệu từ game');
    setText('overview-session-value', `${Number(tracker.total_div_estimate || 0).toFixed(2)} div`);
    setText('overview-session-rate', `${Number(tracker.div_per_hour || 0).toFixed(2)} div/giờ`);
    setText('overview-session-total', formatClock(gameTime));
    setText('overview-active-time', formatClock(botTime));
    setText('overview-idle-time', formatClock(idleTime));
    const activeBar = $('overview-active-bar');
    const idleBar = $('overview-idle-bar');
    if (activeBar) activeBar.style.width = `${activePercent}%`;
    if (idleBar) idleBar.style.width = `${100 - activePercent}%`;
    setText('overview-items', Number(tracker.items_picked || 0).toLocaleString('vi-VN'));
    setText('overview-gold', Number(tracker.gold_count || 0).toLocaleString('vi-VN'));
    setText('overview-divine', Number(tracker.div_count || 0).toLocaleString('vi-VN'));
    setText('overview-exalted', Number(tracker.exalt_count || 0).toLocaleString('vi-VN'));
    renderTradeHistory(snapshot?.events);
  }

  window.refreshOverview = refreshOverview;
  window.overviewGoToTab = goToTab;
})();
