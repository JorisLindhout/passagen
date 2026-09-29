import { imageAllowed } from "../http";
import { combineRegion } from "../region";
import { asRecord, aspectOk, cleanText, httpUrl, type Getter, type RegionName, type WorkDraft } from "../types";

const TYPES = new Set(["Painting", "Print", "Photograph"]);

export async function queryCleveland(options: {
  department: string;
  region: RegionName;
  after: number;
  before: number;
  type: string;
  skip: number;
  get: Getter;
}): Promise<WorkDraft[]> {
  const types = [options.type, ...["Painting", "Print", "Photograph"].filter((type) => type !== options.type)];
  for (const type of types) {
    let rows = await search(options.get, options, type, options.skip);
    if (rows.length === 0 && options.skip > 0) rows = await search(options.get, options, type, 0);
    const works: WorkDraft[] = [];
    for (const row of rows) {
      const draft = toDraft(row, options.region);
      if (draft) works.push(draft);
    }
    if (works.length > 0) return works;
  }
  return [];
}

async function search(
  get: Getter,
  options: { department: string; after: number; before: number },
  type: string,
  skip: number,
): Promise<Record<string, unknown>[]> {
  const url = new URL("https://openaccess-api.clevelandart.org/api/artworks/");
  url.searchParams.set("cc0", "1");
  url.searchParams.set("has_image", "1");
  url.searchParams.set("department", options.department);
  url.searchParams.set("created_after", String(options.after));
  url.searchParams.set("created_before", String(options.before));
  url.searchParams.set("limit", "30");
  url.searchParams.set("skip", String(skip));
  if (type) url.searchParams.set("type", type);
  const body = asRecord(await get(url.toString()));
  const data = body?.data;
  if (!Array.isArray(data)) return [];
  return data.map((row) => asRecord(row)).filter((row): row is Record<string, unknown> => row !== null);
}

function toDraft(row: Record<string, unknown>, region: RegionName): WorkDraft | null {
  if (cleanText(row.share_license_status) !== "CC0") return null;
  const type = cleanText(row.type);
  if (!TYPES.has(type)) return null;
  const images = asRecord(row.images);
  const web = asRecord(images?.web);
  const imageUrl = httpUrl(web?.url).replace(/^http:\/\//i, "https://");
  if (!imageAllowed(imageUrl, null, "cleveland")) return null;
  const width = Number(web?.width);
  const height = Number(web?.height);
  if (height <= 0 || width <= 0) return null;
  const aspect = width / height;
  if (!aspectOk(aspect)) return null;
  const id = cleanText(row.accession_number) || String(row.id ?? "");
  if (!/^[A-Za-z0-9._-]+$/.test(id)) return null;
  const creators = Array.isArray(row.creators) ? row.creators : [];
  const creator = asRecord(creators[0]);
  const artist = shortArtist(cleanText(creator?.description)) || "Unknown";
  const culture = Array.isArray(row.culture)
    ? row.culture.filter((item): item is string => typeof item === "string").join(", ")
    : cleanText(row.culture);
  const department = cleanText(row.department);
  return {
    id: `cma-${id.toLowerCase().replace(/[^a-z0-9_-]+/g, "-")}`,
    source: "cleveland",
    title: cleanText(row.title) || "Untitled",
    artist,
    date: cleanText(row.creation_date),
    culture,
    medium: cleanText(row.technique),
    license: "CC0",
    credit: "The Cleveland Museum of Art",
    pageUrl: httpUrl(row.url),
    aspect,
    imageUrl,
    thumbHost: null,
    region: combineRegion(region, `${department} ${culture}`),
  };
}

function shortArtist(description: string): string {
  const paren = description.indexOf(" (");
  return (paren > 0 ? description.slice(0, paren) : description).trim();
}
