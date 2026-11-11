import { useEffect, useState } from "react";
import { type Locale, localizedText } from "../lib/locale";

// Written by `npm run poevh:publish` next to the exe it describes.
const MANIFEST_URL = "/downloads/poevh/latest.json";

type Release = {
  version: string;
  file: string;
  size: number;
  sha256: string;
  publishedAt: string;
  notes?: string[];
};

type L = { vi: string; en: string };

const t = {
  title: { vi: "Cài app POEVH", en: "Get POEVH" },
  lead: {
    vi: "Ứng dụng Windows đi kèm Path of Exile 2: check giá bằng Alt+E, xem phần thưởng Expedition, overlay leveling và follow bot cho nhóm nhiều tài khoản.",
    en: "A Windows companion for Path of Exile 2: Alt+E price-check, Expedition rewards, a leveling overlay and a follow bot for multi-account parties."
  },
  download: { vi: "Tải POEVH cho Windows", en: "Download POEVH for Windows" },
  version: { vi: "Phiên bản", en: "Version" },
  size: { vi: "Dung lượng", en: "Size" },
  published: { vi: "Phát hành", en: "Released" },
  checksum: { vi: "SHA-256", en: "SHA-256" },
  copy: { vi: "Sao chép", en: "Copy" },
  copied: { vi: "Đã chép", en: "Copied" },
  loading: { vi: "Đang kiểm tra bản mới nhất…", en: "Checking for the latest build…" },
  unavailable: {
    vi: "Bản cài đặt đang được cập nhật, quay lại sau ít phút hoặc nhắn fanpage để lấy link.",
    en: "The installer is being updated. Check back in a few minutes or message the fanpage for a link."
  },
  whatsNew: { vi: "Có gì mới", en: "What's new" },
  requirementsTitle: { vi: "Yêu cầu", en: "Requirements" },
  stepsTitle: { vi: "Cài đặt", en: "Install" },
  featuresTitle: { vi: "Miễn phí và Premium", en: "Free and Premium" },
  free: { vi: "Miễn phí", en: "Free" },
  premium: { vi: "Premium", en: "Premium" },
  premiumCta: { vi: "Xem gói Premium", en: "See Premium plans" },
  riskTitle: { vi: "Lưu ý rủi ro", en: "Risk notice" },
  removeTitle: { vi: "Gỡ cài đặt", en: "Uninstall" }
};

const requirements: { label: L; detail: L; href?: string }[] = [
  {
    label: { vi: "Windows 10 hoặc 11, 64-bit", en: "Windows 10 or 11, 64-bit" },
    detail: { vi: "Chạy bằng quyền người dùng thường, không cần admin.", en: "Runs as a normal user, no admin rights needed." }
  },
  {
    label: { vi: "Microsoft Edge WebView2 Runtime", en: "Microsoft Edge WebView2 Runtime" },
    detail: {
      vi: "Có sẵn trên Windows 11 và hầu hết máy Windows 10. Nếu app mở ra màn hình trắng, cài bản Evergreen.",
      en: "Built into Windows 11 and most Windows 10 PCs. If the app opens blank, install the Evergreen runtime."
    },
    href: "https://developer.microsoft.com/microsoft-edge/webview2/"
  },
  {
    label: { vi: "ViGEmBus (chỉ cho Follow bot)", en: "ViGEmBus (Follow bot only)" },
    detail: {
      vi: "Driver tay cầm ảo cho các tài khoản phụ. Không cần nếu chỉ dùng check giá, Expedition hay leveling.",
      en: "Virtual controller driver for follower accounts. Not needed for price-check, Expedition or leveling."
    },
    href: "https://github.com/nefarius/ViGEmBus/releases"
  },
  {
    label: { vi: "Game ở chế độ Windowed Fullscreen", en: "Game in Windowed Fullscreen" },
    detail: {
      vi: "Overlay không vẽ được lên game khi để Fullscreen độc quyền.",
      en: "Overlays cannot draw over the game in exclusive Fullscreen."
    }
  }
];

const steps: { title: L; body: L }[] = [
  {
    title: { vi: "Tải file POEVH.exe", en: "Download POEVH.exe" },
    body: {
      vi: "Bấm nút tải ở trên. App là một file exe duy nhất, đặt ở thư mục nào cũng được, ví dụ Documents\\POEVH.",
      en: "Use the download button above. The app is a single exe; keep it in any folder, for example Documents\\POEVH."
    }
  },
  {
    title: { vi: "Mở app lần đầu", en: "Open it the first time" },
    body: {
      vi: "File chưa ký số nên Windows SmartScreen có thể cảnh báo. Bấm \"More info\" rồi \"Run anyway\". Nếu muốn chắc chắn, so mã SHA-256 ở trên với file đã tải.",
      en: "The file is not code-signed, so Windows SmartScreen may warn. Click \"More info\" then \"Run anyway\". To be sure, compare the SHA-256 above with the downloaded file."
    }
  },
  {
    title: { vi: "Chọn mức rủi ro", en: "Pick a risk level" },
    body: {
      vi: "Góc trên bên phải có \"Mức rủi ro\". Mặc định chỉ hiện tính năng không đụng vào game. Nâng mức để hiện các mục còn lại.",
      en: "The top-right \"Risk level\" picker starts with features that never touch the game. Raise it to show the rest."
    }
  },
  {
    title: { vi: "Kích hoạt Premium (tuỳ chọn)", en: "Activate Premium (optional)" },
    body: {
      vi: "Tạo key ở trang Premium trên web, rồi dán vào mục HỆ THỐNG › Premium trong app. Mỗi key chạy trên một máy.",
      en: "Create a key on the website's Premium page and paste it into SYSTEM › Premium in the app. One key works on one PC."
    }
  }
];

const freeFeatures: L[] = [
  { vi: "Check giá vật phẩm bằng Alt+E (Trade2)", en: "Alt+E item price-check (Trade2)" },
  { vi: "Expedition check: giá phần thưởng Rune Monolith", en: "Expedition check: Rune Monolith reward prices" },
  { vi: "Overlay leveling và quest theo khu vực đang đứng", en: "Leveling and quest overlay for the current zone" },
  { vi: "Tối ưu đồ hoạ, giới hạn FPS cho cửa sổ phụ", en: "Graphics tuning and background FPS limits" },
  { vi: "Quản lý nhiều cửa sổ game", en: "Multiple game window management" }
];

const premiumFeatures: L[] = [
  { vi: "Bám theo leader, tự bắt kịp và dịch chuyển", en: "Follow the leader, catch up and warp" },
  { vi: "Hỗ trợ chiến đấu, buff định kỳ", en: "Combat assist and timed buffs" },
  { vi: "Tự dùng bình máu và mana", en: "Automatic life and mana flasks" },
  { vi: "Nhặt đồ theo bộ lọc, tự cất hòm", en: "Filtered loot pickup and auto stash" },
  { vi: "Tự mời nhóm, chuẩn bị map, đồng bộ tay cầm", en: "Auto party invites, map prep and controller sync" }
];

const riskNotice: L = {
  vi: "POEVH là công cụ bên thứ ba, không phải của Grinding Gear Games. Tính năng đọc bộ nhớ, sửa file game hoặc tự thao tác thay bạn có thể vi phạm điều khoản của game và dẫn tới khoá tài khoản. App ghi rõ mức rủi ro từng mục; bạn tự quyết định dùng mục nào.",
  en: "POEVH is a third-party tool, not made by Grinding Gear Games. Features that read game memory, patch game files or act for you may break the game's terms and get an account banned. The app labels the risk of every page; which ones to use is your call."
};

const removeNotice: L = {
  vi: "Tắt app, xoá file POEVH.exe. Cấu hình, log và key Premium nằm trong %LOCALAPPDATA%\\POE2MultiPilot; xoá thư mục đó để gỡ sạch.",
  en: "Close the app and delete POEVH.exe. Settings, logs and the Premium key live in %LOCALAPPDATA%\\POE2MultiPilot; delete that folder to remove everything."
};

const formatSize = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

const formatDate = (value: string, locale: Locale) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(locale === "vi" ? "vi-VN" : "en-GB");
};

const isRelease = (value: unknown): value is Release => {
  const v = value as Release;
  return Boolean(v) && typeof v.version === "string" && typeof v.file === "string" && /^[\w.-]+\.(exe|zip)$/i.test(v.file)
    && typeof v.size === "number" && typeof v.sha256 === "string";
};

export function InstallPage({ locale }: { locale: Locale }) {
  const text = (value: L) => localizedText(value, value.vi, locale);
  const [release, setRelease] = useState<Release | null | undefined>(undefined);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(MANIFEST_URL, { cache: "no-cache" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => { if (!cancelled) setRelease(isRelease(data) ? data : null); })
      .catch(() => { if (!cancelled) setRelease(null); });
    return () => { cancelled = true; };
  }, []);

  const copyChecksum = async () => {
    if (!release) return;
    try {
      await navigator.clipboard.writeText(release.sha256);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt("SHA-256", release.sha256);
    }
  };

  return (
    <main className="page-shell install-page">
      <header className="page-title tight">
        <h1>{text(t.title)}</h1>
        <p>{text(t.lead)}</p>
      </header>

      <section className="install-card install-hero">
        <span className="material-symbols-rounded install-hero-icon" aria-hidden="true">install_desktop</span>
        <div className="install-hero-body">
          {release === undefined ? (
            <p className="install-muted">{text(t.loading)}</p>
          ) : release === null ? (
            <p className="install-muted" role="status">{text(t.unavailable)}</p>
          ) : (
            <>
              <a className="install-button is-primary" href={`/downloads/poevh/${release.file}`} download={release.file}>
                <span className="material-symbols-rounded" aria-hidden="true">download</span>
                {text(t.download)}
              </a>
              <dl className="install-facts">
                <div><dt>{text(t.version)}</dt><dd>{release.version}</dd></div>
                <div><dt>{text(t.size)}</dt><dd>{formatSize(release.size)}</dd></div>
                <div><dt>{text(t.published)}</dt><dd>{formatDate(release.publishedAt, locale)}</dd></div>
              </dl>
              <div className="install-checksum">
                <span>{text(t.checksum)}</span>
                <code>{release.sha256}</code>
                <button type="button" className="install-button" onClick={copyChecksum}>{copied ? text(t.copied) : text(t.copy)}</button>
              </div>
              {release.notes?.length ? (
                <div className="install-notes">
                  <strong>{text(t.whatsNew)}</strong>
                  <ul>{release.notes.map((note) => <li key={note}>{note}</li>)}</ul>
                </div>
              ) : null}
            </>
          )}
        </div>
      </section>

      <div className="install-grid">
        <section className="install-card">
          <h2>{text(t.requirementsTitle)}</h2>
          <ul className="install-list">
            {requirements.map((item) => (
              <li key={item.label.vi}>
                <strong>
                  {item.href ? <a href={item.href} target="_blank" rel="noopener noreferrer">{text(item.label)}</a> : text(item.label)}
                </strong>
                <span>{text(item.detail)}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="install-card">
          <h2>{text(t.stepsTitle)}</h2>
          <ol className="install-steps">
            {steps.map((step) => (
              <li key={step.title.vi}>
                <strong>{text(step.title)}</strong>
                <span>{text(step.body)}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <section className="install-card">
        <h2>{text(t.featuresTitle)}</h2>
        <div className="install-tiers">
          <div className="install-tier">
            <h3>{text(t.free)}</h3>
            <ul>{freeFeatures.map((item) => <li key={item.vi}>{text(item)}</li>)}</ul>
          </div>
          <div className="install-tier is-premium">
            <h3><span className="material-symbols-rounded" aria-hidden="true">workspace_premium</span>{text(t.premium)}</h3>
            <ul>{premiumFeatures.map((item) => <li key={item.vi}>{text(item)}</li>)}</ul>
            <a className="install-button" href="/premium">{text(t.premiumCta)}</a>
          </div>
        </div>
      </section>

      <div className="install-grid">
        <section className="install-card install-warning">
          <h2>{text(t.riskTitle)}</h2>
          <p>{text(riskNotice)}</p>
        </section>
        <section className="install-card">
          <h2>{text(t.removeTitle)}</h2>
          <p className="install-muted">{text(removeNotice)}</p>
        </section>
      </div>
    </main>
  );
}
