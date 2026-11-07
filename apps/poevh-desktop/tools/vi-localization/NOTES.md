# Ghi chú việt hoá client (tạm dừng 2026-11-06)

## Đã làm
- Helper GGPK (`../poevh-ggpk-patcher`) có thêm `--list`, `--extract`, `--replace`, `--ggpk-tree`.
  Build bằng .NET 8 SDK user-local: `%LOCALAPPDATA%\Microsoft\dotnet\dotnet.exe publish -c Release -o publish`.
- Bản PoE2 thật: `D:\Grinding Gear Games\Path of Exile 2` (4.5.3.1.4). Bảng dữ liệu ở `data/balance/*.datc64`,
  bản ngôn ngữ khác ở `data/balance/<lang>/`.
- Đã patch quest Act 1 (11 tên quest + 114 dòng QuestStates) vào game, backup trong `POEVH_Backups`.
  Gỡ: `PoevhGgpkPatcher.exe --restore "<game>\Content.ggpk" restore "<game>\POEVH_Backups"`.
- Chưa xem trong game.

## Font (đo cmap thật)
| Font | Dùng cho | Thiếu ký tự Việt (trong 74) |
|---|---|---|
| Fontin regular/bold/italic/smallcaps | UI, tooltip, quest | 56 |
| FrizQuadrata | tiêu đề | 50 |
| Caveat | viết tay | 42 |
| Kanit (có sẵn, font Thái) | - | 0 |

Fontin chỉ có 233 glyph, thiếu toàn bộ ă đ ơ ư và dấu hỏi/ngã/nặng → chữ Việt sẽ hiện ô vuông
trừ khi engine tự fallback.

## Hướng xử lý font
1. Mở rộng Fontin (khuyên dùng): thêm glyph Việt vào chính file Fontin bằng FontForge. Sắc/huyền/mũ/ngã
   dựng tự động được; phải vẽ dấu móc, trăng, hỏi, nặng và chữ đ. Làm cho 4 bản Fontin + FrizQuadrata.
   Không đổi nét chữ hay độ rộng của text tiếng Anh.
2. Thay font giống: Alegreya / Alegreya SC thay Fontin, Spectral hoặc Playfair Display thay FrizQuadrata.
   Nhanh nhưng đổi toàn bộ nét chữ và có thể tràn ô.
3. Kanit chỉ để test pipeline, không hợp phong cách.

Ghi đè font bằng `--replace art/2dart/fonts/<tên>.ttf=<file>` giống như quest.

## Việc tiếp theo
- Xem quest Act 1 trong game để biết engine có fallback font không.
- Chọn hướng font, làm font rồi patch.
- Mở rộng bản dịch: Act 2+ (QuestStates còn 1266 dòng), tên item/currency giữ tiếng Anh theo glossary.
- Thêm cơ chế phát hiện đổi version game: so `originalSha256` trong manifest với file hiện tại trước khi apply.
