# Việt hoá client PoE2 (thử nghiệm)

Pipeline ghi bản dịch vào các bảng `.datc64` trong `Content.ggpk`, không đụng
file nào khác của game.

- `datc64.mjs`: đọc bảng theo `schema/schema.min.json` (poe-tool-dev/dat-schema,
  `validFor` 2 = PoE2) và ghi lại các ô string bằng cách nối chuỗi mới vào cuối
  phần dữ liệu biến, chỉ sửa offset của ô được dịch.
- `translations/quest-act1.vi.json`: bản dịch theo `(bảng, số dòng, cột)`.
  `quest-act1.en.json` là bản gốc trích từ game để đối chiếu khi có patch.
- `build-quest.mjs`: trích bảng từ game, áp dịch, kiểm tra từng ô, và với
  `--apply` ghi vào GGPK qua `../poevh-ggpk-patcher` (có backup trong
  `<game>/POEVH_Backups`, khôi phục bằng `PoevhGgpkPatcher.exe --restore`).

```
node build-quest.mjs --game="D:\Grinding Gear Games\Path of Exile 2" --apply
```

Game phải tắt khi `--apply`. Sau mỗi patch của GGG cần chạy lại; dòng nào đổi
text gốc sẽ báo lỗi token/row để dịch lại.
