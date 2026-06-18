import { execFileSync } from "node:child_process";
const UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const strip=(s)=>s.replace(/<br\s*\/?>/gi,"\n").replace(/<[^>]+>/g,"").replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/&#39;|&rsquo;/g,"'").replace(/&quot;/g,'"').replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/[ \t]+/g," ").replace(/ *\n */g,"\n").trim();
const get=(url)=>{try{return execFileSync("curl",["-sS","-m","20","-A",UA,url],{maxBuffer:32*1024*1024}).toString("utf8");}catch{return null;}};
const isItem=(h)=>h&&(h.includes("explicitMod")||h.includes("newItemPopup"));
const tryFetch=(name)=>{const h=get(`https://poe2db.tw/us/${encodeURIComponent(name.trim().replace(/\s+/g,"_"))}`);return isItem(h)?h:null;};
// fallback: poe2db search -> follow 302 Location to the item page
const searchResolve=(name)=>{
  try{
    const hdr=execFileSync("curl",["-sS","-m","15","-A",UA,"-o","/dev/null","-D","-",`https://poe2db.tw/us/search?q=${encodeURIComponent(name)}`],{maxBuffer:4*1024*1024}).toString("utf8");
    const loc=(hdr.split(/\r?\n/).find((l)=>/^location:/i.test(l))||"").replace(/^location:\s*/i,"").trim();
    if(!loc) return null;
    let path=loc; if(!/^https?:/i.test(path)){ if(!path.startsWith("/")) path="/us/"+path; path="https://poe2db.tw"+path; }
    const h=get(path); if(isItem(h)) return {name:decodeURIComponent(loc.split("/").pop()).replace(/_/g," "),html:h};
  }catch{}
  return null;
};
const resolve=(full)=>{
  const w=full.trim().split(/\s+/);
  for(let n=w.length;n>=1;n--){const c=w.slice(0,n).join(" ");const h=tryFetch(c);if(h)return{name:c,html:h};}
  for(let n=w.length;n>=2;n--){const r=searchResolve(w.slice(0,n).join(" "));if(r)return r;} // search fallback
  return null;
};
const collect=(html,cls)=>{const out=[];const open=new RegExp(`<(\\w+)[^>]*class="[^"]*\\b${cls}\\b[^"]*"[^>]*>`,"gi");let m;while((m=open.exec(html))){const tag=m[1].toLowerCase();let i=open.lastIndex,depth=1;const tagRe=new RegExp(`</?${tag}\\b[^>]*>`,"gi");tagRe.lastIndex=i;let t;while((t=tagRe.exec(html))){if(t[0][1]==="/"){depth--;if(depth===0){const txt=strip(html.slice(i,t.index));if(txt)out.push(txt);break;}}else depth++;}}return [...new Set(out)];};
export function fetchItem(input){
  const r=resolve(input); if(!r) return {input,found:false};
  const html=r.html; const pi=html.indexOf("newItemPopup"); const region=pi>0?html.slice(pi,pi+8000):html;
  const reqM=strip(region.slice(0,2500)).match(/Requires[^\n]*?Level\s*\d+/i);
  return {input,found:true,resolved:r.name,base:(collect(region,"typeLine")[0])||"",requires:reqM?reqM[0].replace(/\s+/g," ").trim():"",implicit:collect(region,"implicitMod"),explicit:collect(region,"explicitMod"),flavour:(collect(region,"flavourText")[0])||""};
}
if(process.argv[2]) console.log(JSON.stringify(fetchItem(process.argv[2]),null,2));
