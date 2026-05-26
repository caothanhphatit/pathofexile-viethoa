import type { Locale } from "./locale";
import { routeText, type AppRoute } from "./routes";

const SITE_ORIGIN = "https://poeviethoa.net";

function upsertMeta(selector: string, attrs: Record<string, string>): void {
  let el = document.head.querySelector<HTMLMetaElement>(selector);
  if (!el) {
    el = document.createElement("meta");
    document.head.appendChild(el);
  }
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
}

function upsertLink(selector: string, attrs: Record<string, string>): void {
  let el = document.head.querySelector<HTMLLinkElement>(selector);
  if (!el) {
    el = document.createElement("link");
    document.head.appendChild(el);
  }
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
}

export function updateSeo(route: AppRoute, locale: Locale = "vi", overrides: Partial<Pick<AppRoute, "title" | "description">> & { canonicalPath?: string } = {}): void {
  const text = routeText(route, locale);
  const title = overrides.title ?? text.title;
  const description = overrides.description ?? text.description;
  const canonical = `${SITE_ORIGIN}${overrides.canonicalPath ?? route.path}`;
  const brand = locale === "en" ? "POE2 Reference" : "POE2 Việt hóa";

  document.title = title === brand ? brand : `${title} - ${brand}`;
  upsertMeta('meta[name="description"]', { name: "description", content: description });
  upsertMeta('meta[name="robots"]', { name: "robots", content: "index,follow,max-image-preview:large" });
  upsertLink('link[rel="canonical"]', { rel: "canonical", href: canonical });
  upsertMeta('meta[property="og:title"]', { property: "og:title", content: title });
  upsertMeta('meta[property="og:description"]', { property: "og:description", content: description });
  upsertMeta('meta[property="og:url"]', { property: "og:url", content: canonical });
  upsertMeta('meta[property="og:image"]', { property: "og:image", content: `${SITE_ORIGIN}/assets/img/logo.jpg` });
  upsertMeta('meta[name="twitter:card"]', { name: "twitter:card", content: "summary" });
  upsertMeta('meta[name="twitter:title"]', { name: "twitter:title", content: title });
  upsertMeta('meta[name="twitter:description"]', { name: "twitter:description", content: description });
}
