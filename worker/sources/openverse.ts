import { imageAllowed } from "../http";
import { combineRegion } from "../region";
import { artistKey, asRecord, aspectOk, cleanText, httpUrl, type Getter, type WorkDraft } from "../types";

export async function queryOpenverse(options: {
  query: "painting" | "print" | "photograph";
  page: number;
  get: Getter;
}): Promise<WorkDraft[]> {
  const first = await search(options.get, options.query, options.page);
  const rows = first.length > 0 || options.page === 1 ? first : await search(options.get, options.query, 1);
  const works: WorkDraft[] = [];
  for (const row of rows) {
    const draft = toDraft(row);
    if (draft) works.push(draft);
  }
  return works;
}

async function search(
  get: Getter,
  query: string,
  page: number,
): Promise<Record<string, unknown>[]> {
  const url = new URL("https://api.openverse.org/v1/images/");
  url.searchParams.set("q", query);
  url.searchParams.set("license", "cc0,by");
  url.searchParams.set("mature", "false");
  url.searchParams.set("page_size", "20");
  url.searchParams.set("page", String(page));
  const body = asRecord(await get(url.toString()));
  const results = body?.results;
  if (!Array.isArray(results)) return [];
  return results
    .map((row) => asRecord(row))
    .filter((row): row is Record<string, unknown> => row !== null);
}

function toDraft(row: Record<string, unknown>): WorkDraft | null {
  if (row.mature === true) return null;
  const licenseName = cleanText(row.license);
  if (licenseName !== "cc0" && licenseName !== "by") return null;
  const thumbnail = httpUrl(row.thumbnail);
  let thumbHost: string | null = null;
  try {
    thumbHost = new URL(thumbnail).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!imageAllowed(thumbnail, thumbHost, "openverse")) return null;
  const width = typeof row.width === "number" ? row.width : Number.NaN;
  const height = typeof row.height === "number" ? row.height : Number.NaN;
  if (height <= 0 || width <= 0) return null;
  const aspect = width / height;
  if (!aspectOk(aspect)) return null;
  const artist = cleanText(row.creator) || "Unknown";
  if (licenseName === "by" && !artistKey(artist)) return null;
  const id = cleanText(row.id).toLowerCase();
  if (!/^[a-z0-9-]{8,80}$/.test(id)) return null;
  const source = cleanText(row.source);
  const place = cleanText(row.title);
  return {
    id: `ov-${id}`,
    source: "openverse",
    title: place || "Untitled",
    artist,
    date: "",
    culture: "",
    medium: cleanText(row.category),
    license: licenseName === "by" ? "CC BY" : "CC0",
    credit: source ? `Openverse · ${source}` : "Openverse",
    pageUrl: httpUrl(row.foreign_landing_url) || `https://openverse.org/image/${id}`,
    aspect,
    imageUrl: thumbnail,
    thumbHost,
    region: combineRegion("unknown", `${artist} ${place}`),
  };
}
