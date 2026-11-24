// Optional "calculate on this device" switch for the Build Planner (behind feature flag).
// Renders nothing unless the pilot flag (?localcalc=1 or localStorage poevh_local_calc_flag=1) is enabled.
// Nothing is downloaded until the user explicitly clicks the download button after seeing the size.
import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  calcBackend,
  formatDownloadSize,
  type CalcBackendState
} from "../lib/calcBackend";
import type { Locale } from "../lib/locale";

interface CalcEngineSwitchProps {
  locale: Locale;
  onModeChanged?: () => void;
}

export function CalcEngineSwitch({ locale, onModeChanged }: CalcEngineSwitchProps) {
  const state: CalcBackendState = useSyncExternalStore(
    calcBackend.subscribe,
    calcBackend.getSnapshot
  );
  const prevModeRef = useRef(state.mode);
  const vi = locale === "vi";

  useEffect(() => {
    void calcBackend.restoreIfRemembered();
  }, []);

  useEffect(() => {
    if (prevModeRef.current !== state.mode) {
      prevModeRef.current = state.mode;
      onModeChanged?.();
    }
  }, [state.mode, onModeChanged]);

  if (!state.flagEnabled) return null;

  const busy = state.phase === "checking" || state.phase === "downloading" || state.phase === "decompressing" || state.phase === "loading_pob";
  const isLocal = state.mode === "local";
  const showPopover = state.phase === "confirm" || state.phase === "downloading" || state.phase === "decompressing" || state.phase === "loading_pob";
  const notice = state.fallbackNotice || state.errorNotice;
  const downloadBytes = state.manifest?.totalDownloadBytes || (state.manifest ? state.manifest.gzipBytes + state.manifest.wasmBytes : 0);

  return (
    <div className="calc-engine-bar" data-calc-mode={state.mode} data-calc-phase={state.phase}>
      <div className="calc-engine-row">
        <div
          className="calc-engine-switch"
          role="radiogroup"
          aria-label={vi ? "Chế độ tính chỉ số" : "Calculation mode"}
        >
          <button
            type="button"
            role="radio"
            aria-checked={!isLocal}
            className={`calc-engine-option ${!isLocal ? "is-active" : ""}`}
            onClick={() => calcBackend.switchToServer()}
          >
            <span className="material-symbols-rounded" aria-hidden="true">cloud</span>
            <span>{vi ? "Tính trên server" : "Calculate on server"}</span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={isLocal}
            className={`calc-engine-option ${isLocal ? "is-active" : ""}`}
            disabled={busy}
            onClick={() => void calcBackend.requestLocalMode()}
          >
            <span className="material-symbols-rounded" aria-hidden="true">memory</span>
            <span>{vi ? "Tính trên máy này" : "Calculate on this device"}</span>
          </button>
        </div>

        <div className="calc-engine-meta">
          {isLocal && state.phase === "ready" ? (
            <span className="calc-engine-badge is-ready">
              {vi ? "Sẵn sàng (offline)" : "Ready (local)"}
              {state.timings?.lastCalcMs ? ` · ${(state.timings.lastCalcMs / 1000).toFixed(1)}s` : ""}
            </span>
          ) : state.phase === "checking" ? (
            <span className="calc-engine-badge">{vi ? "Đang kiểm tra…" : "Checking…"}</span>
          ) : null}

          {state.cachedVersion && !busy ? (
            <button
              type="button"
              className="calc-engine-clear"
              onClick={() => void calcBackend.deleteCachedData()}
              title={vi
                ? `Xoá dữ liệu PoB đã lưu (${formatDownloadSize(state.cachedBytes)})`
                : `Delete cached PoB data (${formatDownloadSize(state.cachedBytes)})`}
            >
              <span className="material-symbols-rounded" aria-hidden="true">delete_sweep</span>
              <span>{vi ? "Xoá dữ liệu đã tải" : "Delete downloaded data"}</span>
            </button>
          ) : null}
        </div>
      </div>

      {/* Anchored popover: zero layout shift for panels below while confirming or downloading. */}
      {showPopover ? (
        <div className="calc-engine-popover" role="dialog" aria-live="polite" aria-label={vi ? "Tải bộ tính Path of Building" : "Download Path of Building engine"}>
          {state.phase === "confirm" && state.manifest ? (
            <>
              <p className="calc-engine-popover-title">
                {vi ? "Tải bộ tính PoB để chạy trực tiếp trên máy này?" : "Download the PoB engine to run locally?"}
              </p>
              <p className="calc-engine-popover-desc">
                {vi
                  ? `Cần tải khoảng ${formatDownloadSize(downloadBytes)} (gồm bộ tính PoB ${state.manifest.pobVersion} và WebAssembly). Dữ liệu được lưu trong trình duyệt để lần sau mở nhanh, không xếp hàng chờ server. Bạn có thể đổi lại server hoặc xoá bất kỳ lúc nào.`
                  : `Downloads about ${formatDownloadSize(downloadBytes)} (PoB ${state.manifest.pobVersion} calculation data + WebAssembly). Cached in this browser for fast startup with no server queue. You can switch back or delete it any time.`}
              </p>
              <div className="calc-engine-popover-actions">
                <button
                  type="button"
                  className="calc-engine-btn is-primary"
                  onClick={() => void calcBackend.confirmDownloadAndEnable()}
                >
                  <span className="material-symbols-rounded" aria-hidden="true">download</span>
                  {vi ? `Tải xuống (${formatDownloadSize(downloadBytes)})` : `Download (${formatDownloadSize(downloadBytes)})`}
                </button>
                <button
                  type="button"
                  className="calc-engine-btn"
                  onClick={() => calcBackend.cancelConfirm()}
                >
                  {vi ? "Để sau" : "Cancel"}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="calc-engine-popover-title">
                {state.phase === "downloading"
                  ? (vi ? "Đang tải dữ liệu Path of Building…" : "Downloading Path of Building data…")
                  : state.phase === "decompressing"
                    ? (vi ? "Đang giải nén dữ liệu…" : "Unpacking data…")
                    : (vi ? "Đang khởi động bộ tính PoB…" : "Starting PoB engine…")}
              </p>
              <div
                className="calc-engine-progress"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={state.phase === "downloading" ? (state.progress?.percent ?? 0) : 100}
              >
                <div
                  className={`calc-engine-progress-fill ${state.phase !== "downloading" ? "is-indeterminate" : ""}`}
                  style={{ width: `${state.phase === "downloading" ? (state.progress?.percent ?? 0) : 100}%` }}
                />
              </div>
              <p className="calc-engine-popover-sub">
                {state.phase === "downloading" && state.progress
                  ? `${formatDownloadSize(state.progress.received)} / ${formatDownloadSize(state.progress.total)} (${state.progress.percent}%)`
                  : (vi ? "Khởi động một lần, giữ sẵn trong bộ nhớ cho các lần tính tiếp theo." : "Loads once and stays ready in memory for subsequent calculations.")}
              </p>
            </>
          )}
        </div>
      ) : null}

      {notice ? (
        <div className="calc-engine-notice" role="status" aria-live="polite">
          <span className="material-symbols-rounded" aria-hidden="true">warning</span>
          <span>{vi ? notice.vi : notice.en}</span>
          <button
            type="button"
            className="calc-engine-notice-close"
            onClick={() => calcBackend.dismissFallbackNotice()}
            aria-label={vi ? "Đóng thông báo" : "Dismiss"}
          >
            <span className="material-symbols-rounded" aria-hidden="true">close</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
