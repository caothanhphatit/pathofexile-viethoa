# Review `distantguy-h/poe2-expedition-radar`

## Kết luận

Repository này không phải overlay/radar bản đồ kiểu PoE Overlay. Nó là một WPF WinExe hiển thị bảng kết quả, attach PoE2 và thực hiện một lượt đọc memory để tìm Rune Monolith/reward rồi dừng. Không nên copy hay dùng làm codebase: repo không có LICENSE, có dấu hiệu source decompile và phần license/signature đã bị patch.

## Tính năng và luồng hoạt động

- Tìm một trong các process PoE2, gọi `OpenProcess` với quyền đọc/query.
- Dùng `VirtualQueryEx` và `NtReadVirtualMemory` để đọc executable image regions.
- AOB-scan pattern, resolve RIP-relative GameState pointer và validate bằng metadata local player.
- Duyệt entity tree có giới hạn, đọc metadata/component của Rune Monolith.
- Đọc StateMachine/listener/owner để suy rune, slot và phần thưởng.
- Ghép với recipe/price book rồi đưa rows sang WPF `DataGrid` qua Dispatcher.

Không thấy `WriteProcessMemory`, remote thread, DLL injection, input hook, world-to-screen, ImGui/Direct2D hay transparent click-through overlay.

## Vấn đề chất lượng

- Worker `return` sau lần scan đầu; mô tả real-time trong README không khớp code.
- AOB scan đọc toàn executable region vào mảng và dò tuần tự, có thể tạo burst CPU/allocation.
- Entity probing rộng, tăng số lượt memory read.
- Không có test và CI; nhiều tên biến/biểu thức mang dấu decompiler.
- `SignedPayloadVerifier` chỉ decode payload, không verify chữ ký.
- License được hard-code luôn hợp lệ.
- Hash tải về không tạo trust vì manifest chứa hash chưa được xác thực.
- Đọc memory game vẫn có rủi ro ToS dù implementation chỉ đọc.

## Pattern clean-room có thể học

- Tách `MemoryTransport -> Resolver -> DomainDecoder -> Snapshot -> Presentation` bằng trait.
- Version schema cho offset/pattern/recipe và fail closed khi build không khớp.
- Bound pointer, node count, số byte và số lần read cho mỗi tick.
- Chỉ AOB-scan khi attach/game build thay đổi; cache theo PID + module fingerprint.
- Scan async/cancellable, publish immutable snapshot qua bounded channel.
- Price provider độc lập với memory reader và có source/timestamp/staleness.
- Remote config phải verify Ed25519 thật trên canonical bytes trước khi tin hash.

## File nguồn trọng tâm

- Scanner: <https://github.com/distantguy-h/poe2-expedition-radar/blob/master/ScannerService.cs#L73-L208>
- Process/memory: <https://github.com/distantguy-h/poe2-expedition-radar/blob/master/GameProcess.cs#L30-L103>
- Entity traversal: <https://github.com/distantguy-h/poe2-expedition-radar/blob/master/EntityReader.cs#L4-L96>
- Monolith decode: <https://github.com/distantguy-h/poe2-expedition-radar/blob/master/MonolithReader.cs#L3-L83>
- UI: <https://github.com/distantguy-h/poe2-expedition-radar/blob/master/PoE2ExpeditionScanner/MainWindow.cs#L19-L140>
- Broken signature verification: <https://github.com/distantguy-h/poe2-expedition-radar/blob/master/SignedPayloadVerifier.cs#L4-L19>
