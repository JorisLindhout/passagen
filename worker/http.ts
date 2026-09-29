import type { Getter } from "./types";

export const USER_AGENT = "MuseumMaze/1.0 (first-person gallery of public-domain art)";

export const CACHE_SECONDS = 60 * 60 * 24 * 7;

const FIXED_HOSTS = new Set([
  "images.metmuseum.org",
  "www.artic.edu",
  "openaccess-cdn.clevelandart.org",
  "ids.si.edu",
]);

export function createGetter(limit = 40): Getter {
  let count = 0;
  return async (url: string) => {
    if (count >= limit) throw new Error("request limit");
    count += 1;
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  };
}

export function imageAllowed(raw: string, thumbHost: string | null, source: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  if (url.username || url.password) return false;
  if (url.port && url.port !== "443") return false;
  const host = url.hostname.toLowerCase();
  if (blockedHostname(host)) return false;
  if (FIXED_HOSTS.has(host) || host.endsWith(".si.edu")) return true;
  return source === "openverse" && !!thumbHost && host === thumbHost.toLowerCase();
}

export function blockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (
    !host ||
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".localhost")
  ) {
    return true;
  }
  if (host.includes(":")) return true;
  if (host === "0.0.0.0" || host.startsWith("127.") || host.startsWith("10.")) return true;
  if (host.startsWith("192.168.") || host.startsWith("169.254.")) return true;
  return /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
}

export function aspectFromPair(height: number, width: number): number | null {
  if (!Number.isFinite(height) || !Number.isFinite(width) || height <= 0 || width <= 0) return null;
  return width / height;
}

/** Museum dimension strings are height × width, with centimeters in parentheses. */
export function aspectFromDimensions(text: string): number | null {
  const cm = text.match(/\(\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*cm/i);
  if (!cm) return null;
  return aspectFromPair(Number(cm[1]), Number(cm[2]));
}
