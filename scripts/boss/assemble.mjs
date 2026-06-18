import { readFileSync, writeFileSync, readdirSync } from "node:fs";
for (const l of readFileSync(new URL("../../.env",import.meta.url),"utf8").split("\n")){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m&&process.env[m[1]]===undefined)process.env[m[1]]=m[2];}
const dir="/tmp/boss-curated";
global.window={}; await import(new URL("../../public/data/boss-data.js",import.meta.url).href);
const obj=global.window.POE2_BOSS_DETAILS;
const images={};
let merged=0;
for(const f of readdirSync(dir).filter(x=>x.endsWith(".json"))){
  const d=JSON.parse(readFileSync(dir+"/"+f,"utf8"));
  const e=obj[d.slug]; if(!e) continue;
  e.name=d.name||e.name; e.group=d.group||e.group; e.location=d.location||e.location; e.source=d.source||e.source;
  e.vi=d.vi||e.vi;
  e.drops=Array.isArray(d.drops)?d.drops:[];
  e.conditions=Array.isArray(d.conditions)?d.conditions:[];
  e.curated=true;
  const gal=(Array.isArray(d.gallery)?d.gallery:[]).filter(Boolean).map(u=>({url:u,alt:""}));
  images[d.slug]={hero:d.hero||null, images:gal};
  merged++;
}
// Apply manual hero overrides (durable across re-runs)
try{const ov=JSON.parse(readFileSync(new URL("./hero-overrides.json",import.meta.url),"utf8"));for(const[s,u]of Object.entries(ov)){images[s]=images[s]||{hero:null,images:[]};images[s].hero=u;}}catch{}
writeFileSync(new URL("../../public/data/boss-data.js",import.meta.url), `window.POE2_BOSS_DETAILS = ${JSON.stringify(obj,null,2)};\n`);
writeFileSync(new URL("../../public/data/boss-images.js",import.meta.url), `// Curated Game8 images -> Cloudflare R2. Auto-generated.\nwindow.POE2_BOSS_IMAGES = ${JSON.stringify(images,null,2)};\n`);
console.log("merged curated bosses:",merged,"| boss-images entries:",Object.keys(images).length);
