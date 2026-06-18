# TODO — Boss Guide (PoE2 Việt hóa)

> File context cho Claude local đọc để **làm tiếp** phần Boss. Đọc kỹ trước khi tiếp tục.

## Đang ở đâu
- Trang list: `public/boss.html` (`/boss`) — 56 boss non-campaign (đã bỏ campaign), có thumbnail + search + filter theo loại.
- Trang chi tiết: `public/boss_detail.html` (`/boss-detail?boss=<slug>`).
- Data:
  - `public/data/boss-data.js` → `window.POE2_BOSS_DETAILS` (nội dung từng boss + entry guide gộp).
  - `public/data/boss-images.js` → `window.POE2_BOSS_IMAGES` (hero + gallery, URL R2).
  - `public/data/boss-items.js` → `window.POE2_DROP_ITEMS` (stats item drop, crawl từ poe2db).
- Ảnh self-host trên **Cloudflare R2** bucket `poe2`, serve qua `https://img.poeviethoa.net/boss/<slug>/...`.

## Hạ tầng / pipeline (`scripts/boss/`)
- `r2.mjs` — lib SigV4 PUT/GET (đọc creds từ `.env`).
- `extract-guide.mjs <game8_url>` — fetch guide Game8 **qua proxy** → JSON {images[{base,alt}], text} (đã lọc ads/related).
- `upload-image.mjs <game8_img_base> <r2_key>` — tải ảnh game8 (qua proxy) → up R2, in URL.
- `fetch-item.mjs "<tên item>"` — crawl stats item từ poe2db (có search-fallback).
- `crawl-drop-stats.mjs` — quét toàn bộ drop trong boss-data → ghi `boss-items.js`.
- `build-images-data.mjs` — sinh `boss-images.js` từ manifest crawl.
- `assemble.mjs` — gộp `/tmp/boss-curated/*.json` (output agent) → `boss-data.js` + `boss-images.js`; áp `hero-overrides.json`.
- `workflow.mjs` — **workflow 5 agent/lần**, mỗi agent curate 1 boss (tự chọn ảnh đúng + viết VN + ghi `/tmp/boss-curated/<slug>.json`). Chạy bằng tool Workflow của Claude Code: `Workflow({scriptPath:"scripts/boss/workflow.mjs"})`.
- `hero-overrides.json` — hero ảnh chọn tay (vd Arbiter dùng ArtStation), bền qua re-run.

### `.env` cần có (đã commit tạm — SẼ REVOKE)
`CRAWL_PROXY`, `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_BASE=https://img.poeviethoa.net`.

### Deploy (thủ công, v2 UAT)
```
npm run build:css            # khi đổi class Tailwind
rsync -a --delete public/ /var/www/v2.poeviethoa.net/
chown -R www-data:www-data /var/www/v2.poeviethoa.net/
# test: curl -k -H "Host: v2.poeviethoa.net" https://127.0.0.1/boss
```
Đổi `boss-data/images/items.js` → **bump `?v=N`** trong 2 file html (nginx cache /data/ 1h).

## ĐÃ XONG
- 13 boss curate kỹ: zarokh, the-trialmaster, the-bodach, tangmazu, xesht, vessel-of-kulemak, atziri-the-red-queen, the-arbiter-of-ash, the-arbiter-of-divinity, the-devourer, the-brambleghast, the-crowbell, candlemass.
- Trang detail: hero banner (cao +30%, object-top), **bảng Drop** (icon + bấm expand stats poe2db kiểu item popup), mục **"Cách vào map boss"** (item mở cửa + ảnh + cách lấy/mua), **các pha dạng bullet ngắn** (bỏ mục Cơ chế trùng khi có pha), gallery. Tooltip tắt trên trang boss.
- **Guide gộp Ritual** (`/boss-detail?boss=ritual`): mẫu cho mechanic chuỗi — Lộ trình A→Z + King in the Mists → The Bodach. Đã bỏ 2 trang lẻ.

## CẦN LÀM TIẾP
1. **Chạy pipeline curate 43 boss còn lại** (Workflow 5 agent) → assemble → crawl-drop-stats → build → deploy.
2. **Làm lại 12 boss đã curate** theo chuẩn mới (phase bullet, access section có ảnh item, drop stats) — prompt agent trong `workflow.mjs` đã cập nhật.
3. **Gộp các mechanic chuỗi khác thành guide A→Z** như Ritual: Breach, Delirium, Abyss, Trial of Sekhemas, Trial of Chaos, Expedition, Atziri's Temple, Precursor Fortress. (Bỏ trang lẻ, list trỏ vào guide gộp.)
4. **Hero còn thiếu**: `vessel-of-kulemak`, `the-arbiter-of-divinity` (Game8 không có ảnh chân dung rõ → tìm nguồn khác / ArtStation rồi thêm vào `hero-overrides.json`).
5. **Giá poe.ninja** (đang gác): tìm đúng endpoint PoE2 (`/poe2/api/economy/...`) + **league hiện tại** (KHÔNG phải "Runes of Aldur" nữa — economy URL đó 404; thử "Rise of the Abyssal"), gắn giá vào panel expand của drop.
6. **Gỡ `.env` khỏi repo** sau khi revoke creds: `git rm --cached .env` + giữ trong `.gitignore`.

## Lưu ý
- KHÔNG bịa nội dung game — luôn crawl từ Game8 (qua proxy) / poe2db.
- Văn phong: tiếng Việt thân thiện, GIỮ thuật ngữ game tiếng Anh.
- Game8 chặn IP datacenter → mọi fetch Game8 phải qua `CRAWL_PROXY`. Ảnh Game8 dùng URL bản `/show` (link `.png` raw bị S3 chặn).
