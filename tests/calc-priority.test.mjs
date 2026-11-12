// /api/builds/calculate runs the planner's own calculation before what-if
// comparisons, and comparisons never take the last free slot.
import assert from "node:assert/strict";
import test from "node:test";

import { buildApp } from "../src/server/app.mjs";

test("main calculations go before queued comparisons, comparisons keep a slot free", async () => {
  const started = [];
  const gates = [];
  const app = await buildApp({
    db: null,
    logger: false,
    sessionSecret: "test-session-secret",
    premiumSigner: null,
    pobRunner: {
      mode: "remote",
      run: (xml) => new Promise((resolve) => {
        started.push(xml.match(/level="(\d+)"/)[1]);
        gates.push(() => resolve({ Life: 1 }));
      })
    }
  });
  // Each request gets its own level so the XML (and the cache key) differs.
  const send = (level, priority) => app.inject({
    method: "POST",
    url: "/api/builds/calculate",
    payload: { className: "Witch", level, skills: [], inventory_slots: [], ...(priority ? { calc_priority: priority } : {}) }
  });
  // Waits (up to 3 s) until n calculations have started, then a little longer so an
  // extra start that should not happen would show up.
  const started_ = (n) => new Promise((resolve, reject) => {
    const deadline = Date.now() + 3000;
    const poll = () => {
      if (started.length >= n) return setTimeout(resolve, 60);
      if (Date.now() > deadline) return reject(new Error(`only ${started.length} of ${n} calculations started`));
      setTimeout(poll, 10);
    };
    poll();
  });
  try {
    const compare1 = send(11, "compare");
    const compare2 = send(12, "compare");
    const compare3 = send(13, "compare");
    await started_(1);
    assert.deepEqual(started, ["11"], "only one comparison runs: the other slot stays free");
    const main = send(50);
    await started_(2);
    assert.deepEqual(started, ["11", "50"], "the main calculation takes the free slot at once");
    gates[0]();
    await started_(3);
    assert.deepEqual(started, ["11", "50", "12"], "then comparisons continue, one at a time");
    gates[1]();
    gates[2]();
    await started_(4);
    gates[3]();
    const answers = await Promise.all([compare1, compare2, compare3, main]);
    for (const answer of answers) assert.equal(answer.statusCode, 200, answer.body);
  } finally {
    await app.close();
  }
});
