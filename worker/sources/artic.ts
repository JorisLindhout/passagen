import { imageAllowed } from "../http";
import { classifyRegion, combineRegion } from "../region";
import {
  asRecord,
  aspectOk,
  cleanText,
  type Getter,
  type RegionName,
  type WorkDraft,
} from "../types";

export async function queryArtic(options: {
  place: string;
  region: RegionName;
  page: number;
  get: Getter;
}): Promise<WorkDraft[]> {
  const first = await search(options.get, options.place, options.page);
  const rows = first.length > 0 || options.page === 1 ? first : await search(options.get, options.place, 1);
  const works: WorkDraft[] = [];
  for (const row of rows) {
    const draft = toDraft(row, options.place, options.region);
    if (draft) works.push(draft);
  }
  return works;
}

async function search(get: Getter, place: string, page: number): Promise<Record<string, unknown>[]> {
  const url = new URL("https://api.artic.edu/api/v1/artworks/search");
  url.searchParams.set("query[bool][must][0][term][is_public_domain]", "true");
  url.searchParams.set("query[bool][must][1][match][place_of_origin]", place);
  url.searchParams.set("limit", "20");
  url.searchParams.set("page", String(page));
  url.searchParams.set(
    "fields",
    "id,title,image_id,artist_title,artist_display,date_display,place_of_origin,medium_display,thumbnail",
  );
  const body = asRecord(await get(url.toString()));
  const data = body?.data;
  if (!Array.isArray(data)) return [];
  return data.map((row) => asRecord(row)).filter((row): row is Record<string, unknown> => row !== null);
}

function toDraft(row: Record<string, unknown>, expectedPlace: string, region: RegionName): WorkDraft | null {
  const imageId = cleanText(row.image_id);
  const id = typeof row.id === "number" ? row.id : Number(row.id);
  if (!imageId || !Number.isFinite(id)) return null;
  const place = cleanText(row.place_of_origin);
  const found = classifyRegion(`${place} ${expectedPlace}`);
  if (found !== "unknown" && region !== "unknown" && found !== region && classifyRegion(place) !== region) {
    if (classifyRegion(place) !== "unknown" && classifyRegion(place) !== region) return null;
  }
  const thumb = asRecord(row.thumbnail);
  const width = typeof thumb?.width === "number" ? thumb.width : Number.NaN;
  const height = typeof thumb?.height === "number" ? thumb.height : Number.NaN;
  if (height <= 0 || width <= 0) return null;
  const aspect = width / height;
  if (!aspectOk(aspect)) return null;
  const imageUrl = `https://www.artic.edu/iiif/2/${encodeURIComponent(imageId)}/full/800,/0/default.jpg`;
  if (!imageAllowed(imageUrl, null, "artic")) return null;
  const artist =
    cleanText(row.artist_title) || firstLine(cleanText(row.artist_display)) || "Unknown";
  return {
    id: `artic-${id}`,
    source: "artic",
    title: cleanText(row.title) || "Untitled",
    artist,
    date: cleanText(row.date_display),
    culture: place,
    medium: cleanText(row.medium_display),
    license: "Public domain",
    credit: "Art Institute of Chicago",
    pageUrl: `https://www.artic.edu/artworks/${id}`,
    aspect,
    imageUrl,
    thumbHost: null,
    region: combineRegion(region, place),
  };
}

function firstLine(value: string): string {
  return value.split("\n")[0]?.trim() ?? "";
}
