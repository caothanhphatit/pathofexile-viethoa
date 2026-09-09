/* Physical XInput controller inventory. Data is produced by the Rust backend. */
(function () {
  function escapeText(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  window.renderPhysicalControllers = function renderPhysicalControllers(inventory) {
    const list = document.getElementById('physical-controller-list');
    const count = document.getElementById('physical-controller-count');
    const title = document.getElementById('physical-controller-heading');
    const subtitle = document.getElementById('physical-controller-subtitle');
    const error = document.getElementById('physical-controller-error');
    const virtualNote = document.getElementById('virtual-controller-note');
    if (!list || !count || !title || !subtitle || !error || !virtualNote) return;

    const physical = Array.isArray(inventory?.physical) ? inventory.physical : [];
    const virtualCount = Number(inventory?.virtual_count || 0);
    count.textContent = String(physical.length);
    virtualNote.textContent = virtualCount > 0
      ? `Đã loại ${virtualCount} controller Xbox ảo do POEVH tạo khỏi kết quả.`
      : 'Controller Xbox ảo do POEVH tạo sẽ tự động được tách khỏi kết quả.';

    if (inventory?.scan_error) {
      error.hidden = false;
      error.textContent = inventory.scan_error;
    } else {
      error.hidden = true;
      error.textContent = '';
    }

    if (!physical.length) {
      title.textContent = 'Chưa thấy tay cầm vật lý';
      subtitle.textContent = 'Cắm USB hoặc kết nối Bluetooth/receiver; danh sách sẽ tự cập nhật.';
      list.innerHTML = `<div class="controller-empty">
        <div class="controller-empty-icon" aria-hidden="true">⌁</div>
        <strong>Không có thiết bị XInput vật lý</strong>
        <span>POEVH vẫn đang theo dõi thay đổi kết nối.</span>
      </div>`;
      return;
    }

    title.textContent = physical.length === 1
      ? 'Đã nhận một tay cầm vật lý'
      : `Đã nhận ${physical.length} tay cầm vật lý`;
    subtitle.textContent = 'Bấm nút hoặc di chuyển cần để kiểm tra tín hiệu trực tiếp.';
    list.innerHTML = physical.map(device => `
      <article class="controller-device ${device.active ? 'is-active' : ''}">
        <div class="controller-device-ordinal">${Number(device.slot) || '—'}</div>
        <div class="controller-device-copy">
          <div class="controller-device-name">${escapeText(device.name)}</div>
          <div class="controller-device-meta">
            <span>${escapeText(device.connection || 'XInput')}</span>
            ${device.battery ? `<span>${escapeText(device.battery)}</span>` : ''}
          </div>
        </div>
        <div class="controller-signal ${device.active ? 'is-live' : ''}">
          <span></span>${device.active ? 'Đang nhận input' : 'Đã kết nối'}
        </div>
      </article>`).join('');
  };
})();
