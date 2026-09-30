import { blockedHostname, CACHE_SECONDS, imageAllowed, userAgentFor } from "./http";
import { readImagePath, type SignedImage } from "./signing";

const MAX_BYTES = 6_000_000;
/** The browser hangs a fallback after this; the fetch goes on in the background so the next visit finds it cached. */
const ANSWER_MS = 4_000;
const FETCH_MS = 25_000;
/** A host that refused an image is not asked again for a while. */
const REFUSED_SECONDS = 60 * 60;

type Loaded =
  | { ok: true; bytes: Uint8Array; type: string }
  /** `lasting` marks an answer the host will give again, not a timeout or a dropped connection. */
  | { ok: false; lasting: boolean };

export async function handleImage(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  id: string,
  payload: string,
  signature: string,
): Promise<Response> {
  const secret = env.IMAGE_SIGNING_KEY ?? "";
  const record = secret ? await readImagePath(secret, id, payload, signature) : null;
  if (
    !record ||
    (record.thumbHost && blockedHostname(record.thumbHost)) ||
    !imageAllowed(record.imageUrl, record.thumbHost, record.source)
  ) {
    return new Response(null, { status: 404, headers: { "cache-control": "no-store" } });
  }

  const cacheKey = new Request(new URL(request.url).origin + `/api/image/${id}`, { method: "GET" });
  const cached = await caches.default.match(cacheKey);
  if (cached) return cached;

  const loading = loadImage(record, id);
  ctx.waitUntil(
    loading.then(async (loaded) => {
      if (loaded.ok || loaded.lasting) await caches.default.put(cacheKey, toResponse(loaded));
    }),
  );
  const loaded = await Promise.race([
    loading,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ANSWER_MS)),
  ]);
  if (loaded) return toResponse(loaded);
  console.error(JSON.stringify({ message: "image slow", id }));
  return new Response(null, { status: 504, headers: { "cache-control": "no-store" } });
}

function toResponse(loaded: Loaded): Response {
  if (!loaded.ok) {
    if (!loaded.lasting) return new Response(null, { status: 502, headers: { "cache-control": "no-store" } });
    return new Response(null, { status: 404, headers: { "cache-control": `public, max-age=${REFUSED_SECONDS}` } });
  }
  return new Response(loaded.bytes, {
    headers: {
      "content-type": loaded.type,
      "cache-control": `public, max-age=${CACHE_SECONDS}`,
      "x-content-type-options": "nosniff",
    },
  });
}

async function loadImage(record: SignedImage, id: string): Promise<Loaded> {
  try {
    const upstream = await fetchAllowed(record.imageUrl, record.thumbHost, record.source, AbortSignal.timeout(FETCH_MS));
    if (!upstream.ok || !upstream.body) {
      console.error(JSON.stringify({ message: "image upstream failed", id, status: upstream.status }));
      return { ok: false, lasting: refusal(upstream.status) };
    }
    const declared = Number(upstream.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_BYTES) return { ok: false, lasting: true };
    const bytes = await readLimited(upstream);
    if (!bytes) return { ok: false, lasting: true };
    const type = imageType(upstream.headers.get("content-type"), bytes);
    if (!type) return { ok: false, lasting: true };
    return { ok: true, bytes, type };
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "image fetch failed",
        id,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return { ok: false, lasting: false };
  }
}

/** Client errors other than a timeout or rate limit will come back the same next time. */
function refusal(status: number): boolean {
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

async function fetchAllowed(
  start: string,
  thumbHost: string | null,
  source: string,
  signal: AbortSignal,
): Promise<Response> {
  let current = start;
  for (let hop = 0; hop < 3; hop++) {
    if (!imageAllowed(current, thumbHost, source)) {
      return new Response(null, { status: 403 });
    }
    const response = await fetch(current, {
      redirect: "manual",
      headers: { "User-Agent": userAgentFor(current), Accept: "image/avif,image/webp,image/*,*/*;q=0.8" },
      signal,
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
