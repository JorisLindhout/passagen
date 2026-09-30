import { handleImage } from "./image";
import { imageSource } from "./signing";
import { asRecord, cleanText, type TasteSummary, type TasteWork } from "./types";
import { chooseMaze, toClient } from "./works";

const IMAGE_ID = /^[a-z0-9][a-z0-9_-]{0,120}$/;
/** Work id, then source and upstream URL in base64url, then an HMAC-SHA-256 signature. */
const IMAGE_PATH = /^\/api\/image\/([^/]+)\/([A-Za-z0-9_-]{1,2000})\/([A-Za-z0-9_-]{43})$/;
/** A maze with a large hall hangs about fifty, and asks for twelve spares. */
const MAX_COUNT = 72;
const MAX_SEEN = 2000;
const MAX_BODY_BYTES = 128 * 1024;
const MAX_LIKED = 12;
const MAX_DISLIKED = 6;
const MAX_ARTISTS = 5;

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/works") {
      if (request.method !== "POST") return error("method not allowed", 405);
      const { success } = await env.WORKS_LIMIT.limit({ key: request.headers.get("cf-connecting-ip") ?? "" });
      if (!success) return error("too many requests", 429);
      return handleWorks(request, env);
    }
    if (request.method !== "GET") return error("method not allowed", 405);
    const [, imageId = "", payload = "", signature = ""] = url.pathname.match(IMAGE_PATH) ?? [];
    if (IMAGE_ID.test(imageId)) return handleImage(request, env, ctx, imageId, payload, signature);
    if (url.pathname.startsWith("/api/")) return error("not found", 404);
    return new Response(null, { status: 404 });
  },
} satisfies ExportedHandler<Env>;

/** Every visitor's list is their own, so none is cached. */
async function handleWorks(request: Request, env: Env): Promise<Response> {
  const body = await readBody(request);
  if (!body) return error("bad request", 400);
  const secret = env.IMAGE_SIGNING_KEY ?? "";
  if (!secret) {
    console.error(JSON.stringify({ message: "works failed", error: "IMAGE_SIGNING_KEY is not set" }));
    return error("unavailable", 502);
  }

  try {
    const drafts = await chooseMaze({ ...body, env });
    const works = await Promise.all(drafts.map(async (work) => toClient(work, await imageSource(secret, work))));
    console.log(
      JSON.stringify({
        message: "works selected",
        count: works.length,
        asked: body.count,
        sources: works.map((work) => work.source),
      }),
    );
    if (works.length === 0) return error("unavailable", 502);
    return Response.json(works, { headers: { "cache-control": "no-store" } });
  } catch (failure) {
    console.error(
      JSON.stringify({
        message: "works failed",
        error: failure instanceof Error ? failure.message : String(failure),
      }),
    );
    return error("unavailable", 502);
  }
}

async function readBody(
  request: Request,
): Promise<{ count: number; seen: string[]; taste: TasteSummary | null } | null> {
  const text = await request.text().catch(() => "");
  if (!text || text.length > MAX_BODY_BYTES) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  const record = asRecord(value);
  if (!record) return null;
  const count = record.count;
  if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > MAX_COUNT) return null;
  const seen = Array.isArray(record.seen)
    ? record.seen.slice(-MAX_SEEN).filter((id): id is string => typeof id === "string" && IMAGE_ID.test(id))
    : [];
  return { count, seen, taste: readTaste(record.taste) };
}

function readTaste(value: unknown): TasteSummary | null {
  const record = asRecord(value);
  if (!record) return null;
  const list = (items: unknown, max: number) =>
    (Array.isArray(items) ? items.slice(0, max) : []).map(readTasteWork).filter((work) => work !== null);
  const liked = list(record.liked, MAX_LIKED);
  const disliked = list(record.disliked, MAX_DISLIKED);
  if (liked.length === 0 && disliked.length === 0) return null;
  const favoriteArtists = (Array.isArray(record.favoriteArtists) ? record.favoriteArtists.slice(0, MAX_ARTISTS) : [])
    .map((name) => cleanText(name, 80))
    .filter(Boolean);
  return {
    liked,
    disliked,
    favoriteArtists,
    likesEphemera: record.likesEphemera === true,
    likesUnnamed: record.likesUnnamed === true,
  };
}

function readTasteWork(value: unknown): TasteWork | null {
  const record = asRecord(value);
  if (!record) return null;
  const number = (item: unknown, max: number) =>
    typeof item === "number" && Number.isFinite(item) ? Math.max(-max, Math.min(max, item)) : 0;
  const title = cleanText(record.title, 120);
  const artist = cleanText(record.artist, 80);
  if (!title && !artist) return null;
  return {
    title,
    artist,
    date: cleanText(record.date, 60),
    culture: cleanText(record.culture, 60),
    medium: cleanText(record.medium, 100),
    kind: cleanText(record.kind, 20),
    region: cleanText(record.region, 20),
    source: cleanText(record.source, 20),
    seconds: Math.round(number(record.seconds, 30)),
    plaque: record.plaque === true,
    revisits: Math.round(number(record.revisits, 10)),
    skips: Math.round(number(record.skips, 10)),
    score: number(record.score, 100),
  };
}

function error(message: string, status: number): Response {
  return Response.json({ error: message }, { status, headers: { "cache-control": "no-store" } });
}
