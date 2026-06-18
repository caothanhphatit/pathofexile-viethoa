import pg from "pg";

const { Pool } = pg;

// Pool tuning defaults. Each can be overridden via the matching env var so
// they stay configurable in different environments without code changes.
// Maximum number of clients the pool keeps open simultaneously.
export const DEFAULT_POOL_MAX = 10;
// How long an idle client may sit in the pool before being closed (ms).
export const DEFAULT_IDLE_TIMEOUT_MS = 30000;
// How long to wait for a connection from the pool before failing (ms).
export const DEFAULT_CONNECTION_TIMEOUT_MS = 10000;

export const databaseUrlFromEnv = () => process.env.POE2_DATABASE_URL || "";

export const createPool = (options = {}) => {
  const connectionString = options.connectionString || databaseUrlFromEnv();
  if (!connectionString) {
    throw new Error("Missing POE2_DATABASE_URL");
  }

  const pool = new Pool({
    connectionString,
    max: Number(process.env.PG_POOL_MAX || DEFAULT_POOL_MAX),
    idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || DEFAULT_IDLE_TIMEOUT_MS),
    connectionTimeoutMillis: Number(process.env.PG_CONNECTION_TIMEOUT_MS || DEFAULT_CONNECTION_TIMEOUT_MS),
    allowExitOnIdle: process.env.NODE_ENV === "test",
    ...options.poolOptions
  });

  // Observability only: surface pool-level events instead of letting an
  // idle-client error crash the process silently. No query-path behavior
  // changes here.
  pool.on("error", (error) => {
    console.error("[db:pool] idle client error", error);
  });
  if (process.env.PG_POOL_DEBUG === "1") {
    pool.on("connect", () => {
      console.debug("[db:pool] client connected", poolStats(pool));
    });
  }

  return pool;
};

// Small read-only snapshot of pool saturation for health checks / logging.
export const poolStats = (pool) => ({
  total: pool?.totalCount ?? 0,
  idle: pool?.idleCount ?? 0,
  waiting: pool?.waitingCount ?? 0
});

export const query = (pool, text, params = []) => pool.query(text, params);

export const withTransaction = async (pool, callback) => {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await callback(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
};

export const closePool = async (pool) => {
  if (pool) await pool.end();
};
