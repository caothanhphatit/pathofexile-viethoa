/* ==========================================================================
   POEVH Calibration & Credentials — Screen Alignment & Windows Vault Login
   ========================================================================== */

let loginCalibrationDraft = null;
let calibrationGeneration = 0;
const calibrationNames = ['Email', 'Password', 'Log In'];
let calibrationSaving = false;

function resetCalibrationImage() {
  const calibrationDialog = document.getElementById('login-calibration-dialog');
  const calibrationCanvas = document.getElementById('calibration-canvas');
  calibrationGeneration++;
  loginCalibrationDraft?.image?.close();
  loginCalibrationDraft = null;
  if (calibrationCanvas) {
    calibrationCanvas.width = 800;
    calibrationCanvas.height = 500;
    calibrationCanvas.hidden = true;
  }
  const fileInput = document.getElementById('calibration-file');
  if (fileInput) fileInput.value = '';
  const pts = document.getElementById('calibration-points');
  if (pts) pts.replaceChildren();
  const chk = document.getElementById('calibration-confirm');
  if (chk) chk.checked = false;
  const saveBtn = document.getElementById('calibration-save');
  if (saveBtn) saveBtn.disabled = true;
}

function openLoginCalibration(id) {
  if (calibrationSaving) return;
  resetCalibrationImage();
  const calibrationDialog = document.getElementById('login-calibration-dialog');
  if (!calibrationDialog) return;
  calibrationDialog.dataset.instanceId = id;
  const title = document.getElementById('calibration-title');
  if (title) title.textContent = 'Hiệu chỉnh login · Instance #' + id;
  const status = document.getElementById('calibration-status');
  if (status) {
    status.textContent = instanceProfiles?.get(id)?.login_calibration
      ? 'Instance có hiệu chỉnh đã lưu. Chọn ảnh mới để thay, hoặc xóa để tự tìm bằng pixel.'
      : 'Chưa chọn ảnh. Nếu không hiệu chỉnh, app tự tìm form bằng pixel.';
  }
  calibrationDialog.showModal();
}

function renderCalibrationPoints() {
  const draft = loginCalibrationDraft;
  const calibrationCanvas = document.getElementById('calibration-canvas');
  if (!draft || !calibrationCanvas) return;
  const ctx = calibrationCanvas.getContext('2d');
  ctx.drawImage(draft.image, 0, 0);
  const color = ['#a3ff60', '#c7a5ff', '#ffbc61'];
  draft.points.forEach((p, i) => {
    if (!p || p.some(v => !Number.isFinite(v))) return;
    const x = p[0] * draft.width, y = p[1] * draft.height;
    ctx.strokeStyle = color[i];
    ctx.lineWidth = Math.max(2, draft.width / 500);
    ctx.beginPath();
    ctx.arc(x, y, Math.max(8, draft.width / 100), 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = color[i];
    ctx.font = 'bold ' + Math.max(18, draft.width / 70) + 'px sans-serif';
    ctx.fillText(String(i + 1), x + 15, y - 12);
    for (let axis = 0; axis < 2; axis++) {
      const field = document.getElementById('calibration-point-' + i + '-' + axis);
      if (field && document.activeElement !== field) field.value = (p[axis] * 100).toFixed(3);
    }
  });
  const valid = draft.points.length === 3
    && draft.points.every(p => p && p.every(Number.isFinite) && p[0] > 0.25 && p[0] < 0.75 && p[1] > 0.45 && p[1] < 0.95)
    && draft.points[0][1] < draft.points[1][1] && draft.points[1][1] < draft.points[2][1];

  const saveBtn = document.getElementById('calibration-save');
  const confirmChk = document.getElementById('calibration-confirm');
  if (saveBtn) {
    saveBtn.disabled = calibrationSaving || !valid || !(confirmChk?.checked);
  }
  const status = document.getElementById('calibration-status');
  if (status) {
    status.textContent = draft.width + ' × ' + draft.height + ' · ' +
      (draft.points.length < 3
        ? 'Chấm điểm ' + (draft.points.length + 1) + ': ' + calibrationNames[draft.points.length]
        : valid ? 'Đủ ba điểm. Kiểm tra lại và xác nhận bên dưới.' : 'Tọa độ/thứ tự chưa hợp lệ. Chấm lại hoặc sửa các ô %.');
  }
}

async function saveLoginCalibration(clear) {
  if (calibrationSaving) return;
  const calibrationDialog = document.getElementById('login-calibration-dialog');
  const draft = loginCalibrationDraft;
  const saveBtn = document.getElementById('calibration-save');
  if (!clear && (!draft || saveBtn?.disabled)) return;
  if (clear && !confirm('Xóa điểm hiệu chỉnh của instance này, chuyển về tự tìm form bằng pixel?')) return;
  const id = Number(calibrationDialog?.dataset.instanceId);
  const calibration = clear ? null : {
    version: 1,
    capture_width: draft.width,
    capture_height: draft.height,
    email: draft.points[0],
    password: draft.points[1],
    submit: draft.points[2]
  };
  calibrationSaving = true;
  const controls = [...(calibrationDialog?.querySelectorAll('button,input') || [])];
  controls.forEach(c => { c.disabled = true; });
  try {
    const response = await fetch('/api/login-calibration', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Token': window.__API_TOKEN__
      },
      body: JSON.stringify({ instance_id: id, confirmed: true, calibration })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Không lưu được hiệu chỉnh.');
    renderState(result);
    if (calibrationDialog) calibrationDialog.close();
    const st = document.getElementById('instance-command-status');
    if (st) st.textContent = clear ? 'Đã xóa hiệu chỉnh #' + id : 'Đã lưu ba điểm cho #' + id + '. Vẫn cần kiểm tra pixel khi đăng nhập.';
  } catch (error) {
    const st = document.getElementById('calibration-status');
    if (st) st.textContent = error.message;
  } finally {
    calibrationSaving = false;
    controls.forEach(c => { c.disabled = false; });
    if (!calibrationDialog?.open) resetCalibrationImage();
    else if (saveBtn) {
      const confirmChk = document.getElementById('calibration-confirm');
      saveBtn.disabled = !draft || !(confirmChk?.checked);
    }
  }
}

async function standaloneAccountAction(id, action) {
  const key = id + ':account';
  if (pendingInstanceActions.has(key)) return;
  const email = document.getElementById('instance-email-' + id);
  const password = document.getElementById('instance-password-' + id);
  const status = document.getElementById('instance-command-status');

  if (action === 'save') {
    if (!email?.value || !password?.value || !email.reportValidity()) return;
    pendingInstanceActions.add(key);
    try {
      const res = await fetch('/api/credentials', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Token': window.__API_TOKEN__
        },
        body: JSON.stringify({ instance_id: id, action: 'save', email: email.value, password: password.value })
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Không lưu được tài khoản');
      password.value = ''; email.value = '';
      renderState(result);
      if (status) status.textContent = 'Đã lưu tài khoản vào Windows Credential Manager cho instance #' + id;
    } catch (e) {
      if (status) status.textContent = 'Lỗi lưu: ' + e.message;
    } finally {
      pendingInstanceActions.delete(key);
      renderInstanceProcesses();
    }
    return;
  }

  if (action === 'delete') {
    if (!confirm('Xóa tài khoản đã lưu trong Windows cho instance #' + id + '?')) return;
    pendingInstanceActions.add(key);
    try {
      const res = await fetch('/api/credentials', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Token': window.__API_TOKEN__
        },
        body: JSON.stringify({ instance_id: id, action: 'delete' })
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Thao tác thất bại');
      renderState(result);
      if (status) status.textContent = 'Đã xóa tài khoản đã lưu.';
    } catch (e) {
      if (status) status.textContent = 'Lỗi xóa: ' + e.message;
    } finally {
      pendingInstanceActions.delete(key);
      renderInstanceProcesses();
    }
    return;
  }

  // Action is login or launch-login
  if (email?.value && password?.value) {
    if (status) status.textContent = 'Đang tự động lưu tài khoản vào Windows Credential Manager…';
    try {
      const saveRes = await fetch('/api/credentials', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Token': window.__API_TOKEN__
        },
        body: JSON.stringify({ instance_id: id, action: 'save', email: email.value, password: password.value })
      });
      if (!saveRes.ok) {
        const err = await saveRes.json();
        throw new Error(err.error || 'Không lưu được tài khoản');
      }
      password.value = ''; email.value = '';
    } catch (e) {
      if (status) status.textContent = 'Lỗi lưu tài khoản: ' + e.message;
      return;
    }
  } else if (!instanceProfiles.get(id)?.has_credentials) {
    alert('Vui lòng nhập Email và Mật khẩu ở ô bên dưới trước khi bấm Đăng nhập!');
    return;
  }

  const flavorEl = document.getElementById('instance-flavor-' + id);
  const exeEl = document.getElementById('instance-exe-' + id);
  if (flavorEl && (flavorEl.value === 'Unknown' || !exeEl.value.trim())) {
    flavorEl.value = 'Standalone';
    if (!exeEl.value.trim()) {
      exeEl.value = 'D:\\Grinding Gear Games\\Path of Exile 2\\PathOfExile.exe';
    }
    dirtyInstances.add(id);
    await saveInstanceProfile(id);
  }

  pendingInstanceActions.add(key);
  if (status) status.textContent = 'Đang tự động đăng nhập cho instance #' + id + '… Vui lòng đợi cửa sổ game.';
  renderInstanceProcesses();
  try {
    const response = await fetch('/api/standalone-login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Token': window.__API_TOKEN__
      },
      body: JSON.stringify({ instance_id: id, launch: action === 'launch-login', confirmed: true })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Đăng nhập thất bại');
    renderState(result);
    if (status) status.textContent = 'Đã gửi thông tin đăng nhập tới game! Vui lòng kiểm tra màn hình game.';
  } catch (error) {
    if (status) status.textContent = 'Lỗi đăng nhập: ' + error.message;
  } finally {
    pendingInstanceActions.delete(key);
    renderInstanceProcesses();
  }
}

async function cancelStandaloneLogin() {
  const status = document.getElementById('instance-command-status');
  try {
    const response = await fetch('/api/standalone-login/cancel', {
      method: 'POST',
      headers: { 'X-Api-Token': window.__API_TOKEN__ }
    });
    if (!response.ok) throw new Error('Không gửi được yêu cầu dừng');
    if (status) status.textContent = 'Đã yêu cầu dừng đăng nhập.';
  } catch (error) {
    if (status) status.textContent = error.message;
  }
}

// Attach calibration listeners on DOM load
window.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('calibration-file');
  const canvas = document.getElementById('calibration-canvas');
  const confirmChk = document.getElementById('calibration-confirm');
  const resetBtn = document.getElementById('calibration-reset');
  const saveBtn = document.getElementById('calibration-save');
  const clearBtn = document.getElementById('calibration-clear');
  const closeBtn = document.getElementById('calibration-close');
  const dialog = document.getElementById('login-calibration-dialog');

  fileInput?.addEventListener('change', async event => {
    const file = event.target.files[0];
    resetCalibrationImage();
    if (!file) return;
    const generation = calibrationGeneration;
    try {
      if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 12 * 1024 * 1024) throw new Error('Chọn PNG/JPEG tối đa 12 MB.');
      const image = await createImageBitmap(file);
      if (generation !== calibrationGeneration || !dialog?.open) { image.close(); return; }
      const width = image.width, height = image.height;
      if (width < 800 || width > 7680 || height < 500 || height > 4320) { image.close(); throw new Error('Vùng game cần từ 800×500 tới 7680×4320 pixel.'); }
      loginCalibrationDraft = { image, width, height, points: [] };
      if (canvas) {
        canvas.width = width; canvas.height = height; canvas.hidden = false;
      }
      const fields = document.getElementById('calibration-points');
      if (fields) {
        fields.replaceChildren();
        calibrationNames.forEach((name, i) => {
          const row = document.createElement('div'); row.className = 'calibration-actions';
          for (let axis = 0; axis < 2; axis++) {
            const field = document.createElement('input');
            field.type = 'number'; field.min = '0'; field.max = '100'; field.step = '0.001'; field.style.width = '100px';
            field.id = 'calibration-point-' + i + '-' + axis;
            const label = document.createElement('label');
            label.htmlFor = field.id;
            label.textContent = (i + 1) + '. ' + name + ' ' + (axis ? 'Y %' : 'X %');
            field.addEventListener('input', () => {
              const points = loginCalibrationDraft?.points; if (!points) return;
              while (points.length <= i) points.push([NaN, NaN]);
              points[i][axis] = field.value === '' ? NaN : Number(field.value) / 100;
              const chk = document.getElementById('calibration-confirm');
              if (chk) chk.checked = false;
              renderCalibrationPoints();
            });
            row.append(label, field);
          }
          fields.append(row);
        });
      }
      renderCalibrationPoints();
    } catch (error) {
      if (generation === calibrationGeneration) {
        const st = document.getElementById('calibration-status');
        if (st) st.textContent = error.message;
      }
    }
  });

  canvas?.addEventListener('click', event => {
    const draft = loginCalibrationDraft;
    if (!draft || draft.points.length >= 3 || calibrationSaving) return;
    const rect = canvas.getBoundingClientRect();
    draft.points.push([
      (event.clientX - rect.left - canvas.clientLeft) / canvas.clientWidth,
      (event.clientY - rect.top - canvas.clientTop) / canvas.clientHeight
    ]);
    const chk = document.getElementById('calibration-confirm');
    if (chk) chk.checked = false;
    renderCalibrationPoints();
  });

  confirmChk?.addEventListener('change', renderCalibrationPoints);
  resetBtn?.addEventListener('click', () => {
    if (!loginCalibrationDraft || calibrationSaving) return;
    loginCalibrationDraft.points = [];
    document.querySelectorAll('#calibration-points input').forEach(input => { input.value = ''; });
    const chk = document.getElementById('calibration-confirm');
    if (chk) chk.checked = false;
    renderCalibrationPoints();
  });

  saveBtn?.addEventListener('click', () => saveLoginCalibration(false));
  clearBtn?.addEventListener('click', () => saveLoginCalibration(true));
  closeBtn?.addEventListener('click', () => { if (!calibrationSaving) dialog?.close(); });
  dialog?.addEventListener('cancel', event => { if (calibrationSaving) event.preventDefault(); });
  dialog?.addEventListener('close', resetCalibrationImage);
});
