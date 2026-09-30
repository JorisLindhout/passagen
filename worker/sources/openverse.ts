import { imageAllowed } from "../http";
import { kindFromText, OBJECT_WORDS } from "../kind";
import { combineRegion } from "../region";
import {
  artistKey,
  asRecord,
  aspectOk,
  cleanText,
  httpUrl,
  needsAttribution,
  type Getter,
  type RegionName,
  type WorkDraft,
} from "../types";

/**
 * Art museums and libraries that Openverse indexes and we don't query
 * directly, so one work can't hang twice under two IDs. Open uploads (Flickr,
 * rawpixel, Wikimedia) return paint textures, 3D printers and snapshots.
 */
const PROVIDERS: Record<string, { name: string; region: RegionName }> = {
  rijksmuseum: { name: "Rijksmuseum", region: "europe" },
  brooklynmuseum: { name: "Brooklyn Museum", region: "unknown" },
  smithsonian_portrait_gallery: { name: "National Portrait Gallery", region: "americas" },
  smithsonian_hirshhorn_museum: { name: "Hirshhorn Museum", region: "unknown" },
  bib_gulbenkian: { name: "Gulbenkian Art Library", region: "europe" },
  nypl: { name: "New York Public Library", region: "unknown" },
};

export const OPENVERSE_QUERIES = [
  "painting",
  "drawing",
  "watercolor",
  "print",
  "woodcut",
  "etching",
  "lithograph",
  "engraving",
  "poster",
  "photograph",
] as const;

const LICENSES: Record<string, WorkDraft["license"]> = { cc0: "CC0", by: "CC BY", "by-sa": "CC BY-SA" };

export async function queryOpenverse(options: {
  query: string;
  page: number;
  get: Getter;
}): Promise<WorkDraft[]> {
  const first = await search(options.get, options.query, options.page);
  const rows = first.length > 0 || options.page === 1 ? first : await search(options.get, options.query, 1);
  const works: WorkDraft[] = [];
  const pages = new Set<string>();
  for (const row of rows) {
    const draft = toDraft(row);
    if (!draft || pages.has(draft.pageUrl)) continue;
    pages.add(draft.pageUrl);
    works.push(draft);
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
  url.searchParams.set("source", Object.keys(PROVIDERS).join(","));
  url.searchParams.set("license", Object.keys(LICENSES).join(","));
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
  const provider = cleanText(row.source);
  const holder = PROVIDERS[provider];
  if (!holder) return null;
  const license = LICENSES[cleanText(row.license)];
  if (!license) return null;
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
  if (needsAttribution(license) && !artistKey(artist)) return null;
  const id = cleanText(row.id).toLowerCase();
  if (!/^[a-z0-9-]{8,80}$/.test(id)) return null;
  const pageUrl = httpUrl(row.foreign_landing_url);
  if (!pageUrl) return null;

  const title = cleanText(row.title);
  const tags = Array.isArray(row.tags)
    ? row.tags.map((tag) => cleanText(asRecord(tag)?.name)).filter(Boolean).join(", ")
    : "";
  if (OBJECT_WORDS.test(`${title} ${tags}`)) return null;
  const kind = kindFromText(title) ?? kindFromText(tags);
  if (!kind) return null;
  return {
    id: `ov-${id}`,
    source: "openverse",
    kind,
    title: title || "Untitled",
    artist,
    date: "",
    culture: "",
    medium: "",
    license,
    credit: `${holder.name} · Openverse`,
    pageUrl,
    aspect,
    imageUrl: thumbnail,
    thumbHost,
    region: combineRegion(holder.region, `${artist} ${title}`),
  };
}
