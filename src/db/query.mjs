export const rows = async (client, text, params = []) => {
  const result = await client.query(text, params);
  return result.rows;
};

export const one = async (client, text, params = []) => {
  const result = await client.query(text, params);
  return result.rows[0] || null;
};

let warnedJsonFallback = false;

// Coerce a DB column value into a parsed object.
// - Returns `fallback` for null/undefined.
// - Parses JSON strings; on parse failure returns `fallback`.
// - When `strict` is true, a parse failure throws instead of silently
//   falling back, so callers that cannot tolerate corruption can opt in.
// The first time the fallback path is hit a single console.warn fires so
// silent data corruption becomes observable without spamming logs.
export const json = (value, fallback, { strict = false } = {}) => {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (error) {
      if (strict) throw error;
      if (!warnedJsonFallback) {
        warnedJsonFallback = true;
        console.warn("[db:query] json() fell back after parse failure (further warnings suppressed)", error?.message);
      }
      return fallback;
    }
  }
  return value;
};
