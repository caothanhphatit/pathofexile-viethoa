export const rows = async (client, text, params = []) => {
  const result = await client.query(text, params);
  return result.rows;
};

export const one = async (client, text, params = []) => {
  const result = await client.query(text, params);
  return result.rows[0] || null;
};

export const json = (value, fallback) => {
  if (value == null) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return value;
};
