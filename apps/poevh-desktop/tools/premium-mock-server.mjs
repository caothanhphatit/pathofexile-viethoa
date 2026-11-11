// Stand-in for the website's premium endpoints, for testing the POEVH client
// without PostgreSQL or a signing key in .env. Same request/response shapes as
// src/server/routes/premium.mjs; one key is accepted and bound to one device.
//
//   node tools/premium-mock-server.mjs [port]
//   POEVH_PREMIUM_API=http://127.0.0.1:<port> POEVH.exe
//
// Accepted key: PVH-TESTK-EYTES-TKEYT-ESTKE (override with PREMIUM_MOCK_KEY).
import crypto from "node:crypto";
import http from "node:http";

const KEY_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const normalizeKey = (input = "") => {
  const compact = String(input).toUpperCase().replace(/[^0-9A-Z]/g, "")
    .replace(/O/g, "0").replace(/[IL]/g, "1");
  const body = compact.startsWith("PVH") ? compact.slice(3) : compact;
  if (body.length !== 20 || [...body].some((ch) => !KEY_ALPHABET.includes(ch))) return null;
  return `PVH-${body.match(/.{5}/g).join("-")}`;
};

const acceptedKey = normalizeKey(process.env.PREMIUM_MOCK_KEY || "PVH-TESTK-EYTES-TKEYT-ESTKE");
const keyId = "pkey_mock";
const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
const b64url = (buffer) => Buffer.from(buffer).toString("base64url");
let boundDevice = null;

const send = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

const readJson = (req) => new Promise((resolve) => {
  let data = "";
  req.on("data", (chunk) => { data += chunk; });
  req.on("end", () => { try { resolve(JSON.parse(data || "{}")); } catch { resolve(null); } });
});

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/api/premium/offer") {
    return send(res, 200, {
      ok: true,
      data: {
        currency: "VND",
        plans: [
          { id: "month", name: "1 tháng", days: 30, price: 49000 },
          { id: "year", name: "1 năm", days: 365, price: 399000 },
          { id: "lifetime", name: "Trọn đời", days: null, price: null }
        ],
        payment: { method: "Chuyển khoản ngân hàng", bank: "MOCK BANK", account: "0000000000", holder: "POEVH MOCK", note_template: "POEVH {email} {plan}", contact: "" },
        steps: ["Mock: chọn gói", "Mock: chuyển khoản", "Mock: tạo key", "Mock: dán key vào app"],
        page_url: `http://127.0.0.1:${server.address().port}/premium`
      }
    });
  }
  if (req.method === "GET" && req.url === "/api/premium/public-key") {
    return send(res, 200, { ok: true, data: { algorithm: "Ed25519", publicKeyPem } });
  }
  if (req.method === "POST" && req.url === "/api/premium/verify") {
    const body = await readJson(req);
    if (!body) return send(res, 400, { ok: false, error: "Bad JSON", code: "bad_request" });
    const key = normalizeKey(body.key);
    if (!key) return send(res, 400, { ok: false, error: "Key format is invalid", code: "bad_key" });
    const deviceId = body.device_id;
    if (typeof deviceId !== "string" || deviceId.length < 16 || deviceId.length > 256) {
      return send(res, 400, { ok: false, error: "device_id must be 16-256 printable characters", code: "bad_device" });
    }
    if (key !== acceptedKey) return send(res, 401, { ok: false, error: "Key not found or revoked", code: "unknown_key" });
    const deviceHash = crypto.createHash("sha256").update(`poevh-device:${keyId}:${deviceId}`).digest("hex");
    boundDevice ??= deviceHash;
    if (boundDevice !== deviceHash) {
      return send(res, 409, { ok: false, error: "This key is already activated on another device", code: "device_mismatch" });
    }
    const now = Date.now();
    const premiumUntil = new Date(now + 30 * 86_400_000);
    const payload = {
      v: 1, sub: "usr_mock", kid: keyId, dev: deviceHash, plan: "month",
      premium_until: premiumUntil.toISOString(),
      iat: Math.floor(now / 1000), exp: Math.floor((now + 7 * 86_400_000) / 1000)
    };
    const encoded = b64url(JSON.stringify(payload));
    const token = `${encoded}.${b64url(crypto.sign(null, Buffer.from(encoded), privateKey))}`;
    console.log(`verify ok: ${key} device=${deviceHash.slice(0, 12)} label=${String(body.device_label || "").slice(0, 40)}`);
    return send(res, 200, {
      ok: true,
      data: { token, plan: payload.plan, premium_until: payload.premium_until, token_expires_at: new Date(payload.exp * 1000).toISOString() }
    });
  }
  send(res, 404, { ok: false, error: "Not found", code: "not_found" });
});

server.listen(Number(process.argv[2] || 0), "127.0.0.1", () => {
  console.log(`premium mock listening on http://127.0.0.1:${server.address().port} (key ${acceptedKey})`);
});
