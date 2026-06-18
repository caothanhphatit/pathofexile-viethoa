// desktop/renderer.js
// Glue between the leveling checklist page and the Electron native bridge
// exposed by preload.cjs as window.poe2native.
//
// Responsibilities:
//   1. Shim window.fetch so leveling-v2.js's GET /api/leveling/log/status is
//      served LOCALLY via poe2native.getLogStatus() — no backend, no edits to
//      leveling-v2.js. All other requests pass through to the real fetch.
//   2. Subscribe to poe2native.onZone(...) as a backup nudge to refresh the UI.
//   3. Render poe2native.onPriceResult(r) into #pricePanel.
//   4. Wire the Interactive toggle hint button (hover-to-interact) and call
//      poe2native.setInteractive appropriately.

(function () {
  "use strict";

  const native = window.poe2native;
  console.log("[overlay] renderer loaded; native bridge = " + (native ? "OK" : "MISSING"));

  // ----------------------------------------------------------------------
  // 1. fetch shim for the log-status endpoint
  // ----------------------------------------------------------------------
  // leveling-v2.js builds the request as `${apiBase}/api/leveling/log/status`.
  // overlay.html sets window.POE2_API_BASE = "" so apiBase is empty and the
  // request URL is the bare path "/api/leveling/log/status". When resolved
  // against a file:// page it may also appear as an absolute URL, so we match
  // on the pathname ending rather than an exact string.
  const LOG_STATUS_PATH = "/api/leveling/log/status";
  const realFetch = window.fetch ? window.fetch.bind(window) : null;

  function urlMatchesLogStatus(input) {
    let raw;
    if (typeof input === "string") {
      raw = input;
    } else if (input && typeof input.url === "string") {
      // Request object
      raw = input.url;
    } else {
      raw = String(input || "");
    }
    // Strip query/hash, then test the path tail. Handles "/api/leveling/log/status",
    // "http://127.0.0.1:3000/api/leveling/log/status", and file://-relative forms.
    let pathPart = raw;
    try {
      // Resolve against current location to normalize relative URLs.
      pathPart = new URL(raw, window.location.href).pathname;
    } catch (_) {
      const q = raw.indexOf("?");
      if (q !== -1) pathPart = raw.slice(0, q);
      const h = pathPart.indexOf("#");
      if (h !== -1) pathPart = pathPart.slice(0, h);
    }
    return pathPart.endsWith(LOG_STATUS_PATH);
  }

  function jsonResponse(obj) {
    const body = JSON.stringify(obj);
    if (typeof Response === "function") {
      return new Response(body, {
        status: 200,
        statusText: "OK",
        headers: { "Content-Type": "application/json" },
      });
    }
    // Minimal duck-typed fallback (matches what requestJson uses: ok, status, json()).
    return {
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => JSON.parse(body),
      text: async () => body,
    };
  }

  window.fetch = async function patchedFetch(input, init) {
    if (urlMatchesLogStatus(input)) {
      try {
        const status = native ? await native.getLogStatus() : null;
        // leveling-v2.js's requestJson returns the parsed body and reads
        // payload.data — so the response envelope must be { data: <status> }.
        return jsonResponse({ data: status || { watching: false, error: "No native bridge", zoneName: null } });
      } catch (err) {
        // Surface as a graceful "offline-ish" status; component falls back cleanly.
        return jsonResponse({
          data: { watching: false, error: String((err && err.message) || err), zoneName: null },
        });
      }
    }
    if (realFetch) return realFetch(input, init);
    throw new Error("fetch is not available");
  };

  // ----------------------------------------------------------------------
  // 1b. EventSource shim for the live log/events stream
  // ----------------------------------------------------------------------
  // leveling-v2.js opens `new EventSource(`${apiBase}/api/leveling/log/events`)`
  // and treats it as the PRIMARY live-update channel ("status"/"zone" events).
  // There is NO backend in the overlay, so a real SSE connection would error
  // out and live zone-following would break (refreshStatus is only polled once
  // on init). We replace EventSource for that one URL with a fake that is fed
  // by the native watcher via poe2native.onZone — so the component's preferred
  // live path keeps working and the checklist auto-advances with the map.
  const LOG_EVENTS_PATH = "/api/leveling/log/events";
  const RealEventSource = window.EventSource;

  function urlMatchesLogEvents(input) {
    let pathPart = String(input || "");
    try {
      pathPart = new URL(String(input || ""), window.location.href).pathname;
    } catch (_) {
      const q = pathPart.indexOf("?");
      if (q !== -1) pathPart = pathPart.slice(0, q);
    }
    return pathPart.endsWith(LOG_EVENTS_PATH);
  }

  function FakeLogEventSource() {
    this.readyState = 1; // OPEN
    this.onerror = null;
    this.onopen = null;
    this.onmessage = null;
    this._listeners = Object.create(null);
    const self = this;
    // Prime with the current status so the checklist syncs immediately.
    if (native && typeof native.getLogStatus === "function") {
      native.getLogStatus().then(function (s) {
        if (s) self._emit("status", s);
      }).catch(function () {});
    }
    // Live zone changes pushed from main via the watcher.
    if (native && typeof native.onZone === "function") {
      native.onZone(function (s) {
        self._emit("zone", s);
      });
    }
  }
  FakeLogEventSource.prototype.addEventListener = function (type, cb) {
    (this._listeners[type] || (this._listeners[type] = [])).push(cb);
  };
  FakeLogEventSource.prototype.removeEventListener = function (type, cb) {
    const arr = this._listeners[type];
    if (arr) this._listeners[type] = arr.filter(function (f) { return f !== cb; });
  };
  FakeLogEventSource.prototype._emit = function (type, obj) {
    const ev = { data: JSON.stringify(obj), type: type };
    (this._listeners[type] || []).forEach(function (cb) {
      try { cb(ev); } catch (_) { /* no-op */ }
    });
  };
  FakeLogEventSource.prototype.close = function () {
    this.readyState = 2; // CLOSED
    this._listeners = Object.create(null);
  };

  if (RealEventSource) {
    const PatchedEventSource = function (url, opts) {
      if (urlMatchesLogEvents(url)) return new FakeLogEventSource();
      return new RealEventSource(url, opts);
    };
    PatchedEventSource.prototype = RealEventSource.prototype;
    PatchedEventSource.CONNECTING = RealEventSource.CONNECTING;
    PatchedEventSource.OPEN = RealEventSource.OPEN;
    PatchedEventSource.CLOSED = RealEventSource.CLOSED;
    window.EventSource = PatchedEventSource;
  }

  // ----------------------------------------------------------------------
  // 2. Zone backup refresh
  // ----------------------------------------------------------------------
  // leveling-v2.js polls log-status on its own timer. The onZone event is a
  // backup nudge: when the watcher emits a zone change, poke the polling loop
  // sooner by dispatching a focus/visibility-style hint. Since we cannot call
  // into leveling-v2.js internals, we trigger a fresh status fetch through the
  // shim — most builds re-poll on window focus, so re-dispatching focus is a
  // cheap, safe nudge. We also keep the latest status around for debugging.
  // Normalize a zone name the same way leveling-v2.js does, so we can tell
  // whether the current map has checklist data.
  function normalizeZoneName(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/<[^>]+>/g, " ")
      .replace(/\([^)]*\)/g, " ")
      .replace(/^\s*\d+(?:\.\d+)?\s+/, "")
      .replace(/\bthe\b/g, " ")
      .replace(/['’]/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, " ");
  }

  // Build the set of zone names that DO have checklist data.
  const knownZones = (function () {
    const set = new Set();
    const zones = window.levelingRouteZones || [];
    zones.forEach(function (z) {
      if (z && z.title) set.add(normalizeZoneName(z.title));
    });
    return set;
  })();

  function updateZoneBanner(status) {
    const el = document.getElementById("czName");
    if (!el) return;
    const zone = status && status.zoneName ? status.zoneName : null;
    if (!zone) {
      el.textContent = "Chưa vào map nào";
      el.parentElement && el.parentElement.querySelectorAll(".cz-nodata").forEach(function (n) { n.remove(); });
      return;
    }
    el.textContent = zone;
    // Has-data indicator: if the current map isn't in the checklist, say so.
    const banner = el.parentElement;
    if (banner) {
      banner.querySelectorAll(".cz-nodata").forEach(function (n) { n.remove(); });
      if (!knownZones.has(normalizeZoneName(zone))) {
        const tag = document.createElement("span");
        tag.className = "cz-nodata";
        tag.textContent = "không có hướng dẫn";
        banner.appendChild(tag);
      }
    }
  }

  if (native && typeof native.onZone === "function") {
    native.onZone(function (status) {
      window.__poe2LastZoneStatus = status;
      updateZoneBanner(status);
      try {
        // Nudge the page so the next poll picks up the new zone promptly.
        window.dispatchEvent(new Event("focus"));
        document.dispatchEvent(new Event("visibilitychange"));
      } catch (_) {
        /* no-op */
      }
    });
  }

  // Populate the banner once on load from the current status.
  if (native && typeof native.getLogStatus === "function") {
    native.getLogStatus().then(updateZoneBanner).catch(function () {});
  }

  // ----------------------------------------------------------------------
  // 3. Price-check result rendering
  // ----------------------------------------------------------------------
  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderPriceResult(r) {
    const panel = document.getElementById("pricePanel");
    if (!panel) return;

    if (!r) {
      panel.innerHTML = '<div class="pp-empty">No result.</div>';
      return;
    }

    if (r.ok === false || r.error) {
      const label = r.type ? escapeHtml(r.type) + ": " : "";
      panel.innerHTML =
        '<div class="pp-err">' + label + escapeHtml(r.error || "Price check failed") + "</div>";
      return;
    }

    const type = escapeHtml(r.type || "Unknown item");
    const count = typeof r.count === "number" ? r.count : (r.lowest ? r.lowest.length : 0);
    const lowest = Array.isArray(r.lowest) ? r.lowest : [];

    let html = "";
    html += '<div class="pp-head">';
    html += '<span class="pp-type" title="' + type + '">' + type + "</span>";
    html += '<span class="pp-count">' + escapeHtml(count) + " online</span>";
    html += "</div>";

    if (!lowest.length) {
      html += '<div class="pp-empty">No listings found.</div>';
    } else {
      html += "<ul>";
      // Show the cheapest few.
      lowest.slice(0, 5).forEach(function (l) {
        const amount = escapeHtml(l && l.amount != null ? l.amount : "?");
        const cur = escapeHtml(l && l.currency ? l.currency : "");
        const acct = escapeHtml(l && l.account ? l.account : "");
        html += "<li>";
        html += '<span><span class="pp-amount">' + amount + '</span> <span class="pp-cur">' + cur + "</span></span>";
        html += '<span class="pp-acct" title="' + acct + '">' + acct + "</span>";
        html += "</li>";
      });
      html += "</ul>";
    }

    panel.innerHTML = html;
  }

  if (native && typeof native.onPriceResult === "function") {
    native.onPriceResult(function (r) {
      renderPriceResult(r);
    });
  }

  // ----------------------------------------------------------------------
  // 4. Interactive toggle + hover-to-interact
  // ----------------------------------------------------------------------
  // The window starts click-through (setIgnoreMouseEvents(true) in main.cjs).
  // The global shortcut Ctrl+Alt+L toggles a "pinned interactive" mode in main.
  // Here we add an optional hover-to-interact behaviour: while the pointer is
  // over the card, allow mouse events; when it leaves, return to click-through.
  // The visible button reflects/forces interactive state for users without a
  // pointer hover (and as a discoverable hint).

  let pinnedInteractive = true; // window starts interactive (movable) by default

  function setInteractive(on) {
    if (native && typeof native.setInteractive === "function") {
      try {
        native.setInteractive(!!on);
      } catch (_) {
        /* no-op */
      }
    }
  }

  function reflectButton() {
    const btn = document.getElementById("interactiveBtn");
    if (!btn) return;
    btn.dataset.on = pinnedInteractive ? "true" : "false";
    btn.textContent = pinnedInteractive ? "Interactive" : "Click-through";
    btn.title = pinnedInteractive
      ? "Tương tác/kéo được. Bấm hoặc Ctrl+Alt+L để chuyển sang click-through (chuột xuyên xuống game)."
      : "Click-through: chuột xuyên xuống game. Bấm hoặc Ctrl+Alt+L để tương tác lại.";
  }

  function initInteractive() {
    const btn = document.getElementById("interactiveBtn");

    if (btn) {
      btn.addEventListener("click", function () {
        pinnedInteractive = !pinnedInteractive;
        setInteractive(pinnedInteractive);
        reflectButton();
      });
    }

    // Reflect interactive state pushed from main (e.g. the Ctrl+Alt+L global
    // hotkey toggles it there). Keep the button label in sync.
    if (native && typeof native.onSetInteractive === "function") {
      native.onSetInteractive(function (on) {
        pinnedInteractive = !!on;
        reflectButton();
      });
    }

    // Close button.
    const closeBtn = document.getElementById("closeBtn");
    if (closeBtn) {
      closeBtn.addEventListener("click", function () {
        console.log("[overlay] close clicked");
        if (native && typeof native.close === "function") native.close();
      });
    }

    // Manual window drag on the top bar (screen coords -> main repositions).
    const dragBar = document.getElementById("dragBar");
    if (dragBar && native && typeof native.drag === "function") {
      let dragging = false;
      dragBar.addEventListener("mousedown", function (e) {
        // Ignore drags that start on a button/control.
        if (e.target.closest("button")) return;
        dragging = true;
        native.drag({ type: "start", screenX: e.screenX, screenY: e.screenY });
        e.preventDefault();
      });
      window.addEventListener("mousemove", function (e) {
        if (dragging) native.drag({ type: "move", screenX: e.screenX, screenY: e.screenY });
      });
      window.addEventListener("mouseup", function () {
        if (dragging) {
          dragging = false;
          native.drag({ type: "end" });
        }
      });
    }

    // Collapse toggle: hide the checklist + price panel, shrink the window to
    // just the header + current-map banner, and back.
    let collapsed = false;
    const collapseBtn = document.getElementById("collapseBtn");
    if (collapseBtn) {
      collapseBtn.addEventListener("click", function () {
        collapsed = !collapsed;
        const body = document.getElementById("overlayBody");
        const price = document.getElementById("pricePanel");
        if (body) body.style.display = collapsed ? "none" : "";
        if (price) price.style.display = collapsed ? "none" : "";
        collapseBtn.textContent = collapsed ? "▢" : "–";
        if (native && typeof native.collapse === "function") {
          // header(30) + banner(~30) + card insets(16) ≈ 76px when collapsed.
          native.collapse(collapsed, 78);
        }
      });
    }

    reflectButton();
  }

  // Keep the button in sync if main pushes interactive state changes via onZone-like
  // channels in the future; for now just initialize on DOM ready.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initInteractive);
  } else {
    initInteractive();
  }

  // Prime the checklist once on load so it shows current zone immediately,
  // without waiting for the first poll tick.
  function primeStatus() {
    try {
      window.dispatchEvent(new Event("focus"));
    } catch (_) {
      /* no-op */
    }
  }
  if (document.readyState === "complete") {
    primeStatus();
  } else {
    window.addEventListener("load", primeStatus);
  }
})();
