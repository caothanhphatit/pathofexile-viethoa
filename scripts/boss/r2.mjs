import crypto from "node:crypto";
import { readFileSync } from "node:fs";

// Minimal .env loader (no dep) — only fills missing keys.
try {
  for (const line of readFileSync(new URL("../../.env", import.meta.url), "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
} catch {}

const ACCOUNT = process.env.R2_ACCOUNT_ID;
const HOST = `${ACCOUNT}.r2.cloudflarestorage.com`;
const REGION = "auto", SERVICE = "s3";
const AK = process.env.R2_ACCESS_KEY_ID, SK = process.env.R2_SECRET_ACCESS_KEY;
const BUCKET = process.env.R2_BUCKET || "poe2";
const sha256hex = (b) => crypto.createHash("sha256").update(b).digest("hex");
const hmac = (k, d) => crypto.createHmac("sha256", k).update(d).digest();
const pad = (n) => String(n).padStart(2, "0");

export async function r2(method, key, { body = "", contentType } = {}) {
  const d = new Date();
  const stamp = `${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}`;
  const amz = `${stamp}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
  const payloadHash = sha256hex(body);
  const uri = "/" + BUCKET + "/" + key.split("/").map(encodeURIComponent).join("/");
  const headers = { host: HOST, "x-amz-content-sha256": payloadHash, "x-amz-date": amz };
  if (contentType) headers["content-type"] = contentType;
  const signed = Object.keys(headers).sort().join(";");
  const canonH = Object.keys(headers).sort().map(h => `${h}:${headers[h]}\n`).join("");
  const canon = [method, uri, "", canonH, signed, payloadHash].join("\n");
  const scope = `${stamp}/${REGION}/${SERVICE}/aws4_request`;
  const sts = ["AWS4-HMAC-SHA256", amz, scope, sha256hex(canon)].join("\n");
  let k = hmac("AWS4"+SK, stamp); k = hmac(k, REGION); k = hmac(k, SERVICE); k = hmac(k, "aws4_request");
  const sig = crypto.createHmac("sha256", k).update(sts).digest("hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${AK}/${scope}, SignedHeaders=${signed}, Signature=${sig}`;
  return fetch(`https://${HOST}${uri}`, { method, headers, body: body || undefined });
}
