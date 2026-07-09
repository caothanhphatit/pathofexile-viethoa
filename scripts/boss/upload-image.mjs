import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { r2 } from "./r2.mjs";
for (const l of readFileSync(new URL("../../.env",import.meta.url),"utf8").split("\n")){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m&&process.env[m[1]]===undefined)process.env[m[1]]=m[2];}
const PROXY=process.env.CRAWL_PROXY, BASE=(process.env.R2_PUBLIC_BASE||"https://img.poeviethoa.net").replace(/\/$/,"");
const UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const [imgBase,key]=process.argv.slice(2);
if(!imgBase||!key){console.error("usage: upload-image.mjs <game8_img_base> <r2_key>");process.exit(1);}
const ref="https://game8.co/";
const targetUrl = imgBase.endsWith("/poster") ? imgBase : imgBase.replace(/\/(show|thumb)$/,"")+"/show";
const buf=execFileSync("curl",["-sS","--proxy",PROXY,"-m","60","-A",UA,"-H",`Referer: ${ref}`,"-H","Accept: image/*,*/*;q=0.8","-H","Sec-Fetch-Dest: image","-H","Sec-Fetch-Mode: no-cors","-H","Sec-Fetch-Site: cross-site",targetUrl],{maxBuffer:64*1024*1024});
if(!buf||buf.length<800||buf.slice(0,5).toString().includes("<?xml")){console.error("ERROR bad image");process.exit(2);}
const ext=key.split(".").pop().toLowerCase();
const ct=ext==="png"?"image/png":ext==="webp"?"image/webp":"image/jpeg";
const r=await r2("PUT",key,{body:buf,contentType:ct});
if(r.status!==200){console.error("ERROR r2 "+r.status);process.exit(3);}
console.log(`${BASE}/${key}`);
