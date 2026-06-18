import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
for (const l of readFileSync(new URL("../../.env",import.meta.url),"utf8").split("\n")){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m&&process.env[m[1]]===undefined)process.env[m[1]]=m[2];}
const PROXY=process.env.CRAWL_PROXY, UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const url=process.argv[2];
const html=execFileSync("curl",["-sS","--proxy",PROXY,"-m","45","-A",UA,url],{maxBuffer:64*1024*1024}).toString("utf8");
// end cut: earliest sidebar/related/comments/footer marker
let endIdx=html.length;
for(const mk of ['c-sideArticleList','id="comment','js-reply-modal','p-articleFooter','class="p-related','Related Articles','c-articleFooter']){const i=html.indexOf(mk);if(i>0&&i<endIdx)endIdx=i;}
// start at first real content image (hero) — skips membership modal above article
const firstImg=(html.match(/<img\b[^>]*data-src=['"]https:\/\/img\.game8\.co\/\d+\/[a-f0-9]+\.(?:png|jpe?g|webp)\/(?:show|thumb)['"][^>]*>/i)||[])[0];
const startIdx=firstImg?html.indexOf(firstImg):0;
const body=html.slice(startIdx,endIdx>startIdx?endIdx:html.length);
// images
const seen=new Set(),images=[];
for(const t of body.match(/<img\b[^>]*>/gi)||[]){
  const ds=t.match(/data-src=['"](https:\/\/img\.game8\.co\/\d+\/[a-f0-9]+\.(?:png|jpe?g|webp))\/(?:show|thumb)['"]/i);
  if(!ds||seen.has(ds[1]))continue;seen.add(ds[1]);
  const alt=(t.match(/\balt=['"]([^'"]*)['"]/i)||[])[1]||"";
  if(/partial banner|banner|^logo$|thumbnail|how to beat all/i.test(alt))continue;
  images.push({base:ds[1],alt:alt.replace(/^(Path of Exile\s*2?\s*-\s*|POE\s*2?\s*-\s*)/i,"").trim()});
}
// text
const txt=[];
for(const m of body.matchAll(/<(h2|h3|p|li|th|td)\b[^>]*>([\s\S]*?)<\/\1>/gi)){
  const tag=m[1].toLowerCase();
  const s=m[2].replace(/<[^>]+>/g," ").replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/&#39;|&rsquo;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g," ").trim();
  if(!s||s.length<2)continue;
  txt.push((tag==="h2"?"\n## ":tag==="h3"?"\n### ":tag==="li"?"- ":"")+s);
}
console.log(JSON.stringify({url,images,text:txt.join("\n").slice(0,9000)}));
