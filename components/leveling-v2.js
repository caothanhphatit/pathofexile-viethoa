(function () {
  const routeZones = window.levelingRouteZones || [];
  const root = document.getElementById("levelingV2Root");
  if (!root || !routeZones.length) return;

  const activeTabKey = "poe2-leveling-active-checklist-tab-v1";
  const progressKey = "poe2-leveling-v2-progress-v1";
  const guestStoreKey = "poe2-leveling-v2-guest-store-v1";
  const currentZoneKey = "poe2-leveling-v2-current-zone-v1";
  const autoFollowKey = "poe2-leveling-v2-auto-follow-v1";
  const logPathKey = "poe2-leveling-v2-log-path-v1";
  const apiBaseKey = "poe2-api-base";
  const localApiBase = `http://${location.hostname || "127.0.0.1"}:3000`;
  const apiBase = window.POE2_API_BASE || localStorage.getItem(apiBaseKey) || (location.port === "3000" ? "" : localApiBase);

  const actLabels = {
    act1: "Act I",
    act2: "Act II",
    act3: "Act III",
    act4: "Act IV",
    interlude: "Interlude"
  };

  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[char]));

  const safeParseJson = (value, fallback) => {
    try {
      return JSON.parse(value) || fallback;
    } catch {
      return fallback;
    }
  };

  const normalizeZoneName = (value) => String(value || "")
    .toLowerCase()
    .replace(/<[^>]+>/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/^\s*\d+(?:\.\d+)?\s+/, "")
    .replace(/\bthe\b/g, " ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");

  const normalizeIdentity = (value) => normalizeZoneName(value);

  const addAlias = (map, alias, zone) => {
    if (!zone) return;
    const key = normalizeZoneName(alias);
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(zone);
  };

  const buildZoneAliasMap = () => {
    const map = new Map();
    routeZones.forEach((zone) => {
      const title = zone.title || "";
      addAlias(map, title, zone);
      addAlias(map, title.replace(/\s*\([^)]*\)/g, ""), zone);
      addAlias(map, zone.id, zone);
      title.split(/\s*->\s*/).forEach((part) => addAlias(map, part, zone));
      title.split(/\s*,\s*/).forEach((part) => addAlias(map, part, zone));
    });
    addAlias(map, "Ardura Caravan", routeZones.find((zone) => zone.title === "The Ardura Caravan"));
    addAlias(map, "Ziggurat Encampment", routeZones.find((zone) => zone.title === "Ziggurat Encampment"));
    addAlias(map, "Heart of the Tribe", routeZones.find((zone) => zone.title.includes("Heart of the Tribe")));
    addAlias(map, "Ogham The Refuge", routeZones.find((zone) => zone.title.includes("Ogham, The Refuge")));
    addAlias(map, "Khari Bazaar", routeZones.find((zone) => zone.title.includes("Khari Bazaar")));
    addAlias(map, "Mount Kriar", routeZones.find((zone) => zone.title.includes("Mount Kriar")));
    return map;
  };

  const zoneAliasMap = buildZoneAliasMap();
  const zoneById = new Map(routeZones.map((zone) => [zone.id, zone]));
  const flatTasks = routeZones.flatMap((zone) => zone.tasks.map((task) => ({ zone, task })));

  const defaultGuestCharacter = (progress = {}) => ({
    id: "guest_default",
    name: "Guest mode",
    className: "",
    level: null,
    source: "guest",
    logPath: "",
    logStartOffset: 0,
    progress,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });

  const normalizeGuestStore = (store) => {
    const legacyProgress = safeParseJson(localStorage.getItem(progressKey), {});
    const characters = Array.isArray(store?.characters) ? store.characters : [];
    const normalizedCharacters = characters.map((character) => ({
      id: String(character.id || `guest_${Date.now()}`),
      name: String(character.name || "Guest mode"),
      className: String(character.className || ""),
      level: character.level == null || character.level === "" ? null : Number(character.level),
      source: String(character.source || "guest"),
      logPath: String(character.logPath || ""),
      logStartOffset: Number(character.logStartOffset || 0),
      progress: character.progress && typeof character.progress === "object" ? character.progress : {},
      createdAt: character.createdAt || new Date().toISOString(),
      updatedAt: character.updatedAt || new Date().toISOString()
    }));

    if (!normalizedCharacters.length) normalizedCharacters.push(defaultGuestCharacter(legacyProgress));
    const activeCharacterId = normalizedCharacters.some((character) => character.id === store?.activeCharacterId)
      ? store.activeCharacterId
      : normalizedCharacters[0].id;

    return {
      activeCharacterId,
      characters: normalizedCharacters
    };
  };

  const loadGuestState = () => normalizeGuestStore(safeParseJson(localStorage.getItem(guestStoreKey), null));

  const saveGuestState = () => {
    if (state.mode !== "guest" || !state.activeCharacter) return;
    const store = loadGuestState();
    const now = new Date().toISOString();
    const nextCharacters = store.characters.map((character) => (
      character.id === state.activeCharacter.id
        ? {
          ...character,
          name: state.activeCharacter.name,
          className: state.activeCharacter.className || "",
          level: state.activeCharacter.level ?? null,
          logPath: state.activeCharacter.logPath || "",
          logStartOffset: Number(state.activeCharacter.logStartOffset || 0),
          progress: { ...state.progress },
          updatedAt: now
        }
        : character
    ));
    const nextStore = {
      activeCharacterId: state.activeCharacter.id,
      characters: nextCharacters
    };
    localStorage.setItem(guestStoreKey, JSON.stringify(nextStore));
    localStorage.setItem(progressKey, JSON.stringify(state.progress));
  };

  const guestCharactersForSync = () => loadGuestState().characters.filter((character) =>
    character.id !== "guest_default" || Object.values(character.progress || {}).some(Boolean)
  );

  const guestHasData = () => guestCharactersForSync().length > 0;

  const state = {
    mode: "guest",
    selectedZoneId: zoneById.has(localStorage.getItem(currentZoneKey)) ? localStorage.getItem(currentZoneKey) : routeZones[0].id,
    autoFollow: localStorage.getItem(autoFollowKey) !== "false",
    logStatus: null,
    eventSource: null,
    progress: {},
    authLoading: true,
    authConfig: { googleEnabled: false, devLoginEnabled: false },
    session: { authenticated: false, user: null, providers: [] },
    characters: [],
    activeCharacter: null,
    authError: "",
    characterError: ""
  };

  const applyGuestState = (store = loadGuestState()) => {
    const normalizedStore = normalizeGuestStore(store);
    const active = normalizedStore.characters.find((character) => character.id === normalizedStore.activeCharacterId) || normalizedStore.characters[0];
    state.mode = "guest";
    state.characters = normalizedStore.characters.map(({ progress, ...character }) => character);
    state.activeCharacter = active ? { ...active } : null;
    if (state.activeCharacter) delete state.activeCharacter.progress;
    state.progress = active?.progress || {};
    localStorage.setItem(guestStoreKey, JSON.stringify(normalizedStore));
    localStorage.setItem(progressKey, JSON.stringify(state.progress));
  };

  const writeProgress = () => {
    localStorage.setItem(progressKey, JSON.stringify(state.progress));
    if (state.mode === "guest") saveGuestState();
  };

  const taskIsDone = (taskId) => Boolean(state.progress[taskId]);

  const zoneStats = (zone) => {
    const checkable = zone.tasks.filter((task) => !task.tip);
    const done = checkable.filter((task) => taskIsDone(task.id)).length;
    return { total: checkable.length, done };
  };

  const firstUnfinishedZoneMatch = (zones) => zones.find((zone) => {
    const stats = zoneStats(zone);
    return stats.total && stats.done < stats.total;
  }) || zones[0];

  const matchZoneName = (zoneName) => {
    const key = normalizeZoneName(zoneName);
    if (!key) return null;
    const exact = zoneAliasMap.get(normalizeZoneName(zoneName));
    if (exact?.length) return firstUnfinishedZoneMatch(exact.filter(Boolean));

    const fuzzy = routeZones.filter((zone) => {
      const zoneKey = normalizeZoneName(zone.title);
      return zoneKey && (zoneKey.includes(key) || key.includes(zoneKey));
    });
    return fuzzy.length ? firstUnfinishedZoneMatch(fuzzy) : null;
  };

  const v2CharacterMismatch = (status = state.logStatus) => {
    if (state.mode === "guest" && state.activeCharacter?.id === "guest_default") return false;
    const selectedName = normalizeIdentity(state.activeCharacter?.name);
    const detectedName = normalizeIdentity(status?.characterName);
    return Boolean(selectedName && detectedName && selectedName !== detectedName);
  };

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

  const syncTaskProgress = async (taskId, completed, source = "manual") => {
    if (!state.activeCharacter?.id) return;
    if (state.mode === "guest") {
      saveGuestState();
      return;
    }
    try {
      await requestJson(`/api/leveling/characters/${encodeURIComponent(state.activeCharacter.id)}/progress`, {
        method: "PUT",
        body: JSON.stringify({ taskId, completed, source })
      });
      state.characterError = "";
    } catch (error) {
      state.characterError = `Chưa lưu được progress: ${error.message}`;
      render();
    }
  };

  const phaseOneZoneFollow = (status) => {
    if (!state.autoFollow || !status?.zoneName || v2CharacterMismatch(status)) return null;
    const zone = matchZoneName(status.zoneName);
    if (!zone) return null;
    state.selectedZoneId = zone.id;
    localStorage.setItem(currentZoneKey, zone.id);
    return zone;
  };

  const renderTask = (zone, task) => {
    if (task.tip) {
      return `
        <article class="v2-task v2-task-info">
          <span class="material-symbols-rounded">info</span>
          <div class="min-w-0">
            <p class="v2-task-title">${task.text}</p>
            ${task.note ? `<p class="v2-task-note">${task.note}</p>` : ""}
          </div>
        </article>
      `;
    }

    const checked = taskIsDone(task.id) ? "checked" : "";
    return `
      <label class="v2-task ${checked ? "is-complete" : ""}">
        <input class="task-checkbox v2-task-check" type="checkbox" value="${escapeHtml(task.id)}" data-v2-zone="${escapeHtml(zone.id)}" ${checked}>
        <span class="min-w-0">
          <span class="v2-task-title">${task.text}</span>
          ${task.note ? `<span class="v2-task-note">${task.note}</span>` : ""}
        </span>
      </label>
    `;
  };

  const renderZoneButton = (zone) => {
    const stats = zoneStats(zone);
    const active = zone.id === state.selectedZoneId ? "is-active" : "";
    return `
      <button class="v2-zone-button ${active}" type="button" data-v2-zone-button="${escapeHtml(zone.id)}">
        <span class="truncate">${escapeHtml(zone.title)}</span>
        <span>${stats.done}/${stats.total}</span>
      </button>
    `;
  };

  const statusTone = () => {
    if (state.mode === "guest" && !state.logStatus) return "Guest mode";
    if (!state.logStatus) return "Chưa kết nối";
    if (v2CharacterMismatch()) return "Sai nhân vật";
    if (state.logStatus.zoneName) return "Đã bắt zone";
    if (state.logStatus.watching) return "Chờ zone";
    return "Offline";
  };

  const statusView = (status, mappedZone) => {
    if (!status || !status.updatedAt) {
      return {
        tone: "is-idle",
        title: "Chưa kết nối log",
        message: "Bấm Dò tự động, hoặc dán path folder logs / file Client.txt rồi bấm Kết nối path này."
      };
    }
    if (status.error === "Backend offline") {
      return {
        tone: "is-bad",
        title: "Backend chưa chạy",
        message: "Checklist vẫn chạy Guest mode bằng localStorage. Start backend ở port 3000 nếu muốn auto-log hoặc sync account."
      };
    }
    if (v2CharacterMismatch(status)) {
      return {
        tone: "is-warn",
        title: "Log đang là nhân vật khác",
        message: `Đang chọn "${state.activeCharacter.name}" nhưng log báo "${status.characterName}". Auto-follow đang tạm dừng để khỏi nhảy sai nhân vật.`
      };
    }
    if (status.activePath && status.zoneName) {
      return {
        tone: mappedZone ? "is-ok" : "is-warn",
        title: mappedZone ? "Đã kết nối log và map được zone" : "Đã đọc log nhưng chưa map được zone",
        message: mappedZone
          ? `Log báo "${status.zoneName}", checklist đang mở "${mappedZone.title}".`
          : `Log báo "${status.zoneName}" nhưng chưa có alias trong checklist V2.`
      };
    }
    if (status.activePath && status.watching) {
      return {
        tone: "is-warn",
        title: "Đã kết nối log, đang chờ zone",
        message: "File đọc được rồi. Hãy vào hoặc đổi zone trong game để log ghi dòng [SCENE] Set Source [...]."
      };
    }
    if (status.activePath) {
      return {
        tone: "is-warn",
        title: "Tìm thấy file log nhưng watcher đang dừng",
        message: "Bấm Kết nối path này để mở lại watcher."
      };
    }
    return {
      tone: "is-bad",
      title: "Không tìm thấy log",
      message: status.error || "Dán path folder logs hoặc Client.txt rồi thử lại."
    };
  };

  const renderAuthLoading = () => `
    <div class="v2-shell">
      <section class="v2-panel v2-status-panel">
        <div class="min-w-0">
          <p class="v2-eyebrow">Checklist V2</p>
          <h2 class="v2-title">Đang mở dữ liệu</h2>
          <p class="v2-muted">Nếu backend chưa chạy, Checklist V2 sẽ tự dùng Guest mode.</p>
        </div>
        <div class="v2-status-pill">Loading</div>
      </section>
    </div>
  `;

  const renderTopTestControls = () => `
    <div class="v2-top-controls">
      <label class="v2-toggle v2-toggle-compact" title="Phase 1: dùng để test tự nhảy zone theo Client.txt">
        <input id="v2AutoFollow" type="checkbox" ${state.autoFollow ? "checked" : ""}>
        <span>Auto-follow</span>
      </label>
      <div class="v2-status-pill">Phase 1</div>
      <div class="v2-status-pill">${statusTone()}</div>
    </div>
  `;

  const renderStatusPanel = ({ done, total }) => `
    <section class="v2-panel v2-status-panel">
      <div class="min-w-0">
        <p class="v2-eyebrow">Checklist V2</p>
        <h2 class="v2-title">Auto log tracker</h2>
        <p class="v2-muted">${done}/${total} task V2 đã check · ${state.mode === "guest" ? "Guest mode" : "Account sync"}</p>
      </div>
      ${renderTopTestControls()}
    </section>
  `;

  const renderAccountPanel = () => {
    if (!state.session.authenticated) {
      return `
        <section class="v2-panel">
          <div class="v2-current-head v2-character-head">
            <div class="min-w-0">
              <p class="v2-eyebrow">Account</p>
              <h3>Guest mode</h3>
              <p>Lưu trong localStorage của browser này. Login chỉ để backup/sync.</p>
            </div>
            <div class="v2-progress">Local</div>
          </div>
          <div class="v2-auth-actions">
            <button class="v2-primary" id="v2GoogleLogin" type="button" ${state.authConfig.googleEnabled ? "" : "disabled"}>
              <span class="material-symbols-rounded">account_circle</span>
              Continue with Google
            </button>
            ${state.authConfig.devLoginEnabled ? `
              <button class="v2-secondary" id="v2DevLogin" type="button">
                <span class="material-symbols-rounded">science</span>
                Local test
              </button>
            ` : ""}
          </div>
          <div class="v2-connection-banner ${state.authConfig.googleEnabled ? "is-ok" : "is-warn"}">
            <strong><span class="v2-status-dot" aria-hidden="true"></span>${state.authConfig.googleEnabled ? "Google OAuth đã bật" : "Đang dùng Guest mode"}</strong>
            <p>${state.authConfig.googleEnabled ? "Login để sync progress lên account." : "Google OAuth chưa cấu hình. Vẫn dùng checklist bình thường bằng localStorage."}</p>
          </div>
          ${state.authError ? `
            <div class="v2-connection-banner is-bad">
              <strong><span class="v2-status-dot" aria-hidden="true"></span>Lỗi auth</strong>
              <p>${escapeHtml(state.authError)}</p>
            </div>
          ` : ""}
        </section>
      `;
    }

    const user = state.session.user || {};
    return `
      <section class="v2-panel v2-user-row">
        <div class="v2-user-main">
          ${user.avatarUrl ? `<img class="v2-avatar" src="${escapeHtml(user.avatarUrl)}" alt="">` : `<span class="v2-avatar v2-avatar-fallback">${escapeHtml((user.displayName || user.email || "U").slice(0, 1).toUpperCase())}</span>`}
          <div class="min-w-0">
            <p class="v2-eyebrow">Account</p>
            <h3>${escapeHtml(user.displayName || user.email || "Logged in")}</h3>
            <p>${escapeHtml(user.email || "Session cookie active")}</p>
          </div>
        </div>
        <div class="v2-auth-actions">
          ${guestHasData() ? `
            <button class="v2-primary" id="v2SyncGuest" type="button">
              <span class="material-symbols-rounded">cloud_sync</span>
              Sync guest
            </button>
          ` : ""}
          <button class="v2-secondary" id="v2Logout" type="button">
            <span class="material-symbols-rounded">logout</span>
            Logout
          </button>
        </div>
      </section>
    `;
  };

  const renderCharacterPanel = () => {
    const status = state.logStatus || {};
    const detectedName = status.characterName || "";
    const detectedClass = status.characterClass || "";
    const detectedLevel = status.characterLevel || "";
    const mismatch = v2CharacterMismatch(status);
    return `
      <section class="v2-panel">
        <div class="v2-current-head v2-character-head">
          <div class="min-w-0">
            <p class="v2-eyebrow">Character</p>
            <h3>${escapeHtml(state.activeCharacter?.name || "Chưa chọn nhân vật")}</h3>
            <p>${state.activeCharacter ? `${escapeHtml(state.activeCharacter.className || "Class?")} · Lv ${escapeHtml(state.activeCharacter.level || "?")}` : "Tạo hoặc chọn nhân vật trước khi theo dõi log."}</p>
          </div>
          <div class="v2-progress">${state.characters.length}</div>
        </div>
        <div class="v2-character-grid">
          <label class="v2-field">
            <span>Nhân vật đang lưu</span>
            <select id="v2CharacterSelect" ${state.characters.length ? "" : "disabled"}>
              ${state.characters.length
                ? state.characters.map((character) => `<option value="${escapeHtml(character.id)}" ${character.id === state.activeCharacter?.id ? "selected" : ""}>${escapeHtml(character.name)} · ${escapeHtml(character.className || character.source || "Local")}</option>`).join("")
                : `<option>Chưa có</option>`}
            </select>
          </label>
          <label class="v2-field">
            <span>Tên nhân vật mới</span>
            <input id="v2NewCharacterName" type="text" value="${escapeHtml(detectedName)}" placeholder="Ví dụ: aaassssas">
            <small>Guest mode vẫn tạo được nhân vật riêng và lưu progress local.</small>
          </label>
          <label class="v2-field">
            <span>Class</span>
            <input id="v2NewCharacterClass" type="text" value="${escapeHtml(detectedClass)}" placeholder="Huntress">
          </label>
          <label class="v2-field">
            <span>Level</span>
            <input id="v2NewCharacterLevel" type="number" min="1" value="${escapeHtml(detectedLevel)}" placeholder="1">
          </label>
          <button class="v2-primary" id="v2CreateCharacter" type="button">
            <span class="material-symbols-rounded">person_add</span>
            Tạo / chọn
          </button>
        </div>
        ${mismatch ? `
          <div class="v2-connection-banner is-warn" id="v2CharacterMismatch">
            <strong><span class="v2-status-dot" aria-hidden="true"></span>Sai nhân vật</strong>
            <p>Đang chọn "${escapeHtml(state.activeCharacter.name)}" nhưng log báo "${escapeHtml(status.characterName)}". Auto-follow đã dừng.</p>
          </div>
        ` : ""}
        ${state.characterError ? `
          <div class="v2-connection-banner ${state.characterError.includes("Đã") ? "is-ok" : "is-bad"}">
            <strong><span class="v2-status-dot" aria-hidden="true"></span>Trạng thái</strong>
            <p>${escapeHtml(state.characterError)}</p>
          </div>
        ` : ""}
      </section>
    `;
  };

  const renderLogControls = (selectedZone, mappedZone, view, status) => `
    <section class="v2-panel">
      <div class="v2-controls">
        <label class="v2-field">
          <span>Path file hoặc folder log</span>
          <input id="v2LogPathInput" type="text" value="${escapeHtml(localStorage.getItem(logPathKey) || "")}" placeholder="C:\\Program Files (x86)\\...\\logs hoặc ...\\Client.txt">
          <small>Để trống rồi bấm Dò tự động nếu dùng folder cài mặc định.</small>
        </label>
        <button class="v2-secondary" id="v2AutoDetectLog" type="button">
          <span class="material-symbols-rounded">travel_explore</span>
          Dò tự động
        </button>
        <button class="v2-primary" id="v2ConnectLog" type="button">
          <span class="material-symbols-rounded">sync</span>
          Kết nối path này
        </button>
      </div>
      <div class="v2-connection-banner ${view.tone}">
        <strong><span class="v2-status-dot" aria-hidden="true"></span>${escapeHtml(view.title)}</strong>
        <p>${escapeHtml(view.message)}</p>
      </div>
      <div class="v2-signal-grid">
        <div>
          <span class="v2-label">Log zone</span>
          <strong>${escapeHtml(status.zoneName || "Chưa có")}</strong>
        </div>
        <div>
          <span class="v2-label">Map vào checklist</span>
          <strong>${escapeHtml(mappedZone?.title || "Chưa map")}</strong>
        </div>
        <div>
          <span class="v2-label">Nhân vật log</span>
          <strong title="${escapeHtml(status.characterName || "")}">${escapeHtml(status.characterName ? `${status.characterName} · ${status.characterClass || "Class?"} · Lv ${status.characterLevel || "?"}` : "Chưa thấy")}</strong>
        </div>
        <div>
          <span class="v2-label">Nhân vật lưu</span>
          <strong title="${escapeHtml(state.activeCharacter?.name || "")}">${escapeHtml(state.activeCharacter ? `${state.activeCharacter.name} · ${state.mode === "guest" ? "local" : "account"}` : "Chưa chọn")}</strong>
        </div>
        <div>
          <span class="v2-label">Phase</span>
          <strong title="Phase 1 chỉ chuyển zone theo Client.txt">Zone follow</strong>
        </div>
      </div>
      <div class="v2-test-row">
        <select id="v2ManualZone">
          ${routeZones.map((zone) => `<option value="${escapeHtml(zone.id)}" ${zone.id === selectedZone.id ? "selected" : ""}>${escapeHtml(zone.title)}</option>`).join("")}
        </select>
        <button id="v2UseManualZone" type="button">Dùng zone test</button>
      </div>
    </section>
  `;

  const render = () => {
    if (state.authLoading) {
      root.innerHTML = renderAuthLoading();
      return;
    }

    const selectedZone = zoneById.get(state.selectedZoneId) || routeZones[0];
    const stats = zoneStats(selectedZone);
    const total = flatTasks.filter(({ task }) => !task.tip).length;
    const done = flatTasks.filter(({ task }) => !task.tip && taskIsDone(task.id)).length;
    const status = state.logStatus || {};
    const mappedZone = status.zoneName ? matchZoneName(status.zoneName) : null;
    const view = statusView(status, mappedZone);

    root.innerHTML = `
      <div class="v2-shell">
        ${renderStatusPanel({ done, total })}

        ${renderAccountPanel()}
        ${renderCharacterPanel()}
        ${renderLogControls(selectedZone, mappedZone, view, status)}

        <section class="v2-layout">
          <aside class="v2-panel v2-zone-list">
            <div class="v2-list-head">
              <span>Route zones</span>
              <span>${routeZones.length}</span>
            </div>
            <div class="v2-zone-scroll">
              ${routeZones.map(renderZoneButton).join("")}
            </div>
          </aside>

          <main class="v2-panel v2-current">
            <div class="v2-current-head">
              <div class="min-w-0">
                <p class="v2-eyebrow">${escapeHtml(actLabels[selectedZone.act || "act1"] || selectedZone.act || "Act")}</p>
                <h3>${escapeHtml(selectedZone.title)}</h3>
                <p>${escapeHtml(selectedZone.level || selectedZone.meta || "")}</p>
              </div>
              <div class="v2-progress">${stats.done}/${stats.total}</div>
            </div>
            <div class="v2-task-list">
              ${selectedZone.tasks.map((task) => renderTask(selectedZone, task)).join("")}
            </div>
          </main>
        </section>
      </div>
    `;
  };

  const applyLevelingState = (payload) => {
    state.mode = "account";
    state.characters = payload.characters || [];
    state.activeCharacter = payload.activeCharacter || null;
    state.progress = payload.progress || {};
    localStorage.setItem(progressKey, JSON.stringify(state.progress));
  };

  const loadLevelingState = async (characterId = "") => {
    const suffix = characterId ? `?characterId=${encodeURIComponent(characterId)}` : "";
    const payload = await requestJson(`/api/leveling/me${suffix}`);
    applyLevelingState(payload.data);
  };

  const refreshAuth = async () => {
    state.authLoading = true;
    render();
    try {
      const [config, session] = await Promise.all([
        requestJson("/api/auth/config"),
        requestJson("/api/auth/session")
      ]);
      state.authConfig = config.data;
      state.session = session.data;
      state.authError = "";
      if (state.session.authenticated) {
        await loadLevelingState();
      } else {
        applyGuestState();
      }
    } catch (error) {
      state.authError = error.message || "Backend offline";
      state.session = { authenticated: false, user: null, providers: [] };
      applyGuestState();
    } finally {
      state.authLoading = false;
      render();
    }
  };

  const selectZone = (zoneId, options = {}) => {
    if (!zoneById.has(zoneId)) return;
    state.selectedZoneId = zoneId;
    localStorage.setItem(currentZoneKey, zoneId);
    render();
    if (options.scroll) {
      document.getElementById("checklist-v2")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const applyLogStatus = (status) => {
    state.logStatus = status;
    phaseOneZoneFollow(status);
    render();
  };

  const refreshStatus = async () => {
    try {
      const payload = await requestJson("/api/leveling/log/status");
      applyLogStatus(payload.data);
    } catch {
      applyLogStatus({ watching: false, error: "Backend offline", zoneName: null });
    }
  };

  const connectLog = async (pathOverride = null) => {
    const input = document.getElementById("v2LogPathInput");
    const path = pathOverride === null ? (input?.value.trim() || "") : pathOverride;
    if (input && pathOverride !== null) input.value = pathOverride;
    localStorage.setItem(logPathKey, path);
    try {
      const payload = await requestJson("/api/leveling/log/config", {
        method: "POST",
        body: JSON.stringify({ path })
      });
      applyLogStatus(payload.data);
      connectEvents();
    } catch {
      applyLogStatus({ watching: false, error: "Backend offline", zoneName: null });
    }
  };

  const connectEvents = () => {
    if (!window.EventSource || state.eventSource) return;
    try {
      const source = new EventSource(`${apiBase}/api/leveling/log/events`, { withCredentials: true });
      source.addEventListener("status", (event) => applyLogStatus(JSON.parse(event.data)));
      source.addEventListener("zone", (event) => applyLogStatus(JSON.parse(event.data)));
      source.addEventListener("log-event", (event) => applyLogStatus(JSON.parse(event.data).status));
      source.onerror = () => {
        state.eventSource?.close();
        state.eventSource = null;
      };
      state.eventSource = source;
    } catch {
      state.eventSource = null;
    }
  };

  const createCharacter = async () => {
    const name = document.getElementById("v2NewCharacterName")?.value.trim() || state.logStatus?.characterName || "";
    const className = document.getElementById("v2NewCharacterClass")?.value.trim() || state.logStatus?.characterClass || "";
    const levelValue = document.getElementById("v2NewCharacterLevel")?.value || state.logStatus?.characterLevel || "";
    if (!name) {
      state.characterError = "Nhập tên nhân vật trước.";
      render();
      return;
    }

    const level = levelValue ? Number(levelValue) : null;
    if (state.mode === "guest") {
      const store = loadGuestState();
      const existing = store.characters.find((character) => normalizeIdentity(character.name) === normalizeIdentity(name));
      const character = existing || {
        id: `guest_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name,
        className,
        level,
        source: "guest",
        logPath: state.logStatus?.activePath || localStorage.getItem(logPathKey) || "",
        logStartOffset: Number(state.logStatus?.bytesRead || 0),
        progress: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      character.name = name;
      character.className = className;
      character.level = level;
      character.logPath = state.logStatus?.activePath || character.logPath || "";
      character.logStartOffset = Number(state.logStatus?.bytesRead ?? character.logStartOffset ?? 0);
      const nextStore = {
        activeCharacterId: character.id,
        characters: existing
          ? store.characters.map((entry) => (entry.id === character.id ? character : entry))
          : [...store.characters, character]
      };
      localStorage.setItem(guestStoreKey, JSON.stringify(nextStore));
      applyGuestState(nextStore);
      state.characterError = "";
      render();
      return;
    }

    try {
      const payload = await requestJson("/api/leveling/characters", {
        method: "POST",
        body: JSON.stringify({ name, className, level, source: "manual" })
      });
      applyLevelingState(payload.data);
      state.characterError = "";
      render();
    } catch (error) {
      state.characterError = error.message;
      render();
    }
  };

  const selectCharacter = async (characterId) => {
    if (!characterId) return;
    if (state.mode === "guest") {
      const store = loadGuestState();
      store.activeCharacterId = characterId;
      applyGuestState(store);
      saveGuestState();
      render();
      return;
    }

    try {
      const payload = await requestJson(`/api/leveling/characters/${encodeURIComponent(characterId)}/select`, {
        method: "POST",
        body: "{}"
      });
      applyLevelingState(payload.data);
      state.characterError = "";
      render();
    } catch (error) {
      state.characterError = error.message;
      render();
    }
  };

  const syncGuestData = async () => {
    if (!state.session.authenticated) return;
    const characters = guestCharactersForSync();
    if (!characters.length) {
      state.characterError = "Không có guest data cần sync.";
      render();
      return;
    }

    try {
      for (const character of characters) {
        const created = await requestJson("/api/leveling/characters", {
          method: "POST",
          body: JSON.stringify({
            name: character.name,
            className: character.className,
            level: character.level,
            source: "guest-import",
            logPath: character.logPath,
            logStartOffset: character.logStartOffset
          })
        });
        const importedId = created.data.activeCharacter?.id;
        for (const [taskId, completed] of Object.entries(character.progress || {})) {
          await requestJson(`/api/leveling/characters/${encodeURIComponent(importedId)}/progress`, {
            method: "PUT",
            body: JSON.stringify({ taskId, completed: Boolean(completed), source: "guest-import" })
          });
        }
      }
      await loadLevelingState();
      state.characterError = "Đã sync guest data lên account.";
      render();
    } catch (error) {
      state.characterError = `Sync guest thất bại: ${error.message}`;
      render();
    }
  };

  const setActiveTab = (tabName) => {
    document.querySelectorAll("[data-checklist-tab]").forEach((button) => {
      const active = button.dataset.checklistTab === tabName;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
    document.querySelectorAll("[data-checklist-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.checklistPanel !== tabName;
    });
    localStorage.setItem(activeTabKey, tabName);
    if (tabName === "v2") {
      refreshStatus();
      connectEvents();
      if (state.authLoading) refreshAuth();
    }
  };

  root.addEventListener("change", (event) => {
    const checkbox = event.target.closest(".v2-task-check");
    if (checkbox) {
      state.progress[checkbox.value] = checkbox.checked;
      writeProgress();
      syncTaskProgress(checkbox.value, checkbox.checked, "manual");
      render();
      return;
    }

    if (event.target.id === "v2AutoFollow") {
      state.autoFollow = event.target.checked;
      localStorage.setItem(autoFollowKey, state.autoFollow ? "true" : "false");
      render();
      return;
    }

    if (event.target.id === "v2CharacterSelect") {
      selectCharacter(event.target.value);
    }
  });

  root.addEventListener("click", (event) => {
    const zoneButton = event.target.closest("[data-v2-zone-button]");
    if (zoneButton) {
      selectZone(zoneButton.dataset.v2ZoneButton);
      return;
    }

    if (event.target.closest("#v2GoogleLogin")) {
      window.location.href = `${apiBase}/api/auth/google/start?returnTo=${encodeURIComponent("/leveling.html")}`;
      return;
    }

    if (event.target.closest("#v2DevLogin")) {
      requestJson("/api/auth/dev-login", { method: "POST", body: "{}" })
        .then(() => refreshAuth())
        .catch((error) => {
          state.authError = error.message;
          render();
        });
      return;
    }

    if (event.target.closest("#v2SyncGuest")) {
      syncGuestData();
      return;
    }

    if (event.target.closest("#v2Logout")) {
      requestJson("/api/auth/logout", { method: "POST", body: "{}" })
        .finally(() => {
          state.session = { authenticated: false, user: null, providers: [] };
          applyGuestState();
          render();
        });
      return;
    }

    if (event.target.closest("#v2CreateCharacter")) {
      createCharacter();
      return;
    }

    if (event.target.closest("#v2ConnectLog")) {
      connectLog();
      return;
    }

    if (event.target.closest("#v2AutoDetectLog")) {
      connectLog("");
      return;
    }

    if (event.target.closest("#v2UseManualZone")) {
      const select = document.getElementById("v2ManualZone");
      selectZone(select?.value);
    }
  });

  document.querySelectorAll("[data-checklist-tab]").forEach((button) => {
    button.addEventListener("click", () => setActiveTab(button.dataset.checklistTab));
  });

  applyGuestState();
  render();
  setActiveTab(localStorage.getItem(activeTabKey) || "classic");
})();
