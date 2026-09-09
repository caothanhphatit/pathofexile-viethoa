/* ==========================================================================
   POEVH Client Manager — Multi-Client Cards, Process Binding & Cloaking
   ========================================================================== */

let instanceProfiles = new Map();
let instanceServices = {};
const pendingInstanceActions = new Set();
let instanceFormIds = '';
const dirtyInstances = new Set();
const cloakedInstances = new Set();
let runtimeHudRenderKey = '';

function effectiveInputMode(profile) {
  if (profile?.input_mode) return profile.input_mode;
  return profile?.id === window.poeevhMainInstanceId ? 'single_wasd' : 'dual_controller';
}

function ensureClientModeDialog() {
  let dialog = document.getElementById('client-input-mode-dialog');
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.id = 'client-input-mode-dialog';
  dialog.style.cssText = 'border:1px solid var(--border);border-radius:12px;background:var(--bg1);color:var(--text);padding:0;max-width:520px;width:calc(100% - 32px);box-shadow:0 24px 70px rgba(45,38,27,.28)';
  dialog.innerHTML = `
    <form method="dialog" style="padding:22px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:16px">
        <div><div style="font-size:12px;color:var(--dim);letter-spacing:.08em;text-transform:uppercase">Cấu hình client</div><h3 id="client-mode-title" style="margin:4px 0 0">Kiểu điều khiển</h3></div>
        <button value="cancel" class="btn btn-neutral btn-sm" aria-label="Đóng">✕</button>
      </div>
      <fieldset style="border:0;padding:0;margin:18px 0;display:grid;gap:10px">
        <label class="card" style="display:flex;gap:12px;align-items:flex-start;cursor:pointer;padding:14px">
          <input type="radio" name="client-input-mode" value="single_wasd" style="margin-top:4px">
          <span><b>1 tài khoản · WASD</b><small style="display:block;color:var(--dim);margin-top:4px">Không tạo controller ảo. Dùng bàn phím và chuột trực tiếp cho nhân vật này.</small></span>
        </label>
        <label class="card" style="display:flex;gap:12px;align-items:flex-start;cursor:pointer;padding:14px">
          <input type="radio" name="client-input-mode" value="dual_controller" style="margin-top:4px">
          <span><b>2 tài khoản · Controller</b><small style="display:block;color:var(--dim);margin-top:4px">Luôn tạo đúng 2 controller ảo cho couch co-op, kể cả khi có tay cầm vật lý.</small></span>
        </label>
      </fieldset>
      <p style="font-size:12px;color:var(--dim)">Follower nhận lệnh di chuyển riêng từ engine; không sao chép phím thô của leader.</p>
      <p id="client-mode-status" role="status" aria-live="polite" style="font-size:12px;color:var(--amber);min-height:18px"></p>
      <div style="display:flex;justify-content:flex-end;gap:8px"><button value="cancel" class="btn btn-neutral">Hủy</button><button id="save-client-mode" value="default" class="btn btn-primary">Lưu cấu hình</button></div>
    </form>`;
  document.body.append(dialog);
  return dialog;
}

function openClientInputSettings(id) {
  const profile = instanceProfiles.get(Number(id));
  if (!profile) return;
  const dialog = ensureClientModeDialog();
  dialog.dataset.instanceId = String(id);
  dialog.querySelector('#client-mode-title').textContent = (profile.label || `Client #${id}`) + ' · kiểu điều khiển';
  const mode = effectiveInputMode(profile);
  const radio = dialog.querySelector(`input[name="client-input-mode"][value="${mode}"]`);
  if (radio) radio.checked = true;
  const save = dialog.querySelector('#save-client-mode');
  const status = dialog.querySelector('#client-mode-status');
  status.textContent = '';
  save.onclick = async event => {
    event.preventDefault();
    const selected = dialog.querySelector('input[name="client-input-mode"]:checked');
    if (!selected) return;
    save.disabled = true;
    const snapshot = await apiPost({command: 'update_instance', instance_id: Number(id), value: {input_mode: selected.value}});
    save.disabled = false;
    if (snapshot) dialog.close();
    else status.textContent = 'Không thể đổi mode. Nếu đây là Main, hãy chọn một client khác làm “1 tài khoản · WASD” trước.';
  };
  dialog.showModal();
}

function makeProfileField(card, id, title, control) {
  const label = document.createElement('label');
  label.htmlFor = id;
  label.textContent = title;
  label.style.cssText = 'display:block;margin-top:10px;font-size:12px';
  control.id = id;
  control.classList.add('profile-control');
  card.append(label, control);
  return control;
}

function renderInstanceProfiles(profiles) {
  const ordered = [...profiles].sort((a, b) => a.id - b.id);
  instanceProfiles = new Map(ordered.map(profile => [profile.id, profile]));
  const ids = ordered.map(profile => profile.id).join(',');
  if (instanceFormIds !== ids) {
    instanceFormIds = ids;
    dirtyInstances.clear();
    const container = document.getElementById('instance-profile-list');
    if (container) {
      container.replaceChildren();
      for (const profile of ordered) {
        const id = profile.id;
        const card = document.createElement('div');
        card.className = 'card';
        card.id = 'instance-card-' + id;
        const heading = document.createElement('h3');
        heading.className = 'card-title';
        heading.textContent = 'Instance #' + id;
        const headingRow = document.createElement('div');
        headingRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:8px';
        const modeButton = document.createElement('button');
        modeButton.className = 'btn btn-neutral btn-sm';
        modeButton.textContent = '⚙';
        modeButton.title = 'Chọn 1 tài khoản WASD hoặc 2 tài khoản controller';
        modeButton.addEventListener('click', () => openClientInputSettings(id));
        headingRow.append(heading, modeButton);
        card.append(headingRow);
        const label = makeProfileField(card, 'instance-label-' + id, 'Tên profile', document.createElement('input'));
        label.maxLength = 160;
        const flavor = makeProfileField(card, 'instance-flavor-' + id, 'Nền tảng', document.createElement('select'));
        for (const [value, text] of [['Unknown', 'Chưa chọn'], ['Steam', 'Steam'], ['Standalone', 'Standalone'], ['EpicGames', 'Epic Games']]) {
          flavor.add(new Option(text, value));
        }
        const path = makeProfileField(card, 'instance-exe-' + id, 'EXE riêng (chỉ dùng khi chọn Standalone)', document.createElement('input'));
        path.placeholder = 'Đường dẫn tuyệt đối tới PathOfExile.exe';
        path.maxLength = 4096;
        for (const input of [label, flavor, path]) {
          input.addEventListener('input', () => dirtyInstances.add(id));
        }
        const enabled = makeProfileField(card, 'instance-enabled-' + id, 'Bật profile (không phải trạng thái kết nối)', document.createElement('input'));
        enabled.type = 'checkbox';
        enabled.style.width = 'auto';
        enabled.addEventListener('change', () => toggleClientActive(id, enabled.checked));

        const save = document.createElement('button');
        save.className = 'btn btn-neutral btn-sm';
        save.textContent = 'Lưu profile';
        save.dataset.instanceId = id;
        save.addEventListener('click', () => saveInstanceProfile(id));
        card.append(save);

        const autoBtn = document.createElement('button');
        autoBtn.className = 'btn btn-neutral btn-sm';
        autoBtn.style.marginLeft = '6px';
        autoBtn.textContent = '🔍 Tự điền Standalone EXE';
        autoBtn.addEventListener('click', async () => {
          const f = document.getElementById('instance-flavor-' + id);
          const p = document.getElementById('instance-exe-' + id);
          if (f) f.value = 'Standalone';
          if (p) p.value = 'D:\\Grinding Gear Games\\Path of Exile 2\\PathOfExile.exe';
          dirtyInstances.add(id);
          await saveInstanceProfile(id);
        });
        card.append(autoBtn);

        const note = document.createElement('p');
        note.id = 'instance-note-' + id;
        note.style.cssText = 'font-size:12px;color:var(--dim)';
        card.append(note);
        makeProfileField(card, 'instance-pid-' + id, 'Process (kiểm tra đường dẫn trước khi gắn)', document.createElement('select'));

        const actions = document.createElement('div');
        actions.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-top:10px';
        for (const [action, title] of [['bind', 'Gắn PID'], ['unbind', 'Gỡ PID'], ['cloak_toggle', '🌑 Màn đen'], ['focus', 'Focus'], ['minimize', 'Thu nhỏ'], ['launch', 'Mở Standalone'], ['main', 'Đặt main'], ['remove', 'Xóa profile']]) {
          const button = document.createElement('button');
          button.className = 'btn btn-neutral btn-sm';
          button.id = 'instance-' + action + '-' + id;
          button.textContent = title;
          button.addEventListener('click', () => instanceAction(id, action));
          actions.append(button);
        }
        card.append(actions);
        container.append(card);
      }
    }
  }
  for (const profile of ordered) {
    const id = profile.id;
    if (!dirtyInstances.has(id)) {
      const lbl = document.getElementById('instance-label-' + id);
      const flv = document.getElementById('instance-flavor-' + id);
      const exe = document.getElementById('instance-exe-' + id);
      if (lbl) lbl.value = profile.label;
      if (flv) flv.value = profile.flavor;
      if (exe) exe.value = profile.exe_path || '';
    }
    const enabled = document.getElementById('instance-enabled-' + id);
    if (enabled && !enabled.disabled) enabled.checked = profile.enabled;
    const note = document.getElementById('instance-note-' + id);
    if (note) {
      const mode = effectiveInputMode(profile) === 'single_wasd' ? '1 tài khoản · WASD' : '2 tài khoản · 2 controller ảo';
      note.textContent = (profile.enabled ? 'Profile bật' : 'Profile tắt') + ' · ' + mode + ' · Chưa gắn PID';
    }
  }
  const select = document.getElementById('instance-graphics-select');
  if (select) {
    const selected = Number(select.value);
    const optionsKey = ordered.map(p => p.id + ':' + p.label).join('|');
    if (select.dataset.optionsKey !== optionsKey) {
      select.replaceChildren(...ordered.map(p => new Option('#' + p.id + ' — ' + p.label, p.id)));
      select.dataset.optionsKey = optionsKey;
      if (instanceProfiles.has(selected)) select.value = String(selected);
    }
    renderInstanceGraphics();
  }
}

async function instanceCommand(command, id, value) {
  const snapshot = await apiPost({command, instance_id: id, value});
  if (snapshot) {
    const st = document.getElementById('instance-command-status');
    if (st) st.textContent = 'Đã xử lý: ' + command + (id == null ? '' : ' (#' + id + ')');
  }
  return snapshot;
}

async function instanceAction(id, action) {
  const key = id + ':' + action;
  if (pendingInstanceActions.has(key)) return;
  pendingInstanceActions.add(key);
  const button = document.getElementById('instance-' + action + '-' + id);
  if (button) button.disabled = true;
  try {
    if (action === 'remove') {
      if (confirm('Xóa profile #' + id + '? Game đang chạy sẽ không bị tắt.')) await instanceCommand('remove_instance', id);
    } else if (action === 'bind') {
      const select = document.getElementById('instance-pid-' + id);
      const key = select?.value;
      const process = (instanceServices.processes || []).find(p => processKey(p) === key);
      if (!process) {
        const st = document.getElementById('instance-command-status');
        if (st) st.textContent = 'Chọn process mới quét trước.';
        return;
      }
      await instanceCommand('bind_instance', id, process.identity);
    } else if (action === 'focus' || action === 'minimize') {
      await instanceCommand('instance_window', id, action);
    } else if (action === 'cloak_toggle') {
      const isCloaked = cloakedInstances.has(id);
      const nextAction = isCloaked ? 'uncloak' : 'cloak';
      await instanceCommand('instance_window', id, nextAction);
      if (isCloaked) { cloakedInstances.delete(id); } else { cloakedInstances.add(id); }
      const b = document.getElementById('instance-cloak_toggle-' + id);
      if (b) {
        b.textContent = isCloaked ? '🌑 Màn đen' : '☀️ Hiện màn hình';
        b.style.borderColor = isCloaked ? '' : 'var(--cyan)';
        b.style.color = isCloaked ? '' : 'var(--cyan)';
      }
    } else if (action === 'launch') {
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
      const profile = instanceProfiles.get(id) || {};
      const running = instanceServices.runtime_instances || [];
      await apiPost({
        command: 'launch_instance',
        account_profile_id: id,
        is_main: running.length === 0 || id === (window.poeevhMainInstanceId ?? 1),
        black_screen: Boolean(profile.black_screen),
        bg_fps: Number(profile.bg_fps) || 60,
      });
    } else {
      const commands = {unbind: 'unbind_instance', main: 'set_main_instance'};
      await instanceCommand(commands[action], id);
    }
  } finally {
    pendingInstanceActions.delete(key);
    if (button) button.disabled = false;
    renderInstanceProcesses();
  }
}

function processKey(process) {
  return process.identity.pid + ':' + process.identity.started_at;
}

function renderInstanceProcesses(mainId) {
  const statuses = new Map((instanceServices.instances || []).map(status => [status.instance_id, status]));
  const processes = instanceServices.processes || [];
  const persistNote = document.getElementById('instance-persistence-note');
  if (persistNote) {
    persistNote.textContent = instanceServices.profiles_persistent
      ? 'Lưu bền vững: ' + instanceServices.profile_path
      : 'Chế độ test/phiên: chưa bật kho lưu profile.';
  }
  const procStatus = document.getElementById('instance-processes-status');
  if (procStatus) {
    procStatus.textContent = instanceServices.scan_error
      ? 'Không quét được: ' + instanceServices.scan_error : 'Tìm thấy ' + processes.length + ' process ứng viên. PID chỉ gắn trong phiên, không khôi phục tự động sau khi mở lại app.';
  }
  const statusNames = {bound: 'Đã gắn PID (OS)', unbound: 'Chưa gắn PID', disabled: 'Profile tắt', exited_or_unavailable: 'Process đã thoát hoặc không truy cập được', scan_unavailable: 'Chưa xác minh được process'};
  for (const [id, profile] of instanceProfiles) {
    const status = statuses.get(id);
    const process = status?.process;
    const select = document.getElementById('instance-pid-' + id);
    if (select) {
      const selection = select.value;
      const optionsKey = JSON.stringify(processes.map(p => [processKey(p), p.identity.exe_path, p.window?.title]));
      if (select.dataset.optionsKey !== optionsKey) {
        select.replaceChildren(new Option('Chọn PID…', ''), ...processes.map(p => new Option('PID ' + p.identity.pid + ' · ' + p.identity.exe_path, processKey(p))));
        if (processes.some(p => processKey(p) === selection)) select.value = selection;
        else if (process) select.value = processKey(process);
        select.dataset.optionsKey = optionsKey;
      }
    }
    const cpu = process?.cpu_percent == null ? '--' : process.cpu_percent.toFixed(1) + '%';
    const ram = process?.working_set_bytes == null ? '--' : (process.working_set_bytes / 1048576).toFixed(1) + ' MB';
    const note = document.getElementById('instance-note-' + id);
    if (note) {
      note.textContent = (profile.enabled ? 'Profile bật · ' : 'Profile tắt · ') + (statusNames[status?.status] || 'Chưa gắn PID')
        + (status?.binding ? ' · PID ' + status.binding.pid : '') + ' · CPU ' + cpu + ' · RAM ' + ram + ' · FPS --';
    }
    const isBound = status?.status === 'bound';
    for (const action of ['focus', 'minimize']) {
      const btn = document.getElementById('instance-' + action + '-' + id);
      if (btn) btn.disabled = !isBound || !process?.window;
    }
    const cloakBtn = document.getElementById('instance-cloak_toggle-' + id);
    if (cloakBtn) {
      cloakBtn.disabled = !isBound || !process?.window;
      const isCloaked = cloakedInstances.has(id);
      cloakBtn.textContent = isCloaked ? '☀️ Hiện màn hình' : '🌑 Màn đen';
      cloakBtn.style.borderColor = isCloaked ? 'var(--cyan)' : '';
      cloakBtn.style.color = isCloaked ? 'var(--cyan)' : '';
    }
    const bBind = document.getElementById('instance-bind-' + id);
    const bUnbind = document.getElementById('instance-unbind-' + id);
    const bLaunch = document.getElementById('instance-launch-' + id);
    if (bBind) bBind.disabled = !profile.enabled || !processes.length;
    if (bUnbind) bUnbind.disabled = !status?.binding;
    if (bLaunch) bLaunch.disabled = !profile.enabled || profile.flavor !== 'Standalone' || isBound;
    if (mainId != null) {
      const h3 = document.querySelector('#instance-card-' + id + ' h3');
      if (h3) h3.textContent = 'Instance #' + id + (mainId === id ? ' · MAIN' : '');
      const bMain = document.getElementById('instance-main-' + id);
      const bRemove = document.getElementById('instance-remove-' + id);
      if (bMain) bMain.disabled = mainId === id || !profile.enabled;
      if (bRemove) bRemove.disabled = mainId === id;
    }
  }
}

async function saveInstanceProfile(id) {
  const value = {
    label: document.getElementById('instance-label-' + id).value,
    flavor: document.getElementById('instance-flavor-' + id).value,
    exe_path: document.getElementById('instance-exe-' + id).value
  };
  const snapshot = await apiPost({command: 'update_instance', instance_id: id, value});
  if (snapshot) {
    if (document.getElementById('instance-label-' + id)?.value === value.label
        && document.getElementById('instance-flavor-' + id)?.value === value.flavor
        && document.getElementById('instance-exe-' + id)?.value === value.exe_path) dirtyInstances.delete(id);
    renderState(snapshot);
    const st = document.getElementById('instance-command-status');
    if (st) st.textContent = 'Đã lưu profile #' + id + (instanceServices.profiles_persistent ? ' vào ổ đĩa.' : ' trong phiên (test mode).');
  }
}

function renderInstanceGraphics() {
  const select = document.getElementById('instance-graphics-select');
  if (!select) return;
  const profile = instanceProfiles.get(Number(select.value));
  if (!profile) return;
  const black = document.getElementById('instance-black-screen');
  const fps = document.getElementById('instance-bg-fps');
  if (black && !black.disabled) black.checked = profile.black_screen;
  if (fps && document.activeElement !== fps && !fps.disabled) fps.value = profile.bg_fps;
}

async function saveInstanceGraphics() {
  const select = document.getElementById('instance-graphics-select');
  const id = Number(select?.value);
  const black = document.getElementById('instance-black-screen');
  const fps = document.getElementById('instance-bg-fps');
  const statusEl = document.getElementById('instance-graphics-status');
  if (!fps || !fps.reportValidity()) return;
  const patch = {black_screen: black.checked, bg_fps: Number(fps.value)};
  black.disabled = fps.disabled = select.disabled = true;
  if (statusEl) statusEl.textContent = 'Đang lưu và áp dụng cho Instance #' + id + '...';
  try {
    const snapshot = await apiPost({command: 'update_instance', instance_id: id, value: patch});
    if (snapshot) {
      renderState(snapshot);
      const tuneRes = await apiPost({command: 'tune_instance_smoother', instance_id: id});
      if (tuneRes && tuneRes.success) {
        if (statusEl) { statusEl.textContent = '✅ ' + tuneRes.message; statusEl.style.color = 'var(--cyan)'; }
      } else {
        if (statusEl) { statusEl.textContent = '✅ Đã lưu cấu hình profile cho #' + id + ' (sẽ tự kích hoạt khi game mở).'; statusEl.style.color = 'var(--cyan)'; }
      }
    } else {
      renderInstanceGraphics();
      if (statusEl) { statusEl.textContent = '❌ Lưu thất bại. Xem lại trong Quản lý instance.'; statusEl.style.color = 'var(--amber)'; }
    }
  } catch (e) {
    if (statusEl) { statusEl.textContent = '❌ Lỗi: ' + e.message; statusEl.style.color = 'var(--amber)'; }
  } finally {
    black.disabled = fps.disabled = select.disabled = false;
  }
}

async function toggleInstanceCloak(enable) {
  const select = document.getElementById('instance-graphics-select');
  const id = Number(select?.value);
  const statusEl = document.getElementById('instance-graphics-status');
  if (statusEl) {
    statusEl.textContent = enable ? 'Đang che màn đen...' : 'Đang hiện cửa sổ...';
  }
  try {
    const res = await apiPost({
      command: 'instance_window',
      instance_id: id,
      value: enable ? 'cloak' : 'uncloak'
    });
    if (res && statusEl) {
      statusEl.textContent = enable ? '🌑 Cửa sổ Instance #' + id + ' đã được che màn đen (DWM Cloak).' : '☀️ Cửa sổ Instance #' + id + ' đã hiển thị bình thường.';
      statusEl.style.color = 'var(--cyan)';
    }
  } catch (e) {
    if (statusEl) {
      statusEl.textContent = '❌ Không thực hiện được: ' + e.message;
      statusEl.style.color = 'var(--amber)';
    }
  }
}

async function toggleClientActive(clientId, active) {
  const checkbox = document.getElementById('instance-enabled-' + clientId);
  if (checkbox) checkbox.disabled = true;
  const snapshot = await apiPost({command: 'update_instance', instance_id: clientId, value: {enabled: active}});
  if (checkbox) {
    checkbox.disabled = false;
    checkbox.checked = instanceProfiles.get(clientId)?.enabled ?? false;
  }
  if (snapshot) renderState(snapshot);
}

function updateClientUIState(clientId, profile, status, isBotRunning) {
  const hudCard = document.getElementById('hud-card-c' + clientId);
  const hudBadge = document.getElementById('hud-badge-c' + clientId);
  const procInfo = document.getElementById('c' + clientId + '-proc-info');
  const mgrBadge = document.getElementById('badge-mgr-c' + clientId);
  const resCard = document.getElementById('res-card-c' + clientId);
  const resBadge = document.getElementById('c' + clientId + '-badge');
  const subtabBtn = document.getElementById('subtab-btn-c' + clientId);

  const btnLaunch = document.getElementById('client-launch-' + clientId);
  const btnToggle = document.getElementById('client-toggle-' + clientId);
  const btnFocus = document.getElementById('client-focus-' + clientId);
  const btnMin = document.getElementById('client-min-' + clientId);

  const isBound = status?.status === 'bound';
  const isLaunching = status?.status === 'launching';
  const pid = status?.binding?.pid;
  const isEnabled = profile?.enabled ?? false;

  if (procInfo) {
    if (isBound && pid) {
      procInfo.textContent = `PID: ${pid} · ${status.binding?.exe_path ? 'Đang chạy' : 'Đã kết nối'}`;
      procInfo.style.color = 'var(--cyan)';
    } else if (isLaunching) {
      procInfo.textContent = 'Đang mở tiến trình...';
      procInfo.style.color = 'var(--amber)';
    } else {
      procInfo.textContent = profile?.flavor ? `${profile.flavor} · Chưa gắn PID` : 'Chưa gắn PID';
      procInfo.style.color = 'var(--dim)';
    }
  }

  if (btnLaunch) {
    if (isBound) {
      btnLaunch.disabled = true;
      btnLaunch.textContent = '✓ Đã mở';
    } else if (isLaunching) {
      btnLaunch.disabled = true;
      btnLaunch.textContent = '⏳ Đang mở...';
    } else {
      btnLaunch.disabled = false;
      btnLaunch.textContent = '▷ Mở game';
    }
  }

  if (btnToggle) {
    if (!isBound) {
      btnToggle.disabled = true;
      btnToggle.textContent = 'Bật bot';
      btnToggle.className = 'btn btn-primary btn-sm';
    } else {
      btnToggle.disabled = false;
      if (isEnabled && isBotRunning) {
        btnToggle.textContent = '⏸ Tạm dừng';
        btnToggle.className = 'btn btn-danger btn-sm';
      } else {
        btnToggle.textContent = '▶ Bật bot';
        btnToggle.className = 'btn btn-primary btn-sm';
      }
    }
  }

  if (btnFocus) btnFocus.disabled = !isBound;
  if (btnMin) btnMin.disabled = !isBound;

  if (isBound) {
    const text = isEnabled && isBotRunning ? `PID: ${pid} · Đang chạy` : `PID: ${pid} · Tạm dừng`;
    const bg = isEnabled && isBotRunning ? 'var(--green-bg)' : 'var(--amber-bg, #3a2b10)';
    const col = isEnabled && isBotRunning ? 'var(--green)' : 'var(--amber)';
    if (hudBadge) { hudBadge.textContent = text; hudBadge.style.background = bg; hudBadge.style.color = col; }
    if (mgrBadge) { mgrBadge.textContent = `PID ${pid}`; mgrBadge.style.background = bg; mgrBadge.style.color = col; }
    if (resBadge) {
      resBadge.textContent = (clientId === 1 ? 'Chính' : 'Ngầm');
      resBadge.style.background = (clientId === 1 ? 'var(--blue-bg)' : 'var(--green-bg)');
      resBadge.style.color = (clientId === 1 ? 'var(--cyan)' : 'var(--green)');
    }
    if (subtabBtn) subtabBtn.style.display = 'flex';
  } else if (isLaunching) {
    if (hudBadge) { hudBadge.textContent = 'Đang mở...'; hudBadge.style.background = 'var(--blue-bg)'; hudBadge.style.color = 'var(--cyan)'; }
    if (mgrBadge) { mgrBadge.textContent = 'Đang mở...'; mgrBadge.style.background = 'var(--blue-bg)'; mgrBadge.style.color = 'var(--cyan)'; }
    if (resBadge) { resBadge.textContent = 'Đang mở'; resBadge.style.background = 'var(--blue-bg)'; resBadge.style.color = 'var(--cyan)'; }
    if (subtabBtn) subtabBtn.style.display = 'flex';
  } else {
    if (hudBadge) { hudBadge.textContent = 'Chưa mở game'; hudBadge.style.background = 'var(--bg3)'; hudBadge.style.color = 'var(--sub)'; }
    if (mgrBadge) { mgrBadge.textContent = 'Chưa mở game'; mgrBadge.style.background = 'var(--bg3)'; mgrBadge.style.color = 'var(--sub)'; }
    if (resBadge) { resBadge.textContent = 'Chờ game'; resBadge.style.background = 'var(--bg3)'; resBadge.style.color = 'var(--sub)'; }
    if (subtabBtn) subtabBtn.style.display = 'none';
  }
}

async function clientAction(id, action) {
  const status = document.getElementById('instance-command-status');
  if (action === 'launch') {
    if (status) status.textContent = `Đang mở Client #${id}...`;
    await instanceAction(id, 'launch');
  } else if (action === 'toggle-bot') {
    await apiPost({ command: 'toggle_client_bot', instance_id: id });
  } else if (action === 'focus') {
    await instanceAction(id, 'focus');
  } else if (action === 'minimize') {
    await instanceAction(id, 'minimize');
  }
}

// Render only live processes. Profiles remain persistent preferences, while a
// runtime card exists for the lifetime of its bound process. This avoids
// presenting empty Client 1/2/3 slots when no game is running.
function renderRuntimeHud(profiles, statuses, running, controllers = {}) {
  const host = document.getElementById('runtime-instance-hud');
  const empty = document.getElementById('runtime-instance-empty');
  if (!host) return;
  const profileById = new Map((profiles || []).map(p => [p.id, p]));
  const virtualByTarget = new Map(
    (controllers.virtual_controllers || []).map(controller => [controller.target, controller])
  );
  const live = (statuses || []).filter(s => s.status === 'bound' || s.status === 'launching');
  const renderKey = JSON.stringify({
    running: Boolean(running),
    live: live.map(status => {
      const profile = profileById.get(status.account_profile_id ?? status.instance_id) || {};
      return [
        status.instance_id, status.status, status.binding?.pid || 0, status.is_main,
        profile.label || '', profile.flavor || '', profile.char1_name || '',
        profile.char1_role || '', profile.char2_name || '', profile.char2_role || '',
        effectiveInputMode(profile),
        ...controllerTargetsForInstance(status.instance_id).map(target => virtualByTarget.get(target)?.xinput_slot || 0),
      ];
    }),
  });
  if (renderKey === runtimeHudRenderKey) return;
  runtimeHudRenderKey = renderKey;
  host.replaceChildren();
  if (empty) empty.style.display = live.length ? 'none' : 'block';
  for (const [index, status] of live.entries()) {
    const id = status.instance_id;
    const profile = profileById.get(status.account_profile_id ?? id) || {};
    const process = status.process || {};
    const card = document.createElement('section');
    card.className = 'card runtime-instance-card';
    card.dataset.instanceId = String(id);
    const title = document.createElement('div');
    title.className = 'card-header';
    const heading = document.createElement('div');
    const name = document.createElement('span');
    name.className = 'card-title';
    name.textContent = profile.label || ('Runtime instance #' + id);
    const detail = document.createElement('div');
    detail.style.cssText = 'font-size:11px;color:var(--dim)';
    detail.textContent = status.binding?.pid ? `PID ${status.binding.pid} · ${profile.flavor || 'PoE2'}` : 'Đang khởi tạo…';
    heading.append(name, detail);
    const headerActions = document.createElement('div');
    headerActions.style.cssText = 'display:flex;align-items:center;gap:6px';
    const settingsButton = document.createElement('button');
    settingsButton.className = 'btn btn-neutral btn-sm';
    settingsButton.textContent = '⚙';
    settingsButton.title = 'Cấu hình số tài khoản và kiểu điều khiển';
    settingsButton.addEventListener('click', () => openClientInputSettings(id));
    const badge = document.createElement('span');
    badge.className = 'app-badge';
    badge.textContent = status.status === 'launching' ? 'ĐANG MỞ' : (status.is_main ? 'MAIN' : 'ĐANG CHẠY');
    badge.style.cssText = 'background:var(--green-bg);color:var(--green)';
    headerActions.append(settingsButton, badge);
    title.append(heading, headerActions);
    card.append(title);
    if (effectiveInputMode(profile) === 'dual_controller') {
      const mapping = document.createElement('div');
      mapping.className = 'runtime-controller-map';
      const mappingTitle = document.createElement('span');
      mappingTitle.className = 'runtime-controller-map-title';
      mappingTitle.textContent = status.binding?.pid
        ? `PID ${status.binding.pid} · Chọn trong game`
        : 'Controller · đang chờ game';
      mapping.append(mappingTitle);
      for (const target of controllerTargetsForInstance(id)) {
        const controller = virtualByTarget.get(target);
        const chip = document.createElement('span');
        chip.className = 'runtime-controller-chip' + (controller ? ' is-ready' : ' is-waiting');
        chip.textContent = controller
          ? `${target} → Xbox Controller #${controller.xinput_slot}`
          : `${target} → đang chờ XInput`;
        mapping.append(chip);
      }
      card.append(mapping);
    }
    const chars = effectiveInputMode(profile) === 'dual_controller'
      ? [[profile.char1_name || 'Character 1', profile.char1_role || 'Follower'], [profile.char2_name || 'Character 2', profile.char2_role || 'Follower']]
      : [[profile.char1_name || 'Leader', profile.char1_role || 'Main · WASD']];
    for (const [charName, role] of chars) {
      const row = document.createElement('div');
      row.style.cssText = 'background:var(--bg0);padding:7px 9px;border-radius:4px;margin-bottom:6px;display:flex;justify-content:space-between';
      const label = document.createElement('span');
      label.textContent = charName + ' · ' + role;
      const hp = document.createElement('span');
      hp.style.color = 'var(--sub)';
      hp.textContent = 'Chờ dữ liệu';
      row.append(label, hp);
      card.append(row);
    }
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;border-top:1px solid var(--border);padding-top:8px;margin-top:6px';
    for (const [action, label] of [['toggle-bot', running ? '⏸ Tạm dừng bot' : '▶ Bật bot'], ['focus', 'Focus'], ['minimize', 'Thu nhỏ']]) {
      const button = document.createElement('button');
      button.className = 'btn btn-neutral btn-sm';
      button.textContent = label;
      button.addEventListener('click', () => clientAction(id, action));
      actions.append(button);
    }
    card.append(actions);
    host.append(card);
  }
}

function controllerTargetsForInstance(instanceId) {
  const first = Math.max(1, (Number(instanceId) - 1) * 2 + 1);
  return [`P${first}`, `P${first + 1}`];
}
