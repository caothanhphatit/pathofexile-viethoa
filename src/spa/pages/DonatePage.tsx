// Donate by bank transfer. Each donation gets its own transfer code (POE + 6 characters),
// so the payment service can tell the site who paid; the page waits for that and says thanks.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import qrcode from "qrcode-generator";

import {
  DONATE_MESSAGE_MAX,
  DONATE_MIN_AMOUNT,
  DONATE_NAME_MAX,
  DONATE_QUICK_AMOUNTS,
  DONATE_TIERS,
  normalizeDonateAmount
} from "../../shared/donate-rules.mjs";
import { vietQrPayload } from "../../shared/vietqr.mjs";
import { type Locale, localizedText } from "../lib/locale";
import "../styles/donate.css";

type L = { vi: string; en: string };

interface DonateConfig {
  enabled: boolean;
  codes: boolean;
  bankBin: string;
  bankName: string;
  accountNo: string;
  accountName: string;
}

interface Intent {
  code: string;
  status: "pending" | "paid";
  amountExpected: number;
  amountPaid: number | null;
  paidAt: string | null;
}

interface Supporters {
  total: number;
  donations: number;
  recent: Array<{ name: string; message: string; amount: number | null; paidAt: string | null; tier: string | null }>;
  top: Array<{ name: string; total: number | null; donations: number; tier: string | null }>;
}

const POLL_INTERVAL_MS = 5000;
const POLL_MAX_MS = 15 * 60 * 1000;

const t = {
  title: { vi: "Ủng hộ POE2 Việt Hóa", en: "Support POE2 Việt Hóa" },
  lead: {
    vi: "Trang này do cộng đồng làm và miễn phí cho mọi người. Nếu bạn thấy nó có ích, một khoản ủng hộ nhỏ giúp trả tiền máy chủ, tên miền và thời gian dịch, cập nhật theo từng bản vá. Không ủng hộ cũng không sao, cảm ơn bạn đã ghé.",
    en: "This site is community-made and free for everyone. If it helps you, a small donation pays for the server, the domain and the time spent translating and updating after each patch. No donation is fine too; thanks for visiting."
  },
  formTitle: { vi: "Tạo mã chuyển khoản", en: "Create a transfer code" },
  amount: { vi: "Số tiền (VND)", en: "Amount (VND)" },
  custom: { vi: "Tuỳ tâm", en: "Custom" },
  name: { vi: "Tên hiển thị (tuỳ chọn)", en: "Display name (optional)" },
  namePlaceholder: { vi: "Ẩn danh", en: "Anonymous" },
  message: { vi: "Lời nhắn (tuỳ chọn)", en: "Message (optional)" },
  hideAmount: { vi: "Ẩn số tiền trên bảng ủng hộ", en: "Hide the amount on the supporter wall" },
  create: { vi: "Tạo mã", en: "Create code" },
  creating: { vi: "Đang tạo…", en: "Creating…" },
  minAmount: { vi: "Số tiền tối thiểu là 10.000đ.", en: "The minimum amount is 10,000đ." },
  createFailed: { vi: "Chưa tạo được mã, thử lại sau ít phút.", en: "Could not create a code, try again in a few minutes." },
  transferTitle: { vi: "Chuyển khoản", en: "Bank transfer" },
  scan: { vi: "Quét bằng ứng dụng ngân hàng", en: "Scan with your banking app" },
  bank: { vi: "Ngân hàng", en: "Bank" },
  account: { vi: "Số tài khoản", en: "Account number" },
  holder: { vi: "Chủ tài khoản", en: "Account holder" },
  content: { vi: "Nội dung chuyển khoản", en: "Transfer content" },
  contentHint: {
    vi: "Nội dung chuyển khoản phải có đúng mã này để hệ thống ghi nhận cho bạn.",
    en: "The transfer content must contain exactly this code so the site can credit you."
  },
  noCodeHint: {
    vi: "Bạn có thể chuyển khoản theo thông tin trên. Vì chưa có mã riêng nên khoản này sẽ không tự hiện trên bảng ủng hộ.",
    en: "You can transfer using the details above. Without a personal code it will not appear on the wall automatically."
  },
  copy: { vi: "Chép", en: "Copy" },
  copied: { vi: "Đã chép", en: "Copied" },
  waiting: { vi: "Đang chờ ngân hàng báo tiền về… thường mất dưới một phút.", en: "Waiting for the bank to report the transfer… usually under a minute." },
  stoppedWaiting: {
    vi: "Chưa thấy tiền về. Nếu bạn đã chuyển, khoản ủng hộ vẫn sẽ được ghi nhận khi ngân hàng báo; tải lại trang để xem.",
    en: "No transfer seen yet. If you did send it, it will still be recorded once the bank reports it; reload to check."
  },
  thanks: { vi: "Đã nhận, cảm ơn bạn rất nhiều!", en: "Received. Thank you very much!" },
  again: { vi: "Tạo mã khác", en: "Create another code" },
  notConfigured: {
    vi: "Kênh nhận ủng hộ đang được thiết lập. Bạn quay lại sau nhé.",
    en: "Donations are being set up. Please check back later."
  },
  tiersTitle: { vi: "Hạng người ủng hộ", en: "Supporter tiers" },
  tiersNote: {
    vi: "Hạng chỉ để ghi nhận cho vui, tính theo tổng số tiền đã ủng hộ. Hạng không mở thêm tính năng nào; gói Premium là phần riêng.",
    en: "Tiers are just a thank-you, based on the total you have donated. They unlock no features; Premium is separate."
  },
  from: { vi: "từ", en: "from" },
  wallTitle: { vi: "Người ủng hộ gần đây", en: "Recent supporters" },
  topTitle: { vi: "Ủng hộ nhiều nhất", en: "Top supporters" },
  wallEmpty: { vi: "Chưa có ai. Bạn có thể là người đầu tiên.", en: "Nobody yet. You could be the first." },
  anonymous: { vi: "Ẩn danh", en: "Anonymous" },
  privacy: { vi: "Chính sách bảo mật", en: "Privacy Policy" },
  signedInAs: { vi: "Khoản ủng hộ sẽ gắn với tài khoản", en: "The donation will be linked to the account" },
  signInHint: {
    vi: "Đăng nhập trước khi tạo mã nếu bạn muốn khoản ủng hộ gắn với tài khoản và hiện huy hiệu hạng.",
    en: "Sign in before creating a code if you want the donation linked to your account and a tier badge."
  }
};

const api = async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: { "content-type": "application/json", ...(init.headers || {}) }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw Object.assign(new Error(payload.error || `HTTP ${response.status}`), { status: response.status, code: payload.code });
  }
  return payload.data as T;
};

const formatVnd = (value: number) => `${Math.round(value).toLocaleString("vi-VN")}đ`;

const formatDate = (value: string | null, locale: Locale) =>
  value ? new Date(value).toLocaleDateString(locale === "vi" ? "vi-VN" : "en-GB") : "";

/** SVG path for a QR of `text` (error correction M), drawn on a white quiet zone. */
function QrCode({ text, label }: { text: string; label: string }) {
  const { size, path } = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    const count = qr.getModuleCount();
    let d = "";
    for (let row = 0; row < count; row += 1) {
      for (let col = 0; col < count; col += 1) {
        if (qr.isDark(row, col)) d += `M${col + 4} ${row + 4}h1v1h-1z`;
      }
    }
    return { size: count + 8, path: d };
  }, [text]);
  return (
    <svg className="dn-qr" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width={size} height={size} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}

export function TierBadge({ tier }: { tier: string | null | undefined }) {
  const found = DONATE_TIERS.find((row) => row.id === tier);
  if (!found) return null;
  return <span className={`dn-tier dn-tier--${found.id}`}>{found.label}</span>;
}

function CopyRow({ label, value, locale }: { label: string; value: string; locale: Locale }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt(label, value);
    }
  };
  return (
    <div className="dn-copy-row">
      <span className="dn-copy-label">{label}</span>
      <strong className="dn-copy-value">{value}</strong>
      <button type="button" className="dn-btn" onClick={copy}>{localizedText(copied ? t.copied : t.copy, "", locale)}</button>
    </div>
  );
}

export function DonatePage({ locale }: { locale: Locale }) {
  const text = (value: L) => localizedText(value, value.vi, locale);
  const [config, setConfig] = useState<DonateConfig | null | undefined>(undefined);
  const [wall, setWall] = useState<Supporters | null>(null);
  const [userName, setUserName] = useState("");
  const [amount, setAmount] = useState<number>(DONATE_QUICK_AMOUNTS[1]);
  const [customAmount, setCustomAmount] = useState("");
  const [useCustom, setUseCustom] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [message, setMessage] = useState("");
  const [hideAmount, setHideAmount] = useState(false);
  const [intent, setIntent] = useState<Intent | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pollStopped, setPollStopped] = useState(false);
  const pollStartRef = useRef(0);

  const loadWall = useCallback(() => {
    api<Supporters>("/api/donate/supporters").then(setWall).catch(() => setWall(null));
  }, []);

  useEffect(() => {
    api<DonateConfig>("/api/donate/config").then(setConfig).catch(() => setConfig(null));
    api<{ authenticated?: boolean; user?: { displayName?: string; email?: string } | null }>("/api/auth/session")
      .then((session) => {
        const name = session.authenticated ? (session.user?.displayName || session.user?.email || "") : "";
        setUserName(name);
      })
      .catch(() => setUserName(""));
    loadWall();
  }, [loadWall]);

  // Wait for the payment service to report the transfer.
  useEffect(() => {
    if (!intent || intent.status === "paid") return;
    pollStartRef.current = Date.now();
    setPollStopped(false);
    const timer = window.setInterval(() => {
      if (Date.now() - pollStartRef.current > POLL_MAX_MS) {
        window.clearInterval(timer);
        setPollStopped(true);
        return;
      }
      if (document.hidden) return;
      api<Intent>(`/api/donate/intents/${intent.code}`)
        .then((next) => {
          if (next.status === "paid") {
            setIntent(next);
            loadWall();
            window.dispatchEvent(new CustomEvent("poe-auth-change"));
          }
        })
        .catch(() => undefined);
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [intent, loadWall]);

  const chosenAmount = useCustom ? normalizeDonateAmount(customAmount.replace(/[^\d]/g, "")) : amount;

  const createCode = async () => {
    setError("");
    if (!chosenAmount) {
      setError(text(t.minAmount));
      return;
    }
    setBusy(true);
    try {
      setIntent(await api<Intent>("/api/donate/intents", {
        method: "POST",
        body: JSON.stringify({ amount: chosenAmount, displayName, message, hideAmount })
      }));
    } catch {
      setError(text(t.createFailed));
    } finally {
      setBusy(false);
    }
  };

  const qrText = config?.enabled
    ? vietQrPayload({
        bin: config.bankBin,
        account: config.accountNo,
        amount: intent ? intent.amountExpected : 0,
        content: intent ? intent.code : ""
      })
    : "";
  const canCreateCodes = Boolean(config?.enabled && config.codes);
  const showTransfer = Boolean(config?.enabled && (intent || !canCreateCodes));

  return (
    <main className="page-shell donate-page poe-no-tooltip">
      <header className="page-title tight">
        <h1>{text(t.title)}</h1>
        <p>{text(t.lead)}</p>
      </header>

      {config === undefined ? null : !config?.enabled ? (
        <section className="dn-card"><p className="dn-muted" role="status">{text(t.notConfigured)}</p></section>
      ) : (
        <div className="dn-grid">
          {canCreateCodes && !intent ? (
            <section className="dn-card">
              <h2>{text(t.formTitle)}</h2>
              <div className="dn-field">
                <span className="dn-label">{text(t.amount)}</span>
                <div className="dn-amounts" role="group" aria-label={text(t.amount)}>
                  {DONATE_QUICK_AMOUNTS.map((value) => (
                    <button
                      type="button"
                      key={value}
                      className={`dn-chip ${!useCustom && amount === value ? "is-active" : ""}`}
                      aria-pressed={!useCustom && amount === value}
                      onClick={() => { setUseCustom(false); setAmount(value); }}
                    >
                      {`${value / 1000}k`}
                    </button>
                  ))}
                  <button
                    type="button"
                    className={`dn-chip ${useCustom ? "is-active" : ""}`}
                    aria-pressed={useCustom}
                    onClick={() => setUseCustom(true)}
                  >
                    {text(t.custom)}
                  </button>
                </div>
                {useCustom ? (
                  <input
                    className="dn-input"
                    inputMode="numeric"
                    autoFocus
                    placeholder={String(DONATE_MIN_AMOUNT)}
                    aria-label={text(t.amount)}
                    value={customAmount}
                    onChange={(event) => setCustomAmount(event.target.value.replace(/[^\d.,\s]/g, "").slice(0, 14))}
                  />
                ) : null}
              </div>
              <label className="dn-field">
                <span className="dn-label">{text(t.name)}</span>
                <input
                  className="dn-input"
                  maxLength={DONATE_NAME_MAX}
                  placeholder={userName || text(t.namePlaceholder)}
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </label>
              <label className="dn-field">
                <span className="dn-label">{text(t.message)}</span>
                <textarea
                  className="dn-input"
                  rows={2}
                  maxLength={DONATE_MESSAGE_MAX}
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                />
              </label>
              <label className="dn-check">
                <input type="checkbox" checked={hideAmount} onChange={(event) => setHideAmount(event.target.checked)} />
                <span>{text(t.hideAmount)}</span>
              </label>
              <p className="dn-muted">{userName ? `${text(t.signedInAs)} ${userName}.` : text(t.signInHint)}</p>
              {error ? <p className="dn-error" role="alert">{error}</p> : null}
              <button type="button" className="dn-btn is-primary" onClick={createCode} disabled={busy}>
                {busy ? text(t.creating) : `${text(t.create)}${chosenAmount ? ` · ${formatVnd(chosenAmount)}` : ""}`}
              </button>
            </section>
          ) : null}

          {showTransfer ? (
            <section className="dn-card">
              <h2>{text(t.transferTitle)}</h2>
              {intent?.status === "paid" ? (
                <p className="dn-thanks" role="status">
                  <span className="material-symbols-rounded" aria-hidden="true">favorite</span>
                  {text(t.thanks)}{intent.amountPaid ? ` (${formatVnd(intent.amountPaid)})` : ""}
                </p>
              ) : null}
              <div className="dn-transfer">
                {qrText ? (
                  <figure className="dn-qr-box">
                    <QrCode text={qrText} label={text(t.scan)} />
                    <figcaption>{text(t.scan)}</figcaption>
                  </figure>
                ) : null}
                <div className="dn-details">
                  <CopyRow label={text(t.bank)} value={config.bankName} locale={locale} />
                  <CopyRow label={text(t.account)} value={config.accountNo} locale={locale} />
                  {config.accountName ? <CopyRow label={text(t.holder)} value={config.accountName} locale={locale} /> : null}
                  {intent ? (
                    <>
                      <CopyRow label={text(t.amount)} value={String(intent.amountExpected)} locale={locale} />
                      <CopyRow label={text(t.content)} value={intent.code} locale={locale} />
                      <p className="dn-hint">{text(t.contentHint)}</p>
                    </>
                  ) : (
                    <p className="dn-hint">{text(t.noCodeHint)}</p>
                  )}
                </div>
              </div>
              {intent && intent.status !== "paid" ? (
                <p className="dn-muted" role="status">
                  {pollStopped ? text(t.stoppedWaiting) : <><span className="dn-spinner" aria-hidden="true" />{text(t.waiting)}</>}
                </p>
              ) : null}
              {intent ? (
                <button type="button" className="dn-btn" onClick={() => { setIntent(null); setError(""); }}>{text(t.again)}</button>
              ) : null}
            </section>
          ) : null}

          <section className="dn-card">
            <h2>{text(t.tiersTitle)}</h2>
            <ul className="dn-tier-list">
              {[...DONATE_TIERS].reverse().map((tier) => (
                <li key={tier.id}>
                  <TierBadge tier={tier.id} />
                  <span>{text(t.from)} {formatVnd(tier.min)}</span>
                </li>
              ))}
            </ul>
            <p className="dn-muted">{text(t.tiersNote)}</p>
          </section>
        </div>
      )}

      <div className="dn-grid dn-grid--wall">
        <section className="dn-card">
          <h2>{text(t.wallTitle)}</h2>
          {wall?.recent.length ? (
            <ul className="dn-wall">
              {wall.recent.map((row, index) => (
                <li key={`${row.paidAt}-${index}`}>
                  <div className="dn-wall-head">
                    <strong>{row.name || text(t.anonymous)}</strong>
                    <TierBadge tier={row.tier} />
                    {row.amount !== null ? <span className="dn-wall-amount">{formatVnd(row.amount)}</span> : null}
                    <span className="dn-wall-date">{formatDate(row.paidAt, locale)}</span>
                  </div>
                  {row.message ? <p>{row.message}</p> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="dn-muted">{text(t.wallEmpty)}</p>
          )}
        </section>
        <section className="dn-card">
          <h2>{text(t.topTitle)}</h2>
          {wall?.top.length ? (
            <ol className="dn-top">
              {wall.top.map((row, index) => (
                <li key={`${row.name}-${index}`}>
                  <strong>{row.name || text(t.anonymous)}</strong>
                  <TierBadge tier={row.tier} />
                  {row.total !== null ? <span className="dn-wall-amount">{formatVnd(row.total)}</span> : null}
                </li>
              ))}
            </ol>
          ) : (
            <p className="dn-muted">{text(t.wallEmpty)}</p>
          )}
        </section>
      </div>

      <p className="dn-foot"><a href="/privacy" data-no-spa>{text(t.privacy)}</a></p>
    </main>
  );
}
