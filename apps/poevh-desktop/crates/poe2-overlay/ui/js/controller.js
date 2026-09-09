/* ==========================================================================
   POEVH Controller — Virtual Controller Mapping & Keybind Conflict Resolver
   ========================================================================== */

let currentRecordingBtn = null;
let recordingCleanups = null;
let pendingConflictAction = null;

function formatKeyDisplay(keyStr) {
  if (!keyStr || keyStr === 'None' || keyStr === 'NONE' || String(keyStr).trim() === '') return 'Chưa gán';
  const u = String(keyStr).trim().toUpperCase();
  const map = {
    'SPACE': 'Space',
    'SHIFT': 'Shift',
    'CTRL': 'Ctrl',
    'CONTROL': 'Ctrl',
    'ALT': 'Alt',
    'TAB': 'Tab',
    'ESCAPE': 'Esc',
    'ESC': 'Esc',
    'ENTER': 'Enter',
    'BACKSPACE': 'Backspace',
    'CAPSLOCK': 'Caps',
    'MOUSELEFT': '🖱️ Chuột Trái',
    'LCLICK': '🖱️ Chuột Trái',
    'MOUSERIGHT': '🖱️ Chuột Phải',
    'RCLICK': '🖱️ Chuột Phải',
    'MOUSEMID': '🖱️ Chuột Giữa',
    'MCLICK': '🖱️ Chuột Giữa',
    'MOUSE4': '🖱️ Nút Hông 1',
    'MOUSE5': '🖱️ Nút Hông 2',
  };
  return map[u] || u;
}

function stopKeyRecord() {
  if (recordingCleanups) {
    recordingCleanups();
    recordingCleanups = null;
  }
  if (currentRecordingBtn) {
    currentRecordingBtn.classList.remove('recording');
    const val = currentRecordingBtn.dataset.currentVal || '';
    const valSpan = currentRecordingBtn.querySelector('.keybind-val');
    if (valSpan) valSpan.textContent = formatKeyDisplay(val);
    currentRecordingBtn = null;
  }
}

function showConflictModal(targetBtn, targetBtnName, conflictBtn, keyName) {
  const targetLabel = targetBtn.closest('.keybind-row')?.querySelector('.keybind-name')?.textContent?.trim() || targetBtnName;
  const conflictLabel = conflictBtn.closest('.keybind-row')?.querySelector('.keybind-name')?.textContent?.trim() || conflictBtn.dataset.btn;
  const keyDisplay = formatKeyDisplay(keyName);

  const dialog = document.getElementById('keybind-conflict-dialog');
  if (!dialog) {
    const ok = confirm(`⚠️ Phím [${keyDisplay}] hiện đang được gán cho "${conflictLabel}".\n\nBạn có muốn xóa gán phím ở "${conflictLabel}" để chuyển sang cho "${targetLabel}" không?\n(Hệ thống không cho phép 1 hotkey trùng lặp)`);
    if (ok) {
      conflictBtn.dataset.currentVal = '';
      const vs = conflictBtn.querySelector('.keybind-val');
      if (vs) vs.textContent = formatKeyDisplay('');
      cmdSetControllerKey(conflictBtn.dataset.btn, '');
      commitKey(targetBtn, targetBtnName, keyName);
    }
    return;
  }

  const msgEl = document.getElementById('conflict-dialog-msg');
  if (msgEl) {
    msgEl.innerHTML = `Phím <strong style="color:var(--accent);font-size:14px;">[ ${keyDisplay} ]</strong> hiện đang được gán cho <strong>"${conflictLabel}"</strong>.<br><br>Bạn có muốn <strong>xóa gán phím ở "${conflictLabel}"</strong> để chuyển phím này sang cho <strong>"${targetLabel}"</strong> không?`;
  }

  pendingConflictAction = () => {
    conflictBtn.dataset.currentVal = '';
    const vs = conflictBtn.querySelector('.keybind-val');
    if (vs) vs.textContent = formatKeyDisplay('');
    cmdSetControllerKey(conflictBtn.dataset.btn, '');
    commitKey(targetBtn, targetBtnName, keyName);
  };

  dialog.showModal();
}

function requestBindKey(btn, buttonName, keyName) {
  const trimmed = (keyName || '').trim();

  if (!trimmed) {
    commitKey(btn, buttonName, '');
    return;
  }

  const currentVal = (btn.dataset.currentVal || '').trim();
  if (currentVal.toUpperCase() === trimmed.toUpperCase()) {
    stopKeyRecord();
    return;
  }

  let conflictBtn = null;
  const allKeybindBtns = document.querySelectorAll('.keybind-btn');
  for (const otherBtn of allKeybindBtns) {
    if (otherBtn !== btn && otherBtn.dataset.btn) {
      const val = (otherBtn.dataset.currentVal || '').trim();
      if (val && val.toUpperCase() === trimmed.toUpperCase()) {
        conflictBtn = otherBtn;
        break;
      }
    }
  }

  stopKeyRecord();

  if (conflictBtn) {
    showConflictModal(btn, buttonName, conflictBtn, trimmed);
  } else {
    commitKey(btn, buttonName, trimmed);
  }
}

function startKeyRecord(btn, buttonName) {
  if (currentRecordingBtn === btn) {
    stopKeyRecord();
    return;
  }
  stopKeyRecord();

  currentRecordingBtn = btn;
  btn.classList.add('recording');
  const valSpan = btn.querySelector('.keybind-val');
  if (valSpan) valSpan.textContent = 'Bấm phím...';

  const onKeyDown = (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (e.key === 'Escape') {
      stopKeyRecord();
      return;
    }

    if (e.code === 'Delete') {
      requestBindKey(btn, buttonName, '');
      return;
    }

    let keyName = '';
    if (e.code === 'Space') {
      keyName = 'Space';
    } else if (e.key === 'Shift' || e.code.startsWith('Shift')) {
      keyName = 'Shift';
    } else if (e.key === 'Control' || e.code.startsWith('Control')) {
      keyName = 'Ctrl';
    } else if (e.key === 'Alt' || e.code.startsWith('Alt')) {
      keyName = 'Alt';
    } else if (e.code === 'Tab') {
      keyName = 'Tab';
    } else if (e.code === 'Enter') {
      keyName = 'Enter';
    } else if (e.code === 'Backspace') {
      keyName = 'Backspace';
    } else if (e.code.startsWith('Digit')) {
      keyName = e.code.replace('Digit', '');
    } else if (e.code.startsWith('Key')) {
      keyName = e.code.replace('Key', '');
    } else if (/^F\d{1,2}$/i.test(e.key)) {
      keyName = e.key.toUpperCase();
    } else if (e.key.length === 1) {
      keyName = e.key.toUpperCase();
    } else {
      keyName = e.code;
    }

    requestBindKey(btn, buttonName, keyName);
  };

  const onMouseDown = (e) => {
    if (!btn.contains(e.target)) {
      stopKeyRecord();
      return;
    }

    let mouseName = '';
    if (e.button === 2) {
      mouseName = 'MouseRight';
    } else if (e.button === 1) {
      mouseName = 'MouseMid';
    } else if (e.button === 3) {
      mouseName = 'Mouse4';
    } else if (e.button === 4) {
      mouseName = 'Mouse5';
    } else if (e.button === 0) {
      mouseName = 'MouseLeft';
    }

    if (mouseName) {
      e.preventDefault();
      e.stopPropagation();
      requestBindKey(btn, buttonName, mouseName);
    }
  };

  const onContextMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  setTimeout(() => {
    window.addEventListener('keydown', onKeyDown, { capture: true });
    window.addEventListener('mousedown', onMouseDown, { capture: true });
    window.addEventListener('contextmenu', onContextMenu, { capture: true });

    recordingCleanups = () => {
      window.removeEventListener('keydown', onKeyDown, { capture: true });
      window.removeEventListener('mousedown', onMouseDown, { capture: true });
      window.removeEventListener('contextmenu', onContextMenu, { capture: true });
    };
  }, 50);
}

function commitKey(btn, buttonName, keyName) {
  btn.dataset.currentVal = keyName;
  const valSpan = btn.querySelector('.keybind-val');
  if (valSpan) valSpan.textContent = formatKeyDisplay(keyName);

  btn.classList.add('just-saved');
  setTimeout(() => btn.classList.remove('just-saved'), 400);

  stopKeyRecord();
  cmdSetControllerKey(buttonName, keyName);
}

function cmdSetControllerKey(button, key) {
  apiPost({ command: 'set_controller_key', key: button, value: key });
}

async function applyCtrlPreset(preset) {
  const defaults = {
    default: {
      move_up: 'W', move_down: 'S', move_left: 'A', move_right: 'D',
      button_a: 'Space', button_b: 'R', button_x: 'Q', button_y: 'E',
      button_lb: 'Shift', button_rb: 'F', button_lt: 'C', button_rt: 'V',
      dpad_left: '1', dpad_right: '2', dpad_up: '3', dpad_down: '4',
      button_start: 'Escape', button_back: 'Tab'
    },
    mouse: {
      move_up: 'W', move_down: 'S', move_left: 'A', move_right: 'D',
      button_a: 'MouseRight', button_b: 'E', button_x: 'Q', button_y: 'R',
      button_lb: 'Shift', button_rb: 'F', button_lt: 'Mouse4', button_rt: 'Mouse5',
      dpad_left: '1', dpad_right: '2', dpad_up: '3', dpad_down: '4',
      button_start: 'Escape', button_back: 'Tab'
    }
  };
  const map = defaults[preset];
  if (!map) return;
  for (const [btn, key] of Object.entries(map)) {
    const el = document.querySelector(`.keybind-btn[data-btn="${btn}"]`);
    if (el) {
      el.dataset.currentVal = key;
      const vs = el.querySelector('.keybind-val');
      if (vs) vs.textContent = formatKeyDisplay(key);
    }
    await apiPost({ command: 'set_controller_key', key: btn, value: key });
  }
}

// Modal dialog button listeners
window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('conflict-confirm-btn')?.addEventListener('click', () => {
    const dialog = document.getElementById('keybind-conflict-dialog');
    if (dialog) dialog.close();
    if (pendingConflictAction) {
      const action = pendingConflictAction;
      pendingConflictAction = null;
      action();
    }
  });

  document.getElementById('conflict-cancel-btn')?.addEventListener('click', () => {
    const dialog = document.getElementById('keybind-conflict-dialog');
    pendingConflictAction = null;
    if (dialog) dialog.close();
  });

  document.getElementById('keybind-conflict-dialog')?.addEventListener('cancel', () => {
    pendingConflictAction = null;
  });
});
