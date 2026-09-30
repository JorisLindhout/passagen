export type Work = {
  id: string;
  source: string;
  title: string;
  artist: string;
  date: string;
  culture: string;
  medium: string;
  license: string;
  credit: string;
  pageUrl: string;
  aspect: number;
  image: string;
  /** painting, drawing, print, poster, photograph, collage, digital, or empty. */
  kind: string;
  region: string;
  /** The rule loosened to let this work hang, "ephemera" or "unnamed", or empty. */
  relaxed: string;
};

const API_IMAGE = /^\/api\/image\/[a-z0-9][a-z0-9_-]{0,120}\/[A-Za-z0-9_-]{1,2000}\/[A-Za-z0-9_-]{43}$/;
/** The Art Institute's images come straight from its IIIF server; the Worker cannot fetch them. */
const DIRECT_IMAGE = /^https:\/\/www\.artic\.edu\/iiif\/2\/[A-Za-z0-9%_-]{1,200}\/full\/[0-9,!]{1,20}\/0\/default\.jpg$/;

/**
 * Browsers' broken image icons, redrawn as pixel SVGs in public/fallback, hung
 * as works in their own right. None of the originals carries an open licence,
 * so the plaque credits the designer and says the drawing is a copy.
 * Used when /api/works cannot fill the walls or a museum image fails to load.
 */
export const FALLBACK_WORKS: Work[] = [
  icon({
    id: "icon-netscape",
    title: "Broken image",
    artist: "Marsh Chamberlin",
    date: "1994",
    credit: "Netscape Navigator",
    medium: "Icon for a picture that failed to load: a page with a circle, a triangle and a square, torn",
    pageUrl: "https://ccm.net/apps-sites/internet-archeology/9769-broken-image-icon-where-does-it-come-from/",
    aspect: 30 / 34,
    image: "/fallback/broken-netscape.svg",
  }),
  icon({
    id: "icon-explorer",
    title: "Broken image",
    artist: "Microsoft",
    date: "1990s",
    credit: "Internet Explorer",
    medium: "Icon for a picture that failed to load: a red cross in the empty box",
    pageUrl: "https://medium.com/@tbarrasso/on-the-broken-image-icon-9d8cd3eb990f",
    aspect: 1,
    image: "/fallback/broken-explorer.svg",
  }),
  icon({
    id: "icon-safari",
    title: "Broken image",
    artist: "Apple",
    date: "2003",
    credit: "Safari",
    medium: "Icon for a picture that failed to load: a question mark",
    pageUrl: "https://medium.com/@tbarrasso/on-the-broken-image-icon-9d8cd3eb990f",
    aspect: 1,
    image: "/fallback/broken-safari.svg",
  }),
  icon({
    id: "icon-chrome",
    title: "Broken image",
    artist: "Google",
    date: "2008",
    credit: "Google Chrome",
    medium: "Icon for a picture that failed to load: a landscape with its corner torn off",
    pageUrl: "http://www.blanktape.com.br/en/exhibitions/broken-page-2/",
    aspect: 30 / 26,
    image: "/fallback/broken-chrome.svg",
  }),
  icon({
    id: "icon-mountain",
    title: "Missing image",
    artist: "Unknown",
    date: "2000s",
    credit: "Everywhere on the web",
    medium: "Placeholder for a picture that is not there: mountains and a sun",
    pageUrl: "https://www.independent.co.uk/tech/internet-famous-viral-image-b2865628.html",
    aspect: 32 / 24,
    image: "/fallback/missing-mountain.svg",
  }),
];

const FALLBACK_IDS = new Set(FALLBACK_WORKS.map((work) => work.id));

/** Fallback icons stand in for missing works; looking at one says nothing about taste. */
export function isFallback(work: Work): boolean {
  return FALLBACK_IDS.has(work.id);
}

function icon(work: Pick<Work, "id" | "title" | "artist" | "date" | "credit" | "medium" | "pageUrl" | "aspect" | "image">): Work {
  return { ...work, source: "icon", culture: "", license: "Redrawn for this museum", kind: "digital", region: "", relaxed: "" };
}

export function sanitizeWorks(value: unknown): Work[] {
  if (!Array.isArray(value)) return [];
  const works: Work[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const image = typeof record.image === "string" ? record.image : "";
    if (!API_IMAGE.test(image) && !DIRECT_IMAGE.test(image)) continue;
    const aspect = typeof record.aspect === "number" ? record.aspect : Number.NaN;
    if (!Number.isFinite(aspect) || aspect < 0.45 || aspect > 2.25) continue;
    const license = typeof record.license === "string" ? record.license : "";
    if (license !== "CC0" && license !== "CC BY" && license !== "CC BY-SA" && license !== "Public domain") continue;
    const artist = text(record.artist);
    if ((license === "CC BY" || license === "CC BY-SA") && !artist) continue;
    const id = text(record.id);
    if (!id) continue;
    works.push({
      id,
      source: text(record.source),
      title: text(record.title) || "Untitled",
      artist: artist || "Unknown",
      date: text(record.date),
      culture: text(record.culture),
      medium: text(record.medium),
      license,
      credit: text(record.credit),
      pageUrl: httpUrl(record.pageUrl),
      aspect,
      image,
      kind: text(record.kind),
      region: text(record.region),
      relaxed: text(record.relaxed),
    });
  }
  return works;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function httpUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    return url.toString();
  } catch {
    return "";
  }
}
