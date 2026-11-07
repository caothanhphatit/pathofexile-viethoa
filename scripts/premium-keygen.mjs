// Prints a new Ed25519 key pair for premium licence tokens.
//   PREMIUM_SIGNING_KEY (private, base64 PEM) goes into the server .env only.
//   The public key PEM is what client apps embed to check token signatures; the
//   server also serves it at GET /api/premium/public-key.
import crypto from "node:crypto";

const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();

console.log("# Add to the server .env (keep secret, never commit):");
console.log(`PREMIUM_SIGNING_KEY=${Buffer.from(privatePem).toString("base64")}`);
console.log("");
console.log("# Public key for client apps:");
console.log(publicPem);
