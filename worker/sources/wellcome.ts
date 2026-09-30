import { imageAllowed } from "../http";
import { kindFromText } from "../kind";
import { combineRegion } from "../region";
import {
  artistKey,
  asRecord,
  aspectOk,
  cleanText,
  needsAttribution,
  type Getter,
  type RegionName,
  type WorkDraft,
} from "../types";

const LICENSES: Record<string, WorkDraft["license"]> = {
  pdm: "Public domain",
  "cc-0": "CC0",
  "cc-by": "CC BY",
  "cc-by-sa": "CC BY-SA",
};

/** Wellcome's photographs and scans record medicine rather than hang on a wall. */
const SCIENTIFIC = /\b(photograph|photographic|photomechanical|x-ray|radiograph|micrograph|scan|specimen|anatomical preparation)/i;

export async function queryWellcome(options: {
  query: string;
  region: RegionName;
  page: number;
  get: Getter;
}): Promise<WorkDraft[]> {
  const first = await search(options.get, options.query, options.page);
  const rows = first.length > 0 || options.page === 1 ? first : await search(options.get, options.query, 1);
  const works: WorkDraft[] = [];
  for (const row of rows) {
    const draft = toDraft(row, options.region);
    if (draft) works.push(draft);
  }
  return works;
}

async function search(get: Getter, query: string, page: number): Promise<Record<string, unknown>[]> {
  const url = new URL("https://api.wellcomecollection.org/catalogue/v2/images");
  url.searchParams.set("query", query);
  url.searchParams.set("locations.license", Object.keys(LICENSES).join(","));
  url.searchParams.set("include", "source.contributors,source.genres");
  url.searchParams.set("pageSize", "20");
  url.searchParams.set("page", String(page));
  const body = asRecord(await get(url.toString()));
  const results = body?.results;
  if (!Array.isArray(results)) return [];
  return results.map((row) => asRecord(row)).filter((row): row is Record<string, unknown> => row !== null);
}

function toDraft(row: Record<string, unknown>, region: RegionName): WorkDraft | null {
  const id = cleanText(row.id).toLowerCase();
  if (!/^[a-z0-9]{4,40}$/.test(id)) return null;
  const aspect = typeof row.aspectRatio === "number" ? row.aspectRatio : Number.NaN;
  if (!aspectOk(aspect)) return null;
  const location = asRecord(Array.isArray(row.locations) ? row.locations[0] : null);
  const license = LICENSES[cleanText(asRecord(location?.license)?.id)];
  if (!license) return null;
  const info = cleanText(location?.url, 400);
  if (!info.endsWith("/info.json")) return null;
  const imageUrl = `${info.slice(0, -"/info.json".length)}/full/800,/0/default.jpg`;
  if (!imageAllowed(imageUrl, null, "wellcome")) return null;

  const work = asRecord(row.source);
  const [title, ...rest] = cleanText(work?.title, 300).split(". ");
  const described = rest.join(". ").replace(/\.$/, "");
  const contributors = Array.isArray(work?.contributors) ? work.contributors : [];
  const named = cleanText(asRecord(asRecord(contributors[0])?.agent)?.label).replace(/[.,]$/, "");
  const artist = named || anonymousHand(described) || "Unknown";
  if (needsAttribution(license) && !artistKey(named)) return null;
  const genres = Array.isArray(work?.genres)
    ? work.genres.map((genre) => cleanText(asRecord(genre)?.label)).filter(Boolean).join(", ")
    : "";
  if (SCIENTIFIC.test(`${genres} ${described}`)) return null;
  const kind = kindFromText(genres) ?? kindFromText(described);
  if (!kind) return null;
  const workId = cleanText(work?.id);
  const known = /^[a-z0-9]+$/.test(workId);
  return {
    // One work often has several images (a second photograph, the back); the work's id keeps it to one frame a visit.
    id: `wc-${known ? workId.toLowerCase() : id}`,
    source: "wellcome",
    kind,
    title: title?.replace(/\.$/, "") || "Untitled",
    artist,
    date: "",
    culture: "",
    medium: described,
    license,
    credit: "Wellcome Collection, London",
    pageUrl: known ? `https://wellcomecollection.org/works/${workId}` : "",
    aspect,
    imageUrl,
    thumbHost: null,
    region: combineRegion(region, `${title ?? ""} ${described}`),
  };
}

/** Catalogue titles read "Gouache painting by an Indian artist"; keep the hand, not "Unknown". */
function anonymousHand(described: string): string {
  const match = described.match(/\bby (an? [A-Z][\w-]*(?: [A-Z][\w-]*)? (?:artist|painter))\b/);
  if (!match?.[1]) return "";
  return match[1].charAt(0).toUpperCase() + match[1].slice(1);
}
