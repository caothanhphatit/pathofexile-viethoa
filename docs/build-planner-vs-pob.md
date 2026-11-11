# Build Planner so với Path of Building (PoE2)

Cập nhật: 2026-11-11. Bản PoB dùng để so: `D:\code\pob-core` (nhánh `dev`).

Ký hiệu: ✅ có · 🟡 làm dở / chỉ một phần · ❌ chưa có.
Cột **Ưu tiên** là thứ tự nên làm tiếp (1 = làm trước), xét theo mức hữu ích cho người chơi Việt.

## Luồng kiểm tra Planner ↔ PoB

Mục tiêu: con số Planner hiện ra phải đúng bằng con số PoB tính cho cùng build.

- Build mẫu: `tests/fixtures/pob-builds/*.json` — 5 PoB code thật lấy từ ladder poe.ninja (Mercenary Gemling ×3, Druid Oracle, Sorceress Stormweaver, cấp 100). Thêm build mẫu = thêm một file `{ name, source, code }`.
- Đường đi giống hệt trang web: import PoB code → trạng thái Planner → lưu build vào trình duyệt rồi mở lại (như bấm F5) → body `POST /api/builds/calculate` → XML backend (`src/server/pob-build-xml.mjs`) → PoB chạy.
- So 3 cột: **Code** (số PoB ghi sẵn trong code, thẻ `PlayerStat`), **PoB** (PoB trên máy chạy nguyên XML của code), **Planner**. Planner phải khớp cột PoB. Cột PoB lệch cột Code chỉ vì bản PoB khác bản người chơi dùng, được ghi chú riêng.
- Chỉ số so: DPS kỹ năng chính, Life, ES, Mana, Spirit, Armour, Evasion, 4 kháng, Str/Dex/Int, EHP.

Chạy:

```bash
npm run check:pob
```

```bash
npm test
```

`npm run check:pob` in bảng từng build và trả mã lỗi 1 nếu có chỉ số lệch (`--report-only` để chỉ báo, `--json` để lấy JSON, thêm tên build để chạy riêng một build). `npm test` chạy `tests/pob-parity.test.mjs`: phần so cấu trúc (nhóm gem, item, node, socket jewel, weapon set, config, class/ascendancy) luôn chạy; phần so số chạy khi máy có PoB (`scripts/setup-pob-local.mjs`), không có thì bỏ qua và ghi rõ lý do.

Kết quả hiện tại: **5/5 build khớp PoB** ở mọi chỉ số trên.

### Lỗi luồng kiểm tra đã tìm ra (đã sửa)

| Lỗi | Hậu quả trước khi sửa |
| --- | --- |
| Cấp và chất lượng gem bị bỏ, gem nào cũng tính cấp 20 chất lượng 0 | DPS lệch 4–14% |
| Gem chỉ nhận ra theo tên, mất `gemId`/`variantId` | Clarity II tính thành Clarity I, v.v. |
| Nhóm gem bị tách theo từng gem kích hoạt (Cast on Crit + Comet thành 2 nhóm), nhóm tắt bị bỏ | Chọn sai kỹ năng chính (`mainSocketGroup` trỏ nhầm nhóm) |
| Mất `corruptLevel`, `skillPart`, lựa chọn minion… của gem | Gem corrupt +1 cấp tính thiếu một cấp |
| Node passive của từng bộ vũ khí (Weapon Set 1/2) bị gộp chung | Cộng cả hai bộ cùng lúc |
| Vũ khí bộ II, Ring 3, ô Arm/Leg (augment), ô jewel trong găng tay không được gửi | Thiếu chỉ số từ các món đó |
| Mọi item PoB từng dán (kể cả không mặc) đều được nhét vào ô trống | Mặc nhầm đồ |
| Mở lại build đã lưu thì mất toàn bộ jewel trên cây passive | Sau F5, DPS 326k còn 78k, kháng sét 19% còn 9% |
| Ascendancy gửi dạng id (`Druid1`) mà backend chỉ hiểu tên | XML sai ascendancy (PoB đoán lại được từ node đã lấy) |
| Kỹ năng do cây/item cho sẵn (Thorns) không có gem bị bỏ | Thiếu nhóm kỹ năng |
| Config gửi nguyên chuỗi XML từ trình duyệt | Thay bằng danh sách input đã lọc (an toàn hơn, sửa được) |

## Bảng so sánh tính năng

### Cây passive

| Tính năng PoB | Planner | Ghi chú | Ưu tiên |
| --- | --- | --- | --- |
| Vẽ cây từ dữ liệu tree, ascendancy | ✅ | `src/spa/passive/*` | |
| Click lấy node theo đường ngắn nhất, bỏ nhánh | ✅ | `passive/planner.ts` | |
| Tìm node theo tên / chỉ số | ✅ | Trang Cây thụ động | |
| Import cây từ PoB code | ✅ | | |
| Node theo bộ vũ khí (Weapon Set 1/2) | 🟡 | Giữ đúng khi import và tính; chưa sửa được trên cây | 5 |
| Chọn thuộc tính cho node +Str/Dex/Int (Attribute override) | 🟡 | Giữ đúng khi import; chưa chọn được trên cây | 6 |
| Gắn jewel vào ô trên cây | 🟡 | Jewel import được giữ và tính; chưa gắn/đổi jewel trong Planner | 4 |
| Xem chỉ số tăng/giảm khi rê chuột vào node | ❌ | PoB tính lại cho từng node; cần gọi PoB nhiều lần hoặc API riêng | 3 |
| Nhiều bản cây (tree spec) trong một build | ❌ | Chỉ lấy bản đang chọn trong PoB | 8 |

### Trang bị

| Tính năng PoB | Planner | Ghi chú | Ưu tiên |
| --- | --- | --- | --- |
| Hình nhân vật với các ô đồ, 2 bộ vũ khí | ✅ | | |
| Tooltip item đủ mod như trong game | ✅ | `parsePobItemDetails` | |
| Chọn item từ danh sách base / unique | ✅ | Unique giờ được gửi kèm mod (giá trị giữa khoảng roll) để PoB tính | |
| Import item từ PoB, giữ nguyên dòng mod và roll | ✅ | | |
| Ô Ring 3, Arm/Leg (augment), jewel trong trang bị | 🟡 | Tính đúng; chưa hiện trên hình nhân vật | 7 |
| Dán item copy từ game (Ctrl+C) | ❌ | Parser đã có (`parsePobItemDetails`), thiếu ô dán | 2 |
| Sửa roll / thêm mod (craft item rare) | ❌ | | 9 |
| Bật/tắt flask, charm | 🟡 | Luôn tính là đang bật (như PoB mặc định) | |

### Skill / support gem

| Tính năng PoB | Planner | Ghi chú | Ưu tiên |
| --- | --- | --- | --- |
| Nhóm skill + support, chọn gem có tìm kiếm | ✅ | | |
| Chọn kỹ năng chính để tính DPS | ✅ | Nút ngôi sao | |
| Cấp và chất lượng gem | ✅ | Mới: ô Lv / Q trên từng gem | |
| Bật/tắt nhóm gem, bật/tắt từng gem | ✅ | Mới: nút gạt | |
| Gem kích hoạt thứ hai trong nhóm (Cast on Crit…) | ✅ | Mới: hiện nhãn "Kỹ năng" | |
| Kỹ năng do item / cây cho sẵn | ✅ | Mới: nhãn "Từ trang bị" / "Từ cây thụ động" | |
| Gem corrupt, chọn phần kỹ năng (skill part), minion | 🟡 | Giữ từ PoB import; chưa chỉnh trong Planner | 10 |
| DPS riêng từng nhóm (Full DPS) | ❌ | Backend chỉ trả kỹ năng chính | 4 |

### Config (điều kiện tính)

| Tính năng PoB | Planner | Ghi chú | Ưu tiên |
| --- | --- | --- | --- |
| Đọc config của build | ✅ | Mới: đọc từng input của ConfigSet đang chọn | |
| Sửa config | ✅ | Mới: panel "Điều kiện tính" — loại kẻ địch, hiệu ứng lên kẻ địch (shock, chill, ignite…), trạng thái nhân vật, charge. Có giải thích tiếng Việt, lưu cùng build, nút về điều kiện gốc | |
| Toàn bộ ~300 tuỳ chọn của PoB | 🟡 | Panel có 25 tuỳ chọn hay dùng; các input khác trong PoB code được giữ nguyên | 11 |

### Item set / skill set

| Tính năng PoB | Planner | Ghi chú | Ưu tiên |
| --- | --- | --- | --- |
| Nhiều bộ đồ (item set), nhiều bộ skill (skill set) | ❌ | Import lấy bộ đang chọn trong PoB | 8 |
| Bộ vũ khí I/II đang dùng | ✅ | Mới: lấy theo PoB khi import, gửi đúng cho PoB | |

### Chỉ số tấn công và phòng thủ

| Tính năng PoB | Planner | Ghi chú | Ưu tiên |
| --- | --- | --- | --- |
| Tóm tắt nhân vật / phòng thủ / kỹ năng chính | ✅ | Panel "Chỉ số" | |
| Chỉ số chi tiết tấn công | ✅ | Mới: DPS tổng, DPS đòn, sát thương trung bình, tốc độ, chí mạng, tỉ lệ trúng, DPS đốt/độc/chảy máu, số đạn, vùng ảnh hưởng, mana tiêu hao | |
| Chỉ số chi tiết phòng thủ | ✅ | Mới: EHP, đòn lớn nhất chịu được theo từng loại sát thương, né, deflect, block, giảm sát thương vật lý, kháng + phần vượt trần, ngưỡng choáng, Spirit còn trống | |
| Hồi phục (regen, ES recharge, leech) | ✅ | Mới | |
| Giải thích từng chỉ số | ✅ | Mới: dấu ? cạnh mỗi dòng, lời tiếng Việt không dùng thuật ngữ PoB | |
| Breakdown (chỉ số đến từ đâu, tab Calcs) | ❌ | Cần backend trả thêm `calcsTab` breakdown | 1 |
| Minion, totem, chỉ số theo từng phần kỹ năng | ❌ | | 12 |

### So sánh

| Tính năng PoB | Planner | Ghi chú | Ưu tiên |
| --- | --- | --- | --- |
| Thay đổi so với trước khi sửa | ✅ | Mới: mỗi lần tính lại, chỉ số hiện +/− (xanh tốt, đỏ xấu) so với lần trước | |
| So item đang mặc với item khác (tooltip "nếu mặc vào thì…") | ❌ | Cần một lần tính PoB cho mỗi item so | 3 |
| So hai build với nhau (Compare tab) | ❌ | | 13 |

### Import / export

| Tính năng PoB | Planner | Ghi chú | Ưu tiên |
| --- | --- | --- | --- |
| Import PoB code | ✅ | | |
| Export PoB code | ✅ | Mới: nút "PoB code" — đúng XML Planner dùng để tính, mở trong PoB ra cùng số | |
| Import / export file `.build` | ✅ | | |
| Import nhân vật từ tài khoản game | ❌ | | 14 |
| Link chia sẻ build | 🟡 | API `/api/builds` có sẵn nhưng server chưa có database | |

## Việc nên làm tiếp (theo thứ tự)

1. **Breakdown chỉ số**: bấm vào một chỉ số thấy nó đến từ đâu (item, cây, gem). PoB có sẵn trong `calcsTab`; backend cần trả thêm.
2. **Dán item từ game** (Ctrl+C trong game → dán vào ô đồ).
3. **So item / node**: "mặc món này vào thì DPS, máu đổi bao nhiêu" và rê chuột lên node passive. Cần endpoint tính nhiều biến thể trong một lần chạy PoB để không phải chạy lại cả PoB cho từng món.
4. **DPS từng nhóm skill** (Full DPS) và **gắn jewel trên cây**.
5. Sửa node theo bộ vũ khí, chọn thuộc tính cho node, ô Ring 3/augment trên hình nhân vật.

## Tệp liên quan

- Planner: `src/spa/pages/BuildPlannerPage.tsx`, `src/spa/lib/buildPlanner.ts`, `src/spa/lib/buildStats.ts`, `src/spa/components/BuildCalcPanels.tsx`, `src/spa/styles/planner-calc.css`
- Backend: `src/server/pob-build-xml.mjs` (XML gửi PoB, dùng chung cho route, test và export PoB code), `src/server/routes/public.mjs` (`POST /api/builds/calculate`), `scripts/pob-calculate.lua`
- Luồng kiểm tra: `scripts/check-pob-parity.mjs`, `scripts/lib/planner-node.mjs`, `tests/pob-parity.test.mjs`, `tests/fixtures/pob-builds/`
