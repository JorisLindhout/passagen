import { aspectFromDimensions, aspectFromPair, imageAllowed } from "../http";
import { combineRegion } from "../region";
import { asRecord, aspectOk, cleanText, httpUrl, type Getter, type RegionName, type WorkDraft } from "../types";

export async function querySmithsonian(options: {
  unit: string;
  region: RegionName;
  start: number;
  apiKey: string;
  get: Getter;
}): Promise<WorkDraft[]> {
  const units = options.unit === "NMAA" ? ["NMAA", "FSG"] : [options.unit];
  for (const unit of units) {
    const rows = await search(options.get, unit, options.start, options.apiKey);
    const usable = rows.length > 0 || options.start === 0 ? rows : await search(options.get, unit, 0, options.apiKey);
    const works: WorkDraft[] = [];
    for (const row of usable) {
      const draft = toDraft(row, options.region);
      if (draft) works.push(draft);
    }
    if (works.length > 0) return works;
  }
  return [];
}

async function search(get: Getter, unit: string, start: number, apiKey: string): Promise<Record<string, unknown>[]> {
  const url = new URL("https://api.si.edu/openaccess/api/v1.0/search");
  url.searchParams.set("q", `unit_code:${unit} AND online_media_type:Images`);
  url.searchParams.set("rows", "20");
  url.searchParams.set("start", String(start));
  url.searchParams.set("api_key", apiKey);
  const body = asRecord(await get(url.toString()));
  const response = asRecord(body?.response);
  const rows = response?.rows;
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => asRecord(row)).filter((row): row is Record<string, unknown> => row !== null);
}

function toDraft(row: Record<string, unknown>, region: RegionName): WorkDraft | null {
  const content = asRecord(row.content);
  const descriptive = asRecord(content?.descriptiveNonRepeating);
  const freetext = asRecord(content?.freetext);
  const indexed = asRecord(content?.indexedStructured);
  const recordId = cleanText(descriptive?.record_ID) || cleanText(row.id);
  const slug = recordId.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "");
  if (!slug) return null;
  const media = mediaList(descriptive);
  let imageUrl = "";
  let aspect: number | null = null;
  const dimensions = labeled(freetext?.physicalDescription, "Dimensions");
  aspect = dimensions ? (flatAspect(dimensions) ?? aspectFromDimensions(dimensions)) : null;
  for (const item of media) {
    if (cleanText(asRecord(item.usage)?.access) !== "CC0") continue;
    const candidate = screenUrl(item) || httpUrl(item.content);
    if (!imageAllowed(candidate, null, "smithsonian")) continue;
    imageUrl = candidate;
    break;
  }
  if (!imageUrl || aspect === null || !aspectOk(aspect)) return null;
  const names = indexed?.name;
  const artist =
    (Array.isArray(names) && typeof names[0] === "string" ? cleanText(names[0]) : "") ||
    labeled(freetext?.name, "Artist") ||
    "Unknown";
  const culture =
    (Array.isArray(indexed?.culture) ? indexed.culture.filter((item) => typeof item === "string").join(", ") : "") ||
    labeled(freetext?.culture, "Culture");
  const dataSource = cleanText(descriptive?.data_source);
  return {
    id: `si-${slug}`.slice(0, 80),
    source: "smithsonian",
    title: textContent(descriptive?.title) || cleanText(row.title) || "Untitled",
    artist,
    date: labeled(freetext?.date, "Date") || firstString(indexed?.date),
    culture,
    medium: labeled(freetext?.physicalDescription, "Medium"),
    license: "CC0",
    credit: dataSource || "Smithsonian Institution",
    pageUrl: httpUrl(descriptive?.record_link),
    aspect,
    imageUrl,
    thumbHost: null,
    region: combineRegion(region, `${culture} ${dataSource}`),
  };
}

/**
 * The African and Asian art museums write "H x W (image): 161.9 x 86.9 cm".
 * A depth is allowed only when it is thin, so a photograph of a bowl or a
 * mask does not get stretched to the object's outline.
 */
function flatAspect(text: string): number | null {
  const match = text.match(
    /H\s*[x×]\s*W(\s*[x×]\s*D)?[^:]*:\s*(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)(?:\s*[x×]\s*(\d+(?:\.\d+)?))?\s*cm/i,
  );
  if (!match) return null;
  const height = Number(match[2]);
  const width = Number(match[3]);
  if (match[1]) {
    const depth = Number(match[4]);
    if (!Number.isFinite(depth) || depth > 0.1 * Math.min(height, width)) return null;
  }
  return aspectFromPair(height, width);
}

function mediaList(descriptive: Record<string, unknown> | null): Record<string, unknown>[] {
  const online = asRecord(descriptive?.online_media);
  const media = online?.media;
  if (!Array.isArray(media)) return [];
  return media.map((item) => asRecord(item)).filter((item): item is Record<string, unknown> => item !== null);
}

function screenUrl(item: Record<string, unknown>): string {
  const resources = Array.isArray(item.resources) ? item.resources : [];
  for (const resource of resources) {
    const record = asRecord(resource);
    if (cleanText(record?.label) !== "Screen Image") continue;
    const url = httpUrl(record?.url);
    if (url) return url;
  }
  return "";
}

function labeled(value: unknown, label: string): string {
  if (!Array.isArray(value)) return "";
  for (const entry of value) {
    const record = asRecord(entry);
    if (cleanText(record?.label) !== label) continue;
    const content = cleanText(record?.content);
    if (content) return content;
  }
  return "";
}

function textContent(value: unknown): string {
  const record = asRecord(value);
  return cleanText(record?.content) || cleanText(value);
}

function firstString(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return typeof value[0] === "string" ? cleanText(value[0]) : "";
}
