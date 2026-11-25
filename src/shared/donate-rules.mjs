// Rules shared by the donate API and the donate page: amounts, transfer codes,
// supporter tiers and the text a donor may enter.

export const DONATE_MIN_AMOUNT = 10000;
export const DONATE_MAX_AMOUNT = 500000000;
export const DONATE_QUICK_AMOUNTS = [20000, 50000, 100000, 200000];
export const DONATE_NAME_MAX = 40;
export const DONATE_MESSAGE_MAX = 140;

export const DONATE_CODE_PREFIX = "POE";
// No 0/O, 1/I/L: bank apps and people mix them up.
export const DONATE_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const DONATE_CODE_LENGTH = 6;
export const DONATE_CODE_PATTERN = /^POE[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;

/** Supporter tiers by total donated (VND), highest first. Named after PoE item rarities; they unlock nothing. */
export const DONATE_TIERS = [
  { id: "mirror", label: "Mirror", min: 2000000 },
  { id: "unique", label: "Unique", min: 500000 },
  { id: "rare", label: "Rare", min: 100000 },
  { id: "magic", label: "Magic", min: 20000 }
];

/** Tier for a total, or null below the first threshold. */
export function donateTier(total) {
  const value = Number(total) || 0;
  return DONATE_TIERS.find((tier) => value >= tier.min) ?? null;
}

/** The next tier above a total and how much is missing, or null at the top. */
export function nextDonateTier(total) {
  const value = Number(total) || 0;
  const above = DONATE_TIERS.filter((tier) => value < tier.min);
  const next = above[above.length - 1];
  return next ? { ...next, missing: next.min - value } : null;
}

/** Whole VND inside the allowed range, or null. */
export function normalizeDonateAmount(value) {
  const amount = Math.floor(Number(value));
  if (!Number.isFinite(amount) || amount < DONATE_MIN_AMOUNT || amount > DONATE_MAX_AMOUNT) return null;
  return amount;
}

/** One line of plain text: control and invisible formatting characters removed, spaces collapsed, cut to `max`. */
export function cleanDonateText(value, max) {
  return [...String(value ?? "")
    // C0/C1 controls, zero-width and bidi controls, BOM.
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/g, " ")
    .replace(/\s+/g, " ")
    .trim()]
    .slice(0, max)
    .join("")
    .trim();
}

/** A code found in a bank transfer description (banks upper-case it and may insert spaces or dashes). */
export function findDonateCode(text) {
  const squashed = String(text ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const match = squashed.match(/POE[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}/);
  return match ? match[0] : null;
}
