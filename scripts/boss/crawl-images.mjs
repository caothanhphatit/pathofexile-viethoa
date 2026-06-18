import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { r2 } from "./r2.mjs";

// load .env for proxy
for (const line of readFileSync(new URL("../../.env", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
const PROXY = process.env.CRAWL_PROXY;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const MANIFEST = "/tmp/boss-images.json";
const CAP = 30;

const curlText = (url) => execFileSync("curl", ["-sS","--proxy",PROXY,"-m","45","-A",UA,url], { maxBuffer:64*1024*1024 }).toString("utf8");
const curlBin  = (url, ref) => execFileSync("curl", ["-sS","--proxy",PROXY,"-m","60","-A",UA,"-H",`Referer: ${ref}`,"-H","Accept: image/*,*/*;q=0.8","-H","Sec-Fetch-Dest: image","-H","Sec-Fetch-Mode: no-cors","-H","Sec-Fetch-Site: cross-site",url], { maxBuffer:64*1024*1024 });
const norm = (s) => String(s||"").toLowerCase().replace(/path of exile 2?\s*-\s*/i,"").replace(/poe\s*2?\s*-\s*/i,"").replace(/[^a-z0-9]+/g," ").trim();

global.window = {};
await import(new URL("../../public/data/boss-data.js", import.meta.url).href);
const data = global.window.POE2_BOSS_DETAILS;
const slugs = Object.keys(data);

let manifest = {};
try { manifest = JSON.parse(readFileSync(MANIFEST,"utf8")); } catch {}

let done = 0;
for (const slug of slugs) {
  if (manifest[slug]?.images?.length) { done++; continue; } // resume
  const b = data[slug];
  const guide = b.source;
  if (!guide) { console.log(`SKIP ${slug} (no source)`); continue; }
  try {
    const html = curlText(guide);
    const tags = [...html.matchAll(/<img\b[^>]*>/gi)].map(m=>m[0]);
    const seen = new Set(); const imgs = [];
    for (const t of tags) {
      const ds = t.match(/data-src=['"](https:\/\/img\.game8\.co\/\d+\/[a-f0-9]+\.(?:png|jpe?g|webp))\/(show|thumb)['"]/i);
      if (!ds) continue;
      if (seen.has(ds[1])) continue; seen.add(ds[1]);
      const alt = (t.match(/\balt=['"]([^'"]*)['"]/i)||[])[1] || "";
      imgs.push({ base: ds[1], alt });
    }
    const nName = norm(b.name);
    const heroIdx = imgs.findIndex(x => { const a = norm(x.alt); return a && (a===nName || a.includes(nName) || nName.includes(a)); });
    const ordered = heroIdx > 0 ? [imgs[heroIdx], ...imgs.slice(0,heroIdx), ...imgs.slice(heroIdx+1)] : imgs;
    const pick = ordered.slice(0, CAP);
    const out = { name: b.name, guide, hero: null, images: [] };
    for (let i=0;i<pick.length;i++){
      const im = pick[i];
      const ext = im.base.split(".").pop().replace("jpeg","jpg");
      try {
        const buf = curlBin(im.base+"/show", guide);
        if (!buf || buf.length < 800 || buf.slice(0,5).toString().includes("<?xml")) throw new Error("bad img");
        const key = `boss/${slug}/${i===0?"hero":"img-"+i}.${ext}`;
        const ct = ext==="png"?"image/png":ext==="webp"?"image/webp":"image/jpeg";
        const r = await r2("PUT", key, { body: buf, contentType: ct });
        if (r.status!==200) throw new Error("r2 "+r.status);
        const rec = { key, alt: im.alt, bytes: buf.length };
        if (i===0) out.hero = rec; out.images.push(rec);
      } catch(e){ /* skip this image */ }
    }
    manifest[slug] = out;
    writeFileSync(MANIFEST, JSON.stringify(manifest,null,2));
    done++;
    console.log(`[${done}/${slugs.length}] ${slug}: ${out.images.length} imgs (hero=${out.hero?"y":"n"})`);
  } catch(e){
    console.log(`ERR ${slug}: ${e.message}`);
    manifest[slug] = { name: b.name, guide, hero:null, images:[], error:e.message };
    writeFileSync(MANIFEST, JSON.stringify(manifest,null,2));
  }
}
console.log("DONE. bosses processed:", done, "/", slugs.length);
