/**
 * Resolves API and WS base URLs.
 *
 * If NEXT_PUBLIC_API_URL / NEXT_PUBLIC_WS_URL are set, uses those (explicit mode).
 * Otherwise, derives from window.location (same-origin mode, for Caddy reverse proxy).
 */

let cached: { apiUrl: string; wsUrl: string } | null = null;

function normalizeHttpUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim().replace(/\/+$/, "");
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  const protocol = trimmed.startsWith("localhost") || trimmed.startsWith("127.0.0.1") ? "http" : "https";
  return `${protocol}://${trimmed}`;
}

function normalizeWsUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim().replace(/\/+$/, "");
  if (/^wss?:\/\//i.test(trimmed)) {
    return trimmed.endsWith("/ws") ? trimmed : `${trimmed}/ws`;
  }
  const protocol = trimmed.startsWith("localhost") || trimmed.startsWith("127.0.0.1") ? "ws" : "wss";
  return `${protocol}://${trimmed}/ws`;
}

function resolve(): { apiUrl: string; wsUrl: string } {
  if (cached) return cached;

  const envApi = process.env.NEXT_PUBLIC_API_URL?.trim();
  const envWs = process.env.NEXT_PUBLIC_WS_URL?.trim();

  if (envApi) {
    const apiUrl = normalizeHttpUrl(envApi);
    const wsUrl = envWs ? normalizeWsUrl(envWs) : `${apiUrl.replace(/^http/i, "ws")}/ws`;
    cached = { apiUrl, wsUrl };
  } else if (typeof window !== "undefined") {
    const { protocol, host } = window.location;
    const isSecure = protocol === "https:";
    cached = {
      apiUrl: `${protocol}//${host}`,
      wsUrl: `${isSecure ? "wss" : "ws"}://${host}/ws`,
    };
  } else {
    // SSR fallback — don't cache empty strings so client can resolve properly after hydration
    return { apiUrl: "", wsUrl: "" };
  }

  return cached;
}

export function getApiUrl(): string {
  return resolve().apiUrl;
}

export function getWsUrl(): string {
  return resolve().wsUrl;
}
