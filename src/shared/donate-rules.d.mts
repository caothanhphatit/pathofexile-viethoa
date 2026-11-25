export declare const DONATE_MIN_AMOUNT: number;
export declare const DONATE_MAX_AMOUNT: number;
export declare const DONATE_QUICK_AMOUNTS: number[];
export declare const DONATE_NAME_MAX: number;
export declare const DONATE_MESSAGE_MAX: number;
export declare const DONATE_CODE_PREFIX: string;
export declare const DONATE_CODE_ALPHABET: string;
export declare const DONATE_CODE_LENGTH: number;
export declare const DONATE_CODE_PATTERN: RegExp;
export interface DonateTier {
  id: "mirror" | "unique" | "rare" | "magic";
  label: string;
  min: number;
}
export declare const DONATE_TIERS: DonateTier[];
export declare function donateTier(total: number): DonateTier | null;
export declare function nextDonateTier(total: number): (DonateTier & { missing: number }) | null;
export declare function normalizeDonateAmount(value: unknown): number | null;
export declare function cleanDonateText(value: unknown, max: number): string;
export declare function findDonateCode(text: unknown): string | null;
