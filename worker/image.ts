import { blockedHostname, CACHE_SECONDS, imageAllowed, userAgentFor } from "./http";
import { asRecord } from "./types";

const MAX_BYTES = 6_000_000;

type StoredImage = {
  imageUrl: string;
  thumbHost: string | null;
  source: string;
};

export async function handleImage(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  id: string,
): Promise<Response> {
  const cacheKey = new Request(new URL(request.url).origin + `/api/image/${id}`, { method: "GET" });
  const cached = await caches.default.match(cacheKey);
  if (cached) return cached;

  const stored = asRecord(await env.ART.get(`img:v1:${id}`, "json"));
  const record = readRecord(stored);
  if (!record || !imageAllowed(record.imageUrl, record.thumbHost, record.source)) {
    return new Response(null, { status: 404, headers: { "cache-control": "no-store" } });
  }

  let upstream: Response;
  try {
    upstream = await fetchAllowed(record.imageUrl, record.thumbHost, record.source);
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "image fetch failed",
        id,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return new Response(null, { status: 502, headers: { "cache-control": "no-store" } });
  }
  if (!upstream.ok || !upstream.body) {
    console.error(JSON.stringify({ message: "image upstream failed", id, status: upstream.status }));
    return new Response(null, { status: 502, headers: { "cache-control": "no-store" } });
  }

  const declared = Number(upstream.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    return new Response(null, { status: 502, headers: { "cache-control": "no-store" } });
  }

  const bytes = await readLimited(upstream);
  if (!bytes) return new Response(null, { status: 502, headers: { "cache-control": "no-store" } });
  const type = imageType(upstream.headers.get("content-type"), bytes);
  if (!type) return new Response(null, { status: 502, headers: { "cache-control": "no-store" } });

  const response = new Response(bytes, {
    headers: {
      "content-type": type,
      "cache-control": `public, max-age=${CACHE_SECONDS}`,
      "x-content-type-options": "nosniff",
    },
  });
  ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
  return response;
}

function readRecord(value: Record<string, unknown> | null): StoredImage | null {
  if (!value || typeof value.imageUrl !== "string" || typeof value.source !== "string") return null;
  const thumbHost = typeof value.thumbHost === "string" ? value.thumbHost : null;
  if (thumbHost && blockedHostname(thumbHost)) return null;
  return { imageUrl: value.imageUrl, thumbHost, source: value.source };
}

async function fetchAllowed(start: string, thumbHost: string | null, source: string): Promise<Response> {
  let current = start;
  for (let hop = 0; hop < 3; hop++) {
    if (!imageAllowed(current, thumbHost, source)) {
      return new Response(null, { status: 403 });
    }
    const response = await fetch(current, {
      redirect: "manual",
      headers: { "User-Agent": userAgentFor(current), Accept: "image/avif,image/webp,image/*,*/*;q=0.8" },
      signal: AbortSignal.timeout(12_000),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return new Response(null, { status: 502 });
      current = new URL(location, current).toString();
      continue;
    }
    return response;
  }
  return new Response(null, { status: 502 });
}

async function readLimited(response: Response): Promise<Uint8Array | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function imageType(header: string | null, bytes: Uint8Array): string | null {
  const sniffed = sniff(bytes);
  if (sniffed) return sniffed;
  if (!header) return null;
  const type = header.split(";")[0]?.trim().toLowerCase() ?? "";
  if (type === "image/jpeg" || type === "image/png" || type === "image/webp" || type === "image/gif") {
    return type;
  }
  return null;
}

function sniff(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image/gif";
  return null;
}
