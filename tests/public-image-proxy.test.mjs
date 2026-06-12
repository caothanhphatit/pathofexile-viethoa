import assert from "node:assert/strict";
import test from "node:test";

import { buildApp } from "../src/server/app.mjs";

test("POE2DB image proxy fetches allowed CDN images with a Poe2DB referer", async () => {
  const calls = [];
  const app = await buildApp({
    db: null,
    logger: false,
    sessionSecret: "test-session-secret",
    poe2dbImageFetch: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        headers: {
          get: () => null
        },
        arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer
      };
    }
  });

  try {
    const imageUrl = "https://cdn.poe2db.tw/image/Art/2DItems/Weapons/OneHandWeapons/Wands/Basetypes/Wand03.webp";
    const response = await app.inject({
      method: "GET",
      url: `/api/poe2db-image?url=${encodeURIComponent(imageUrl)}`
    });

    assert.equal(response.statusCode, 200);
    assert.match(response.headers["content-type"], /^image\/webp/);
    assert.equal(response.rawPayload.toString("hex"), "010203");
    assert.equal(calls[0].url, imageUrl);
    assert.equal(calls[0].options.headers.referer, "https://poe2db.tw/us/Items");

    const rejected = await app.inject({
      method: "GET",
      url: `/api/poe2db-image?url=${encodeURIComponent("https://example.com/image/foo.webp")}`
    });
    assert.equal(rejected.statusCode, 400);
  } finally {
    await app.close();
  }
});
