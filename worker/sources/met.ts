import { aspectFromDimensions, aspectFromPair, imageAllowed } from "../http";
import { combineRegion } from "../region";
import {
  asRecord,
  aspectOk,
  cleanText,
  httpUrl,
  sampleIds,
  type Getter,
  type Kind,
  type RegionName,
  type Sampler,
  type WorkDraft,
} from "../types";

/** The search's medium filter takes one classification at a time; a "|" list matches nothing. */
export type MetClassification = "Paintings" | "Drawings" | "Prints" | "Photographs";

const KINDS: Record<MetClassification, Kind> = {
  Paintings: "painting",
  Drawings: "drawing",
  Prints: "print",
  Photographs: "photograph",
};

export async function queryMet(options: {
  departmentId: number;
  classification: MetClassification;
  region: RegionName;
  q: string;
  get: Getter;
  rng: Sampler;
}): Promise<WorkDraft[]> {
  const ids = await search(options.get, options.departmentId, options.classification, options.q);
  const chosen = sampleIds(ids, 4, options.rng);
  const drafts: WorkDraft[] = [];
  for (const id of chosen) {
    const draft = await readObject(options.get, id, options.region);
    if (draft) drafts.push(draft);
    if (drafts.length >= 2) break;
  }
  return drafts;
}

async function search(
  get: Getter,
  departmentId: number,
  classification: MetClassification,
  q: string,
): Promise<number[]> {
  const first = await searchOnce(get, departmentId, classification, q);
  if (first.length > 0 || q === "*") return first;
  return searchOnce(get, departmentId, classification, "*");
}

async function searchOnce(
  get: Getter,
  departmentId: number,
  classification: MetClassification,
  q: string,
): Promise<number[]> {
  const url = new URL("https://collectionapi.metmuseum.org/public/collection/v1/search");
  url.searchParams.set("hasImages", "true");
  url.searchParams.set("isPublicDomain", "true");
  url.searchParams.set("departmentId", String(departmentId));
  url.searchParams.set("medium", classification);
  url.searchParams.set("q", q);
  const body = asRecord(await get(url.toString()));
  const ids = body?.objectIDs;
  if (!Array.isArray(ids)) return [];
  return ids.filter((id): id is number => typeof id === "number");
}

async function readObject(get: Getter, id: number, region: RegionName): Promise<WorkDraft | null> {
  try {
    const body = asRecord(
      await get(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`),
    );
    if (!body || body.isPublicDomain !== true) return null;
    const kind = metKind(cleanText(body.classification), cleanText(body.objectName), cleanText(body.medium));
    if (!kind) return null;
    const imageUrl = cleanText(body.primaryImageSmall).replace(/^http:\/\//i, "https://");
    if (!imageAllowed(imageUrl, null, "met")) return null;
    const aspect = metAspect(body.measurements) ?? aspectFromDimensions(cleanText(body.dimensions, 400));
    if (aspect === null || !aspectOk(aspect)) return null;
    const culture = cleanText(body.culture);
    const department = cleanText(body.department);
    return {
      id: `met-${id}`,
      source: "met",
      kind,
      title: cleanText(body.title) || "Untitled",
      artist: cleanText(body.artistDisplayName) || "Unknown",
      date: cleanText(body.objectDate),
      culture,
      medium: cleanText(body.medium),
      license: "CC0",
      credit: "The Metropolitan Museum of Art",
      pageUrl: httpUrl(body.objectURL),
      aspect,
      imageUrl,
      thumbHost: null,
      region: combineRegion(region, `${culture} ${department}`),
    };
  } catch (error) {
    if (error instanceof Error && error.message === "request limit") throw error;
    return null;
  }
}

/** Classifications read "Prints" or "Prints|Ephemera"; only the flat four, and no ephemera. */
function metKind(classification: string, objectName: string, medium: string): Kind | null {
  const parts = classification.split("|").map((part) => part.trim());
  if (parts.includes("Ephemera")) return null;
  const base = KINDS[parts[0] as MetClassification];
  if (!base) return null;
  if (/\bposters?\b/i.test(objectName)) return "poster";
  if (/\bcollage\b/i.test(`${objectName} ${medium}`)) return "collage";
  return base;
}

function metAspect(value: unknown): number | null {
  if (!Array.isArray(value)) return null;
  const entries = value
    .map((entry) => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== null);
  entries.sort((a, b) => rank(cleanText(a.elementName)) - rank(cleanText(b.elementName)));
  for (const entry of entries) {
    const measured = asRecord(entry.elementMeasurements);
    const height = numberValue(measured?.Height);
    const width = numberValue(measured?.Width);
    if (height === null || width === null) continue;
    const aspect = aspectFromPair(height, width);
    if (aspect !== null) return aspect;
  }
  return null;
}

function rank(name: string): number {
  if (name === "Overall") return 0;
  if (name === "Sheet" || name === "Image" || name === "Plate") return 1;
  return 2;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
