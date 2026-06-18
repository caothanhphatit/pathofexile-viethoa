# PoE2 Overlay

Overlay cho Path of Exile 2 (Electron).

## Cách chạy

```bash
cd desktop
npm install
npm start
```

## Yêu cầu quan trọng

- Game **BẮT BUỘC** phải chạy ở chế độ **Windowed Fullscreen (borderless)** — overlay không hoạt động ở chế độ Fullscreen độc quyền.

## Price check (kiểm tra giá)

Để dùng tính năng kiểm tra giá, cần đặt biến môi trường `POESESSID`:

1. Mở trình duyệt và đăng nhập vào [pathofexile.com](https://www.pathofexile.com).
2. Mở Developer Tools (F12) > tab **Application** (Chrome) hoặc **Storage** (Firefox).
3. Vào **Cookies** > `https://www.pathofexile.com`.
4. Tìm cookie tên `POESESSID` và copy giá trị của nó.
5. Đặt biến môi trường trước khi chạy:

```powershell
# PowerShell
$env:POESESSID = "gia_tri_cookie_cua_ban"
npm start
```

```bash
# Bash / cmd
set POESESSID=gia_tri_cookie_cua_ban
npm start
```

- Tùy chọn: đặt thêm `POE2_LEAGUE` để chọn league (mặc định dùng league hiện tại nếu không đặt).

```powershell
$env:POE2_LEAGUE = "Standard"
```

## Phím tắt (Hotkeys)

- `Ctrl+Alt+L` — bật/tắt chế độ click-through / tương tác với overlay.
- `Ctrl+D` — kiểm tra giá món đồ đang ở clipboard (trong game nhấn `Ctrl+C` trên món đồ trước).

## Ghi chú

- Tính năng **auto-follow** tự động đọc file `Client.txt` (ở các đường dẫn cài đặt mặc định) — **không cần backend**.
