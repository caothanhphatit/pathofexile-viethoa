# POEVH Trade Overlay

## Kết quả

Module price-check dùng luồng clean-room theo hành vi của Awakened PoE Trade:

1. Người dùng rê chuột lên item khi cửa sổ Path of Exile đang foreground.
2. `Ctrl+E` gửi `Ctrl+C`, đợi clipboard mới và từ chối dữ liệu clipboard cũ.
3. Parser chuyển item text thành model có rarity, base type, item level và modifier.
4. Overlay nổi được mở sau khi capture hoàn tất và tự động chạy một query đầu tiên với tối đa ba modifier có tín hiệu cao.
5. Backend tải stat IDs từ GGG, map từng dòng sang filter Trade2 hợp lệ, rồi gọi `trade2/search` và `trade2/fetch`.
6. UI hiển thị listing thật: giá, iLvl, quality, seller và thời điểm đăng.

Không dùng OCR, đọc memory game, công thức giá cố định hay dữ liệu marketing để định giá.

## Các thành phần

- `crates/poe2-world/src/trade/hotkey.rs`: foreground gate, hotkey, clipboard sentinel/poll/restore.
- `crates/poe2-world/src/trade/parser.rs`: parse item text.
- `crates/poe2-world/src/trade/market.rs`: danh sách league, stat mapping, search/fetch và rate pacing.
- `crates/poe2-overlay/src/desktop_app.rs`: cửa sổ overlay warm/hidden, always-on-top.
- `crates/poe2-overlay/ui/trade-overlay.html`: cấu trúc popup.
- `crates/poe2-overlay/ui/css/trade-overlay.css`: giao diện tối màu kiểu bảng PoE.
- `crates/poe2-overlay/ui/js/trade-overlay.js`: filter, search, median và listing table.
- `crates/poe2-overlay/src/server.rs`: local authenticated routes.

## API upstream

- `GET https://www.pathofexile.com/api/trade2/data/leagues`
- `GET https://www.pathofexile.com/api/trade2/data/stats`
- `POST https://www.pathofexile.com/api/trade2/search/poe2/{league}`
- `GET https://www.pathofexile.com/api/trade2/fetch/{ids}?query={queryId}`

Client có User-Agent riêng, timeout, xử lý `Retry-After`, serialize search và chờ tối thiểu 2.1 giây giữa hai search. Local API vẫn yêu cầu token theo phiên và không hoạt động như proxy URL tùy ý.

## Cách dùng

1. Mở `POEVH.exe`.
2. Để game ở Windowed Fullscreen/Borderless nếu fullscreen độc quyền không cho cửa sổ khác phủ lên.
3. Rê chuột lên item.
4. Bấm `Ctrl+E`.
5. Kết quả đầu tiên tự tải. Có thể bật/tắt dòng, sửa min/max hoặc chọn pseudo-total, sau đó bấm **Search** để chạy lại query.
6. `Esc` hoặc nút `×` để đóng popup.

Hotkey bị bỏ qua khi foreground window không có tiêu đề Path of Exile. Nếu `Ctrl+E` đã do ứng dụng khác chiếm, lỗi được ghi vào session log.

## Giới hạn hiện tại

- Hiển thị 10 listing đầu tiên; tổng match vẫn lấy từ search response.
- Modifier được map theo stat catalog chính thức của Trade2; các dòng rune/implicit/enchant được giữ đúng kind. Một số pseudo-total được gộp ở UI và chỉ đưa vào query khi người dùng chọn.
- Currency hiện đi qua item search; chưa có UI bulk exchange riêng.
- Popup là always-on-top window, không inject renderer. Fullscreen độc quyền có thể che popup.
- Kiểm thử tự động xác nhận capture/parser/query/UI; thao tác `Ctrl+E` thật trong game cần test thủ công vì test không phát input vào tài khoản game.

## Nguồn tham khảo

- Awakened PoE Trade quick-start: <https://github.com/SnosMe/awakened-poe-trade/blob/master/docs/quick-start.md>
- Hotkey/clipboard flow: <https://github.com/SnosMe/awakened-poe-trade/tree/master/main/src/shortcuts>
- Trade search/fetch pattern: <https://github.com/SnosMe/awakened-poe-trade/blob/master/renderer/src/web/price-check/trade/pathofexile-trade.ts>
- PoE2 Overlay (Rust/Tauri, clipboard → parse → Trade2): <https://github.com/andre-lund/poe2-overlay>
- PoE2 currency/item overlay (official Trade2 + pseudo-stat filters): <https://github.com/POE2-VibeTools/poe2-currency-overlay>
- Exiled Exchange 2 (PoE2 port of Awakened-style stat filters): <https://github.com/Kvan7/Exiled-Exchange-2>

Awakened PoE Trade được dùng để hiểu hành vi và ranh giới module. Giao diện và implementation Rust của POEVH được viết mới.
