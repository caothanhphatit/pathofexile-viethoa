/* Expedition Radar settings and status panel. */
(function () {
  const $ = (id) => document.getElementById(id);
  const token = () => window.__API_TOKEN__ || '';

  async function loadState() {
    const response = await fetch('/api/state', { headers: { 'X-Api-Token': token() } });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return response.json();
  }

  function readConfig() {
    return {
      enabled: $('exp-enabled').checked,
      auto_open: true,
      min_value_exalted: Math.max(0, Number($('exp-min-value').value) || 0),
      max_rows_per_station: Math.max(1, Math.min(30, Number($('exp-max-rows').value) || 8)),
      scan_interval_ms: Math.max(400, Math.min(3000, Number($('exp-interval').value) || 650)),
      show_unpriced: $('exp-show-unpriced').checked,
      selected_client_id: Number($('exp-client').value) || 1,
      league: ($('exp-league').value || 'Standard').trim()
    };
  }

  function writeConfig(config) {
    const c = config || {};
    $('exp-enabled').checked = !!c.enabled;
    $('exp-min-value').value = c.min_value_exalted ?? 0;
    $('exp-max-rows').value = c.max_rows_per_station ?? 8;
    $('exp-interval').value = c.scan_interval_ms ?? 650;
    $('exp-show-unpriced').checked = c.show_unpriced !== false;
    $('exp-client').value = String(c.selected_client_id ?? 1);
    $('exp-league').value = c.league ?? 'Standard';
    $('expedition-status').textContent = c.enabled ? 'Đang bật' : 'Tắt';
  }

  window.saveExpeditionConfig = async function () {
    const status = $('exp-config-status');
    try {
      const snapshot = await apiPost({ command: 'update_expedition', value: readConfig() });
      if (snapshot) {
        writeConfig(snapshot.settings?.expedition);
        status.textContent = 'Đã lưu cấu hình Expedition Radar.';
      }
    } catch (error) {
      status.textContent = 'Không lưu được: ' + error.message;
    }
  };

  window.refreshExpeditionStatus = async function () {
    const out = $('exp-status-detail');
    try {
      const response = await fetch('/api/expedition/latest', { headers: { 'X-Api-Token': token() } });
      const data = await response.json();
      if (!data.snapshot) { out.textContent = data.last_error || 'Chưa có snapshot Expedition.'; return; }
      const s = data.snapshot;
      const rows = s.stations.reduce((n, station) => n + station.combinations.length, 0);
      out.textContent = `${s.area_name || 'Unknown'} · Lv ${s.area_level || '?'}\n` +
        `${s.stations.length} Rune Station · ${rows} combination · session ${s.session_id}\n` +
        (data.dismissed_session === s.session_id ? 'Overlay đã được đóng trong map này.' : 'Overlay sẵn sàng hiển thị.');
    } catch (error) { out.textContent = 'Không đọc được trạng thái: ' + error.message; }
  };

  document.addEventListener('DOMContentLoaded', async () => {
    try {
      const state = await loadState();
      writeConfig(state.settings?.expedition);
      await refreshExpeditionStatus();
    } catch (error) {
      const status = $('exp-config-status');
      if (status) status.textContent = 'Không tải được cấu hình: ' + error.message;
    }
  });
})();
