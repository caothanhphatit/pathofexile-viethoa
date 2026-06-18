import { readFileSync, writeFileSync } from "node:fs";
for (const line of readFileSync(new URL("../../.env", import.meta.url),"utf8").split("\n")){const m=line.match(/^([A-Z0-9_]+)=(.*)$/);if(m&&process.env[m[1]]===undefined)process.env[m[1]]=m[2];}
const BASE = (process.env.R2_PUBLIC_BASE||"https://img.poeviethoa.net").replace(/\/$/,"");
const man = JSON.parse(readFileSync("/tmp/boss-images.json","utf8"));
const out = {};
for (const [slug,b] of Object.entries(man)) {
  if (!b.images?.length) continue;
  const images = b.images.map(im => ({ url: `${BASE}/${im.key}`, alt: (im.alt||"").replace(/^(Path of Exile\s*2?\s*-\s*|POE\s*2?\s*-\s*)/i,"").trim() }));
  out[slug] = { hero: b.hero ? `${BASE}/${b.hero.key}` : (images[0]?.url||null), images };
}
const body = `// AUTO-GENERATED from Game8 crawl -> Cloudflare R2 (${BASE}). Do not edit by hand.\nwindow.POE2_BOSS_IMAGES = ${JSON.stringify(out,null,2)};\n`;
writeFileSync(new URL("../../public/data/boss-images.js", import.meta.url), body);
console.log("wrote boss-images.js:", Object.keys(out).length, "bosses,", Object.values(out).reduce((n,b)=>n+b.images.length,0), "images");
