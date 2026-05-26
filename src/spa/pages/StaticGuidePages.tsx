import { useEffect, useState } from "react";
import { localizedText, type Locale, uiText } from "../lib/locale";
import type { RouteKey } from "../lib/routes";

const legacyFiles: Partial<Record<RouteKey, string>> = {
  patchnote: "/patchnote_vn.html",
  newbie: "/newbie.html",
  beginner: "/beginner.html",
  weapon: "/weapon.html"
};

const fallbackCopy: Record<string, { eyebrow: string; title: string; body: string }> = {
  patchnote: {
    eyebrow: "Return of the Ancients",
    title: "Patch note",
    body: "Khong tai duoc noi dung legacy."
  },
  newbie: {
    eyebrow: "Nguoi moi",
    title: "Newbie POE2",
    body: "Khong tai duoc noi dung legacy."
  },
  beginner: {
    eyebrow: "Beginner guide",
    title: "Beginner guide POE2",
    body: "Khong tai duoc noi dung legacy."
  },
  weapon: {
    eyebrow: "Equipment",
    title: "Weapon guide POE2",
    body: "Khong tai duoc noi dung legacy."
  }
};

function legacyArticleText(html: string): Record<string, unknown> {
  const token = "const NEWBIE_TEXT =";
  const tokenIndex = html.indexOf(token);
  if (tokenIndex === -1) return {};
  const start = html.indexOf("{", tokenIndex);
  if (start === -1) return {};

  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = start; index < html.length; index += 1) {
    const char = html[index];
    if (quote) {
      escaped = char === "\\" && !escaped;
      if (char === quote && !escaped) quote = "";
      else if (char !== "\\") escaped = false;
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) {
      try {
        return Function(`"use strict"; return (${html.slice(start, index + 1)});`)() as Record<string, unknown>;
      } catch {
        return {};
      }
    }
  }
  return {};
}

function extractLegacyMain(html: string, locale: Locale): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const main = doc.querySelector("main");
  if (!main) return "";
  const articleText = legacyArticleText(html);

  main.querySelectorAll<HTMLElement>("[data-article-i18n]").forEach((element) => {
    const key = element.dataset.articleI18n || "";
    element.textContent = localizedText(articleText[key], element.textContent || "", locale);
  });

  main.querySelectorAll("script, style, [data-component='site-header']").forEach((node) => node.remove());
  main.querySelectorAll("a[href]").forEach((anchor) => {
    const href = anchor.getAttribute("href") || "";
    const clean = href.replace(/^\.?\//, "/");
    const mapped: Record<string, string> = {
      "/index.html": "/",
      "/lookup.html": "/tra-cuu",
      "/newbie.html": "/newbie",
      "/beginner.html": "/beginner-guide",
      "/weapon.html": "/weapon",
      "/skill_gems.html": "/skill-gems",
      "/currency.html": "/currency",
      "/dictionary.html": "/dictionary",
      "/passive_tree.html": "/passive-tree",
      "/leveling.html": "/leveling",
      "/patchnote_vn.html": "/patchnote"
    };
    if (mapped[clean]) anchor.setAttribute("href", mapped[clean]);
  });

  return main.innerHTML;
}

export function StaticGuidePage({ routeKey, locale }: { routeKey: RouteKey; locale: Locale }) {
  const [html, setHtml] = useState("");
  const [error, setError] = useState("");
  const fallback = fallbackCopy[routeKey] ?? fallbackCopy.newbie;

  useEffect(() => {
    let alive = true;
    const file = legacyFiles[routeKey];
    if (!file) return;

    setHtml("");
    setError("");
    fetch(file, { cache: "force-cache" })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then((text) => {
        if (alive) setHtml(extractLegacyMain(text, locale));
      })
      .catch((err: Error) => {
        if (alive) setError(err.message);
      });

    return () => {
      alive = false;
    };
  }, [routeKey, locale]);

  if (html) {
    return (
      <main className="page-shell legacy-page">
        <div className="legacy-content" dangerouslySetInnerHTML={{ __html: html }} />
      </main>
    );
  }

  return (
    <main className="page-shell">
      <header className="page-title">
        <p className="eyebrow">{fallback.eyebrow}</p>
        <h1>{fallback.title}</h1>
        <p>{error ? `${uiText("oldPageFailed", locale)}: ${error}` : uiText("loadingLegacy", locale)}</p>
      </header>
    </main>
  );
}
