import { imageAllowed } from "../http";
import { cleanText, httpUrl, asRecord, aspectOk, type Getter, type RegionName, type WorkDraft } from "../types";

export type CommonsRoom = {
  category: string;
  museum: string;
  region: RegionName;
  /** Files counted in the category tree; offsets stay under it. */
  size: number;
};

/**
 * Museum categories on Wikimedia Commons whose holdings are mostly made where
 * the museum stands, so the region tag stays honest for the Europe cap.
 */
export const COMMONS_ROOMS: CommonsRoom[] = [
  { category: "Collections of the Tokyo National Museum", museum: "Tokyo National Museum", region: "asia", size: 4600 },
  { category: "Collections of the Kyoto National Museum", museum: "Kyoto National Museum", region: "asia", size: 320 },
  { category: "Paintings in the National Palace Museum", museum: "National Palace Museum, Taipei", region: "asia", size: 2000 },
  { category: "Collections of the National Museum of Korea", museum: "National Museum of Korea", region: "asia", size: 2900 },
  {
    category: "Paintings in the Museu Nacional de Belas Artes",
    museum: "Museu Nacional de Belas Artes, Rio de Janeiro",
    region: "americas",
    size: 980,
  },
  { category: "Paintings in the Museo de Arte de Lima", museum: "Museo de Arte de Lima", region: "americas", size: 90 },
  {
    category: "Paintings in the Pinacoteca do Estado de São Paulo",
    museum: "Pinacoteca do Estado de São Paulo",
    region: "americas",
    size: 550,
  },
  { category: "Paintings in the Museu Paulista", museum: "Museu Paulista, São Paulo", region: "americas", size: 1100 },
  { category: "Paintings in the Museo Nacional de Colombia", museum: "Museo Nacional de Colombia", region: "americas", size: 80 },
  { category: "Collections of Te Papa", museum: "Te Papa Tongarewa, Wellington", region: "oceania", size: 4300 },
  {
    category: "Collections of the State Library of New South Wales",
    museum: "State Library of New South Wales",
    region: "oceania",
    size: 9900,
  },
  { category: "Museum collections from Nigeria", museum: "", region: "africa", size: 400 },
];

export async function queryCommons(options: { room: CommonsRoom; pick: number; get: Getter }): Promise<WorkDraft[]> {
  const offset = Math.floor((options.pick * Math.min(options.room.size, 9900)) / 20) * 20;
  const first = await search(options.get, options.room.category, offset);
  const pages = first.length > 0 || offset === 0 ? first : await search(options.get, options.room.category, 0);
  const works: WorkDraft[] = [];
  for (const page of pages) {
    const draft = toDraft(page, options.room);
    if (draft) works.push(draft);
  }
  return works;
}

async function search(get: Getter, category: string, offset: number): Promise<Record<string, unknown>[]> {
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.searchParams.set("action", "query");
  url.searchParams.set("format", "json");
  url.searchParams.set("formatversion", "2");
  url.searchParams.set("generator", "search");
  url.searchParams.set("gsrsearch", `deepcat:"${category}" filetype:bitmap`);
  url.searchParams.set("gsrnamespace", "6");
  url.searchParams.set("gsrlimit", "20");
  url.searchParams.set("gsroffset", String(offset));
  url.searchParams.set("prop", "imageinfo");
  url.searchParams.set("iiprop", "url|size|mime|extmetadata");
  url.searchParams.set("iiurlwidth", "960");
  url.searchParams.set("iiextmetadatafilter", "License|Artist|ObjectName|DateTimeOriginal");
  const body = asRecord(await get(url.toString()));
  const pages = asRecord(body?.query)?.pages;
  if (!Array.isArray(pages)) return [];
  return pages
    .map((page) => asRecord(page))
    .filter((page): page is Record<string, unknown> => page !== null)
    .sort((a, b) => Number(a.index) - Number(b.index));
}

function toDraft(page: Record<string, unknown>, room: CommonsRoom): WorkDraft | null {
  const pageId = typeof page.pageid === "number" ? page.pageid : Number.NaN;
  if (!Number.isInteger(pageId) || pageId <= 0) return null;
  const info = asRecord(Array.isArray(page.imageinfo) ? page.imageinfo[0] : null);
  if (!info || !/^image\/(jpeg|png|tiff|webp)$/.test(cleanText(info.mime))) return null;
  const width = Number(info.width);
  const height = Number(info.height);
  if (!(width > 0) || !(height > 0)) return null;
  const aspect = width / height;
  if (!aspectOk(aspect)) return null;
  const imageUrl = withoutQuery(cleanText(info.thumburl, 600));
  if (!imageUrl || !imageAllowed(imageUrl, null, "commons")) return null;

  const meta = asRecord(info.extmetadata);
  const license = licenseOf(field(meta, "License"));
  if (!license) return null;
  const artist = artistOf(field(meta, "Artist"));
  const title = withoutStatements(field(meta, "ObjectName")) || fileTitle(cleanText(page.title));
  return {
    id: `wm-${pageId}`,
    source: "commons",
    title: title || "Untitled",
    artist,
    date: objectDate(withoutStatements(field(meta, "DateTimeOriginal"))),
    culture: "",
    medium: "",
    license,
    credit: room.museum ? `${room.museum} · Wikimedia Commons` : "Wikimedia Commons",
    pageUrl: httpUrl(info.descriptionurl),
    aspect,
    imageUrl,
    thumbHost: null,
    region: room.region,
  };
}

function field(meta: Record<string, unknown> | null, name: string): string {
  const value = asRecord(meta?.[name])?.value;
  if (typeof value !== "string") return "";
  const text = value
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ");
  return cleanText(text, 300);
}

/** Only free licenses without share-alike: public domain marks, CC0, and plain CC BY. */
function licenseOf(code: string): WorkDraft["license"] | null {
  const value = code.toLowerCase();
  if (value === "pd" || value.startsWith("pd-")) return "Public domain";
  if (value === "cc0") return "CC0";
  if (/^cc-by-\d(\.\d)?$/.test(value)) return "CC BY";
  return null;
}

function artistOf(text: string): string {
  if (!text || /unknown|anonymous|unidentified/i.test(text)) return "Unknown";
  const name = text
    .replace(/\s*\[\d+\]/g, "")
    .replace(/^User:/i, "")
    .split(/\s{2,}|\s\(|\s-\s|\s–\s/)[0];
  return name?.slice(0, 80).trim() || "Unknown";
}

/** A photograph of an object carries the day it was taken; that is not the object's date. */
function objectDate(text: string): string {
  if (/\d{1,2}:\d{2}/.test(text) || /^(199\d|20\d\d)-\d\d/.test(text)) return "";
  return text.slice(0, 80);
}

/** Wikidata-backed templates leave "label QS:…" or "date QS:…" behind once the markup is stripped. */
function withoutStatements(text: string): string {
  return text.replace(/\s*(?:label|title|date) QS:.*$/i, "").trim();
}

function fileTitle(title: string): string {
  return title
    .replace(/^File:/, "")
    .replace(/\.[a-z0-9]{3,4}$/i, "")
    .replace(/_/g, " ")
    .trim();
}

function withoutQuery(raw: string): string {
  try {
    const url = new URL(raw);
    url.search = "";
    return url.toString();
  } catch {
    return "";
  }
}
