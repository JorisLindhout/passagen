export type SourceName =
  | "met"
  | "artic"
  | "cleveland"
  | "smithsonian"
  | "openverse"
  | "smk"
  | "wellcome"
  | "commons";

export type LicenseName = "CC0" | "CC BY" | "CC BY-SA" | "Public domain";

export type RegionName = "europe" | "asia" | "africa" | "americas" | "oceania" | "unknown";

/** Flat work made to hang or be framed; anything a source cannot place here stays out. */
export type Kind = "painting" | "drawing" | "print" | "poster" | "photograph" | "collage" | "digital";

export type WorkDraft = {
  id: string;
  source: SourceName;
  kind: Kind;
  title: string;
  artist: string;
  date: string;
  culture: string;
  medium: string;
  license: LicenseName;
  credit: string;
  pageUrl: string;
  aspect: number;
  imageUrl: string;
  thumbHost: string | null;
  region: RegionName;
};

export type ClientWork = {
  id: string;
  source: SourceName;
  title: string;
  artist: string;
  date: string;
  culture: string;
  medium: string;
  license: LicenseName;
  credit: string;
  pageUrl: string;
  aspect: number;
  image: string;
};

export type Getter = (url: string) => Promise<unknown>;

export type Sampler = { int(max: number): number };

export function artistKey(name: string): string | null {
  const key = name.trim().toLowerCase().replace(/\s+/g, " ");
  if (!key) return null;
  if (
    /^(unknown|anonymous|unidentified|(unidentified|unknown) (artist|author|photographer|maker)|artist unknown|n\/a|none|myself|me|self|own work)$/.test(
      key,
    )
  ) {
    return null;
  }
  return key;
}

export function needsAttribution(license: LicenseName): boolean {
  return license === "CC BY" || license === "CC BY-SA";
}

export function aspectOk(aspect: number): boolean {
  return Number.isFinite(aspect) && aspect >= 0.45 && aspect <= 2.25;
}

export function cleanText(value: unknown, max = 240): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

export function httpUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    return url.toString();
  } catch {
    return "";
  }
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function sampleIds(ids: number[], count: number, rng: Sampler): number[] {
  const copy = ids.slice();
  const n = Math.min(count, copy.length);
  for (let i = 0; i < n; i++) {
    const j = i + rng.int(copy.length - i);
    const swap = copy[i] ?? 0;
    copy[i] = copy[j] ?? swap;
    copy[j] = swap;
  }
  return copy.slice(0, n);
}
