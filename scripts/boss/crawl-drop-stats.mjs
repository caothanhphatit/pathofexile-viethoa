import { writeFileSync } from "node:fs";
import { fetchItem } from "./fetch-item.mjs";
global.window={}; await import(new URL("../../public/data/boss-data.js",import.meta.url).href);
const d=global.window.POE2_BOSS_DETAILS;
const names=new Set();
for(const b of Object.values(d)) for(const dr of (b.drops||[])) if(dr.name) names.add(dr.name.trim());
console.error("unique drop names:",names.size);
const items={}; let ok=0,miss=0;
for(const n of names){
  try{ const r=fetchItem(n);
    if(r.found && (r.explicit.length||r.implicit.length||r.base)){ items[n]={base:r.base,requires:r.requires,implicit:r.implicit,explicit:r.explicit,flavour:r.flavour}; ok++; }
    else miss++;
  }catch(e){miss++;}
  if((ok+miss)%10===0) console.error(`  ${ok+miss}/${names.size} (ok ${ok})`);
}
writeFileSync(new URL("../../public/data/boss-items.js",import.meta.url),`// poe2db item stats for boss drops. Auto-generated.\nwindow.POE2_DROP_ITEMS = ${JSON.stringify(items,null,2)};\n`);
console.error("DONE: stats for",ok,"items, missed",miss);
