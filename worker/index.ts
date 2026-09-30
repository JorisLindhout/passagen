import { CACHE_SECONDS } from "./http";
import { handleImage } from "./image";
import { asRecord, type ClientWork } from "./types";
import { chooseWorks, toClient } from "./works";

/** A shared seed, then the maze's place in the chain: alpha.0, alpha.1, … A hall adds alpha.6.1, alpha.6.2, … */
const SEED = /^[A-Za-z0-9_-]{1,64}(?:\.[0-9]{1,7}){0,2}$/;
const IMAGE_ID = /^[a-z0-9][a-z0-9_-]{0,120}$/;

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "GET") {
      return Response.json({ error: "method not allowed" }, { status: 405, headers: { "cache-control": "no-store" } });
    }
    if (url.pathname === "/api/works") return handleWorks(url, env, ctx);
    const imageId = url.pathname.match(/^\/api\/image\/([^/]+)$/)?.[1] ?? "";
    if (IMAGE_ID.test(imageId)) return handleImage(request, env, ctx, imageId);
    if (url.pathname.startsWith("/api/")) {
      return Response.json({ error: "not found" }, { status: 404, headers: { "cache-control": "no-store" } });
    }
    return new Response(null, { status: 404 });
  },
} satisfies ExportedHandler<Env>;

async function handleWorks(url: URL, env: Env, ctx: ExecutionContext): Promise<Response> {
  const seed = url.searchParams.get("seed") ?? "";
  if (!SEED.test(seed)) {
    return Response.json({ error: "seed required" }, { status: 400, headers: { "cache-control": "no-store" } });
  }

  const cacheKey = new Request(`${url.origin}/api/works?seed=${encodeURIComponent(seed)}`, { method: "GET" });
  const cached = await caches.default.match(cacheKey);
  if (cached) return cached;

  const kvKey = `works:v3:${seed}`;
  const stored = await env.ART.get(kvKey, "json");
  const fromKv = clientList(stored);
  if (fromKv && fromKv.length >= 12) {
    const response = jsonWorks(fromKv);
    ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
    return response;
  }

  try {
    const drafts = await chooseWorks(seed, env.SMITHSONIAN_API_KEY);
    const works = drafts.map(toClient);
    console.log(
      JSON.stringify({
        message: "works selected",
        seed,
        count: works.length,
        sources: works.map((work) => work.source),
      }),
    );
    if (works.length === 0) {
      return Response.json({ error: "unavailable" }, { status: 502, headers: { "cache-control": "no-store" } });
    }
    const ttl = works.length >= 12 ? CACHE_SECONDS : 120;
    await Promise.all([
      env.ART.put(kvKey, JSON.stringify(works), { expirationTtl: ttl }),
      ...drafts.map((work) =>
        env.ART.put(
          `img:v1:${work.id}`,
          JSON.stringify({
            imageUrl: work.imageUrl,
            thumbHost: work.thumbHost,
            source: work.source,
          }),
          { expirationTtl: ttl },
        ),
      ),
    ]);
    const response = jsonWorks(works, ttl);
    if (works.length >= 12) ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
    return response;
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "works failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return Response.json({ error: "unavailable" }, { status: 502, headers: { "cache-control": "no-store" } });
  }
}

function jsonWorks(works: ClientWork[], ttl = CACHE_SECONDS): Response {
  return Response.json(works, {
    headers: { "cache-control": `public, max-age=${ttl}` },
  });
}

function clientList(value: unknown): ClientWork[] | null {
  if (!Array.isArray(value)) return null;
  const works: ClientWork[] = [];
  for (const item of value) {
    const record = asRecord(item);
    if (!record) return null;
    const image = typeof record.image === "string" ? record.image : "";
    const id = typeof record.id === "string" ? record.id : "";
    if (!IMAGE_ID.test(id) || image !== `/api/image/${id}`) return null;
    const aspect = typeof record.aspect === "number" ? record.aspect : Number.NaN;
    const license = record.license;
    if (license !== "CC0" && license !== "CC BY" && license !== "CC BY-SA" && license !== "Public domain") return null;
    if (!Number.isFinite(aspect)) return null;
    works.push({
      id,
      source: record.source as ClientWork["source"],
      title: text(record.title),
      artist: text(record.artist),
      date: text(record.date),
      culture: text(record.culture),
      medium: text(record.medium),
      license,
      credit: text(record.credit),
      pageUrl: text(record.pageUrl),
      aspect,
      image,
    });
  }
  return works;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}
