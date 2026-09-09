/* ==========================================================================
   POEVH PoeSmoother 2 & GGPK Patcher — Graphics, Zoom, Maphack & Color Mods
   ========================================================================== */

async function autoDetectGamePath() {
  try {
    const info = await apiPost({command: 'get_smoother_info'});
    if (info && info.game_path) {
      const gp = document.getElementById('smoother-game-path');
      if (gp) gp.value = info.game_path;
    }
  } catch (e) {
    console.error('autoDetectGamePath error:', e);
  }
}

async function loadSmootherInfo() {
  try {
    const info = await apiPost({command: 'get_smoother_info'});
    if (info) {
      const badge = document.getElementById('smoother-ini-badge');
      const pathEl = document.getElementById('smoother-ini-path');
      const restoreBtn = document.getElementById('btn-restore-smoother-ini');
      if (info.config_found) {
        if (badge) {
          badge.textContent = 'Đã tìm thấy file';
          badge.style.background = 'var(--accent)';
          badge.style.color = '#fff';
        }
        if (pathEl) pathEl.textContent = 'Đường dẫn: ' + (info.config_path || '');
        if (info.game_path) {
          const gp = document.getElementById('smoother-game-path');
          if (gp && !gp.value) gp.value = info.game_path;
        }
        if (restoreBtn) restoreBtn.disabled = !info.has_backup;
      } else {
        if (badge) {
          badge.textContent = 'Không tìm thấy file';
          badge.style.background = 'var(--amber)';
          badge.style.color = '#fff';
        }
        if (pathEl) pathEl.textContent = 'Chưa phát hiện file poe2_production_Config.ini trên máy. Hãy mở game 1 lần để tạo file.';
      }
    }
  } catch (e) {
    console.error('loadSmootherInfo error:', e);
  }
}

async function applySmootherIni() {
  const bgFps = Number(document.getElementById('smoother-global-bg-fps')?.value) || 15;
  const fgFps = Number(document.getElementById('smoother-global-fg-fps')?.value) || 60;
  const lowSpec = document.getElementById('smoother-low-spec')?.checked ?? true;
  const statusEl = document.getElementById('smoother-ini-status');
  const btn = document.getElementById('btn-apply-smoother-ini');

  if (btn) btn.disabled = true;
  if (statusEl) statusEl.textContent = 'Đang ghi file cấu hình PoE2...';

  try {
    const res = await apiPost({
      command: 'apply_smoother_ini',
      value: { bg_fps: bgFps, fg_fps: fgFps, low_spec: lowSpec }
    });
    if (res && res.success) {
      if (statusEl) {
        statusEl.textContent = '✅ ' + res.message;
        statusEl.style.color = 'var(--cyan)';
      }
      loadSmootherInfo();
    } else {
      if (statusEl) {
        statusEl.textContent = '❌ Lỗi: ' + (res?.error || 'Không ghi được');
        statusEl.style.color = 'var(--amber)';
      }
    }
  } catch (e) {
    if (statusEl) {
      statusEl.textContent = '❌ Lỗi: ' + e.message;
      statusEl.style.color = 'var(--amber)';
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function restoreSmootherIni() {
  const statusEl = document.getElementById('smoother-ini-status');
  const btn = document.getElementById('btn-restore-smoother-ini');

  if (btn) btn.disabled = true;
  if (statusEl) statusEl.textContent = 'Đang khôi phục file gốc từ .bak...';

  try {
    const res = await apiPost({command: 'restore_smoother_ini'});
    if (res && res.success) {
      if (statusEl) {
        statusEl.textContent = '✅ Đã khôi phục file cấu hình PoE2 gốc thành công!';
        statusEl.style.color = 'var(--cyan)';
      }
      loadSmootherInfo();
    } else {
      if (statusEl) {
        statusEl.textContent = '❌ Lỗi khôi phục: ' + (res?.error || 'Không có file .bak');
        statusEl.style.color = 'var(--amber)';
      }
    }
  } catch (e) {
    if (statusEl) {
      statusEl.textContent = '❌ Lỗi: ' + e.message;
      statusEl.style.color = 'var(--amber)';
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function restoreAllOriginal() {
  const gamePath = document.getElementById('smoother-game-path')?.value || '';
  showSmootherStatus('Đang khôi phục toàn bộ file game & cấu hình nguyên bản từ bản sao lưu...');
  try {
    const patchRes = await apiPost({
      command: 'restore_ggpk_patch',
      value: { game_path: gamePath }
    });
    const iniRes = await apiPost({ command: 'restore_smoother_ini' });
    let msg = '✅ Đã khôi phục nguyên bản thành công!';
    if (patchRes && patchRes.restored_count !== undefined) {
      msg += ` (Đã hoàn trả ${patchRes.restored_count} file game gốc từ POEVH_Backups)`;
    }
    showSmootherStatus(msg);
    loadSmootherInfo();
  } catch (e) {
    showSmootherStatus('❌ Lỗi khôi phục: ' + e.message, false);
  }
}

async function probeGgpkCompatibility() {
  const gamePath = document.getElementById('smoother-game-path')?.value || '';
  const button = document.getElementById('btn-probe-ggpk');
  if (button) button.disabled = true;
  showSmootherStatus('Đang đọc index và kiểm tra cấu trúc shader/metadata của bản game hiện tại...');
  try {
    const response = await apiPost({
      command: 'probe_ggpk_compatibility',
      value: { game_path: gamePath }
    });
    const report = response?.report;
    if (!report) throw new Error('Không nhận được báo cáo compatibility');
    const supported = (report.supported_features || []).join(', ') || 'không có';
    const unsupported = (report.unsupported_features || []).join(', ');
    if (report.compatible) {
      showSmootherStatus(`Build tương thích · ${report.fingerprint} · ${supported}`);
    } else {
      showSmootherStatus(`Build đã thay đổi · ${report.fingerprint} · cần cập nhật: ${unsupported}`, false);
    }
  } catch (error) {
    showSmootherStatus('Không xác minh được build: ' + error.message, false);
  } finally {
    if (button) button.disabled = false;
  }
}

function toggleSmootherAdvanced() {
  const content = document.getElementById('smoother-adv-content');
  const btn = document.getElementById('btn-smoother-adv-toggle');
  if (content && btn) {
    const isHidden = content.style.display === 'none';
    content.style.display = isHidden ? 'block' : 'none';
    btn.textContent = isHidden ? '▲ Thu gọn' : '▼ Mở rộng';
  }
}

function applyPoeSmootherOptimal() {
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.checked = val; };
  set('ps2-disable-sounds', false);
  set('ps2-soft-mtx', true);
  set('ps2-important-things', true);
  set('ps2-remove-shadows', true);
  set('ps2-remove-darkness', true);
  set('ps2-better-lights', true);
  set('ps2-remove-soft-particles', true);
  set('ps2-silent-skills', false);
  set('ps2-silent-monsters', true);
  set('ps2-maps-revealed', true);
  set('ps2-atlas-revealed', true);
  set('ps2-color-mods-enabled', true);
  set('ps2-zero-effects', false);
  set('ps2-zero-particles', false);
  set('ps2-high-performance', true);
  set('ps2-remove-players', true);
  set('ps2-remove-monsters', false);
  set('ps2-clean-terrain', true);
  set('ps2-zero-materials', false);
  set('ps2-patch-rain', false);
  setZoomValue(1.35);
  showSmootherStatus('Đã chọn cấu hình tối ưu khuyến nghị (Optimal Settings). Bấm "Áp Dụng Ngay" để kích hoạt.');
}

function applyPoeSmootherCheckAll() {
  const ids = [
    'ps2-disable-sounds', 'ps2-soft-mtx', 'ps2-important-things',
    'ps2-remove-shadows', 'ps2-remove-darkness', 'ps2-better-lights',
    'ps2-remove-soft-particles', 'ps2-silent-skills', 'ps2-silent-monsters',
    'ps2-color-mods-enabled',
    'ps2-zero-effects', 'ps2-zero-particles', 'ps2-high-performance',
    'ps2-remove-players', 'ps2-remove-monsters', 'ps2-clean-terrain',
    'ps2-zero-materials', 'ps2-patch-rain'
  ];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) el.checked = true;
  }
  showSmootherStatus('Đã chọn tất cả tùy chọn hiệu năng an toàn. Bấm "Áp Dụng Ngay" để kích hoạt.');
}

function onZoomSliderInput(val) {
  const num = parseFloat(val).toFixed(2);
  const disp = document.getElementById('ps2-zoom-display');
  if (disp) disp.textContent = num + 'x';
  apiPost({ command: 'set_smoother_zoom', value: parseFloat(val) });
}

function setZoomValue(val) {
  const slider = document.getElementById('ps2-zoom-slider');
  if (slider) slider.value = val;
  onZoomSliderInput(val);
}

function showSmootherStatus(msg, isSuccess = true) {
  const el = document.getElementById('ps2-apply-status');
  if (el) {
    el.textContent = (isSuccess ? '✅ ' : '❌ ') + msg;
    el.style.color = isSuccess ? 'var(--cyan)' : 'var(--amber)';
  }
}

async function applyPoeSmootherChanges() {
  const btn = document.getElementById('btn-apply-ps2');
  if (btn) btn.disabled = true;
  showSmootherStatus('Đang áp dụng cấu hình PoeSmoother 2 & Patcher vào game...');

  const gamePath = document.getElementById('smoother-game-path')?.value || '';
  const zoomScale = parseFloat(document.getElementById('ps2-zoom-slider')?.value || '1.35');
  const mapsRev = document.getElementById('ps2-maps-revealed')?.checked ?? false;
  const atlasRev = document.getElementById('ps2-atlas-revealed')?.checked ?? false;
  const rainClouds = document.getElementById('ps2-patch-rain')?.checked ?? false;
  const cleanTerr = document.getElementById('ps2-clean-terrain')?.checked ?? true;
  const zeroPart = document.getElementById('ps2-zero-particles')?.checked ?? false;
  const disSounds = document.getElementById('ps2-disable-sounds')?.checked ?? false;
  const blockDeadly = document.getElementById('ps2-block-deadly-mods')?.checked ?? true;

  const cfg = {
    enabled: true,
    disable_sounds: disSounds,
    soft_mtx: document.getElementById('ps2-soft-mtx')?.checked ?? false,
    important_things: document.getElementById('ps2-important-things')?.checked ?? true,
    remove_shadows: document.getElementById('ps2-remove-shadows')?.checked ?? true,
    remove_darkness: document.getElementById('ps2-remove-darkness')?.checked ?? false,
    better_lights: document.getElementById('ps2-better-lights')?.checked ?? false,
    remove_soft_particles: document.getElementById('ps2-remove-soft-particles')?.checked ?? true,
    silent_skills: document.getElementById('ps2-silent-skills')?.checked ?? false,
    silent_monsters: document.getElementById('ps2-silent-monsters')?.checked ?? false,
    maps_revealed: mapsRev,
    atlas_revealed: atlasRev,
    standard_colors: document.getElementById('ps2-color-mods-enabled')?.checked ?? true,
    zero_effects: document.getElementById('ps2-zero-effects')?.checked ?? false,
    zero_particles: zeroPart,
    performance_mode: true,
    full_remove_mtx: false,
    high_performance: document.getElementById('ps2-high-performance')?.checked ?? true,
    remove_players: document.getElementById('ps2-remove-players')?.checked ?? false,
    remove_monsters: document.getElementById('ps2-remove-monsters')?.checked ?? false,
    clean_terrain: cleanTerr,
    zero_materials: document.getElementById('ps2-zero-materials')?.checked ?? false,
    black_screen: false,
    game_path: gamePath,
    patch_rain: rainClouds,
    patch_clouds: rainClouds,
    zoom_enabled: true,
    zoom_scale: zoomScale,
    background_fps: Number(document.getElementById('smoother-global-bg-fps')?.value) || 15,
    foreground_fps: Number(document.getElementById('smoother-global-fg-fps')?.value) || 60,
  };

  try {
    // Patch assets first: the backend refuses while this exact game install is
    // running, so no INI/runtime state is persisted for a failed operation.
    const patchRes = await apiPost({
      command: 'apply_ggpk_patch',
      value: {
        game_path: gamePath,
        camera_zoom: true,
        zoom_scale: zoomScale,
        minimap_revealed: mapsRev,
        atlas_revealed: atlasRev,
        remove_rain_clouds: rainClouds,
        clean_terrain: cleanTerr,
        remove_particles: zeroPart,
        disable_sounds: disSounds,
        block_deadly_mods: blockDeadly,
        color_mods_enabled: document.getElementById('ps2-color-mods-enabled')?.checked ?? true,
      }
    });
    await apiPost({ command: 'apply_poe_smoother', value: cfg });

    if (patchRes && patchRes.status && patchRes.status.is_patched) {
      showSmootherStatus('Đã áp dụng thành công toàn bộ cấu hình PoeSmoother 2 & GGPK Patch vào game!');
    } else {
      showSmootherStatus('Đã cập nhật cấu hình tối ưu game thành công!');
    }
    loadSmootherInfo();
  } catch (e) {
    showSmootherStatus('Lỗi áp dụng: ' + e.message, false);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function saveWaystoneColorSettings() {
  const blockDeadly = document.getElementById('ps2-block-deadly-mods')?.checked ?? true;
  await apiPost({
    command: 'update_waystone_colors',
    value: {
      enabled: true,
      block_deadly_mods: blockDeadly,
      mods: []
    }
  });
}

function syncSmootherState(s) {
  if (s.settings && s.settings.poe_smoother) {
    const ps = s.settings.poe_smoother;
    const setChk = (id, val) => { const el = document.getElementById(id); if (el && document.activeElement !== el) el.checked = !!val; };
    setChk('ps2-disable-sounds', ps.disable_sounds);
    setChk('ps2-soft-mtx', ps.soft_mtx);
    setChk('ps2-important-things', ps.important_things);
    setChk('ps2-remove-shadows', ps.remove_shadows);
    setChk('ps2-remove-darkness', ps.remove_darkness);
    setChk('ps2-better-lights', ps.better_lights);
    setChk('ps2-remove-soft-particles', ps.remove_soft_particles);
    setChk('ps2-silent-skills', ps.silent_skills);
    setChk('ps2-silent-monsters', ps.silent_monsters);
    setChk('ps2-maps-revealed', ps.maps_revealed);
    setChk('ps2-atlas-revealed', ps.atlas_revealed);
    setChk('ps2-color-mods-enabled', ps.standard_colors);
    setChk('ps2-zero-effects', ps.zero_effects);
    setChk('ps2-zero-particles', ps.zero_particles);
    setChk('ps2-high-performance', ps.high_performance);
    setChk('ps2-remove-players', ps.remove_players);
    setChk('ps2-remove-monsters', ps.remove_monsters);
    setChk('ps2-clean-terrain', ps.clean_terrain);
    setChk('ps2-zero-materials', ps.zero_materials);
    setChk('ps2-patch-rain', ps.patch_rain);

    const gp = document.getElementById('smoother-game-path');
    if (gp && document.activeElement !== gp && ps.game_path) gp.value = ps.game_path;

    const zSlider = document.getElementById('ps2-zoom-slider');
    const zDisp = document.getElementById('ps2-zoom-display');
    if (zSlider && document.activeElement !== zSlider && ps.zoom_scale) {
      zSlider.value = ps.zoom_scale;
      if (zDisp) zDisp.textContent = parseFloat(ps.zoom_scale).toFixed(2) + 'x';
    }

    const bgFps = document.getElementById('smoother-global-bg-fps');
    if (bgFps && document.activeElement !== bgFps && ps.background_fps) bgFps.value = ps.background_fps;
    const fgFps = document.getElementById('smoother-global-fg-fps');
    if (fgFps && document.activeElement !== fgFps && ps.foreground_fps) fgFps.value = ps.foreground_fps;
  }

  if (s.settings && s.settings.waystone_colors) {
    const wc = s.settings.waystone_colors;
    const setChk = (id, val) => { const el = document.getElementById(id); if (el && document.activeElement !== el) el.checked = !!val; };
    setChk('ps2-block-deadly-mods', wc.block_deadly_mods);
  }
}
