import { useCallback, useEffect, useState } from "react";
import { type Locale, localizedText } from "../lib/locale";

type PremiumStatus = {
  active: boolean;
  plan: "month" | "year" | "lifetime" | "custom" | null;
  expiresAt: string | null;
  key: { prefix: string; createdAt: string } | null;
  device: { label: string; firstSeenAt: string; lastSeenAt: string } | null;
  deviceResetAvailableAt: string | null;
};

type Session = { authenticated: boolean; user: { displayName?: string; email?: string } | null };

const t = {
  title: { vi: "Premium", en: "Premium" },
  lead: {
    vi: "Trạng thái gói, key dùng cho ứng dụng và máy đang kích hoạt key.",
    en: "Your plan, the key for client apps and the device the key is activated on."
  },
  signInTitle: { vi: "Đăng nhập để xem premium", en: "Sign in to see your premium" },
  signIn: { vi: "Đăng nhập bằng Google", en: "Sign in with Google" },
  plan: { vi: "Gói", en: "Plan" },
  active: { vi: "Đang hoạt động", en: "Active" },
  inactive: { vi: "Chưa có premium", en: "No premium" },
  inactiveHint: {
    vi: "Tài khoản này chưa có gói premium. Liên hệ admin để kích hoạt.",
    en: "This account has no premium plan yet. Contact the admin to activate one."
  },
  expires: { vi: "Hết hạn", en: "Expires" },
  never: { vi: "Không hết hạn", en: "Never" },
  keyTitle: { vi: "Key ứng dụng", en: "App key" },
  keyHint: {
    vi: "Mỗi tài khoản có một key. Key chỉ kích hoạt được trên một máy.",
    en: "One key per account. A key works on one device only."
  },
  noKey: { vi: "Chưa tạo key.", en: "No key yet." },
  createKey: { vi: "Tạo key", en: "Create key" },
  rotateKey: { vi: "Tạo key mới", en: "Create a new key" },
  rotateConfirm: {
    vi: "Key cũ sẽ ngừng hoạt động ngay và máy đang dùng key cũ phải nhập key mới. Tiếp tục?",
    en: "The old key stops working right away and its device must enter the new key. Continue?"
  },
  newKeyTitle: { vi: "Key mới của bạn", en: "Your new key" },
  newKeyHint: {
    vi: "Chỉ hiện một lần. Sao chép và lưu lại ngay; sau khi rời trang sẽ không xem lại được.",
    en: "Shown once. Copy and keep it now; it cannot be shown again after you leave."
  },
  copy: { vi: "Sao chép", en: "Copy" },
  copied: { vi: "Đã chép", en: "Copied" },
  deviceTitle: { vi: "Máy đã kích hoạt", en: "Activated device" },
  noDevice: { vi: "Key chưa được kích hoạt trên máy nào.", en: "The key has not been activated on any device." },
  deviceUnnamed: { vi: "Máy không tên", en: "Unnamed device" },
  firstSeen: { vi: "Kích hoạt", en: "Activated" },
  lastSeen: { vi: "Lần cuối", en: "Last seen" },
  resetDevice: { vi: "Đổi máy", en: "Change device" },
  resetConfirm: {
    vi: "Gỡ key khỏi máy hiện tại để kích hoạt trên máy khác? Mỗi 30 ngày chỉ đổi được một lần.",
    en: "Release the key from this device so another one can activate it? Allowed once every 30 days."
  },
  resetAfter: { vi: "Đổi máy được lại từ", en: "Can change device again from" },
  loading: { vi: "Đang tải…", en: "Loading…" },
  planNames: {
    month: { vi: "Tháng", en: "Monthly" },
    year: { vi: "Năm", en: "Yearly" },
    lifetime: { vi: "Trọn đời", en: "Lifetime" },
    custom: { vi: "Tuỳ chỉnh", en: "Custom" }
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

const formatDate = (value: string | null, locale: Locale) =>
  value ? new Date(value).toLocaleString(locale === "vi" ? "vi-VN" : "en-GB", { dateStyle: "medium", timeStyle: "short" }) : "";

export function PremiumPage({ locale }: { locale: Locale }) {
  const text = (entry: Record<string, string>) => localizedText(entry, "", locale);
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<PremiumStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const current = await api<Session>("/api/auth/session");
      setSession(current);
      if (current.authenticated) setStatus(await api<PremiumStatus>("/api/premium/me"));
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const createKey = () => run(async () => {
    if (status?.key && !window.confirm(text(t.rotateConfirm))) return;
    const data = await api<{ key: string }>("/api/premium/key", { method: "POST", body: "{}" });
    setNewKey(data.key);
    setCopied(false);
    setStatus(await api<PremiumStatus>("/api/premium/me"));
  });

  const resetDevice = () => run(async () => {
    if (!window.confirm(text(t.resetConfirm))) return;
    setStatus(await api<PremiumStatus>("/api/premium/device/reset", { method: "POST", body: "{}" }));
  });

  const copyKey = async () => {
    try {
      await navigator.clipboard.writeText(newKey);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const loginHref = `/api/auth/google/start?returnTo=${encodeURIComponent("/premium")}`;
  const resetLocked = Boolean(status?.deviceResetAvailableAt);

  return (
    <main className="page-shell premium-page">
      <header className="page-title tight">
        <h1>{text(t.title)}</h1>
        <p>{text(t.lead)}</p>
      </header>

      {error ? <p className="premium-error" role="alert">{error}</p> : null}

      {!session ? (
        <p className="premium-muted">{text(t.loading)}</p>
      ) : !session.authenticated ? (
        <section className="premium-card premium-signin">
          <span className="material-symbols-rounded" aria-hidden="true">workspace_premium</span>
          <h2>{text(t.signInTitle)}</h2>
          <a className="premium-button is-primary" href={loginHref}>{text(t.signIn)}</a>
        </section>
      ) : !status ? (
        <p className="premium-muted">{text(t.loading)}</p>
      ) : (
        <div className="premium-grid">
          <section className={`premium-card premium-status ${status.active ? "is-active" : ""}`}>
            <div className="premium-status-head">
              <span className="material-symbols-rounded" aria-hidden="true">workspace_premium</span>
              <div>
                <span className="premium-kicker">{text(t.plan)}</span>
                <h2>{status.active ? text(t.planNames[status.plan ?? "custom"]) : text(t.inactive)}</h2>
              </div>
              <span className={`premium-pill ${status.active ? "is-on" : ""}`}>{status.active ? text(t.active) : text(t.inactive)}</span>
            </div>
            {status.active ? (
              <dl className="premium-facts">
                <div><dt>{text(t.expires)}</dt><dd>{status.expiresAt ? formatDate(status.expiresAt, locale) : text(t.never)}</dd></div>
                {session.user?.email ? <div><dt>Email</dt><dd>{session.user.email}</dd></div> : null}
              </dl>
            ) : (
              <p className="premium-muted">{text(t.inactiveHint)}</p>
            )}
          </section>

          <section className="premium-card">
            <h2>{text(t.keyTitle)}</h2>
            <p className="premium-muted">{text(t.keyHint)}</p>
            {newKey ? (
              <div className="premium-newkey">
                <strong>{text(t.newKeyTitle)}</strong>
                <div className="premium-keyrow">
                  <code>{newKey}</code>
                  <button type="button" className="premium-button" onClick={copyKey}>{copied ? text(t.copied) : text(t.copy)}</button>
                </div>
                <small>{text(t.newKeyHint)}</small>
              </div>
            ) : status.key ? (
              <div className="premium-keyrow"><code>{status.key.prefix}-•••••-•••••-•••••</code></div>
            ) : (
              <p>{text(t.noKey)}</p>
            )}
            <button type="button" className="premium-button is-primary" disabled={busy || !status.active} onClick={createKey}>
              {status.key ? text(t.rotateKey) : text(t.createKey)}
            </button>
          </section>

          <section className="premium-card">
            <h2>{text(t.deviceTitle)}</h2>
            {status.device ? (
              <dl className="premium-facts">
                <div><dt>{text(t.deviceTitle)}</dt><dd>{status.device.label || text(t.deviceUnnamed)}</dd></div>
                <div><dt>{text(t.firstSeen)}</dt><dd>{formatDate(status.device.firstSeenAt, locale)}</dd></div>
                <div><dt>{text(t.lastSeen)}</dt><dd>{formatDate(status.device.lastSeenAt, locale)}</dd></div>
              </dl>
            ) : (
              <p className="premium-muted">{text(t.noDevice)}</p>
            )}
            {resetLocked ? (
              <p className="premium-muted">{text(t.resetAfter)} {formatDate(status.deviceResetAvailableAt, locale)}</p>
            ) : null}
            <button type="button" className="premium-button" disabled={busy || !status.device || resetLocked} onClick={resetDevice}>
              {text(t.resetDevice)}
            </button>
          </section>
        </div>
      )}
    </main>
  );
}
