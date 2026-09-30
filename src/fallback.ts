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

const API_IMAGE = /^\/api\/image\/[a-z0-9][a-z0-9_-]{0,120}$/;

/**
 * Eight stable Met Open Access images. The museum releases these public-domain
 * works as CC0. The files ship in public/fallback because images.metmuseum.org
 * no longer sends Access-Control-Allow-Origin.
 * Used when /api/works cannot fill the walls or a museum image fails to load.
 */
export const FALLBACK_WORKS: Work[] = [
  {
    id: "met-51868",
    source: "met",
    title: "Painting",
    artist: "Unidentified artist",
    date: "20th century",
    culture: "China",
    medium: "Leaf from an album; ink on paper",
    license: "CC0",
    credit: "The Metropolitan Museum of Art",
    pageUrl: "https://www.metmuseum.org/art/collection/search/51868",
    aspect: 1.2398,
    image: "/fallback/met-51868.jpg",
    kind: "painting",
    region: "asia",
    relaxed: "",
  },
  {
    id: "met-544502",
    source: "met",
    title: "Ceiling painting from the palace of Amenhotep III",
    artist: "Unknown",
    date: "ca. 1386–1347 BCE",
    culture: "Egyptian",
    medium: "Dried mud, mud plaster, paint, gesso",
    license: "CC0",
    credit: "The Metropolitan Museum of Art",
    pageUrl: "https://www.metmuseum.org/art/collection/search/544502",
    aspect: 1,
    image: "/fallback/met-544502.jpg",
    kind: "painting",
    region: "africa",
    relaxed: "",
  },
  {
    id: "met-436122",
    source: "met",
    title: "The Collector of Prints",
    artist: "Edgar Degas",
    date: "1866",
    culture: "",
    medium: "Oil on canvas",
    license: "CC0",
    credit: "The Metropolitan Museum of Art",
    pageUrl: "https://www.metmuseum.org/art/collection/search/436122",
    aspect: 0.7547,
    image: "/fallback/met-436122.jpg",
    kind: "painting",
    region: "europe",
    relaxed: "",
  },
  {
    id: "met-311021",
    source: "met",
    title: "Helmet crest from a nja masquerade",
    artist: "Grassfields artists",
    date: "ca. 1800–80",
    culture: "Bamum kingdom",
    medium: "Wood, copper, glass beads, raffia palm, cowrie shells",
    license: "CC0",
    credit: "The Metropolitan Museum of Art",
    pageUrl: "https://www.metmuseum.org/art/collection/search/311021",
    aspect: 0.688,
    image: "/fallback/met-311021.jpg",
    kind: "",
    region: "africa",
    relaxed: "",
  },
  {
    id: "met-453351",
    source: "met",
    title: "The Angel Gabriel meets 'Amr ibn Zaid (the Shepherd)",
    artist: "Mustafa ibn Vali",
    date: "ca. 1595",
    culture: "",
    medium: "Ink, opaque watercolor, and gold on paper",
    license: "CC0",
    credit: "The Metropolitan Museum of Art",
    pageUrl: "https://www.metmuseum.org/art/collection/search/453351",
    aspect: 0.7027,
    image: "/fallback/met-453351.jpg",
    kind: "painting",
    region: "asia",
    relaxed: "",
  },
  {
    id: "met-286582",
    source: "met",
    title: "General Robert E. Lee",
    artist: "Mathew B. Brady",
    date: "1865",
    culture: "",
    medium: "Albumen silver print from glass negative",
    license: "CC0",
    credit: "The Metropolitan Museum of Art",
    pageUrl: "https://www.metmuseum.org/art/collection/search/286582",
    aspect: 0.6643,
    image: "/fallback/met-286582.jpg",
    kind: "photograph",
    region: "americas",
    relaxed: "",
  },
  {
    id: "met-13997",
    source: "met",
    title: "Poet's-narcissus textile",
    artist: "Associated Artists",
    date: "1883–1900",
    culture: "American",
    medium: "Linen, woven and printed",
    license: "CC0",
    credit: "The Metropolitan Museum of Art",
    pageUrl: "https://www.metmuseum.org/art/collection/search/13997",
    aspect: 1.2611,
    image: "/fallback/met-13997.jpg",
    kind: "",
    region: "americas",
    relaxed: "",
  },
  {
    id: "met-249232",
    source: "met",
    title: "Couch and footstool with bone carvings and glass inlays",
    artist: "Unknown",
    date: "1st–2nd century CE",
    culture: "Roman",
    medium: "Wood, bone, glass",
    license: "CC0",
    credit: "The Metropolitan Museum of Art",
    pageUrl: "https://www.metmuseum.org/art/collection/search/249232",
    aspect: 1.6339,
    image: "/fallback/met-249232.jpg",
    kind: "",
    region: "europe",
    relaxed: "",
  },
];

export function sanitizeWorks(value: unknown): Work[] {
  if (!Array.isArray(value)) return [];
  const works: Work[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const image = typeof record.image === "string" ? record.image : "";
    if (!API_IMAGE.test(image)) continue;
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
