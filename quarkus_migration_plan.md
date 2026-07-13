# Kế hoạch & Thiết kế Di chuyển Backend sang Quarkus (Hexagonal Architecture)

Tài liệu này trình bày phân tích kiến trúc, thiết kế chi tiết (Ports & Adapters) và lộ trình di chuyển backend hiện tại (Fastify / Node.js) sang **Quarkus (Java/Kotlin)** theo mô hình **Hexagonal Clean Architecture**.

---

## 1. Phân Tích & Đánh Giá Đề Xuất (Pros & Cons)

### Tại sao chọn Quarkus + Hexagonal Architecture?
* **Tách biệt nghiệp vụ (Domain Isolation)**: Nghiệp vụ chính (quản lý build, ánh xạ từ điển tiếng Việt, cấu hình POB) hoàn toàn không phụ thuộc vào framework, thư viện kết nối cơ sở dữ liệu hay cách thức gọi tiến trình phụ (LuaJIT).
* **Quản lý đa nguồn dữ liệu (Multi-Data Sources)**: Quarkus hỗ trợ cấu hình đa nguồn dữ liệu (multiple databases, REST APIs từ GGG, file dữ liệu cục bộ) vô cùng mạnh mẽ thông qua Quarkus Agile/Reactive Datasources và Hibernate Reactive.
* **Hiệu năng vượt trội**: Biên dịch Native (GraalVM) giúp giảm dung lượng RAM sử dụng xuống còn ~30-50MB, thời gian khởi động tính bằng phần nghìn giây (millisecond), lý tưởng cho môi trường container/cloud.
* **Lập trình phản ứng (Reactive Programming)**: Sử dụng Mutiny / Hibernate Reactive giúp tối ưu hóa luồng I/O khi xử lý số lượng lớn request tính toán chỉ số build hoặc thu thập dữ liệu (crawling).

---

## 2. Thiết kế Kiến trúc Hexagonal (Ports & Adapters)

Mô hình thiết kế phân chia thành 3 vùng: **Domain (Core)**, **Ports (Interfaces)**, và **Adapters (Implementations)**.

```mermaid
graph TD
    subgraph Driving Adapters (Inbound)
        REST[Quarkus RESTEasy / JAX-RS REST Controller]
        CLI[Migration CLI / Schedulers]
    end

    subgraph Ports (Inbound & Outbound)
        InPorts[Driving Ports: CalculateBuildUseCase, ManageBuildUseCase, TranslateUseCase]
        OutPorts[Driven Ports: BuildRepositoryPort, CalculationEnginePort, GameDataScraperPort]
    end

    subgraph Domain Core
        Models[Domain Models: Build, SkillGem, DictionaryEntry, Stats]
        Services[Domain Services: BuildManager, TranslatorService]
    end

    subgraph Driven Adapters (Outbound)
        Postgres[PostgreSQL Adapter via Hibernate Reactive Panache]
        LuaJit[LuaJIT Subprocess Runner Adapter]
        GGGClient[Path of Exile 2 API REST Client]
    end

    REST --> InPorts
    CLI --> InPorts
    InPorts --> Services
    Services --> Models
    Services --> OutPorts
    OutPorts --> Postgres
    OutPorts --> LuaJit
    OutPorts --> GGGClient
```

### A. Domain Core (Lõi nghiệp vụ)
Nằm trong package `com.poe2.viethoa.domain`. Hoàn toàn độc lập với Quarkus và bất kỳ thư viện bên thứ ba nào.
* **Models**: `Build`, `Equipment`, `SkillGem`, `Stats`, `DictionaryEntry`.
* **Services**: Thực thi logic cốt lõi (ví dụ: khớp nối ngọc hỗ trợ phù hợp, chuyển ngữ các mod sang tiếng Việt).

### B. Ports (Cổng giao tiếp)
Nằm trong package `com.poe2.viethoa.ports`.
* **Driving (Inbound) Ports**: Giao diện cung cấp cho ứng dụng ngoài gọi vào Domain.
  * `CalculateBuildUseCase`: Thực hiện tính toán stats.
  * `ManageBuildUseCase`: CRUD các build của người dùng.
  * `TranslateUseCase`: Dịch thuật ngữ game.
* **Driven (Outbound) Ports**: Giao diện yêu cầu các thành phần bên ngoài (DB, engine tính toán) đáp ứng cho Domain.
  * `BuildRepositoryPort`: Giao tiếp với database lưu trữ build.
  * `CalculationEnginePort`: Cổng gọi tới LuaJIT engine.
  * `GameDataScraperPort`: Cổng crawl dữ liệu từ game gốc.

### C. Adapters (Bộ điều hợp cụ thể)
Nằm trong package `com.poe2.viethoa.adapters`.
* **Inbound Adapters**:
  * `rest`: `BuildPlannerResource` (JAX-RS) cung cấp `/api/builds/calculate` và các endpoint CRUD.
  * `scheduler`: `CronCrawlJob` tự động kích hoạt tiến trình cập nhật giá cả tiền tệ / dữ liệu game định kỳ.
* **Outbound Adapters**:
  * `database`: `PanacheBuildRepository` kết nối PostgreSQL sử dụng Hibernate Reactive.
  * `calculator`: `LuaJitCalculationAdapter` thực hiện ghi file XML tạm và thực thi `ProcessBuilder` gọi `luajit calculate.lua` (sử dụng Quarkus Virtual Threads hoặc Async I/O để tránh block luồng).
  * `crawler`: `GGGClientAdapter` dùng Quarkus REST Client Reactive (`@RegisterRestClient`) kết nối tới các endpoint của game gốc.

---

## 3. Cấu trúc thư mục đề xuất (Quarkus Maven/Gradle)

```text
poe2-viethoa-backend/
├── src/
│   ├── main/
│   │   ├── java/com/poe2/viethoa/
│   │   │   ├── domain/                         # Lõi nghiệp vụ (Domain Models & Services)
│   │   │   │   ├── model/
│   │   │   │   └── service/
│   │   │   ├── ports/                          # Giao diện Ports (Inbound & Outbound)
│   │   │   │   ├── inbound/
│   │   │   │   └── outbound/
│   │   │   └── adapters/                       # Bộ điều hợp Adapters
│   │   │       ├── inbound/
│   │   │       │   ├── rest/                   # HTTP REST Controllers
│   │   │       │   └── scheduler/              # Cron Jobs
│   │   │       └── outbound/
│   │   │           ├── database/               # PostgreSQL / Panache Entity
│   │   │           ├── calculator/             # LuaJIT Subprocess Runner
│   │   │           └── client/                 # REST Client call GGG API
│   │   └── resources/
│   │       ├── application.properties          # Cấu hình Quarkus (DB, luajit path)
│   │       └── db/migration/                   # Flyway / Liquibase database migrations
│   └── test/                                   # Unit & Integration Tests (JUnit 5 + QuarkusTest)
├── pom.xml                                     # Cấu hình dependencies
└── calculate.lua                               # Được đóng gói kèm hoặc link tới pob-core
```

---

## 4. Chiến lược Chuyển Đổi Từng Bước (Migration Strategy)

Để giảm thiểu rủi ro và không làm gián đoạn hệ thống hiện tại, lộ trình chuyển đổi sẽ được tiến hành như sau:

1. **Khởi tạo dự án Quarkus**: Thiết lập dự án Quarkus Java 21, cấu hình Flyway để đồng bộ các cấu trúc bảng hiện tại của PostgreSQL.
2. **Xây dựng Outbound Adapter cho LuaJIT**:
   * Chuyển đổi logic viết XML trong Javascript sang Java (`pob_xml_generation`).
   * Sử dụng `java.lang.ProcessBuilder` để gọi `luajit calculate.lua` và phân tích stdout JSON.
3. **Triển khai REST API song song (BFF / Gateway)**:
   * Giữ nguyên giao diện React SPA.
   * Cấu hình Nginx / Proxy hướng `/api/builds/calculate` sang cổng chạy Quarkus mới, các API khác vẫn trỏ về Fastify Node.js.
4. **Di chuyển dần các Data Sources & Crawler**:
   * Chuyển các crawler script trong `scripts/` sang thành Quarkus Scheduled Tasks (`@Scheduled`).
   * Tận dụng khả năng kết nối đa nguồn dữ liệu của Quarkus để crawl và dịch đồng thời.
5. **Tắt hoàn toàn Node.js Backend**: Sau khi hoàn thành kiểm thử hiệu năng và độ ổn định, chuyển toàn bộ lưu lượng sang Quarkus.
