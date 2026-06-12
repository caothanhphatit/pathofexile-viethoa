const poe2dbCdnImagePattern = /^https:\/\/cdn\.poe2db\.tw\/image\//i;

export function displayImageUrl(value?: string): string {
  const url = String(value || "").trim();
  if (!url) return "";
  if (!poe2dbCdnImagePattern.test(url)) return url;
  return `/api/poe2db-image?url=${encodeURIComponent(url)}`;
}
