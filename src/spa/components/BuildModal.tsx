// Shared accessible modal dialog for the Build Planner (Passive Tree, Conditions, Detailed Stats).
// Top-aligned with internal scrolling (never jumps vertically when content changes height),
// locks body scroll, traps keyboard focus, closes on Escape / backdrop / close button,
// and synchronously returns focus to the triggering button when closed.
import { useEffect, useId, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";

import "../styles/planner-modals.css";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex=\"-1\"])"
].join(", ");

export interface BuildModalProps {
  open: boolean;
  title: string;
  subtitle?: ReactNode;
  badge?: ReactNode;
  /** "large" = 95vw x 90vh (fullscreen on phones); "wide" = 780px top-aligned dialog. */
  size?: "large" | "wide";
  /** Pause Escape handling when a nested dialog (e.g. StatBreakdownDialog) is open on top. */
  disableEscape?: boolean;
  onClose: () => void;
  returnFocusRef?: RefObject<HTMLElement>;
  bodyClassName?: string;
  locale: string;
  children: ReactNode;
}

export function BuildModal({
  open,
  title,
  subtitle,
  badge,
  size = "wide",
  disableEscape = false,
  onClose,
  returnFocusRef,
  bodyClassName = "",
  locale,
  children
}: BuildModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLElement | null>(null);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const backdropDownRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const returnFocusRefLatest = useRef(returnFocusRef);
  returnFocusRefLatest.current = returnFocusRef;

  // Lock page scroll while open, move focus into the modal, and restore focus synchronously on close.
  useLayoutEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    const prevActive = document.activeElement as HTMLElement | null;
    document.body.style.overflow = "hidden";

    if (closeBtnRef.current) closeBtnRef.current.focus({ preventScroll: true });
    else dialogRef.current?.focus({ preventScroll: true });

    return () => {
      document.body.style.overflow = prevOverflow;
      const target = returnFocusRefLatest.current?.current ?? prevActive;
      if (target && typeof target.focus === "function" && target.isConnected) {
        target.focus({ preventScroll: true });
      }
    };
  }, [open]);

  // Escape to close + Tab/Shift+Tab focus trap inside the dialog.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (disableEscape) return;
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || disableEscape) return;
      const container = dialogRef.current;
      if (!container) return;
      const focusable = [...container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
        .filter((el) => el.offsetParent !== null || el === document.activeElement);
      if (!focusable.length) {
        event.preventDefault();
        container.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey) {
        if (!active || active === first || !container.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (!active || active === last || !container.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, disableEscape]);

  if (!open) return null;
  const vi = locale === "vi";

  return (
    <div
      className={`bm-backdrop bm-backdrop--${size}`}
      role="presentation"
      onMouseDown={(event) => {
        backdropDownRef.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (backdropDownRef.current && event.target === event.currentTarget) {
          backdropDownRef.current = false;
          onClose();
        }
      }}
    >
      <section
        ref={dialogRef}
        className={`bm-dialog bm-dialog--${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="bm-head">
          <div className="bm-head-copy">
            <h2 id={titleId}>{title}</h2>
            {badge ? <span className="bm-head-badge">{badge}</span> : null}
            {subtitle ? <span className="bm-head-sub">{subtitle}</span> : null}
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            className="bm-close"
            onClick={onClose}
            aria-label={vi ? "Đóng" : "Close"}
            title={vi ? "Đóng (Esc)" : "Close (Esc)"}
          >
            <span className="material-symbols-rounded" aria-hidden="true">close</span>
          </button>
        </header>
        <div className={`bm-body ${bodyClassName}`.trim()}>
          {children}
        </div>
      </section>
    </div>
  );
}
