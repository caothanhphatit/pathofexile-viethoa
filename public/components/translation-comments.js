(() => {
  const apiBaseKey = "poe2-api-base";
  const localApiBase = `http://${location.hostname || "127.0.0.1"}:3000`;
  const apiBase = window.POE2_API_BASE || localStorage.getItem(apiBaseKey) || (location.port === "3000" ? "" : localApiBase);
  const entityTypes = new Set(["skill_gem", "currency", "dictionary"]);
  const TEXT = {
    noComments: { vi: "Chưa có góp ý nào cho bản dịch này.", en: "No public suggestions for this translation yet." },
    loginPrompt: { vi: "Đăng nhập Google để bình luận công khai.", en: "Sign in with Google to leave a public comment." },
    googleLogin: { vi: "Đăng nhập Google", en: "Sign in with Google" },
    loginUnavailable: { vi: "Login chưa khả dụng", en: "Login unavailable" },
    logout: { vi: "Đăng xuất", en: "Sign out" },
    textarea: { vi: "Góp ý phần dịch này...", en: "Suggest an edit for this translation..." },
    submit: { vi: "Gửi góp ý", en: "Send suggestion" },
    panelTitle: { vi: "Góp ý bản dịch", en: "Translation suggestions" },
    commentUnit: { vi: "bình luận", en: "comments" },
    refresh: { vi: "Tải lại", en: "Refresh" },
    loading: { vi: "Đang tải bình luận...", en: "Loading comments..." },
    publicComments: { vi: "Bình luận công khai", en: "Public comments" },
    feedback: { vi: "Góp ý dịch", en: "Suggest translation" },
    closeFeedback: { vi: "Đóng góp ý", en: "Close suggestions" },
    sessionError: { vi: "Không thể tải phiên đăng nhập.", en: "Could not load the login session." },
    commentError: { vi: "Không thể tải bình luận.", en: "Could not load comments." },
    submitError: { vi: "Không thể gửi góp ý.", en: "Could not send the suggestion." }
  };

  let authCache = null;
  let authPromise = null;
  let modalEl = null;
  let lastFocused = null;

  const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  }[char]));

  const clamp = (value, max) => String(value || "").trim().slice(0, max);
  const t = (key) => window.PoeUi?.i18nText?.(TEXT[key], key) || TEXT[key]?.vi || key;
  const localeCode = () => window.PoeUi?.currentLocale?.() === "en" ? "en-US" : "vi-VN";

  const normalizeContext = (context = {}) => ({
    entityType: entityTypes.has(context.entityType) ? context.entityType : "dictionary",
    entityId: clamp(context.entityId, 180),
    entityName: clamp(context.entityName || context.entityId, 220),
    fieldPath: clamp(context.fieldPath || "summary", 120),
    sourceText: clamp(context.sourceText || "", 4000),
    translatedText: clamp(context.translatedText || "", 4000),
    pageUrl: clamp(context.pageUrl || `${location.pathname}${location.search}${location.hash}`, 1000)
  });

  const readContext = (node) => normalizeContext({
    entityType: node.dataset.commentEntityType,
    entityId: node.dataset.commentEntityId,
    entityName: node.dataset.commentEntityName,
    fieldPath: node.dataset.commentFieldPath,
    sourceText: node.dataset.commentSourceText,
    translatedText: node.dataset.commentTranslatedText,
    pageUrl: node.dataset.commentPageUrl
  });

  const requestJson = async (path, options = {}) => {
    const response = await fetch(`${apiBase}${path}`, {
      ...options,
      credentials: "include",
      headers: {
        "content-type": "application/json",
        ...(options.headers || {})
      }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    return payload;
  };

  const loadAuth = async (force = false) => {
    if (!force && authCache) return authCache;
    if (!force && authPromise) return authPromise;

    authPromise = Promise.all([
      requestJson("/api/auth/config"),
      requestJson("/api/auth/session")
    ]).then(([config, session]) => {
      authCache = {
        config: config.data || { googleEnabled: false, devLoginEnabled: false },
        session: session.data || { authenticated: false, user: null, providers: [] }
      };
      return authCache;
    }).finally(() => {
      authPromise = null;
    });

    return authPromise;
  };

  const loginUrl = () => `${apiBase}/api/auth/google/start?returnTo=${encodeURIComponent(`${location.pathname}${location.search}${location.hash}`)}`;

  const timeLabel = (value) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat(localeCode(), {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  };

  const avatarHtml = (comment) => {
    const name = comment.user?.displayName || "POE2 user";
    const avatarUrl = comment.user?.avatarUrl || "";
    if (avatarUrl) {
      return `<img class="h-8 w-8 rounded-full border border-slate-200 object-cover dark:border-slate-700" src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(name)}" loading="lazy">`;
    }
    return `
      <span class="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-amber-200 bg-amber-50 text-xs font-black text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
        ${escapeHtml(name.slice(0, 1).toUpperCase() || "U")}
      </span>
    `;
  };

  const renderComments = (comments = []) => {
    if (!comments.length) {
      return `
        <div class="rounded-lg border border-dashed border-slate-200 bg-slate-50/70 px-3 py-3 text-xs font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-400">
          ${escapeHtml(t("noComments"))}
        </div>
      `;
    }

    return comments.map((comment) => `
      <article class="rounded-lg border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-950/40">
        <div class="flex items-start gap-2.5">
          ${avatarHtml(comment)}
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <strong class="text-xs font-black text-slate-900 dark:text-slate-100">${escapeHtml(comment.user?.displayName || "POE2 user")}</strong>
              <time class="text-[10px] font-bold text-slate-400">${escapeHtml(timeLabel(comment.createdAt))}</time>
            </div>
            <p class="mt-1 whitespace-pre-wrap break-words text-sm font-semibold leading-relaxed text-slate-700 dark:text-slate-300">${escapeHtml(comment.body)}</p>
          </div>
        </div>
      </article>
    `).join("");
  };

  const renderComposer = (auth, error = "") => {
    if (!auth?.session?.authenticated) {
      const googleEnabled = Boolean(auth?.config?.googleEnabled);
      return `
        <div class="rounded-lg border border-blue-200 bg-blue-50/80 p-3 dark:border-blue-900/70 dark:bg-blue-950/30">
          <p class="text-xs font-bold text-blue-900 dark:text-blue-200">${escapeHtml(t("loginPrompt"))}</p>
          ${googleEnabled ? `
            <a class="mt-2 inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-black text-white transition hover:bg-blue-700" href="${escapeHtml(loginUrl())}">
              <span class="material-symbols-rounded text-sm" aria-hidden="true">account_circle</span>
              ${escapeHtml(t("googleLogin"))}
            </a>
          ` : `
            <span class="mt-2 inline-flex h-9 items-center gap-1.5 rounded-lg border border-blue-200 bg-white/70 px-3 text-xs font-black text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-200">
              <span class="material-symbols-rounded text-sm" aria-hidden="true">lock</span>
              ${escapeHtml(t("loginUnavailable"))}
            </span>
          `}
        </div>
      `;
    }

    const user = auth.session.user || {};
    return `
      <form class="translation-comment-form rounded-lg border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/40">
        <div class="mb-2 flex items-center justify-between gap-3">
          <span class="text-xs font-black text-slate-700 dark:text-slate-200">${escapeHtml(user.displayName || user.email || "POE2 user")}</span>
          <button class="text-[11px] font-bold text-slate-400 transition hover:text-slate-700 dark:hover:text-slate-200" type="button" data-comment-logout>${escapeHtml(t("logout"))}</button>
        </div>
        <textarea class="min-h-20 w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold leading-relaxed text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-blue-400 dark:focus:ring-blue-950" name="body" maxlength="1200" placeholder="${escapeHtml(t("textarea"))}" required></textarea>
        ${error ? `<p class="mt-2 text-xs font-bold text-rose-600 dark:text-rose-300">${escapeHtml(error)}</p>` : ""}
        <div class="mt-2 flex justify-end">
          <button class="inline-flex h-9 items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-xs font-black text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100" type="submit">
            <span class="material-symbols-rounded text-sm" aria-hidden="true">send</span>
            ${escapeHtml(t("submit"))}
          </button>
        </div>
      </form>
    `;
  };

  const renderPanel = (instance) => {
    const count = instance.comments.length;
    instance.target.innerHTML = `
      <section class="translation-comments-panel rounded-xl border border-slate-200 bg-white/80 p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900/70" data-comments-panel data-no-tooltip>
        <div class="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 class="text-sm font-black text-slate-950 dark:text-white">${escapeHtml(t("panelTitle"))}</h3>
            <p class="text-[11px] font-semibold text-slate-500 dark:text-slate-400">${escapeHtml(instance.context.entityName)}${count ? ` · ${count} ${escapeHtml(t("commentUnit"))}` : ""}</p>
          </div>
          <button class="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 px-2 text-[11px] font-black text-slate-600 transition hover:bg-slate-50 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800" type="button" data-comment-refresh>
            <span class="material-symbols-rounded text-sm" aria-hidden="true">refresh</span>
            ${escapeHtml(t("refresh"))}
          </button>
        </div>
        ${instance.loading ? `
          <div class="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-xs font-bold text-slate-500 dark:border-slate-800 dark:bg-slate-950/40 dark:text-slate-400">${escapeHtml(t("loading"))}</div>
        ` : `
          ${renderComposer(instance.auth, instance.error)}
          <div class="mt-3 grid gap-2" data-comment-list>
            ${renderComments(instance.comments)}
          </div>
        `}
      </section>
    `;
  };

  const loadComments = async (context) => {
    const params = new URLSearchParams({
      entityType: context.entityType,
      entityId: context.entityId,
      limit: "20"
    });
    const payload = await requestJson(`/api/translation-comments?${params.toString()}`);
    return payload.data || [];
  };

  const refresh = async (instance, { forceAuth = false } = {}) => {
    instance.loading = true;
    instance.error = "";
    renderPanel(instance);

    const [authResult, commentsResult] = await Promise.allSettled([
      loadAuth(forceAuth),
      loadComments(instance.context)
    ]);

    if (authResult.status === "fulfilled") {
      instance.auth = authResult.value;
    } else {
      instance.auth = authCache || { config: { googleEnabled: false }, session: { authenticated: false, user: null } };
      instance.error = authResult.reason?.message || t("sessionError");
    }

    if (commentsResult.status === "fulfilled") {
      instance.comments = commentsResult.value;
    } else {
      instance.comments = [];
      instance.error = commentsResult.reason?.message || t("commentError");
    }

    instance.loading = false;
    renderPanel(instance);
  };

  const mount = (target, rawContext) => {
    if (!target) return null;
    const context = normalizeContext(rawContext);
    if (!context.entityId) return null;

    const existing = target.__translationCommentsInstance;
    if (existing && JSON.stringify(existing.context) === JSON.stringify(context)) {
      refresh(existing);
      return existing;
    }

    const instance = {
      target,
      context,
      auth: authCache,
      comments: [],
      loading: true,
      error: ""
    };
    target.__translationCommentsInstance = instance;
    refresh(instance);
    return instance;
  };

  const closeModal = () => {
    if (!modalEl) return;
    modalEl.classList.add("hidden");
    modalEl.classList.remove("flex");
    if (lastFocused?.focus) lastFocused.focus();
  };

  const ensureModal = () => {
    if (modalEl) return modalEl;
    modalEl = document.createElement("div");
    modalEl.className = "fixed inset-0 z-[10000] hidden items-center justify-center bg-slate-950/65 p-4 backdrop-blur-sm";
    modalEl.innerHTML = `
      <section class="w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900" role="dialog" aria-modal="true" aria-labelledby="translationCommentsModalTitle" data-no-tooltip>
        <div class="flex items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3 dark:border-slate-800/70 dark:bg-slate-950/30">
          <div class="min-w-0">
            <p class="text-[11px] font-black uppercase tracking-wider text-blue-600 dark:text-blue-300" data-comment-public-label>${escapeHtml(t("publicComments"))}</p>
            <h2 class="truncate text-base font-black text-slate-950 dark:text-white" id="translationCommentsModalTitle">${escapeHtml(t("feedback"))}</h2>
          </div>
          <button class="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white" type="button" data-comment-modal-close aria-label="${escapeHtml(t("closeFeedback"))}">
            <span class="material-symbols-rounded" aria-hidden="true">close</span>
          </button>
        </div>
        <div class="max-h-[72vh] overflow-y-auto p-4" data-comment-modal-body></div>
      </section>
    `;
    document.body.appendChild(modalEl);
    modalEl.addEventListener("click", (event) => {
      if (event.target === modalEl || event.target.closest("[data-comment-modal-close]")) closeModal();
    });
    return modalEl;
  };

  const open = (rawContext, trigger = document.activeElement) => {
    const context = normalizeContext(rawContext);
    if (!context.entityId) return;
    const modal = ensureModal();
    lastFocused = trigger;
    modal.querySelector("[data-comment-public-label]").textContent = t("publicComments");
    modal.querySelector("[data-comment-modal-close]").setAttribute("aria-label", t("closeFeedback"));
    modal.querySelector("#translationCommentsModalTitle").textContent = `${t("feedback")}: ${context.entityName}`;
    modal.classList.remove("hidden");
    modal.classList.add("flex");
    mount(modal.querySelector("[data-comment-modal-body]"), context);
  };

  document.addEventListener("click", (event) => {
    const trigger = event.target.closest("[data-comment-trigger]");
    if (!trigger) return;
    event.preventDefault();
    event.stopPropagation();
    open(readContext(trigger), trigger);
  });

  document.addEventListener("submit", async (event) => {
    const form = event.target.closest(".translation-comment-form");
    if (!form) return;
    event.preventDefault();
    const panel = form.closest("[data-comments-panel]");
    const target = panel?.parentElement;
    const instance = target?.__translationCommentsInstance;
    if (!instance) return;

    const submit = form.querySelector("button[type='submit']");
    const textarea = form.querySelector("textarea[name='body']");
    const body = textarea.value.trim();
    if (body.length < 2) return;

    submit.disabled = true;
    try {
      await requestJson("/api/translation-comments", {
        method: "POST",
        body: JSON.stringify({
          ...instance.context,
          body
        })
      });
      textarea.value = "";
      await refresh(instance);
    } catch (error) {
      instance.error = error.message || t("submitError");
      renderPanel(instance);
    } finally {
      submit.disabled = false;
    }
  });

  document.addEventListener("click", async (event) => {
    const refreshButton = event.target.closest("[data-comment-refresh]");
    if (refreshButton) {
      const target = refreshButton.closest("[data-comments-panel]")?.parentElement;
      const instance = target?.__translationCommentsInstance;
      if (instance) refresh(instance, { forceAuth: true });
      return;
    }

    if (event.target.closest("[data-comment-logout]")) {
      const target = event.target.closest("[data-comments-panel]")?.parentElement;
      const instance = target?.__translationCommentsInstance;
      await requestJson("/api/auth/logout", { method: "POST", body: "{}" }).catch(() => null);
      authCache = null;
      if (instance) refresh(instance, { forceAuth: true });
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && modalEl && !modalEl.classList.contains("hidden")) closeModal();
  });
  window.addEventListener("poe-locale-change", () => {
    document.querySelectorAll("[data-comments-slot]").forEach((target) => {
      const instance = target.__translationCommentsInstance;
      if (instance) renderPanel(instance);
    });
    if (modalEl && !modalEl.classList.contains("hidden")) {
      modalEl.querySelector("[data-comment-public-label]").textContent = t("publicComments");
      modalEl.querySelector("[data-comment-modal-close]").setAttribute("aria-label", t("closeFeedback"));
      const body = modalEl.querySelector("[data-comment-modal-body]");
      const instance = body?.__translationCommentsInstance;
      if (instance) {
        modalEl.querySelector("#translationCommentsModalTitle").textContent = `${t("feedback")}: ${instance.context.entityName}`;
        renderPanel(instance);
      }
    }
  });

  window.PoeTranslationComments = {
    mount,
    open,
    readContext
  };
})();
