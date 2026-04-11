function parseCookies(cookieHeader) {
  const cookies = {};

  if (!cookieHeader) {
    return cookies;
  }

  for (const part of cookieHeader.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) {
      continue;
    }

    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    cookies[key] = value;
  }

  return cookies;
}

function buildDebugCookie(name, value, maxAge) {
  return [
    `${name}=${value}`,
    "Path=/",
    `Max-Age=${maxAge}`,
    "HttpOnly",
    "Secure",
    "SameSite=None"
  ].join("; ");
}

function buildRedirectResponse(url, cookieName, cookieValue, maxAge) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: url.toString(),
      "Set-Cookie": buildDebugCookie(cookieName, cookieValue, maxAge),
      "Cache-Control": "private, no-store"
    }
  });
}

function getRequiredEnv(env, key) {
  const value = env[key];

  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${key}`);
  }

  return value;
}

function getConfig(env) {
  const debugOrigin = getRequiredEnv(env, "DEBUG_ORIGIN");
  const debugIp = getRequiredEnv(env, "DEBUG_IP");
  const debugCookie =
    (typeof env.DEBUG_COOKIE === "string" && env.DEBUG_COOKIE.trim() !== "")
      ? env.DEBUG_COOKIE.trim()
      : "cf_local_debug";
  const debugMaxAge = env.DEBUG_MAX_AGE !== undefined && env.DEBUG_MAX_AGE !== ""
    ? Number(env.DEBUG_MAX_AGE)
    : 3600;

  if (!Number.isFinite(debugMaxAge) || debugMaxAge < 0) {
    throw new Error("DEBUG_MAX_AGE must be a non-negative number");
  }

  return {
    debugOrigin,
    debugIp,
    debugCookie,
    debugMaxAge
  };
}

export default {
  async fetch(request, env) {
    const requestUrl = new URL(request.url);

    if (/\.(png|jpe?g|gif|svg|webp|ico|bmp|tiff|avif)$/i.test(requestUrl.pathname)) {
      return fetch(request);
    }

    const config = getConfig(env);
    const clientIp =
      request.headers.get("CF-Connecting-IP") ||
      request.headers.get("CF-Connecting-IPv6") ||
      "";

    const cookies = parseCookies(request.headers.get("Cookie"));
    const hasDebugCookie = cookies[config.debugCookie] === "1";

    const enableRequested = requestUrl.searchParams.get("cf_local_debug") === "1";
    const disableRequested = requestUrl.searchParams.get("cf_local_debug") === "0";
    const ipMatches = clientIp === config.debugIp;

    if (enableRequested && ipMatches) {
      const cleanUrl = new URL(requestUrl);
      cleanUrl.searchParams.delete("cf_local_debug");
      return buildRedirectResponse(
        cleanUrl,
        config.debugCookie,
        "1",
        config.debugMaxAge
      );
    }

    if (disableRequested) {
      const cleanUrl = new URL(requestUrl);
      cleanUrl.searchParams.delete("cf_local_debug");
      return buildRedirectResponse(cleanUrl, config.debugCookie, "0", 0);
    }

    if (!(hasDebugCookie && ipMatches)) {
      return fetch(request);
    }

    const debugOrigin = new URL(config.debugOrigin);
    const targetUrl = new URL(requestUrl);
    targetUrl.protocol = debugOrigin.protocol;
    targetUrl.hostname = debugOrigin.hostname;
    targetUrl.port = debugOrigin.port;
    targetUrl.searchParams.delete("cf_local_debug");

    const headers = new Headers(request.headers);
    headers.delete("Host");
    headers.set("Host", debugOrigin.hostname); // Explicitly set Host to ngrok to be completely safe
    headers.set("x-debug-via", "cloudflare-worker");
    headers.set("x-original-host", requestUrl.hostname);
    // Removed x-forwarded-host as some strict tunnels drop connections if it doesn't match SNI
    headers.set("x-forwarded-proto", "https");
    headers.set("x-forwarded-for", clientIp);

    const proxiedRequest = new Request(targetUrl.toString(), {
      method: request.method,
      headers,
      body: request.body,
      redirect: "manual"
    });

    const upstream = await fetch(proxiedRequest);
    const response = new Response(upstream.body, upstream);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
};
