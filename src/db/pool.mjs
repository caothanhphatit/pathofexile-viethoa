import pg from "pg";

const { Pool } = pg;

export const databaseUrlFromEnv = () => process.env.POE2_DATABASE_URL || "";

export const createPool = (options = {}) => {
  const connectionString = options.connectionString || databaseUrlFromEnv();
  if (!connectionString) {
    throw new Error("Missing POE2_DATABASE_URL");
  }

  return new Pool({
    connectionString,
    max: Number(process.env.PG_POOL_MAX || 10),
    idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 30000),
    connectionTimeoutMillis: Number(process.env.PG_CONNECTION_TIMEOUT_MS || 10000),
    allowExitOnIdle: process.env.NODE_ENV === "test",
    ...options.poolOptions
  });
};

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
