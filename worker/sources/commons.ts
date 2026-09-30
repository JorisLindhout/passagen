import { imageAllowed } from "../http";
import {
  cleanText,
  httpUrl,
  asRecord,
  aspectOk,
  type Getter,
  type Kind,
  type RegionName,
  type WorkDraft,
} from "../types";

export type CommonsRoom = {
  /** A CirrusSearch expression; `deepcat:` only on trees that stay within one kind of work. */
  search: string;
  museum: string;
  region: RegionName;
  kind: Kind;
  /**
   * A faithful scan of an old work is tagged public domain; a visitor's photo
   * of it in the gallery carries the photographer's own CC licence.
   */
  publicDomainOnly: boolean;
  /** Files the search counts; offsets stay under it. */
  size: number;
};

/**
 * Painting and print categories of museums whose holdings are mostly made
 * where the museum stands, so the region tag stays honest for the Europe cap.
 * The broader "Collections of …" trees mix in objects and photos of objects.
 */
export const COMMONS_ROOMS: CommonsRoom[] = [
  {
    search: 'deepcat:"Paintings in the Tokyo National Museum"',
    museum: "Tokyo National Museum",
    region: "asia",
    kind: "painting",
    publicDomainOnly: true,
    size: 1150,
  },
  {
    search: 'deepcat:"Ukiyo-e in the Tokyo National Museum"',
    museum: "Tokyo National Museum",
    region: "asia",
    kind: "print",
    publicDomainOnly: true,
    size: 170,
  },
  {
    search: 'deepcat:"Paintings in the Kyoto National Museum"',
    museum: "Kyoto National Museum",
    region: "asia",
    kind: "painting",
    publicDomainOnly: true,
    size: 190,
  },
  {
    search: 'deepcat:"Paintings in the National Palace Museum"',
    museum: "National Palace Museum, Taipei",
    region: "asia",
    kind: "painting",
    publicDomainOnly: true,
    size: 2000,
  },
  {
    search: 'deepcat:"Paintings in the National Museum of Korea"',
    museum: "National Museum of Korea",
    region: "asia",
    kind: "painting",
    publicDomainOnly: true,
    size: 110,
  },
  {
    search: 'deepcat:"Paintings in the Museu Nacional de Belas Artes"',
    museum: "Museu Nacional de Belas Artes, Rio de Janeiro",
    region: "americas",
    kind: "painting",
    publicDomainOnly: true,
    size: 980,
  },
  {
    search: 'deepcat:"Paintings in the Museo de Arte de Lima"',
    museum: "Museo de Arte de Lima",
    region: "americas",
    kind: "painting",
    publicDomainOnly: true,
    size: 90,
  },
  {
    search: 'deepcat:"Paintings in the Pinacoteca do Estado de São Paulo"',
    museum: "Pinacoteca do Estado de São Paulo",
    region: "americas",
    kind: "painting",
    publicDomainOnly: true,
    size: 550,
  },
  {
    search: 'deepcat:"Paintings in the Museu Paulista"',
    museum: "Museu Paulista, São Paulo",
    region: "americas",
    kind: "painting",
    publicDomainOnly: true,
    size: 1100,
  },
  {
    search: 'deepcat:"Paintings in the Museo Nacional de Colombia"',
    museum: "Museo Nacional de Colombia",
    region: "americas",
    kind: "painting",
    publicDomainOnly: true,
    size: 80,
  },
  {
    search: 'deepcat:"Paintings in Te Papa"',
    museum: "Te Papa Tongarewa, Wellington",
    region: "oceania",
    kind: "painting",
    publicDomainOnly: true,
    size: 2200,
  },
];

/**
 * Kinds museums hold little of in the open: photographs made as pictures,
 * collages, and born-digital work. "Computer art", "Abstract art" and
 * "Photomontages" were left out; their files are mostly snapshots, panoramas
 * and focus stacks. `incategory:` stays one level deep; A|B|C is an OR.
 */
export const COMMONS_WIDE: CommonsRoom[] = [
  { search: 'deepcat:"Pictorialism"', museum: "", region: "unknown", kind: "photograph", publicDomainOnly: true, size: 9900 },
  { search: 'deepcat:"Collages by artist"', museum: "", region: "unknown", kind: "collage", publicDomainOnly: false, size: 470 },
  {
    search: "incategory:Digital_art|Digital_drawings|Fractal_art|Algorithmic_art|Glitch_art",
    museum: "",
    region: "unknown",
    kind: "digital",
    publicDomainOnly: false,
    size: 2700,
  },
];

/** Uploaders who photograph works in the gallery and sign the file as its author. */
const GALLERY_PHOTOGRAPHERS = new Set(["daderot"]);

/**
 * Library of Congress scans (and their LCCN numbers) bring a photographer's
 * survey, news and government work into the same categories as their
 * portraits; so do other copies of survey photographs of buildings and rooms.
 */
const SURVEY =
  /\b(houses?|home|mansions?|buildings?|warehouses?|rooms?|bedrooms?|classrooms?|interiors?|lobby|halls?|estates?|farms?|plantations?|churches|streets?|avenues?|exhibits?)\b/i;

/** Categories that mark a snapshot, a screen, a gallery view, or a machine-made image. */
const NOT_ART_CATEGORY =
  /panorama|focus stack|screenshot|\blogos?\b|diagram|\bmaps?\b|ai-generated|midjourney|stable diffusion|dall-e|exhibitions?\b|installation|museum interior|interiors? of|photographs of (museum|galler)/i;

export async function queryCommons(options: { room: CommonsRoom; pick: number; get: Getter }): Promise<WorkDraft[]> {
  const offset = Math.floor((options.pick * Math.min(options.room.size, 9900)) / 20) * 20;
  const first = await search(options.get, options.room.search, offset);
  const pages = first.length > 0 || offset === 0 ? first : await search(options.get, options.room.search, 0);
  const works: WorkDraft[] = [];
  for (const page of pages) {
    const draft = toDraft(page, options.room);
    if (draft) works.push(draft);
  }
  return works;
}

async function search(get: Getter, expression: string, offset: number): Promise<Record<string, unknown>[]> {
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.searchParams.set("action", "query");
  url.searchParams.set("format", "json");
  url.searchParams.set("formatversion", "2");
  url.searchParams.set("generator", "search");
  url.searchParams.set("gsrsearch", `${expression} filetype:bitmap`);
  url.searchParams.set("gsrnamespace", "6");
  url.searchParams.set("gsrlimit", "20");
  url.searchParams.set("gsroffset", String(offset));
  url.searchParams.set("prop", "imageinfo|categories");
  url.searchParams.set("cllimit", "max");
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
  const categories = Array.isArray(page.categories)
    ? page.categories.map((category) => cleanText(asRecord(category)?.title))
    : [];
  if (categories.some((category) => NOT_ART_CATEGORY.test(category))) return null;
  const width = Number(info.width);
  const height = Number(info.height);
  if (!(width > 0) || !(height > 0)) return null;
  const aspect = width / height;
  if (!aspectOk(aspect)) return null;
  const imageUrl = withoutQuery(cleanText(info.thumburl, 600));
  if (!imageUrl || !imageAllowed(imageUrl, null, "commons")) return null;

  const meta = asRecord(info.extmetadata);
  const license = licenseOf(field(meta, "License"));
  if (!license || (room.publicDomainOnly && license !== "Public domain")) return null;
  const artist = artistOf(field(meta, "Artist"));
  if (GALLERY_PHOTOGRAPHERS.has(artist.toLowerCase())) return null;
  const title = withoutStatements(field(meta, "ObjectName")) || fileTitle(cleanText(page.title));
  if (room.kind === "photograph") {
    const fromCongress =
      /\bLCCN/.test(title) || categories.includes("Category:Images from the Library of Congress");
    if (fromCongress || SURVEY.test(title)) return null;
  }
  return {
    id: `wm-${pageId}`,
    source: "commons",
    kind: room.kind,
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

/** Public domain marks, CC0, CC BY and CC BY-SA; no non-commercial or no-derivatives terms. */
function licenseOf(code: string): WorkDraft["license"] | null {
  const value = code.toLowerCase();
  if (value === "pd" || value.startsWith("pd-")) return "Public domain";
  if (value === "cc0") return "CC0";
  if (/^cc-by-\d(\.\d)?$/.test(value)) return "CC BY";
  if (/^cc-by-sa-\d(\.\d)?$/.test(value)) return "CC BY-SA";
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
