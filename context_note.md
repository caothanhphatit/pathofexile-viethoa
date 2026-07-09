# Nhật ký thay đổi giao diện Bảng Kỹ năng (Build Planner Skills Panel) - PoE2 Việt Hóa

Tài liệu này tóm tắt toàn bộ bối cảnh (context) và các thay đổi đã thực hiện đối với giao diện Skills Panel trên trang Build Planner để phục vụ cho việc review.

## 1. Yêu cầu của người dùng
* Loại bỏ toàn bộ thiết kế cũ, xây dựng lại bảng ngọc kỹ năng (Skills Panel) mô phỏng chính xác giao diện in-game của Path of Exile 2.
* Khắc phục tình trạng giao diện cũ bị vỡ, méo các ô tròn cắm ngọc khi sidebar hẹp.
* Đảm bảo tính toán DPS tự động cập nhật ngay khi người dùng đổi kỹ năng chính (click chọn ngôi sao).
* Xóa hoàn toàn các ô nhập liệu thủ công rườm rà (Cấp ngọc, Ghi chú...) dưới mỗi ngọc hỗ trợ để giao diện sạch sẽ, gọn gàng nhất có thể.
* Phóng to các ô socket cắm ngọc và đặt chúng khít sát nhau (giảm khoảng cách nối).
* Hiển thị DPS, thông số chi tiết (Cast Time, Mana Cost, Damage range màu xanh lam) một cách trực quan, tự động và hỗ trợ xem tooltip khi di chuột (hover) qua từng viên ngọc.

## 2. Các thay đổi đã thực hiện

### A. Giao diện socket và đường liên kết ngọc (Socket Chain Link)
* **Kích thước các ô ngọc được phóng to vượt trội**:
  * Ngọc chủ động (Active Socket): Tăng lên **`56px`** với viền gradient vàng hoàng kim (`2.5px solid var(--gold)`) nổi bật.
  * Ngọc bổ trợ (Support Sockets): Tăng lên **`46px`** với viền bạc/xám dày dặn (`2px solid #888888`).
  * Ngọc bổ trợ trống (Add Support Socket): Ô nét đứt dashed `46px` với biểu tượng dấu cộng trực quan.
* **Độ khít sát**:
  * Cầu nối liên kết giữa các ngọc (Link Bridges) được thu ngắn tối đa về **`6px`** và tăng độ dày lên **`6px`**, sử dụng dải màu vàng-đồng in-game. Các ô ngọc hiện giờ xếp khít sát nhau tạo cảm giác liên kết chặt chẽ.
  * Thêm thuộc tính CSS `flexShrink: 0` cho từng ô và bridge để bảo vệ hình dạng tròn trịa của socket trên mọi kích thước màn hình.
  * Hỗ trợ tự động cuộn ngang mượt mà (`overflowX: "auto"`, ẩn thanh cuộn) trên điện thoại di động mà không bao giờ bị vỡ hay rớt dòng.

### B. Cơ chế xem DPS & Tooltip chi tiết (PoE2 Style Tooltip)
* **Tooltip khi di chuột (Hover Tooltip)**:
  * Khai báo state `tooltip` và các hàm bắt sự kiện di chuyển chuột (`handleMouseMove`, `handleMouseLeave`) tại layout gốc.
  * Render một thẻ `div` cố định (`position: "fixed"`) ở cuối trang để hiển thị nội dung tooltip tương ứng với tọa độ chuột.
  * Khi người dùng di chuột qua bất kỳ viên ngọc nào trên chuỗi liên kết, tooltip in-game chuẩn tiếng Việt/tiếng Anh (gồm Tên ngọc, tags thuộc tính, thuộc tính đặc trưng, yêu cầu chỉ số và các dòng bổ trợ) sẽ xuất hiện lập tức.
* **Thông số chi tiết cố định (Inline Tooltip)**:
  * Loại bỏ nút mũi tên đóng/mở thủ công. Thay vào đó, bảng thông số DPS và sát thương chi tiết của kỹ năng đó sẽ hiển thị cố định ngay dưới dải ngọc (khi đã hoàn tất tính toán phía server) một cách tự động và trực quan nhất.
* **Cập nhật DPS tự động**:
  * Bổ sung state `mainSocketGroup` làm dependency cho `useEffect` gọi hàm `runCalculation()`. Mỗi khi click nút chọn ngôi sao (kỹ năng chính), hệ thống sẽ lập tức cập nhật DPS chuẩn xác mà không cần bất kỳ thao tác thủ công nào.

### C. Quản lý ngọc và loại bỏ ô nhập liệu rườm rà
* **Xóa hoàn toàn ô nhập Cấp/Ghi chú**: Loại bỏ vĩnh viễn các thẻ `<input>` chỉnh Level/Ghi chú dưới dải ngọc để trả lại không gian tối giản nhất.
* **Gỡ bỏ ngọc trực tiếp**:
  * Thêm nút **"Gỡ bỏ" (Remove)** màu đỏ trực tiếp trong hộp thoại tìm kiếm ngọc (Gem Picker).
  * Khi click vào một ngọc đã cắm và mở bảng tìm kiếm ngọc, bạn chỉ cần bấm nút "Gỡ bỏ" này để giải phóng socket đó mà không cần thông qua danh sách chỉnh sửa cũ.

### D. Tránh Cache trình duyệt (Cache Busting)
* Tăng phiên bản truy vấn của các asset tĩnh (`dist/spa/assets/app.js` và `app.css`) từ `v64` lên `v66` trong cả hai file `index.html` và `404.html`. Điều này đảm bảo trình duyệt người dùng sẽ tải bản cập nhật mới ngay lập tức.

## 3. Danh sách các file được cập nhật
* **Trang SPA chính**: [BuildPlannerPage.tsx](file:///root/pathofexile-viethoa-v2/src/spa/pages/BuildPlannerPage.tsx) (State tooltip, socket size, remove gem picker, permanent inline detail layout).
* **File HTML phân phối**: [index.html](file:///root/pathofexile-viethoa-v2/public/index.html) và [404.html](file:///root/pathofexile-viethoa-v2/public/404.html) (Cache bust suffix updated).
