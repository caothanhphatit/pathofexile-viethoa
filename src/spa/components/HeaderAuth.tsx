import { useEffect, useRef, useState } from "react";
import type { Locale } from "../lib/locale";
import { TierBadge } from "../pages/DonatePage";
import "../styles/header-auth.css";

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string;
}

interface AuthSessionResponse {
  ok?: boolean;
  data?: {
    authenticated?: boolean;
    user?: AuthUser | null;
  };
}

interface AuthConfigResponse {
  ok?: boolean;
  data?: {
    googleEnabled?: boolean;
    devLoginEnabled?: boolean;
  };
}

function cleanReturnTo(): string {
  try {
    const url = new URL(window.location.href);
    url.searchParams.delete("auth");
    const qs = url.searchParams.toString();
    return `${url.pathname}${qs ? `?${qs}` : ""}` || "/";
  } catch {
    return "/";
  }
}

function initialsOf(user: AuthUser): string {
  const source = (user.displayName || user.email || "U").trim();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

function GoogleMark() {
  return (
    <svg className="ha-google-svg" viewBox="0 0 18 18" width="16" height="16" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.89 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.96 10.71A5.41 5.41 0 0 1 3.68 9c0-.59.1-1.17.28-1.71V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.04l3-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3 2.33C4.67 5.16 6.66 3.58 9 3.58z" />
    </svg>
  );
}

export function HeaderAuth({ locale, currentPath }: { locale: Locale; currentPath?: string }) {
  const vi = locale === "vi";
  void currentPath;
  const [ready, setReady] = useState(false);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [tier, setTier] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const refreshAuth = async () => {
    try {
      const [cfgRes, sesRes] = await Promise.all([
        fetch("/api/auth/config", { credentials: "include" }),
        fetch("/api/auth/session", { credentials: "include" })
      ]);
      const cfg = (cfgRes.ok ? await cfgRes.json() : null) as AuthConfigResponse | null;
      const ses = (sesRes.ok ? await sesRes.json() : null) as AuthSessionResponse | null;
      setGoogleEnabled(Boolean(cfg?.data?.googleEnabled));
      const signedIn = Boolean(ses?.data?.authenticated && ses.data.user);
      setUser(signedIn ? ses!.data!.user! : null);
      setAvatarFailed(false);
      // Supporter tier badge; missing when the donate API is unavailable.
      if (signedIn) {
        const me = await fetch("/api/donate/me", { credentials: "include" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
        setTier(me?.data?.tier ?? null);
      } else {
        setTier(null);
      }
    } catch {
      // Backend offline or static-only mode: keep hidden cleanly.
      setGoogleEnabled(false);
      setUser(null);
    } finally {
      setReady(true);
    }
  };

  useEffect(() => {
    void refreshAuth();
    const onAuthChange = () => void refreshAuth();
    window.addEventListener("poe-auth-change", onAuthChange);
    return () => window.removeEventListener("poe-auth-change", onAuthChange);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onMouseDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onMouseDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, [open]);

  if (!ready) return null;

  if (!user) {
    if (!googleEnabled) return null;
    const loginHref = `/api/auth/google/start?returnTo=${encodeURIComponent(cleanReturnTo())}`;
    return (
      <a
        className="ha-login-btn"
        href={loginHref}
        data-no-spa="true"
        title={vi ? "Đăng nhập bằng Google" : "Sign in with Google"}
        aria-label={vi ? "Đăng nhập bằng Google" : "Sign in with Google"}
      >
        <GoogleMark />
        <span className="ha-login-label">{vi ? "Đăng nhập" : "Sign in"}</span>
      </a>
    );
  }

  const handleLogout = async () => {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
      setUser(null);
      setOpen(false);
      window.dispatchEvent(new CustomEvent("poe-auth-change"));
    } finally {
      setBusy(false);
    }
  };

  const shortName = (user.displayName || user.email || "Account").split(/\s+/)[0];

  return (
    <div className="ha-account" ref={rootRef}>
      <button
        type="button"
        className={`ha-user-btn ${open ? "is-open" : ""}`}
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="menu"
        title={user.displayName || user.email}
      >
        <span className="ha-avatar">
          {user.avatarUrl && !avatarFailed ? (
            <img
              src={user.avatarUrl}
              alt=""
              referrerPolicy="no-referrer"
              onError={() => setAvatarFailed(true)}
            />
          ) : (
            <span>{initialsOf(user)}</span>
          )}
        </span>
        <span className="ha-user-name">{shortName}</span>
        <TierBadge tier={tier} />
        <span className="material-symbols-rounded ha-chevron" aria-hidden="true">expand_more</span>
      </button>

      {open ? (
        <div className="ha-menu" role="menu" aria-label={vi ? "Tài khoản" : "Account"}>
          <div className="ha-menu-head">
            <strong>{user.displayName || user.email}</strong>
            {user.email ? <small>{user.email}</small> : null}
          </div>
          <div className="ha-menu-links">
            <a href="/build" role="menuitem" onClick={() => setOpen(false)}>
              <span className="material-symbols-rounded" aria-hidden="true">construction</span>
              <span>{vi ? "Build Planner" : "Build Planner"}</span>
            </a>
            <a href="/leveling" role="menuitem" onClick={() => setOpen(false)}>
              <span className="material-symbols-rounded" aria-hidden="true">route</span>
              <span>{vi ? "Tiến độ Leveling" : "Leveling progress"}</span>
            </a>
            <a href="/donate" role="menuitem" onClick={() => setOpen(false)}>
              <span className="material-symbols-rounded" aria-hidden="true">favorite</span>
              <span>{vi ? "Ủng hộ trang" : "Support the site"}</span>
            </a>
            <a href="/premium" role="menuitem" onClick={() => setOpen(false)}>
              <span className="material-symbols-rounded" aria-hidden="true">workspace_premium</span>
              <span>{vi ? "Tài khoản & Premium" : "Account & Premium"}</span>
            </a>
          </div>
          <div className="ha-menu-foot">
            <button type="button" className="ha-logout-btn" onClick={handleLogout} disabled={busy} role="menuitem">
              <span className="material-symbols-rounded" aria-hidden="true">logout</span>
              <span>{busy ? (vi ? "Đang đăng xuất..." : "Signing out...") : (vi ? "Đăng xuất" : "Sign out")}</span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
