import assert from "node:assert/strict";
import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  defaultClientLogCandidates,
  parseEnteredZone,
  parseLogEvent,
  Poe2LogWatcher
} from "../src/server/services/poe2-log-watcher.mjs";

test("parseEnteredZone extracts POE2 zone entries from Client.txt lines", () => {
  assert.equal(
    parseEnteredZone("2026/05/23 12:00:00 123 [INFO Client] : You have entered Riverbank."),
    "Riverbank"
  );
  assert.equal(
    parseEnteredZone("2026/05/23 12:01:00 124 [INFO Client] : You have entered The Grelwood."),
    "The Grelwood"
  );
  assert.equal(
    parseEnteredZone("2026/05/23 13:35:39 363728312 7fbd122e [INFO Client 23692] [SCENE] Set Source [Clearfell]"),
    "Clearfell"
  );
  assert.equal(
    parseEnteredZone("2026/05/23 13:35:39 363728312 7fbd122e [INFO Client 23692] [SCENE] Set Source [(null)]"),
    null
  );
  assert.equal(
    parseEnteredZone("2026/05/23 13:29:19 363349203 7fbd122e [INFO Client 23692] [SCENE] Set Source [(unknown)]"),
    null
  );
  assert.equal(parseEnteredZone("2026/05/23 debug noise"), null);
});

test("parseLogEvent extracts task-level POE2 log signals", () => {
  assert.deepEqual(
    parseLogEvent("2026/05/23 13:30:57 363446468 3ef232c2 [INFO Client 23692] Wounded Man: By the First Ones! You're alive!"),
    { type: "dialogue", speaker: "Wounded Man", text: "By the First Ones! You're alive!" }
  );
  assert.deepEqual(
    parseLogEvent("2026/05/23 13:33:53 363623140 3ef232c2 [INFO Client 23692] : aaassssas (Huntress) is now level 2"),
    { type: "level", characterName: "aaassssas", characterClass: "Huntress", level: 2 }
  );
  assert.deepEqual(
    parseLogEvent("2026/05/23 13:35:39 363728312 7fbd122e [INFO Client 23692] [SCENE] Set Source [Clearfell]"),
    { type: "zone", zoneName: "Clearfell" }
  );
});

test("defaultClientLogCandidates includes the local POE2 Client.txt path without secrets", () => {
  const candidates = defaultClientLogCandidates({ USERPROFILE: "C:\\Users\\tester" });
  assert.ok(candidates.some((candidate) => candidate.includes("Path of Exile 2")));
  assert.ok(candidates.some((candidate) => candidate.endsWith("Client.txt")));
  assert.doesNotMatch(candidates.join("\n"), /postgres(?:ql)?:\/\//i);
});

test("Poe2LogWatcher accepts a logs directory and resolves Client.txt", async () => {
  const dir = await mkdtemp(join(tmpdir(), "poe2-log-dir-"));
  const logsDir = join(dir, "logs");
  const logPath = join(logsDir, "Client.txt");
  const watcher = new Poe2LogWatcher({ path: logsDir, pollIntervalMs: 60_000 });

  try {
    await mkdir(logsDir);
    await writeFile(logPath, "2026/05/23 13:35:39 363728312 [INFO Client] [SCENE] Set Source [Clearfell]");
    await watcher.start();
    assert.equal(watcher.status().activePath, logPath);
    assert.equal(watcher.status().zoneName, "Clearfell");
    assert.equal(watcher.status().recentEvents.at(-1).type, "zone");
  } finally {
    watcher.stop();
    await rm(dir, { recursive: true, force: true });
  }
});

test("Poe2LogWatcher reads the latest zone and follows appended log lines", async () => {
  const dir = await mkdtemp(join(tmpdir(), "poe2-log-"));
  const logPath = join(dir, "Client.txt");
  const watcher = new Poe2LogWatcher({ path: logPath, pollIntervalMs: 60_000 });

  try {
    await writeFile(logPath, [
      "2026/05/23 12:00:00 123 [INFO Client] : You have entered Riverbank.",
      "2026/05/23 12:00:01 124 [INFO Client] : unrelated"
    ].join("\n"));
    await watcher.start();
    assert.equal(watcher.status().watching, true);
    assert.equal(watcher.status().zoneName, "Riverbank");

    await appendFile(logPath, "\n2026/05/23 12:02:00 125 [INFO Client] : TestName (Huntress) is now level 2");
    await watcher.poll();
    assert.equal(watcher.status().characterName, "TestName");
    assert.equal(watcher.status().characterClass, "Huntress");
    assert.equal(watcher.status().characterLevel, 2);

    await appendFile(logPath, "\n2026/05/23 12:03:00 125 [INFO Client] : You have entered Clearfell.");
    await watcher.poll();
    assert.equal(watcher.status().zoneName, "Clearfell");
    assert.ok(watcher.status().recentEvents.some((event) => event.zoneName === "Clearfell"));
  } finally {
    watcher.stop();
    await rm(dir, { recursive: true, force: true });
  }
});
