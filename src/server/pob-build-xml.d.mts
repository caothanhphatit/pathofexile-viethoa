// Types for pob-build-xml.mjs, which the SPA also imports to export PoB codes.
export declare const escapeXml: (value: unknown) => string;
export declare const mapGemId: (skillId: string) => string;
export declare const POB_SLOT_NAMES: Record<string, string>;
export declare const POB_GEM_EXTRA_ATTRIBUTES: string[];
export declare const configXml: (inputs: unknown) => string;
/** PathOfBuilding2 XML for a POST /api/builds/calculate body. */
export declare function buildPobXml(build?: Record<string, unknown>): string;
