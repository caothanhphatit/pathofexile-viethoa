import crypto from "node:crypto";

const sessionCookieName = "poe2_session";
const googleStateCookieName = "poe2_google_oauth";
const sessionTtlMs = 1000 * 60 * 60 * 24 * 30;
const googleStateTtlMs = 1000 * 60 * 10;

const base64Url = (value) => Buffer.from(value)
  .toString("base64")
  .replace(/\+/g, "-")
  .replace(/\//g, "_")
  .replace(/=+$/g, "");

const randomId = (prefix) => `${prefix}_${base64Url(crypto.randomBytes(18))}`;

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

const cookieDate = (date) => date.toUTCString();

const safeEqual = (a, b) => {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

export const parseCookies = (cookieHeader = "") => {
  const cookies = {};
  for (const part of String(cookieHeader || "").split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (!rawName) continue;
    cookies[rawName] = decodeURIComponent(rawValue.join("="));
  }
  return cookies;
};

export const serializeCookie = (name, value, options = {}) => {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge != null) parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
  if (options.expires) parts.push(`Expires=${cookieDate(options.expires)}`);
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  return parts.join("; ");
};

const normalizeReturnTo = (value) => {
  const text = String(value || "/leveling.html").trim();
  if (!text.startsWith("/") || text.startsWith("//") || /[\r\n]/.test(text)) return "/leveling.html";
  return text;
};

const publicUser = (row) => row ? {
  id: row.id,
  email: row.email || "",
  displayName: row.display_name || "",
  avatarUrl: row.avatar_url || ""
} : null;

const publicProviders = (rows) => rows.map((row) => ({
  provider: row.provider,
  email: row.email || "",
  displayName: row.display_name || "",
  avatarUrl: row.avatar_url || ""
}));

export const createAuthService = (options = {}) => {
  const env = options.env || process.env;
  const secret = options.sessionSecret || env.APP_SESSION_SECRET || base64Url(crypto.randomBytes(32));
  const appUrl = (options.appUrl || env.APP_URL || "http://127.0.0.1:4173").replace(/\/+$/, "");
  const apiUrl = (options.apiUrl || env.API_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
  const secureCookies = env.NODE_ENV === "production" || apiUrl.startsWith("https://");

  const hmac = (value) => base64Url(crypto.createHmac("sha256", secret).update(value).digest());
  const signPayload = (payload) => {
    const body = base64Url(JSON.stringify(payload));
    return `${body}.${hmac(body)}`;
  };
  const verifyPayload = (token) => {
    const [body, signature] = String(token || "").split(".");
    if (!body || !signature || !safeEqual(hmac(body), signature)) return null;
    try {
      const payload = JSON.parse(Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
      if (payload.expiresAt && Date.parse(payload.expiresAt) < Date.now()) return null;
      return payload;
    } catch {
      return null;
    }
  };

  const cookieOptions = (expires) => ({
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure: secureCookies,
    expires
  });

  const setCookie = (reply, name, value, expires) => {
    reply.header("set-cookie", serializeCookie(name, value, cookieOptions(expires)));
  };

  const clearCookie = (reply, name) => {
    reply.header("set-cookie", serializeCookie(name, "", {
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      secure: secureCookies,
      maxAge: 0,
      expires: new Date(0)
    }));
  };

  const googleEnabled = () => Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
  const devLoginEnabled = () => env.NODE_ENV !== "production" && env.DEV_AUTH_ENABLED !== "false";
  const googleRedirectUri = () => env.GOOGLE_REDIRECT_URI || `${apiUrl}/api/auth/google/callback`;

  const requireDb = (db) => {
    if (!db) {
      const error = new Error("Database is not configured");
      error.statusCode = 503;
      throw error;
    }
    return db;
  };

  const sessionFromRequest = async (db, request) => {
    const token = parseCookies(request.headers.cookie)[sessionCookieName];
    if (!token) return { authenticated: false, user: null, providers: [] };
    const sessionHash = sha256(token);
    if (!db) return { authenticated: false, user: null, providers: [] };

    const { rows } = await db.query(`
      select u.id, u.email, u.display_name, u.avatar_url
      from user_sessions s
      join users u on u.id = s.user_id
      where s.session_hash = $1
        and s.expires_at > now()
      limit 1
    `, [sessionHash]);

    if (!rows[0]) return { authenticated: false, user: null, providers: [] };
    await db.query("update user_sessions set last_seen_at = now() where session_hash = $1", [sessionHash]);

    const providers = await db.query(`
      select provider, email, display_name, avatar_url
      from auth_accounts
      where user_id = $1
      order by provider
    `, [rows[0].id]);

    return {
      authenticated: true,
      user: publicUser(rows[0]),
      providers: publicProviders(providers.rows)
    };
  };

  const createSession = async (db, userId, request) => {
    requireDb(db);
    const token = base64Url(crypto.randomBytes(32));
    const expiresAt = new Date(Date.now() + sessionTtlMs);
    await db.query(`
      insert into user_sessions (session_hash, user_id, user_agent, ip_address, expires_at)
      values ($1, $2, $3, $4, $5)
    `, [
      sha256(token),
      userId,
      request?.headers?.["user-agent"] || "",
      request?.ip || "",
      expiresAt
    ]);
    return { token, expiresAt };
  };

  const setSessionCookie = (reply, session) => setCookie(reply, sessionCookieName, session.token, session.expiresAt);
  const clearSessionCookie = (reply) => clearCookie(reply, sessionCookieName);

  const destroySession = async (db, request) => {
    const token = parseCookies(request.headers.cookie)[sessionCookieName];
    if (token && db) await db.query("delete from user_sessions where session_hash = $1", [sha256(token)]);
  };

  const requireUser = async (db, request) => {
    const session = await sessionFromRequest(db, request);
    if (!session.authenticated) {
      const error = new Error("Unauthorized");
      error.statusCode = 401;
      throw error;
    }
    return session.user;
  };

  const createGoogleState = (returnTo) => {
    const verifier = base64Url(crypto.randomBytes(32));
    const state = base64Url(crypto.randomBytes(24));
    const expiresAt = new Date(Date.now() + googleStateTtlMs);
    return {
      state,
      verifier,
      returnTo: normalizeReturnTo(returnTo),
      expiresAt,
      cookieValue: signPayload({
        state,
        verifier,
        returnTo: normalizeReturnTo(returnTo),
        expiresAt: expiresAt.toISOString()
      })
    };
  };

  const setGoogleStateCookie = (reply, statePayload) => {
    setCookie(reply, googleStateCookieName, statePayload.cookieValue, statePayload.expiresAt);
  };
  const clearGoogleStateCookie = (reply) => clearCookie(reply, googleStateCookieName);
  const verifyGoogleState = (request, state) => {
    const payload = verifyPayload(parseCookies(request.headers.cookie)[googleStateCookieName]);
    if (!payload || payload.state !== state) {
      const error = new Error("Invalid OAuth state");
      error.statusCode = 400;
      throw error;
    }
    return {
      verifier: payload.verifier,
      returnTo: normalizeReturnTo(payload.returnTo)
    };
  };

  const googleAuthorizationUrl = (statePayload) => {
    const challenge = base64Url(crypto.createHash("sha256").update(statePayload.verifier).digest());
    const params = new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID || "",
      redirect_uri: googleRedirectUri(),
      response_type: "code",
      scope: "openid email profile",
      state: statePayload.state,
      code_challenge: challenge,
      code_challenge_method: "S256",
      access_type: "offline",
      prompt: "select_account"
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  };

  const exchangeGoogleCode = async (code, verifier) => {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID || "",
        client_secret: env.GOOGLE_CLIENT_SECRET || "",
        redirect_uri: googleRedirectUri(),
        grant_type: "authorization_code",
        code_verifier: verifier
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error_description || payload.error || "Google token exchange failed");
      error.statusCode = 502;
      throw error;
    }
    return payload;
  };

  const fetchGoogleProfile = async (accessToken) => {
    const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { authorization: `Bearer ${accessToken}` }
    });
    const profile = await response.json().catch(() => ({}));
    if (!response.ok || !profile.sub) {
      const error = new Error(profile.error_description || profile.error || "Google profile fetch failed");
      error.statusCode = 502;
      throw error;
    }
    return profile;
  };

  const upsertAuthUser = async (db, profile) => {
    requireDb(db);
    const provider = profile.provider;
    const providerUserId = profile.providerUserId;
    const email = profile.email || null;
    const displayName = profile.displayName || email || providerUserId;
    const avatarUrl = profile.avatarUrl || "";
    const account = await db.query(
      "select user_id from auth_accounts where provider = $1 and provider_user_id = $2",
      [provider, providerUserId]
    );

    let userId = account.rows[0]?.user_id || null;
    if (!userId && email) {
      const existingUser = await db.query("select id from users where email = $1", [email]);
      userId = existingUser.rows[0]?.id || null;
    }
    if (!userId) userId = randomId("usr");

    await db.query(`
      insert into users (id, email, display_name, avatar_url)
      values ($1, $2, $3, $4)
      on conflict (id) do update set
        email = coalesce(excluded.email, users.email),
        display_name = excluded.display_name,
        avatar_url = excluded.avatar_url,
        updated_at = now()
    `, [userId, email, displayName, avatarUrl]);

    await db.query(`
      insert into auth_accounts (user_id, provider, provider_user_id, email, display_name, avatar_url, profile_json)
      values ($1, $2, $3, $4, $5, $6, $7::jsonb)
      on conflict (provider, provider_user_id) do update set
        email = excluded.email,
        display_name = excluded.display_name,
        avatar_url = excluded.avatar_url,
        profile_json = excluded.profile_json,
        updated_at = now()
    `, [userId, provider, providerUserId, email, displayName, avatarUrl, JSON.stringify(profile.raw || {})]);

    const user = await db.query("select id, email, display_name, avatar_url from users where id = $1", [userId]);
    return publicUser(user.rows[0]);
  };

  const upsertDevUser = async (db) => upsertAuthUser(db, {
    provider: "dev",
    providerUserId: "local-dev-user",
    email: "local-dev@poe2.local",
    displayName: "Local test user",
    avatarUrl: "",
    raw: { mode: "development" }
  });

  return {
    appUrl,
    googleEnabled,
    devLoginEnabled,
    sessionFromRequest,
    requireUser,
    createSession,
    setSessionCookie,
    clearSessionCookie,
    destroySession,
    createGoogleState,
    setGoogleStateCookie,
    clearGoogleStateCookie,
    verifyGoogleState,
    googleAuthorizationUrl,
    exchangeGoogleCode,
    fetchGoogleProfile,
    upsertAuthUser,
    upsertDevUser
  };
};
