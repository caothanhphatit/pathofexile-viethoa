// The PoE2 log watcher reads Client.txt on the machine the backend runs on, so it only
// makes sense when the player runs the backend locally. Requests from anywhere else must
// not be able to repoint it, read its status or subscribe to the log lines it streams.

const LOOPBACK = /^(?:127\.\d{1,3}\.\d{1,3}\.\d{1,3}|::1|::ffff:127\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i;

// A reverse proxy on the same host connects from 127.0.0.1 too, so a request that carries
// forwarding headers came from somewhere else and is treated as remote.
const FORWARDING_HEADERS = ["x-forwarded-for", "x-real-ip", "forwarded", "cf-connecting-ip"];

export const isLocalRequest = (request) => {
  const remote = request?.raw?.socket?.remoteAddress || "";
  if (!LOOPBACK.test(remote)) return false;
  return !FORWARDING_HEADERS.some((name) => request.headers?.[name]);
};

export const requireLocalRequest = (request) => {
  if (isLocalRequest(request)) return;
  const error = new Error("The game log watcher is only available when the backend runs on your own machine");
  error.statusCode = 403;
  throw error;
};
