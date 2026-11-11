// Runs the browser-side Build Planner library (src/spa/lib/buildPlanner.ts) under Node:
// transpiles it with TypeScript and gives it a small XML DOMParser built on
// htmlparser2 + css-select (Node already has atob, DecompressionStream, Blob, Response).
// Used by scripts/check-pob-parity.mjs and the planner tests.
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const { parseDocument } = require("htmlparser2");
const CSSselect = require("css-select");
const render = require("dom-serializer").default;
const { textContent } = require("domutils");
const ts = require("typescript");

export const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

const selectOptions = { xmlMode: true };

class XmlElement {
  constructor(node) {
    this.node = node;
  }
  get tagName() {
    return this.node.name;
  }
  get textContent() {
    return textContent(this.node);
  }
  get outerHTML() {
    return render(this.node, { xmlMode: true, decodeEntities: false });
  }
  getAttribute(key) {
    return Object.prototype.hasOwnProperty.call(this.node.attribs ?? {}, key) ? this.node.attribs[key] : null;
  }
  hasAttribute(key) {
    return this.getAttribute(key) !== null;
  }
  querySelector(selector) {
    const found = CSSselect.selectOne(selector, this.node.children ?? [], selectOptions);
    return found ? new XmlElement(found) : null;
  }
  querySelectorAll(selector) {
    return CSSselect.selectAll(selector, this.node.children ?? [], selectOptions).map((node) => new XmlElement(node));
  }
}

export class NodeDOMParser {
  parseFromString(xml) {
    const doc = parseDocument(String(xml).replace(/^\s*<\?xml[^>]*\?>/, ""), { xmlMode: true, decodeEntities: true });
    const root = doc.children.find((node) => node.type === "tag");
    return {
      documentElement: root ? new XmlElement(root) : null,
      // A malformed document has no root; parsePobXmlDocument reports that.
      querySelector: (selector) => (selector === "parsererror" ? null : new XmlElement(doc).querySelector(selector))
    };
  }
}

let cached;
/** The planner library as a CommonJS module object. */
export async function loadPlannerLib() {
  if (cached) return cached;
  const source = await readFile(join(repoRoot, "src/spa/lib/buildPlanner.ts"), "utf8");
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 }
  }).outputText;
  const module = { exports: {} };
  const context = vm.createContext({
    module,
    exports: module.exports,
    require,
    console,
    DOMParser: NodeDOMParser,
    XMLSerializer: class { serializeToString(element) { return element.outerHTML; } },
    TextDecoder,
    DecompressionStream,
    CompressionStream,
    TextEncoder,
    btoa,
    Blob,
    Response,
    atob,
    URL,
    setTimeout
  });
  vm.runInContext(js, context);
  cached = module.exports;
  return cached;
}

/** public/data/build-planner-data.js, as the page loads it (ascendancy and passive ids). */
export function loadPlannerData() {
  const context = { window: {} };
  vm.runInNewContext(readFileSync(join(repoRoot, "public/data/build-planner-data.js"), "utf8"), context);
  return context.window.POE2_BUILD_PLANNER_DATA ?? null;
}

const DEFAULT_SLOTS = [
  "Weapon1", "Weapon2", "Weapon3", "Weapon4",
  "Helm1", "BodyArmour1", "Gloves1", "Boots1",
  "Amulet1", "Ring1", "Ring2", "Ring3", "Belt1",
  "LifeFlask1", "ManaFlask1",
  "Charm1", "Charm2", "Charm3", "Trinket1"
];

const emptyChoice = (slotId) => ({ id: `item-${slotId}`, inventoryId: slotId, itemName: "", note: "", isUnique: false, levelStart: "", levelEnd: "" });

/**
 * What the planner page does with a PoB code: import it, build the planner state
 * from the payload, save the build to the browser and open it again (as after F5),
 * then produce the POST /api/builds/calculate body.
 */
export async function plannerCalculationRequest(code, { activeWeaponSet } = {}) {
  const lib = await loadPlannerLib();
  const data = await lib.parsePobExportCode(code);
  const payload = lib.buildPayloadFromPobImport(data, { inventorySlotIds: DEFAULT_SLOTS, plannerData: loadPlannerData() });
  const imported = lib.createBuildProject({
    name: "parity",
    author: "",
    description: "",
    inventory: lib.inventoryChoicesFromBuildPayload(payload, DEFAULT_SLOTS),
    skills: lib.skillChoicesFromBuildPayload(payload),
    importedPayload: payload
  });
  // localStorage round trip.
  const project = lib.normalizeBuildProject(JSON.parse(JSON.stringify(imported)));
  const inventory = lib.inventoryForSlots(project.inventory, DEFAULT_SLOTS, emptyChoice);
  const passives = lib.passiveIdsFromPobImport(data);
  const xml = await lib.decodePobXmlText(code);
  const body = lib.calculationRequestBody({
    payload: project.importedPayload,
    passives,
    inventory,
    skills: project.skills,
    activeWeaponSet: activeWeaponSet ?? (Number(payload.active_weapon_set) === 2 ? 2 : 1),
    mainSocketGroup: Number(project.importedPayload.mainSocketGroup) || 1
  });
  return { data, payload, body, xml };
}
