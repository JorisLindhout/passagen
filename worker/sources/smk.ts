import { imageAllowed } from "../http";
import { combineRegion } from "../region";
import { asRecord, aspectOk, cleanText, httpUrl, type Getter, type WorkDraft } from "../types";

/** Public-domain works with images: about 4,600 paintings among some 39,000 objects. */
const SIZE = { painting: 4600, any: 39000 } as const;

export type SmkKind = keyof typeof SIZE;

export async function querySmk(options: { kind: SmkKind; pick: number; get: Getter }): Promise<WorkDraft[]> {
  const offset = Math.floor((options.pick * SIZE[options.kind]) / 20) * 20;
  const first = await search(options.get, options.kind, offset);
  const rows = first.length > 0 || offset === 0 ? first : await search(options.get, options.kind, 0);
  const works: WorkDraft[] = [];
  for (const row of rows) {
    const draft = toDraft(row);
    if (draft) works.push(draft);
  }
  return works;
}

async function search(get: Getter, kind: SmkKind, offset: number): Promise<Record<string, unknown>[]> {
  const filters = ["[has_image:true]", "[public_domain:true]"];
  if (kind === "painting") filters.push("[object_names:painting]");
  const url = new URL("https://api.smk.dk/api/v1/art/search/");
  url.searchParams.set("keys", "*");
  url.searchParams.set("filters", filters.join(","));
  url.searchParams.set("rows", "20");
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("lang", "en");
  const body = asRecord(await get(url.toString()));
  const items = body?.items;
  if (!Array.isArray(items)) return [];
  return items.map((row) => asRecord(row)).filter((row): row is Record<string, unknown> => row !== null);
}

function toDraft(row: Record<string, unknown>): WorkDraft | null {
  if (row.public_domain !== true) return null;
  const imageUrl = imageFor(cleanText(row.image_thumbnail, 400));
  if (!imageUrl || !imageAllowed(imageUrl, null, "smk")) return null;
  const width = Number(row.image_width);
  const height = Number(row.image_height);
  if (!(width > 0) || !(height > 0)) return null;
  const aspect = width / height;
  if (!aspectOk(aspect)) return null;
  const number = cleanText(row.object_number);
  const slug = number.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "");
  if (!slug) return null;
  const production = asRecord(Array.isArray(row.production) ? row.production[0] : null);
  const nationality = cleanText(production?.creator_nationality);
  const dates = asRecord(Array.isArray(row.production_date) ? row.production_date[0] : null);
  const titles = Array.isArray(row.titles) ? row.titles.map((title) => asRecord(title)) : [];
  const techniques = Array.isArray(row.techniques) ? row.techniques : [];
  return {
    id: `smk-${slug}`.slice(0, 80),
    source: "smk",
    title: cleanText(titles[0]?.title) || "Untitled",
    artist: personName(cleanText(production?.creator)),
    date: cleanText(dates?.period),
    culture: nationality,
    medium: cleanText(techniques[0]),
    license: "Public domain",
    credit: "SMK – National Gallery of Denmark",
    pageUrl: httpUrl(row.frontend_url),
    aspect,
    imageUrl,
    thumbHost: null,
    region: combineRegion("europe", nationality),
  };
}

/** The iip-thumb host often stalls; the main IIIF server answers the same paths. */
function imageFor(thumbnail: string): string {
  let url: URL;
  try {
    url = new URL(thumbnail);
  } catch {
    return "";
  }
  if (url.hostname === "iip-thumb.smk.dk") {
    url.hostname = "iip.smk.dk";
    url.pathname = url.pathname.replace("/full/!1024,/", "/full/!800,/");
  }
  return url.toString();
}

function personName(creator: string): string {
  if (!creator || /^(ubekendt|unknown)$/i.test(creator)) return "Unknown";
  const [last, first] = creator.split(",").map((part) => part.trim());
  return first && last ? `${first} ${last}` : creator;
}
