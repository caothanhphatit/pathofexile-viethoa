# POE2 MultiPilot — Re-review sau session fix

Thời điểm chốt snapshot: **2026-09-02 22:13:59 (Asia/Bangkok)**
Phạm vi: source hiện tại trong `D:\code\poe2-bot`, binary release và dashboard/API.
Phương pháp: đọc đường thực thi, build/lint/test, kiểm thử dashboard headless bằng Playwright với mock runtime an toàn. Không khởi động memory reader, ViGEm hay global keyboard hook trên game thật.

## Kết luận ngắn

Các fix security bề mặt đã cải thiện rõ rệt, nhưng dự án **chưa production-ready và chưa chứng minh được chức năng live follow**. Trong 10 tuyên bố fix:

- **4 mục đã fix đúng:** bỏ raw password khỏi state, bỏ wildcard CORS, sửa XSS feed, thêm release profile.
- **5 mục chỉ fix một phần:** API auth, keyboard hook scope, focus, non-blocking pad command, dynamic tick.
- **1 mục chưa đúng:** compiler warnings/quality gate chưa sạch.

Blocker lớn nhất không nằm trong bảng fix: ở live memory mode, action vừa được engine tính có thể bị mất trước khi `ActionMapper` nhận được nó. Các tính năng multi-client, launcher, combat, stash, party, waystone, timed action và smoother phần lớn vẫn là UI/config/event, chưa có executor thật.

## Baseline kiểm thử

| Kiểm tra | Kết quả | Ý nghĩa |
|---|---:|---|
| `cargo build --release --locked` | PASS | Source hiện tại tạo được release binary |
| `cargo test --workspace --all-targets` | PASS, **0 tests** | Chỉ chứng minh compile; không chứng minh logic |
| `cargo fmt --all -- --check` | FAIL | Phần lớn source chưa theo rustfmt |
| `cargo clippy --workspace --all-targets -- -D warnings` | FAIL | 12 lỗi lint ở `poe2-world` và `poe2-input` |
| Playwright dashboard | PASS một phần | Load/render/nav/toggle/XSS-safe đều chạy |
| Playwright `networkidle` | FAIL | Poll `/api/state` mỗi 200 ms nên trang không idle |
| Rust tests được khai báo | **0** | Không có unit/integration/contract test |

Binary release đúng với bản được mô tả:

- `D:\code\POE2-MultiPilot.exe`: **2,242,048 bytes**, SHA-256 `95FD7DC94ED81D31066B9186F3389C2FE5A31444F64CFFEF5FCB2D1F95F17435`.
- `D:\code\poe2-bot\target\release\poe2-bot.exe`: cùng size và SHA-256.
- `D:\code\poe2-bot\POE2-MultiPilot.exe`: **bản cũ 9,137,827 bytes**, SHA-256 khác, build lúc 20:36. Cần loại khỏi package hoặc có script release copy atomically để tránh chạy nhầm.

## Đối chiếu 10 tuyên bố fix

### 1. Raw password trong `/api/state` — FIXED

`ClientAccountProfile` không còn `password`; chỉ còn `email_masked` và `has_credentials`. `ApiSnapshot` vẫn serialize toàn bộ settings nhưng không còn secret thực trong model hiện tại.

Lưu ý: ba ô password trên dashboard hiện không được bind hay lưu ở đâu, vì vậy phần “auto login/credentials” hiện chỉ là UI giả, không phải credential storage hoàn chỉnh.

### 2. Wildcard CORS — FIXED

Router không còn `CorsLayer::permissive()` và không thêm `Access-Control-Allow-Origin`. Đây là cải thiện đúng.

### 3. API auth — PARTIAL

`/api/state` và `/api/command` đều gọi `is_authorized`, chấp nhận `X-Api-Token` hoặc Bearer token. Thiếu token trả 401 theo source.

Tuy nhiên token **không phải random cryptographic**. Nó là `SystemTime::as_nanos()` ghép với PID tại `server.rs:21-28`. Đây là token khó đoán ngẫu nhiên từ web origin khác, nhưng không phải boundary tin cậy trước local process hoặc attacker biết thời điểm/PID. Dashboard `/` không auth và inject token vào HTML; thiết kế này phù hợp như CSRF barrier cục bộ, không nên mô tả là strong authentication.

Khuyến nghị: dùng RNG của hệ điều hành, so sánh constant-time nếu coi token là secret, thêm security headers/CSP, và test router trực tiếp.

### 4. Stored XSS trong feed — FIXED và đã test

Feed dùng `createElement`, `textContent` và sanitize phần dùng trong CSS class. Playwright đã bơm actor/action/detail chứa `<img>`, `<script>` và `<svg>`; không node độc hại nào được tạo, chuỗi chỉ xuất hiện dưới dạng text.

Ảnh kiểm thử: `review-tools/dashboard-review.png`.

### 5. Global keyboard hook chỉ chạy khi PoE2 focus — PARTIAL

Hook đã có `GetForegroundWindow()` và neutralize input khi không active. Toggle cũng cập nhật `HOOK_ENABLED`, sửa lỗi snapshot cũ.

Nhưng gate dùng **window title substring**: `path of exile`, `poe` hoặc `multipilot`. Một cửa sổ khác có title chứa các chuỗi này vẫn kích hoạt hook. Đây không phải xác minh PID/process identity. Ngoài ra F10/F12 trong `desktop_app.rs:43-76` vẫn dùng `GetAsyncKeyState` toàn cục, không có foreground gate.

Khuyến nghị: lấy PID từ HWND rồi kiểm tra executable thuộc allowlist đã attach; gate cả global hotkeys; không chạy hook mặc định trước khi người dùng opt-in.

### 6. `FOCUS` command — PARTIAL

Dispatch đã sửa đúng từ `cmd.button` sang `cmd.target == "FOCUS"`, nên bug unreachable cũ đã hết.

Nhưng app quảng cáo 6 character trong khi startup chỉ tạo target `P1` và `P2`. KBM focus gửi vào tên cố định `P1..P6`, còn live adapter đặt follower name theo character name đọc từ memory. Hai namespace target này không đồng nhất; focus P3-P6 có thể trỏ vào target chưa tồn tại hoặc khác tên.

### 7. Blocking sleep trong tick loop — PARTIAL

Sleep giữ nút đã chuyển sang thread riêng nên decision loop không còn bị block trực tiếp.

Đổi lại, mỗi command spawn một OS thread không giới hạn và không có scheduler/cancellation. Sau khi thread nhấn nút rồi thả mutex để sleep, tick kế tiếp gọi `ActionMapper::apply_action` trên cùng controller và có thể ghi report neutral/movement lên report đang cần giữ. Vì ViGEm update gửi **full report**, lệnh JOIN 2 giây, flask pulse và manual pulse có thể bị ghi đè gần như ngay lập tức. Các thread release muộn cũng có thể xóa input mới hơn.

Khuyến nghị: một controller-output worker duy nhất sở hữu ViGEm; command có deadline/priority/generation; merge movement + buttons thành một report; không spawn-per-command.

### 8. Dynamic `tick_ms` — PARTIAL

Main loop đọc `snapshot.config.tick_ms.clamp(10, 1000)` mỗi vòng, nên setting có tác dụng lên sleep.

Nhưng tracker vẫn tăng `session_seconds` theo `tick % 5 == 0`, ngầm giả định 200 ms/tick. Khi đổi `tick_ms`, thời gian session và div/hour sai. Cần dùng `Instant`/elapsed duration thay vì đếm tick.

### 9. Release optimization — FIXED

`[profile.release]` đã có `opt-level=3`, fat LTO, một codegen unit, abort panic và strip. Release build pass; binary đúng 2.14 MiB.

Size nhỏ không tự chứng minh correctness, performance runtime hay an toàn.

### 10. Compiler warnings — NOT FIXED

Build/test thông thường pass, nhưng quality gate nghiêm `clippy -D warnings` vẫn fail. Các lỗi gồm `field_reassign_with_default`, `unnecessary_map_or`, `get_first`, `for_kv_map`, `derivable_impls`, `cmp_null`. `cargo fmt --check` cũng fail trên nhiều file.

## Findings mới / blocker còn lại

### P0 — Live follow action bị mất giữa engine và input mapper

Đường chạy hiện tại:

1. `BotRuntime::step()` gọi `adapter.snapshot()`.
2. `FollowEngine::step()` gán `follower.action`.
3. `MemoryWorldAdapter::apply_state()` lưu state.
4. Main gọi tiếp `to_api_snapshot()`, hàm này lại gọi `adapter.snapshot()`.
5. Live adapter dựng lại mọi follower bằng `raw_to_actor()`, luôn gán `action: Hold`.
6. Main đưa snapshot thứ hai vào `ActionMapper`.

Kết quả: trong live mode, decision `FollowRoute`, `SprintCatchUp`, `AutoLoot`, `WarpToMain` có thể bị thay bằng `Hold` trước khi phát input. Mock mode che giấu bug này vì mock không dựng lại actor.

Thiết kế cần tách `Observation` bất biến khỏi `Decision/ActuationPlan`. `step()` nên trả plan hoặc snapshot sau decision trực tiếp; không đọc adapter lần hai để lấy output.

### P0 — “Multi-client 3 client / 6 character” chưa được implement

- `cmd_launch_clients()` chỉ push event; không có `std::process::Command` hay launcher service.
- Startup chỉ ensure hai virtual pads.
- Connector dừng tại process PoE2 đầu tiên tìm thấy.
- Một `ClientStatus` duy nhất được mirror sang ba card telemetry.
- Event vẫn tuyên bố “6 pads ready” và “party of 6 connected” dù không kiểm tra thực tế.

Đây là false-positive product state. Không nên hiện “ready/connected” nếu không có capability probe và acknowledgment từ từng client/device.

### P1 — Phần lớn feature tab vẫn là config-only

| Tính năng | Trạng thái source hiện tại |
|---|---|
| Follow/catch-up | Có decision mock; live output đang vướng P0 phía trên |
| Warp | Chỉ quyết định + D-pad Down; không có state machine xác nhận teleport |
| Auto flask | Có threshold/cooldown cơ bản; nhiều option không được dùng; pulse dễ bị mapper ghi đè |
| Auto pickup | Chỉ hoạt động với loot mock; live memory reader không đọc loot |
| Currency tracker | Có mock accounting; timing sai khi đổi tick; price conversion hardcode |
| Auto stash | Config/UI only |
| Auto party | Config/UI only |
| Party combat | Config/UI only |
| Waystone crafting | Config/UI only; master key `waystones_enabled` bị ignore |
| Shared controls | Config/UI only |
| Timed actions | Config/UI only |
| Core smoother | Config/UI only |
| Launch 3 clients | Event-only |
| Resource telemetry | Số CPU/RAM/FPS hardcode |

Engine hiện không tham chiếu các option `prioritize_catchup`, `classic_roll_sprint`, `mirror_attack_dir`, `currency_tier`, `only_allocated_to_bot`, `currency_shards`, `exceptional_bases`, `auto_run_to_loot`, `vacuum_pickup`, các recovery/reserved-mana flag, và các config executor kể trên.

### P1 — Unknown toggle/set_param bị trả 200 giả thành công

`cmd_toggle` và `cmd_set_param` chỉ `return` khi key không biết, không trả `Result`. HTTP handler sau đó vẫn trả `200 OK` với snapshot. Dashboard có ví dụ thật: `waystones_enabled` không tồn tại trong match nhưng UI gửi key đó.

Cần typed command enum hoặc schema validation; unknown key trả 400/422 và UI rollback control + hiển thị lỗi.

### P1 — Memory reader chưa có compatibility/safety boundary

- Generic `read<T: Copy + Default>` được ghi raw bytes vào bất kỳ `T`; bound không đảm bảo POD.
- Pattern scanner bỏ qua vị trí cuối do `for i in 0..scan_limit` thay vì inclusive khi đủ chiều dài.
- Scan cố định 64 MiB thay vì đọc PE sections/memory regions.
- AOB fail thì dùng static offset không gate theo game build/hash.
- Read fail trả last state vô thời hạn, không timestamp/quality/stale cutoff.
- Entity list không có party-membership validation rõ ràng.

Không có fixture/dump test nên offsets, component hash và pointer chain hiện chỉ là giả định source, chưa có bằng chứng tương thích với một game build cụ thể.

### P1 — Engine sửa observation như simulation

Engine gọi `move_toward` và ghi follower position/area như thể đã di chuyển/warp. Trong adapter live, đây phải là observed data chỉ đọc; command không được giả định action đã thành công. Event warp còn tính `area_match` sau khi đã overwrite area, nên luôn báo true.

Cần state machine `requested -> issued -> observed/confirmed -> timeout/retry`, không optimistic mutation.

### P1 — Lifecycle và concurrency chưa có ownership rõ

- Tick loop, hook loop, hotkey poller và command threads không có cancellation token/join handle.
- Close UI chỉ thoát event loop; không có shutdown sequence đảm bảo neutralize/unplug pad.
- WebView mở URL ngay sau khi server được spawn, không có readiness handshake.
- `Arc<Mutex<BotRuntime>>` giữ coarse lock trong các snapshot có I/O/polling; API polling 5 Hz cạnh tranh với tick loop.
- `push_event()` gọi thêm `adapter.snapshot()` chỉ để lấy tick, có thể tạo I/O ngoài ý muốn.

## Dashboard review

Điểm tốt:

- XSS feed đã sửa đúng.
- Layout 1440x1000 hiển thị ổn, nav và toggle hoạt động trong Playwright.
- State binding có guard cơ bản cho follower/telemetry.

Còn lại:

- `apiPost()` và `pollState()` có `catch (e) {}` rỗng; lỗi auth/network/server hoàn toàn vô hình.
- Không xử lý `!res.ok`, không rollback optimistic toggle.
- Poll 200 ms liên tục dù tab ẩn/minimized; không backoff và không abort request cũ.
- System CPU/RAM/GPU/latency vẫn hardcode trong JavaScript.
- “Lưu đường dẫn” chỉ `alert`, ô password không bind, nhiều control tạo cảm giác feature đã hoạt động dù backend không có executor.

## Kiến trúc nên chốt trước khi scale-up

1. **Domain pipeline rõ ràng:** `Observation -> Decision -> CommandPlan -> Actuator -> Outcome`; observation bất biến và có timestamp/confidence.
2. **Một input scheduler:** một worker sở hữu controller, merge report, deadline/priority/cancel, neutralize khi shutdown.
3. **Typed API:** command enum, validation range, `Result`, 4xx cho unsupported/invalid, capability endpoint cho UI.
4. **Adapter contract:** `Mock`, `Replay`, `Live`; replay từ sanitized fixture để test mà không cần game thật.
5. **Feature modules:** mỗi feature có interface, executor và capability status; UI disable rõ ràng khi executor chưa có.
6. **Multi-client model:** registry theo stable client ID/PID/window/device slot; không dùng display name làm routing key.
7. **Observability:** structured event có request ID, issued/confirmed/failed, latency, stale state indicator.
8. **Shutdown/readiness:** cancellation token, join handles, server-ready signal trước WebView, release-all/unplug pads khi thoát.

## Test tối thiểu trước khi gọi là “ready”

- Unit table tests cho mọi boundary follow/hold/sprint/warp và mọi config flag.
- Regression test chứng minh live adapter không làm mất decision.
- Fake-controller tests cho scheduler: join hold duration, concurrent pulse, stale release, shutdown neutral.
- Router tests cho 401/200/400/422, unknown key, range validation, token lifecycle.
- XSS tests cho mọi runtime string render vào DOM.
- Replay fixtures cho loading screen, stale pointer, zone change, missing component, nhiều nearby player.
- Multi-client contract tests: PID/window/device mapping và partial failure.
- CI gate: `fmt --check`, `clippy -D warnings`, `test --all-targets`, release build.

## Verdict

Session fix đã xử lý tốt ba lỗ hổng rõ ràng (credential exposure, wildcard CORS, XSS) và cải thiện build release. Tuy vậy, gọi tất cả là “fix hoàn toàn” là chưa chính xác. Bản hiện tại phù hợp ở mức **UI + mock/demo build**, chưa đủ bằng chứng để gọi là live-capable, reliable hoặc dễ scale. Ưu tiên tiếp theo nên là sửa đường dữ liệu live action, thay spawn-thread bằng input scheduler, trả lỗi API đúng, rồi xây test/replay trước khi mở rộng thêm feature.
