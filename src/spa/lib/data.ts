type GlobalName =
  | "POE2_SKILL_GEMS"
  | "POE2_CURRENCY"
  | "POE2_ITEMS"
  | "POE2_DICTIONARY_TERMS"
  | "POE2_BUILD_PLANNER_DATA"
  | "POE2_PASSIVE_TREE"
  | "POE2_PASSIVE_TREE_CHANGES"
  | "POE2_CRAFT"
  | "POE2_CRAFT_INDEX"
  | "levelingRouteZones";

const pendingScripts = new Map<string, Promise<unknown>>();
const passiveTreeDataVersion = "20260528-pruned-nodes";
const itemsDataVersion = "20260529-item-categories";
const skillGemsDataVersion = "20260529-gem-sot-official";
const dictionaryDataVersion = "20260529-gem-sot";

export function loadScriptGlobal<T>(src: string, globalName: GlobalName): Promise<T> {
  const current = window[globalName as keyof Window] as T | undefined;
  if (current) return Promise.resolve(current);

  const key = `${src}:${globalName}`;
  const pending = pendingScripts.get(key);
  if (pending) return pending as Promise<T>;

  const promise = new Promise<T>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[data-spa-global="${globalName}"]`);
    const script = existing ?? document.createElement("script");

    const done = () => {
      const value = window[globalName as keyof Window] as T | undefined;
      if (value) resolve(value);
      else reject(new Error(`Global ${globalName} was not defined by ${src}`));
    };

    script.addEventListener("load", done, { once: true });
    script.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)), { once: true });

    if (!existing) {
      script.src = src;
      script.defer = true;
      script.dataset.spaGlobal = globalName;
      document.head.appendChild(script);
    }
  });

  pendingScripts.set(key, promise);
  return promise;
}

export const loadSkillGemsData = () => loadScriptGlobal<any>(`/data/skill-gems-data.js?v=${skillGemsDataVersion}`, "POE2_SKILL_GEMS");
export const loadCurrencyData = () => loadScriptGlobal<any>("/data/currency-data.js", "POE2_CURRENCY");
export const loadItemsData = () => loadScriptGlobal<any>(`/data/items-data.js?v=${itemsDataVersion}`, "POE2_ITEMS");
export const loadDictionaryData = () => loadScriptGlobal<any>(`/data/dictionary-data.js?v=${dictionaryDataVersion}`, "POE2_DICTIONARY_TERMS");
export const loadBuildPlannerData = () => loadScriptGlobal<any>("/data/build-planner-data.js", "POE2_BUILD_PLANNER_DATA");
export const loadPassiveTreeData = () => loadScriptGlobal<any>(`/data/passive-tree-data.js?v=${passiveTreeDataVersion}`, "POE2_PASSIVE_TREE");
export const loadPassiveTreeChanges = () => loadScriptGlobal<any>(`/data/passive-tree-changes.js?v=${passiveTreeDataVersion}`, "POE2_PASSIVE_TREE_CHANGES");
export const loadLevelingData = () => loadScriptGlobal<any[]>("/data/leveling-data.js", "levelingRouteZones");
export const loadCraftData = () => loadScriptGlobal<any>("/data/craft-data.js?v=20260610", "POE2_CRAFT");
export const loadCraftIndex = () => loadScriptGlobal<any>("/data/craft-index.js?v=20260610", "POE2_CRAFT_INDEX");

export function useAsyncData<T>(loader: () => Promise<T>, onData: (value: T) => void, onError: (error: Error) => void): () => void {
  let cancelled = false;
  loader().then((value) => {
    if (!cancelled) onData(value);
  }).catch((error: Error) => {
    if (!cancelled) onError(error);
  });
  return () => {
    cancelled = true;
  };
}
