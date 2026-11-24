// Persistent worker pool and priority queue for Path of Building calculations.
//
// Keeps a pool of long-lived LuaJIT processes running `calculate.lua --worker` so
// Path of Building's ~3 s startup and game-data load is paid once per worker instead
// of once per calculation.
//
// Features:
//   - Lazy or prewarmed workers (`POB_CALC_WORKERS`, `POB_CALC_PREWARM=1`).
//   - Two-level priority queue: `main` (user-facing build calculation) ahead of
//     `background` (node previews, item/gem what-if comparisons).
//   - Bounded queue length (`POB_CALC_QUEUE_MAX`) and max wait (`POB_CALC_QUEUE_WAIT_MS`),
//     returning 503 errors beyond limits.
//   - Client disconnect cancellation via AbortSignal (removes queued jobs before run).
//   - Per-job timeout kills and replaces the worker; crashes are automatically replaced.
//   - Automatic worker recycling after `POB_CALC_WORKER_MAX_JOBS` jobs or when RSS
//     exceeds `POB_CALC_WORKER_MAX_RSS_MB`.
//   - Automatic fallback to one-shot `execFile` if no worker can start.
import { spawn } from "node:child_process";
import { readFileSync, unlink, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const READY_PREFIX = "__POB_WORKER_READY__ ";
const RES_PREFIX = "__POB_WORKER_RES__ ";

const normalizePriority = (value) => (value === "background" || value === "compare" ? "background" : "main");

const makeBusyError = (message, code) => Object.assign(new Error(message), { statusCode: 503, code });

const makeAbortError = () => Object.assign(new Error("Request cancelled"), { name: "AbortError", code: "ABORT_ERR" });

/** Reads a Linux child process's VmRSS in bytes from /proc/<pid>/status. */
export function readLinuxPidRssBytes(pid) {
  if (process.platform !== "linux" || !pid) return null;
  try {
    const text = readFileSync(`/proc/${pid}/status`, "utf8");
    const match = text.match(/^VmRSS:\s+(\d+)\s+kB/m);
    return match ? Number(match[1]) * 1024 : null;
  } catch {
    return null;
  }
}

/** Reads pool and queue tuning from environment variables. */
export function pobPoolConfig(env = process.env) {
  const positiveInt = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
  };
  const nonNegInt = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
  };
  return {
    workers: positiveInt(env.POB_CALC_WORKERS || env.POB_CALC_MAX_CONCURRENT, 2),
    prewarm: env.POB_CALC_PREWARM === "1" || env.POB_CALC_PREWARM === "true",
    maxJobs: nonNegInt(env.POB_CALC_WORKER_MAX_JOBS, 200),
    maxRssMb: nonNegInt(env.POB_CALC_WORKER_MAX_RSS_MB, 768),
    maxQueue: nonNegInt(env.POB_CALC_QUEUE_MAX, 32),
    maxQueueWaitMs: positiveInt(env.POB_CALC_QUEUE_WAIT_MS, 15_000),
    timeoutMs: positiveInt(env.POB_CALCULATE_TIMEOUT_MS, 20_000),
    startTimeoutMs: positiveInt(env.POB_CALC_WORKER_START_TIMEOUT_MS, 30_000)
  };
}

export function createPobPool(options = {}) {
  const {
    coreDir,
    luajit = "luajit",
    script = "calculate.lua",
    workers: maxWorkers = 2,
    prewarm = false,
    maxJobs = 200,
    maxRssMb = 768,
    maxQueue = 32,
    maxQueueWaitMs = 15_000,
    timeoutMs = 20_000,
    startTimeoutMs = 30_000,
    retryWorkerAfterMs = 10_000,
    logger = null,
    spawnImpl = spawn,
    oneShotFallback = null
  } = options;

  const workerPool = [];
  const queues = { main: [], background: [] };
  let nextWorkerId = 1;
  let nextJobId = 1;
  let closed = false;
  let fallbackRunning = 0;
  let consecutiveStartFailures = 0;
  let lastStartFailureAt = 0;
  let lastStartError = null;

  const stats = {
    completed: 0,
    failed: 0,
    recycles: 0,
    crashes: 0,
    timeouts: 0,
    fallbacks: 0,
    cancelled: 0
  };

  const logEvent = (level, event) => {
    if (!logger) return;
    if (typeof logger === "function") {
      logger(level, event);
    } else if (typeof logger[level] === "function") {
      logger[level](event);
    }
  };

  const queuedTotal = () => queues.main.length + queues.background.length;

  const removeFromQueue = (job) => {
    const list = queues[job.priority];
    const idx = list.indexOf(job);
    if (idx !== -1) {
      list.splice(idx, 1);
      return true;
    }
    return false;
  };

  const cleanupJobWaiters = (job) => {
    if (job.waitTimer) {
      clearTimeout(job.waitTimer);
      job.waitTimer = null;
    }
    if (job.onAbort && job.signal) {
      job.signal.removeEventListener("abort", job.onAbort);
      job.onAbort = null;
    }
  };

  const cleanupTempFile = (filePath) => {
    if (!filePath) return;
    unlink(filePath, () => { /* ignore */ });
  };

  const killWorker = (worker, reason) => {
    if (worker.state === "dead") return;
    worker.state = "dead";
    if (worker.startTimer) {
      clearTimeout(worker.startTimer);
      worker.startTimer = null;
    }
    if (worker.jobTimer) {
      clearTimeout(worker.jobTimer);
      worker.jobTimer = null;
    }
    const idx = workerPool.indexOf(worker);
    if (idx !== -1) workerPool.splice(idx, 1);
    logEvent("info", { event: "pob_worker_kill", workerId: worker.id, pid: worker.pid, reason });
    try {
      worker.child.kill("SIGKILL");
    } catch {
      try { worker.child.kill(); } catch { /* already gone */ }
    }
  };

  const retireWorker = (worker, reason) => {
    if (worker.state === "dead" || worker.state === "recycling") return;
    worker.state = "recycling";
    stats.recycles += 1;
    const idx = workerPool.indexOf(worker);
    if (idx !== -1) workerPool.splice(idx, 1);
    logEvent("info", {
      event: "pob_worker_recycle",
      workerId: worker.id,
      pid: worker.pid,
      jobs: worker.jobsDone,
      rssMb: worker.rssBytes ? Math.round((worker.rssBytes / (1024 * 1024)) * 10) / 10 : null,
      reason
    });
    try {
      worker.child.stdin.write('{"cmd":"quit"}\n');
      worker.child.stdin.end();
    } catch {
      // Stdin already closed; fallback kill timer will terminate if still alive.
    }
    const forceKill = setTimeout(() => {
      try { worker.child.kill("SIGKILL"); } catch { /* exited */ }
    }, 1500);
    forceKill.unref?.();
    worker.child.once("exit", () => clearTimeout(forceKill));
  };

  const shouldRecycle = (worker) => {
    if (maxJobs > 0 && worker.jobsDone >= maxJobs) return `max_jobs(${maxJobs})`;
    if (maxRssMb > 0 && worker.rssBytes && worker.rssBytes > maxRssMb * 1024 * 1024) {
      return `max_rss(${Math.round(worker.rssBytes / (1024 * 1024))}MB>${maxRssMb}MB)`;
    }
    return null;
  };

  const finishJob = (worker, job, payload) => {
    if (worker.jobTimer) {
      clearTimeout(worker.jobTimer);
      worker.jobTimer = null;
    }
    worker.currentJob = null;
    cleanupTempFile(job.xmlPath);

    const calcMs = Date.now() - job.calcStartedAt;
    const rssBytes = payload.rssBytes || readLinuxPidRssBytes(worker.pid) || worker.rssBytes;
    if (rssBytes) worker.rssBytes = rssBytes;
    if (payload.luaMemKb) worker.luaMemKb = payload.luaMemKb;

    const rssMb = worker.rssBytes ? Math.round((worker.rssBytes / (1024 * 1024)) * 10) / 10 : null;

    if (payload.ok) {
      worker.jobsDone += 1;
      stats.completed += 1;
      logEvent("info", {
        event: "pob_job",
        workerId: worker.id,
        priority: job.priority,
        queueWaitMs: job.queueWaitMs,
        calcMs,
        rssMb,
        ok: true
      });
      job.resolve(payload.data);
    } else {
      stats.failed += 1;
      logEvent("error", {
        event: "pob_job",
        workerId: worker.id,
        priority: job.priority,
        queueWaitMs: job.queueWaitMs,
        calcMs,
        rssMb,
        ok: false,
        fatal: Boolean(payload.fatal),
        error: payload.error || "Calculation failed"
      });
      job.reject(new Error(payload.error || "Calculation failed"));
    }

    if (closed) {
      retireWorker(worker, "pool_closed");
      return;
    }

    if (payload.fatal) {
      stats.crashes += 1;
      killWorker(worker, "fatal_lua_error");
      ensureWorkers();
      pump();
      return;
    }

    const recycleReason = shouldRecycle(worker);
    if (recycleReason) {
      retireWorker(worker, recycleReason);
      ensureWorkers();
      pump();
      return;
    }

    worker.state = "idle";
    pump();
  };

  const handleStdoutLine = (worker, rawLine) => {
    const line = rawLine.replace(/\r$/, "");
    if (line.startsWith(READY_PREFIX)) {
      let payload = {};
      try {
        payload = JSON.parse(line.slice(READY_PREFIX.length));
      } catch {
        // Treat malformed ready line as fatal startup failure.
        killWorker(worker, "malformed_ready_frame");
        return;
      }
      if (worker.startTimer) {
        clearTimeout(worker.startTimer);
        worker.startTimer = null;
      }
      const rssBytes = payload.rssBytes || readLinuxPidRssBytes(worker.pid);
      if (rssBytes) worker.rssBytes = rssBytes;
      if (payload.luaMemKb) worker.luaMemKb = payload.luaMemKb;
      worker.readyAt = Date.now();
      consecutiveStartFailures = 0;
      lastStartError = null;
      logEvent("info", {
        event: "pob_worker_ready",
        workerId: worker.id,
        pid: worker.pid,
        startupMs: worker.readyAt - worker.startedAt,
        rssMb: worker.rssBytes ? Math.round((worker.rssBytes / (1024 * 1024)) * 10) / 10 : null
      });
      if (closed) {
        retireWorker(worker, "pool_closed");
        return;
      }
      worker.state = "idle";
      if (worker.resolveReady) {
        worker.resolveReady(worker);
        worker.resolveReady = null;
      }
      pump();
      return;
    }

    if (line.startsWith(RES_PREFIX)) {
      let payload;
      try {
        payload = JSON.parse(line.slice(RES_PREFIX.length));
      } catch (err) {
        if (worker.currentJob) {
          const job = worker.currentJob;
          worker.currentJob = null;
          cleanupTempFile(job.xmlPath);
          if (worker.jobTimer) {
            clearTimeout(worker.jobTimer);
            worker.jobTimer = null;
          }
          stats.failed += 1;
          job.reject(new Error(`Invalid worker JSON frame: ${err.message}`));
        }
        killWorker(worker, "malformed_response_frame");
        ensureWorkers();
        pump();
        return;
      }

      if (worker.currentJob && (payload.id === worker.currentJob.id || payload.id == null)) {
        finishJob(worker, worker.currentJob, payload);
      }
    }
  };

  const spawnWorker = () => {
    if (closed) return null;
    const id = nextWorkerId++;
    const startedAt = Date.now();
    let child;
    try {
      child = spawnImpl(luajit, [script || "calculate.lua", "--worker"], {
        cwd: coreDir,
        stdio: ["pipe", "pipe", "pipe"]
      });
    } catch (error) {
      consecutiveStartFailures += 1;
      lastStartFailureAt = Date.now();
      lastStartError = error.message;
      logEvent("error", { event: "pob_worker_spawn_error", workerId: id, error: error.message });
      return null;
    }

    const worker = {
      id,
      child,
      pid: child.pid || null,
      state: "starting",
      jobsDone: 0,
      startedAt,
      readyAt: null,
      rssBytes: null,
      luaMemKb: null,
      currentJob: null,
      stdoutBuf: "",
      stderrTail: "",
      startTimer: null,
      jobTimer: null,
      resolveReady: null,
      readyPromise: null
    };
    worker.readyPromise = new Promise((resolve) => {
      worker.resolveReady = resolve;
    });

    workerPool.push(worker);

    worker.startTimer = setTimeout(() => {
      worker.startTimer = null;
      if (worker.state !== "starting") return;
      consecutiveStartFailures += 1;
      lastStartFailureAt = Date.now();
      lastStartError = "Worker startup timed out";
      logEvent("error", { event: "pob_worker_start_timeout", workerId: worker.id, timeoutMs: startTimeoutMs });
      killWorker(worker, "start_timeout");
      if (worker.resolveReady) {
        worker.resolveReady(null);
        worker.resolveReady = null;
      }
      pump();
    }, startTimeoutMs);
    worker.startTimer.unref?.();

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      worker.stdoutBuf += chunk;
      let nl;
      while ((nl = worker.stdoutBuf.indexOf("\n")) !== -1) {
        const line = worker.stdoutBuf.slice(0, nl);
        worker.stdoutBuf = worker.stdoutBuf.slice(nl + 1);
        handleStdoutLine(worker, line);
      }
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      worker.stderrTail = (worker.stderrTail + chunk).slice(-2048);
    });

    const onUnexpectedExit = (reason) => {
      if (worker.startTimer) {
        clearTimeout(worker.startTimer);
        worker.startTimer = null;
      }
      if (worker.jobTimer) {
        clearTimeout(worker.jobTimer);
        worker.jobTimer = null;
      }
      const prevState = worker.state;
      worker.state = "dead";
      const idx = workerPool.indexOf(worker);
      if (idx !== -1) workerPool.splice(idx, 1);

      if (worker.resolveReady) {
        worker.resolveReady(null);
        worker.resolveReady = null;
      }

      if (prevState === "recycling" || prevState === "dead" || closed) {
        return;
      }

      if (prevState === "starting") {
        consecutiveStartFailures += 1;
        lastStartFailureAt = Date.now();
        lastStartError = worker.stderrTail.trim() || reason;
        logEvent("error", {
          event: "pob_worker_start_failed",
          workerId: worker.id,
          reason,
          stderr: worker.stderrTail.trim() || undefined
        });
        pump();
        return;
      }

      stats.crashes += 1;
      if (prevState === "busy" && worker.currentJob) {
        const job = worker.currentJob;
        worker.currentJob = null;
        cleanupTempFile(job.xmlPath);
        stats.failed += 1;
        const detail = worker.stderrTail.trim() || reason;
        logEvent("error", {
          event: "pob_job",
          workerId: worker.id,
          priority: job.priority,
          queueWaitMs: job.queueWaitMs,
          calcMs: Date.now() - job.calcStartedAt,
          ok: false,
          crashed: true,
          error: detail
        });
        job.reject(new Error(`Calculation worker crashed (${detail})`));
      } else {
        logEvent("error", { event: "pob_worker_crashed", workerId: worker.id, pid: worker.pid, reason });
      }

      ensureWorkers();
      pump();
    };

    child.on("error", (err) => onUnexpectedExit(err.message));
    child.on("exit", (code, sig) => onUnexpectedExit(sig ? `signal ${sig}` : `code ${code}`));
    child.stdin.on("error", () => { /* handled via child exit */ });

    return worker;
  };

  const canTrySpawningWorkers = () => {
    if (consecutiveStartFailures === 0) return true;
    return Date.now() - lastStartFailureAt >= retryWorkerAfterMs;
  };

  const ensureWorkers = () => {
    if (closed || !canTrySpawningWorkers()) return;
    const busyOrStarting = workerPool.filter((w) => w.state === "busy" || w.state === "starting").length;
    const desired = prewarm
      ? maxWorkers
      : Math.min(maxWorkers, Math.max(workerPool.length, busyOrStarting + queuedTotal()));
    while (workerPool.length < desired) {
      const spawned = spawnWorker();
      if (!spawned) break;
    }
  };

  const dequeueNext = () => {
    while (queues.main.length > 0) {
      const job = queues.main.shift();
      cleanupJobWaiters(job);
      if (job.signal?.aborted) {
        stats.cancelled += 1;
        job.reject(makeAbortError());
        continue;
      }
      return job;
    }
    while (queues.background.length > 0) {
      const job = queues.background.shift();
      cleanupJobWaiters(job);
      if (job.signal?.aborted) {
        stats.cancelled += 1;
        job.reject(makeAbortError());
        continue;
      }
      return job;
    }
    return null;
  };

  const dispatchToWorker = (worker, job) => {
    worker.state = "busy";
    worker.currentJob = job;
    job.queueWaitMs = Date.now() - job.enqueuedAt;
    job.calcStartedAt = Date.now();
    job.xmlPath = join(tmpdir(), `pob_worker_${process.pid}_${worker.id}_${job.id}_${Math.random().toString(36).slice(2, 8)}.xml`);

    try {
      writeFileSync(job.xmlPath, job.xml, "utf8");
    } catch (error) {
      worker.currentJob = null;
      worker.state = "idle";
      stats.failed += 1;
      job.reject(error);
      pump();
      return;
    }

    worker.jobTimer = setTimeout(() => {
      worker.jobTimer = null;
      if (worker.currentJob !== job) return;
      worker.currentJob = null;
      cleanupTempFile(job.xmlPath);
      stats.timeouts += 1;
      stats.failed += 1;
      logEvent("error", {
        event: "pob_job",
        workerId: worker.id,
        priority: job.priority,
        queueWaitMs: job.queueWaitMs,
        calcMs: Date.now() - job.calcStartedAt,
        ok: false,
        timedOut: true,
        error: "Calculation timed out"
      });
      job.reject(new Error("Calculation timed out"));
      killWorker(worker, "job_timeout");
      ensureWorkers();
      pump();
    }, timeoutMs);
    worker.jobTimer.unref?.();

    const frame = JSON.stringify({ id: job.id, xmlPath: job.xmlPath }) + "\n";
    try {
      worker.child.stdin.write(frame);
    } catch (error) {
      clearTimeout(worker.jobTimer);
      worker.jobTimer = null;
      worker.currentJob = null;
      cleanupTempFile(job.xmlPath);
      stats.failed += 1;
      job.reject(new Error(`Failed to send job to worker: ${error.message}`));
      killWorker(worker, "stdin_write_error");
      ensureWorkers();
      pump();
    }
  };

  const dispatchFallback = (job) => {
    fallbackRunning += 1;
    stats.fallbacks += 1;
    const queueWaitMs = Date.now() - job.enqueuedAt;
    const calcStartedAt = Date.now();
    Promise.resolve()
      .then(() => oneShotFallback(job.xml, { coreDir, luajit, timeoutMs, script }))
      .then((data) => {
        stats.completed += 1;
        logEvent("info", {
          event: "pob_job",
          workerId: "one-shot",
          priority: job.priority,
          queueWaitMs,
          calcMs: Date.now() - calcStartedAt,
          ok: true,
          fallback: true
        });
        job.resolve(data);
      })
      .catch((error) => {
        stats.failed += 1;
        logEvent("error", {
          event: "pob_job",
          workerId: "one-shot",
          priority: job.priority,
          queueWaitMs,
          calcMs: Date.now() - calcStartedAt,
          ok: false,
          fallback: true,
          error: error.message
        });
        job.reject(error);
      })
      .finally(() => {
        fallbackRunning -= 1;
        pump();
      });
  };

  const pump = () => {
    if (closed) return;

    // Dispatch to idle workers first.
    for (;;) {
      const idleWorker = workerPool.find((w) => w.state === "idle");
      if (!idleWorker) break;
      const job = dequeueNext();
      if (!job) break;
      dispatchToWorker(idleWorker, job);
    }

    // If queued jobs remain and workers cannot start, fall back to one-shot execution
    // (or fail cleanly if no fallback was supplied).
    if (queuedTotal() > 0 && workerPool.length === 0 && !canTrySpawningWorkers()) {
      if (oneShotFallback) {
        while (queuedTotal() > 0 && fallbackRunning < maxWorkers) {
          const job = dequeueNext();
          if (!job) break;
          dispatchFallback(job);
        }
      } else {
        while (queuedTotal() > 0) {
          const job = dequeueNext();
          if (!job) break;
          stats.failed += 1;
          job.reject(new Error(lastStartError ? `PoB worker failed to start: ${lastStartError}` : "PoB worker failed to start"));
        }
      }
    }
  };

  const run = (xml, { priority: rawPriority = "main", signal } = {}) => {
    if (closed) return Promise.reject(new Error("Calculator pool is shut down"));
    if (signal?.aborted) {
      stats.cancelled += 1;
      return Promise.reject(makeAbortError());
    }

    const priority = normalizePriority(rawPriority);

    return new Promise((resolve, reject) => {
      const job = {
        id: nextJobId++,
        xml,
        priority,
        signal: signal || null,
        enqueuedAt: Date.now(),
        queueWaitMs: 0,
        calcStartedAt: 0,
        xmlPath: null,
        waitTimer: null,
        onAbort: null,
        resolve,
        reject
      };

      // Fast path: an idle worker is ready and no higher-priority job is ahead.
      const idleWorker = workerPool.find((w) => w.state === "idle");
      const canRunNow = idleWorker && (priority === "main" || queues.main.length === 0);
      if (canRunNow) {
        dispatchToWorker(idleWorker, job);
        return;
      }

      // Check queue capacity before enqueueing (jobs waiting on a lazily-starting
      // worker slot do not count against the backlog limit behind busy workers).
      const startingCount = workerPool.filter((w) => w.state === "starting").length;
      const freeLazySlots = canTrySpawningWorkers() ? Math.max(0, maxWorkers - workerPool.length) : 0;
      if (queuedTotal() - startingCount - freeLazySlots >= maxQueue) {
        reject(makeBusyError("Calculator busy, retry shortly", "QUEUE_FULL"));
        return;
      }

      queues[priority].push(job);

      job.waitTimer = setTimeout(() => {
        job.waitTimer = null;
        if (!removeFromQueue(job)) return;
        cleanupJobWaiters(job);
        reject(makeBusyError("Calculator queue wait timed out, retry shortly", "QUEUE_TIMEOUT"));
      }, maxQueueWaitMs);
      job.waitTimer.unref?.();

      if (signal) {
        job.onAbort = () => {
          if (!removeFromQueue(job)) return;
          cleanupJobWaiters(job);
          stats.cancelled += 1;
          reject(makeAbortError());
        };
        signal.addEventListener("abort", job.onAbort, { once: true });
      }

      ensureWorkers();
      pump();
    });
  };

  const prewarmWorkers = async () => {
    if (closed) return;
    while (workerPool.length < maxWorkers && canTrySpawningWorkers()) {
      const spawned = spawnWorker();
      if (!spawned) break;
    }
    await Promise.all(workerPool.map((w) => w.readyPromise));
  };

  const health = () => {
    const workers = workerPool.map((w) => {
      const linuxRss = readLinuxPidRssBytes(w.pid);
      if (linuxRss) w.rssBytes = linuxRss;
      return {
        id: w.id,
        pid: w.pid,
        state: w.state,
        jobs: w.jobsDone,
        rssBytes: w.rssBytes,
        rssMb: w.rssBytes ? Math.round((w.rssBytes / (1024 * 1024)) * 10) / 10 : null,
        luaMemMb: w.luaMemKb ? Math.round((w.luaMemKb / 1024) * 10) / 10 : null,
        uptimeMs: Date.now() - w.startedAt
      };
    });
    const busy = workers.filter((w) => w.state === "busy").length + fallbackRunning;
    return {
      maxWorkers,
      busy,
      idle: workers.filter((w) => w.state === "idle").length,
      starting: workers.filter((w) => w.state === "starting").length,
      queued: {
        main: queues.main.length,
        background: queues.background.length,
        total: queuedTotal()
      },
      workers,
      stats: { ...stats }
    };
  };

  const close = async () => {
    if (closed) return;
    closed = true;

    for (const key of ["main", "background"]) {
      while (queues[key].length > 0) {
        const job = queues[key].shift();
        cleanupJobWaiters(job);
        job.reject(new Error("Calculator pool is shutting down"));
      }
    }

    const toClose = workerPool.splice(0, workerPool.length);
    await Promise.all(toClose.map((worker) => new Promise((resolve) => {
      if (worker.startTimer) {
        clearTimeout(worker.startTimer);
        worker.startTimer = null;
      }
      if (worker.jobTimer) {
        clearTimeout(worker.jobTimer);
        worker.jobTimer = null;
      }
      if (worker.currentJob) {
        const job = worker.currentJob;
        worker.currentJob = null;
        cleanupTempFile(job.xmlPath);
        job.reject(new Error("Calculator pool is shutting down"));
      }
      if (worker.resolveReady) {
        worker.resolveReady(null);
        worker.resolveReady = null;
      }

      const done = () => resolve();
      if (worker.child.exitCode !== null || worker.child.signalCode !== null) {
        resolve();
        return;
      }
      worker.child.once("exit", done);

      const wasIdle = worker.state === "idle";
      worker.state = "dead";
      if (wasIdle) {
        try {
          worker.child.stdin.write('{"cmd":"quit"}\n');
          worker.child.stdin.end();
        } catch {
          try { worker.child.kill("SIGKILL"); } catch { /* exited */ }
        }
        const forceKill = setTimeout(() => {
          try { worker.child.kill("SIGKILL"); } catch { /* exited */ }
        }, 1000);
        forceKill.unref?.();
        worker.child.once("exit", () => clearTimeout(forceKill));
      } else {
        try { worker.child.kill("SIGKILL"); } catch {
          try { worker.child.kill(); } catch { /* exited */ }
        }
      }
    })));
  };

  if (prewarm) {
    // Start prewarming asynchronously so construction stays synchronous.
    void prewarmWorkers();
  }

  return { run, health, prewarm: prewarmWorkers, close };
}
