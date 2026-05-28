import { useEffect } from "react";
import { loadDictionaryData } from "./data";
import { dictionaryCategoryLabel, dictionaryMeaning, normalizeLocale, type Locale } from "./locale";
import { asArray, cleanText } from "./text";

interface PoeDictionaryTerm {
  term?: string;
  category?: string;
  meaning?: string;
  description_en?: string;
  variants?: unknown;
  examples?: unknown;
}

interface PoeDictionaryData {
  categories?: Record<string, string>;
  terms?: PoeDictionaryTerm[];
}

interface TermIndex {
  terms: PoeDictionaryTerm[];
  categories: Record<string, string>;
  map: Map<string, PoeDictionaryTerm>;
  regex: RegExp | null;
}

const EXCLUDE_SELECTOR = [
  "a",
  "button",
  "select",
  "option",
  "input",
  "textarea",
  "[role='button']",
  "script",
  "style",
  "template",
  "noscript",
  "pre",
  "code",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  ".app-header",
  ".nav-rail",
  ".app-actions",
  ".passive-toolbar",
  ".passive-tooltip",
  ".poe-term",
  ".poe-tooltip-box",
  ".poe-term-modal",
  "[translate='no']",
  "[data-no-tooltip]",
  ".no-tooltip",
  ".poe-no-tooltip"
].join(", ");

const escapeRegex = (value: string): string => value.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");

const escapeHtml = (value: unknown): string => cleanText(value)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

function buildTermIndex(data: PoeDictionaryData): TermIndex {
  const terms = asArray<PoeDictionaryTerm>(data?.terms);
  const categories = data?.categories ?? {};
  const map = new Map<string, PoeDictionaryTerm>();
  const patternKeys = new Set<string>();
  const patterns: string[] = [];

  const addAlias = (value: unknown, term: PoeDictionaryTerm) => {
    const text = cleanText(value);
    if (!text) return;
    const key = text.toLowerCase();
    if (!map.has(key)) map.set(key, term);
    if (!patternKeys.has(key)) {
      patternKeys.add(key);
      patterns.push(escapeRegex(text));
    }
  };

  for (const term of terms) {
    addAlias(term.term, term);
    for (const variant of asArray(term.variants)) addAlias(variant, term);
  }

  patterns.sort((a, b) => b.length - a.length);

  return {
    terms,
    categories,
    map,
    regex: patterns.length ? new RegExp(`\\b(${patterns.join("|")})\\b`, "gi") : null
  };
}

function findTerm(index: TermIndex, value: unknown): PoeDictionaryTerm | null {
  const key = cleanText(value).toLowerCase();
  if (!key) return null;
  return index.map.get(key) ?? index.terms.find((term) => cleanText(term.term).toLowerCase() === key) ?? null;
}

function termCategoryLabel(index: TermIndex, term: PoeDictionaryTerm, locale: Locale): string {
  return dictionaryCategoryLabel(term.category, locale, index.categories?.[cleanText(term.category)]);
}

function termMeaning(term: PoeDictionaryTerm, locale: Locale): string {
  return dictionaryMeaning(term as Record<string, unknown>, locale) || (locale === "en" ? "No description yet." : "Chưa có mô tả.");
}

function termOriginal(term: PoeDictionaryTerm, locale: Locale): string {
  if (locale === "en") return cleanText(term.description_en) ? cleanText(term.meaning) : "";
  return cleanText(term.description_en);
}

function isTooltipUiElement(node: Node): boolean {
  if (!(node instanceof Element)) return false;
  return Boolean(node.closest(".poe-tooltip-box, .poe-term-modal"));
}

function walkTextNodes(root: Node, callback: (node: Text) => void): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => {
      if (!cleanText(node.nodeValue)) return NodeFilter.FILTER_REJECT;
      const parent = node.parentElement;
      if (!parent || parent.closest(EXCLUDE_SELECTOR)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  const nodes: Text[] = [];
  while (walker.nextNode()) {
    nodes.push(walker.currentNode as Text);
  }
  for (const node of nodes) callback(node);
}

function wrapTermsInTextNode(node: Text, index: TermIndex): void {
  const regex = index.regex;
  if (!regex || !node.parentNode) return;

  const text = node.nodeValue ?? "";
  regex.lastIndex = 0;

  let match: RegExpExecArray | null;
  let lastIndex = 0;
  let hasMatches = false;
  const fragment = document.createDocumentFragment();

  while ((match = regex.exec(text)) !== null) {
    const matchText = match[0];
    const term = findTerm(index, matchText);
    if (!term) continue;

    hasMatches = true;
    if (match.index > lastIndex) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className = "poe-term";
    button.dataset.term = cleanText(term.term);
    button.textContent = matchText;
    fragment.appendChild(button);

    lastIndex = regex.lastIndex;
  }

  if (!hasMatches) return;
  if (lastIndex < text.length) {
    fragment.appendChild(document.createTextNode(text.slice(lastIndex)));
  }
  node.parentNode.replaceChild(fragment, node);
}

function applyTooltips(root: Node, index: TermIndex): void {
  if (!index.regex || isTooltipUiElement(root)) return;
  walkTextNodes(root, (node) => wrapTermsInTextNode(node, index));
}

function termElementFromEvent(event: Event): HTMLElement | null {
  const target = event.target;
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLElement>(".poe-term");
}

function relatedTargetInside(target: HTMLElement, relatedTarget: EventTarget | null): boolean {
  return relatedTarget instanceof Node && target.contains(relatedTarget);
}

function positionTooltip(tooltip: HTMLElement, target: HTMLElement): void {
  const targetRect = target.getBoundingClientRect();
  const tooltipRect = tooltip.getBoundingClientRect();
  let top = targetRect.top - tooltipRect.height - 8;
  let left = targetRect.left + (targetRect.width - tooltipRect.width) / 2;

  if (top < 8) top = targetRect.bottom + 8;
  if (left < 8) left = 8;
  if (left + tooltipRect.width > window.innerWidth - 8) left = window.innerWidth - tooltipRect.width - 8;

  tooltip.style.top = `${top}px`;
  tooltip.style.left = `${left}px`;
}

function modalLabels(locale: Locale) {
  return locale === "en"
    ? { close: "Close", original: "Original", related: "Related terms" }
    : { close: "Đóng", original: "Gốc tiếng Anh", related: "Biến thể" };
}

export function usePoeTermTooltips(localeValue: Locale, routeKey: string): void {
  const locale = normalizeLocale(localeValue);

  useEffect(() => {
    if (routeKey === "dictionary") return undefined;

    let cancelled = false;
    let observer: MutationObserver | null = null;
    let tooltipEl: HTMLElement | null = null;
    let modalEl: HTMLElement | null = null;
    let lastFocusedTermEl: HTMLElement | null = null;
    let removeListeners = () => {};

    const ensureTooltip = () => {
      if (!tooltipEl) {
        tooltipEl = document.createElement("div");
        tooltipEl.className = "poe-tooltip-box";
        document.body.appendChild(tooltipEl);
      }
      return tooltipEl;
    };

    const closeModal = () => {
      if (!modalEl) return;
      modalEl.classList.remove("is-open");
      modalEl.setAttribute("aria-hidden", "true");
      lastFocusedTermEl?.focus();
      lastFocusedTermEl = null;
    };

    const ensureModal = () => {
      if (modalEl) return modalEl;
      const labels = modalLabels(locale);
      modalEl = document.createElement("div");
      modalEl.className = "poe-term-modal";
      modalEl.setAttribute("aria-hidden", "true");
      modalEl.innerHTML = `
        <section class="poe-term-modal__panel" role="dialog" aria-modal="true" aria-labelledby="poeTermModalTitle">
          <div class="poe-term-modal__header">
            <div>
              <span class="poe-term-modal__category" id="poeTermModalCategory"></span>
              <h2 id="poeTermModalTitle" translate="no"></h2>
            </div>
            <button class="poe-term-modal__close" type="button" aria-label="${escapeHtml(labels.close)}" data-poe-term-close>
              <span class="material-symbols-rounded" aria-hidden="true">close</span>
            </button>
          </div>
          <div class="poe-term-modal__body">
            <p id="poeTermModalMeaning"></p>
            <div class="poe-term-modal__block" id="poeTermModalOriginalWrap" hidden>
              <strong>${escapeHtml(labels.original)}</strong>
              <p id="poeTermModalOriginal" translate="no"></p>
            </div>
            <div class="poe-term-modal__block" id="poeTermModalVariantsWrap" hidden>
              <strong>${escapeHtml(labels.related)}</strong>
              <div class="poe-term-modal__chips" id="poeTermModalVariants"></div>
            </div>
          </div>
        </section>
      `;
      modalEl.addEventListener("click", (event) => {
        const target = event.target;
        if (target === modalEl || (target instanceof Element && target.closest("[data-poe-term-close]"))) closeModal();
      });
      document.body.appendChild(modalEl);
      return modalEl;
    };

    const showTooltip = (target: HTMLElement, index: TermIndex) => {
      const term = findTerm(index, target.dataset.term);
      if (!term) return;
      const tooltip = ensureTooltip();
      tooltip.innerHTML = `
        <div class="poe-tooltip-box__head">
          <strong translate="no">${escapeHtml(term.term)}</strong>
          <span>${escapeHtml(termCategoryLabel(index, term, locale))}</span>
        </div>
        <p>${escapeHtml(termMeaning(term, locale))}</p>
      `;
      tooltip.classList.add("is-visible");
      positionTooltip(tooltip, target);
    };

    const hideTooltip = () => {
      tooltipEl?.classList.remove("is-visible");
    };

    const openModal = (target: HTMLElement, index: TermIndex) => {
      const term = findTerm(index, target.dataset.term);
      if (!term) return;
      hideTooltip();

      const modal = ensureModal();
      const labels = modalLabels(locale);
      const category = modal.querySelector<HTMLElement>("#poeTermModalCategory");
      const title = modal.querySelector<HTMLElement>("#poeTermModalTitle");
      const meaning = modal.querySelector<HTMLElement>("#poeTermModalMeaning");
      const originalWrap = modal.querySelector<HTMLElement>("#poeTermModalOriginalWrap");
      const original = modal.querySelector<HTMLElement>("#poeTermModalOriginal");
      const variantsWrap = modal.querySelector<HTMLElement>("#poeTermModalVariantsWrap");
      const variants = modal.querySelector<HTMLElement>("#poeTermModalVariants");
      const closeButton = modal.querySelector<HTMLElement>("[data-poe-term-close]");

      if (category) category.textContent = termCategoryLabel(index, term, locale);
      if (title) title.textContent = cleanText(term.term || target.textContent);
      if (meaning) meaning.textContent = termMeaning(term, locale);
      closeButton?.setAttribute("aria-label", labels.close);

      const originalText = termOriginal(term, locale);
      if (originalWrap && original) {
        original.textContent = originalText;
        originalWrap.hidden = !originalText;
      }

      const related = [...new Set([...asArray(term.variants), ...asArray(term.examples)].map(cleanText))]
        .filter((value) => value && value.toLowerCase() !== cleanText(term.term).toLowerCase())
        .slice(0, 4);
      if (variantsWrap && variants) {
        variants.innerHTML = related.map((value) => `<span translate="no">${escapeHtml(value)}</span>`).join("");
        variantsWrap.hidden = related.length === 0;
      }

      lastFocusedTermEl = document.activeElement instanceof HTMLElement ? document.activeElement.closest<HTMLElement>(".poe-term") : null;
      modal.classList.add("is-open");
      modal.setAttribute("aria-hidden", "false");
      modal.querySelector<HTMLElement>("[data-poe-term-close]")?.focus();
    };

    loadDictionaryData()
      .then((data) => {
        if (cancelled) return;
        const index = buildTermIndex(data as PoeDictionaryData);
        if (!index.regex) return;

        const onPointerOver = (event: PointerEvent) => {
          const target = termElementFromEvent(event);
          if (!target || relatedTargetInside(target, event.relatedTarget)) return;
          showTooltip(target, index);
        };

        const onPointerOut = (event: PointerEvent) => {
          const target = termElementFromEvent(event);
          if (!target || relatedTargetInside(target, event.relatedTarget)) return;
          hideTooltip();
        };

        const onClick = (event: MouseEvent) => {
          const target = termElementFromEvent(event);
          if (!target) return;
          event.preventDefault();
          event.stopPropagation();
          openModal(target, index);
        };

        const onKeyDown = (event: KeyboardEvent) => {
          if (event.key === "Escape") closeModal();
        };

        document.addEventListener("pointerover", onPointerOver);
        document.addEventListener("pointerout", onPointerOut);
        document.addEventListener("click", onClick);
        document.addEventListener("keydown", onKeyDown);
        removeListeners = () => {
          document.removeEventListener("pointerover", onPointerOver);
          document.removeEventListener("pointerout", onPointerOut);
          document.removeEventListener("click", onClick);
          document.removeEventListener("keydown", onKeyDown);
        };

        const root = document.querySelector(".app") ?? document.body;
        window.requestAnimationFrame(() => {
          if (!cancelled) applyTooltips(root, index);
        });

        observer = new MutationObserver((mutations) => {
          for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
              if (node.nodeType === Node.ELEMENT_NODE && !isTooltipUiElement(node)) {
                applyTooltips(node, index);
              }
            }
          }
        });
        observer.observe(root, { childList: true, subtree: true });

        if (cancelled) {
          removeListeners();
          observer.disconnect();
        }
      })
      .catch((error: Error) => {
        console.warn("Failed to load dictionary tooltips", error);
      });

    return () => {
      cancelled = true;
      removeListeners();
      observer?.disconnect();
      tooltipEl?.remove();
      modalEl?.remove();
    };
  }, [locale, routeKey]);
}
