import { createGetter } from "./http";
import { queryArtic } from "./sources/artic";
import { queryCleveland } from "./sources/cleveland";
import { COMMONS_ROOMS, queryCommons, type CommonsRoom } from "./sources/commons";
import { queryMet } from "./sources/met";
import { queryOpenverse } from "./sources/openverse";
import { querySmithsonian } from "./sources/smithsonian";
import { querySmk, type SmkKind } from "./sources/smk";
import { queryWellcome } from "./sources/wellcome";
import {
  artistKey,
  aspectOk,
  type ClientWork,
  type Getter,
  type RegionName,
  type WorkDraft,
} from "./types";

type Rng = {
  int(max: number): number;
  pick<T>(items: readonly T[]): T;
  shuffle<T>(items: readonly T[]): T[];
};

type Slot =
  | { kind: "met"; departmentId: number; region: RegionName }
  | { kind: "artic"; place: string; region: RegionName }
  | { kind: "cleveland"; department: string; region: RegionName; after: number; before: number; type: string }
  | { kind: "smithsonian"; unit: string; region: RegionName }
  | { kind: "openverse"; query: "painting" | "print" | "photograph" }
  | { kind: "smk"; smk: SmkKind }
  | { kind: "wellcome"; query: string; region: RegionName; pages: number }
  | { kind: "commons"; room: CommonsRoom };

/** Searches that stay on pictures rather than book pages; pages keeps offsets inside the results. */
const WELLCOME: { query: string; region: RegionName; pages: number }[] = [
  { query: "chinese painting", region: "asia", pages: 10 },
  { query: "indian painting", region: "asia", pages: 10 },
  { query: "persian", region: "asia", pages: 10 },
  { query: "japanese woodcut", region: "asia", pages: 2 },
  { query: "japan", region: "asia", pages: 10 },
  { query: "mexico", region: "americas", pages: 8 },
  { query: "watercolour", region: "unknown", pages: 10 },
  { query: "oil painting", region: "europe", pages: 10 },
];

const MET_DEPARTMENTS: { id: number; region: RegionName }[] = [
  { id: 11, region: "europe" },
  { id: 6, region: "asia" },
  { id: 10, region: "africa" },
  { id: 14, region: "asia" },
  { id: 5, region: "unknown" },
  { id: 19, region: "unknown" },
  { id: 1, region: "americas" },
  { id: 21, region: "unknown" },
  { id: 9, region: "unknown" },
  { id: 13, region: "europe" },
];

const MET_QUERIES = ["painting", "portrait", "landscape", "flower", "bird", "figure", "vessel", "textile", "print"];

const PLACES: { place: string; region: RegionName }[] = [
  { place: "China", region: "asia" },
  { place: "Japan", region: "asia" },
  { place: "France", region: "europe" },
  { place: "Italy", region: "europe" },
  { place: "Netherlands", region: "europe" },
  { place: "India", region: "asia" },
  { place: "Mexico", region: "americas" },
  { place: "Egypt", region: "africa" },
  { place: "Iran", region: "asia" },
  { place: "United States", region: "americas" },
  { place: "Korea", region: "asia" },
  { place: "Germany", region: "europe" },
  { place: "Nigeria", region: "africa" },
  { place: "Peru", region: "americas" },
];

const CLEVELAND: { name: string; region: RegionName }[] = [
  { name: "European Painting and Sculpture", region: "europe" },
  { name: "Modern European Painting and Sculpture", region: "europe" },
  { name: "Chinese Art", region: "asia" },
  { name: "Japanese Art", region: "asia" },
  { name: "Korean Art", region: "asia" },
  { name: "Indian and South East Asian Art", region: "asia" },
  { name: "Islamic Art", region: "asia" },
  { name: "African Art", region: "africa" },
  { name: "Egyptian and Ancient Near Eastern Art", region: "africa" },
  { name: "Art of the Americas", region: "americas" },
  { name: "American Painting and Sculpture", region: "americas" },
  { name: "Oceania", region: "oceania" },
  { name: "Prints", region: "unknown" },
  { name: "Photography", region: "unknown" },
];

const WINDOWS = [
  { after: -2000, before: 600 },
  { after: 600, before: 1400 },
  { after: 1400, before: 1700 },
  { after: 1700, before: 1850 },
  { after: 1850, before: 1950 },
  { after: 1950, before: 2020 },
];

/** The American Indian museum shares no CC0 images and Cooper Hewitt gives no dimensions, so neither can fill a frame. */
const SMITHSONIAN: { code: string; region: RegionName }[] = [
  { code: "SAAM", region: "americas" },
  { code: "NMAfA", region: "africa" },
  { code: "NMAA", region: "asia" },
];

const FORCED_MET = [6, 5, 10, 14];
const FORCED_CLEVELAND = [
  "Chinese Art",
  "African Art",
  "Art of the Americas",
  "Indian and South East Asian Art",
  "Japanese Art",
  "Islamic Art",
  "Egyptian and Ancient Near Eastern Art",
  "Korean Art",
  "Oceania",
];
const FORCED_SMITHSONIAN = ["NMAfA", "NMAA"];
const CLEVELAND_TYPES = ["Painting", "Print", "Photograph"];

const LIST_SIZE = 12;
/** Spare searches run alongside the twelve, so an empty or stalled one is covered without another round trip. */
const SPARES = 3;
/** Most searches are back by now; past it, the list goes out as soon as enough of them have answered. */
const QUORUM_MS = 3_000;
/** A search still out after this is left behind. */
const SEARCH_MS = 5_000;
const DEADLINE_MS = 10_000;

export async function chooseWorks(seed: string, apiKey: string | undefined): Promise<WorkDraft[]> {
  const key = typeof apiKey === "string" ? apiKey.trim() : "";
  const rng = makeRng(`works:${seed}`);
  const get = createGetter(48);
  const start = Date.now();
  const deadline = start + DEADLINE_MS;
  const expired = () => Date.now() > deadline;
  const usedIds = new Set<string>();
  const usedArtists = new Set<string>();
  const works: WorkDraft[] = [];

  const accept = (work: WorkDraft) => {
    if (!work.id || !work.imageUrl || !aspectOk(work.aspect)) return false;
    if (work.license === "CC BY" && !artistKey(work.artist)) return false;
    if (usedIds.has(work.id)) return false;
    const artist = artistKey(work.artist);
    if (artist && usedArtists.has(artist)) return false;
    return true;
  };
  const commit = (work: WorkDraft) => {
    usedIds.add(work.id);
    const artist = artistKey(work.artist);
    if (artist) usedArtists.add(artist);
  };
  const release = (work: WorkDraft) => {
    const artist = artistKey(work.artist);
    if (artist) usedArtists.delete(artist);
  };
  const takeFrom = (list: WorkDraft[], allowEurope: boolean) => {
    for (const work of list) {
      if (!allowEurope && work.region === "europe") continue;
      if (!accept(work)) continue;
      commit(work);
      return work;
    }
    return null;
  };

  const slots = rng.shuffle(buildSlots(rng, key.length > 0));
  const spareSlots = rng.shuffle(backupSlots(rng, key.length > 0)).slice(0, SPARES);
  const loaded = await gather(
    [...slots, ...spareSlots].map((slot, index) => loadSlot(slot, makeRng(`works:${seed}:${index}`), get, key)),
    slots.length,
    start,
  );
  const spares = loaded.slice(slots.length).map((list) => rng.shuffle(list));
  let nextSpare = 0;
  const fromSpares = (allowEurope: boolean) => {
    for (let tried = 0; tried < spares.length; tried++) {
      const list = spares[(nextSpare + tried) % spares.length] ?? [];
      const picked = takeFrom(list, allowEurope);
      if (!picked) continue;
      nextSpare = (nextSpare + tried + 1) % spares.length;
      return picked;
    }
    return null;
  };

  for (const list of loaded.slice(0, slots.length)) {
    if (works.length >= LIST_SIZE) break;
    const picked = takeFrom(rng.shuffle(list), true) ?? fromSpares(true);
    if (picked) works.push(picked);
  }

  let extra = 0;
  while (works.length < LIST_SIZE && extra < 4 && !expired()) {
    extra += 1;
    const filled = await fillFromAnother(rng, get, key, deadline, takeFrom);
    if (!filled) break;
    works.push(filled);
  }

  let europeSeen = 0;
  for (let index = 0; index < works.length; index++) {
    const current = works[index];
    if (!current || current.region !== "europe") continue;
    europeSeen += 1;
    if (europeSeen <= 4 || expired()) continue;
    const replacement = fromSpares(false) ?? (await forcedReplacement(rng, get, key, deadline, takeFrom));
    if (!replacement) continue;
    release(current);
    works[index] = replacement;
  }

  return works.slice(0, LIST_SIZE);
}

/**
 * Waits for every search, or, once the first `primary` are in or the quorum
 * time has passed, for enough non-empty answers to fill a list. Searches
 * still out at the cutoff count as empty.
 */
function gather(lists: Promise<WorkDraft[]>[], primary: number, start: number): Promise<WorkDraft[][]> {
  const results: (WorkDraft[] | null)[] = lists.map(() => null);
  return new Promise((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(quorum);
      clearTimeout(cutoff);
      resolve(results.map((list) => list ?? []));
    };
    const check = () => {
      if (results.every((list) => list !== null)) return finish();
      const primaryIn = results.slice(0, primary).every((list) => list !== null);
      const usable = results.filter((list) => list && list.length > 0).length;
      if ((primaryIn || Date.now() - start >= QUORUM_MS) && usable >= LIST_SIZE) finish();
    };
    lists.forEach((list, index) => {
      void list
        .catch(() => [] as WorkDraft[])
        .then((value) => {
          results[index] = value;
          check();
        });
    });
    const quorum = setTimeout(check, Math.max(0, start + QUORUM_MS - Date.now()));
    const cutoff = setTimeout(finish, Math.max(0, start + SEARCH_MS - Date.now()));
  });
}

export function toClient(work: WorkDraft): ClientWork {
  return {
    id: work.id,
    source: work.source,
    title: work.title,
    artist: work.artist,
    date: work.date,
    culture: work.culture,
    medium: work.medium,
    license: work.license,
    credit: work.credit,
    pageUrl: work.pageUrl,
    aspect: Math.round(work.aspect * 1000) / 1000,
    image: `/api/image/${work.id}`,
  };
}

/**
 * Twelve searches per list: half from the US museums and Openverse, half from
 * SMK, Wellcome, and museums across Asia, Latin America, Oceania, and Africa
 * by way of Wikimedia Commons.
 */
function buildSlots(rng: Rng, hasSmithsonian: boolean): Slot[] {
  const articCount = hasSmithsonian ? 1 : 2;
  const met = ensureOutside(rng.shuffle(MET_DEPARTMENTS).slice(0, 2), MET_DEPARTMENTS);
  const places = ensureOutside(rng.shuffle(PLACES).slice(0, articCount), PLACES);
  const cleveland = ensureOutside(rng.shuffle(CLEVELAND).slice(0, 1), CLEVELAND);
  const windows = rng.shuffle(WINDOWS);
  const units = hasSmithsonian ? rng.shuffle(SMITHSONIAN).slice(0, 1) : [];
  const wellcome = rng.shuffle(WELLCOME).slice(0, 2);
  const rooms = rng.shuffle(COMMONS_ROOMS).slice(0, 3);
  const slots: Slot[] = [
    ...met.map((item) => ({ kind: "met" as const, departmentId: item.id, region: item.region })),
    ...places.map((item) => ({ kind: "artic" as const, place: item.place, region: item.region })),
    ...cleveland.map((item, index) => ({
      kind: "cleveland" as const,
      department: item.name,
      region: item.region,
      after: windows[index]?.after ?? 1400,
      before: windows[index]?.before ?? 1900,
      type: CLEVELAND_TYPES[index] ?? "Painting",
    })),
    ...units.map((item) => ({ kind: "smithsonian" as const, unit: item.code, region: item.region })),
    { kind: "openverse", query: rng.pick(["painting", "print", "photograph"] as const) },
    { kind: "smk", smk: rng.int(3) === 0 ? "any" : "painting" },
    ...wellcome.map((item) => ({ kind: "wellcome" as const, ...item })),
    ...rooms.map((room) => ({ kind: "commons" as const, room })),
  ];
  return slots;
}

async function loadSlot(slot: Slot, rng: Rng, get: Getter, apiKey: string): Promise<WorkDraft[]> {
  try {
    switch (slot.kind) {
      case "met":
        return await queryMet({
          departmentId: slot.departmentId,
          region: slot.region,
          q: rng.pick(MET_QUERIES),
          get,
          rng,
        });
      case "artic":
        return await queryArtic({
          place: slot.place,
          region: slot.region,
          page: 1 + rng.int(5),
          get,
        });
      case "cleveland":
        return await queryCleveland({
          department: slot.department,
          region: slot.region,
          after: slot.after,
          before: slot.before,
          type: slot.type,
          skip: rng.int(5) * 20,
          get,
        });
      case "smithsonian":
        return await querySmithsonian({
          unit: slot.unit,
          region: slot.region,
          start: rng.int(5) * 15,
          apiKey,
          get,
        });
      case "openverse":
        return await queryOpenverse({
          query: slot.query,
          page: 1 + rng.int(4),
          get,
        });
      case "smk":
        return await querySmk({ kind: slot.smk, pick: rng.int(1_000_000) / 1_000_000, get });
      case "wellcome":
        return await queryWellcome({
          query: slot.query,
          region: slot.region,
          page: 1 + rng.int(slot.pages),
          get,
        });
      case "commons":
        return await queryCommons({ room: slot.room, pick: rng.int(1_000_000) / 1_000_000, get });
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "source failed",
        source: slot.kind,
        error: errorText(error),
      }),
    );
    return [];
  }
}

async function fillFromAnother(
  rng: Rng,
  get: Getter,
  apiKey: string,
  deadline: number,
  takeFrom: (list: WorkDraft[], allowEurope: boolean) => WorkDraft | null,
): Promise<WorkDraft | null> {
  const backups = rng.shuffle(backupSlots(rng, apiKey.length > 0)).slice(0, 2);
  for (const slot of backups) {
    if (Date.now() > deadline) return null;
    const picked = takeFrom(rng.shuffle(await beforeDeadline(loadSlot(slot, rng, get, apiKey), deadline)), true);
    if (picked) return picked;
  }
  return null;
}

function backupSlots(rng: Rng, hasSmithsonian: boolean): Slot[] {
  const met = rng.pick(MET_DEPARTMENTS);
  const place = rng.pick(PLACES);
  const cleveland = rng.pick(CLEVELAND);
  const window = rng.pick(WINDOWS);
  const slots: Slot[] = [
    { kind: "met", departmentId: met.id, region: met.region },
    { kind: "artic", place: place.place, region: place.region },
    {
      kind: "cleveland",
      department: cleveland.name,
      region: cleveland.region,
      after: window.after,
      before: window.before,
      type: rng.pick(CLEVELAND_TYPES),
    },
    { kind: "openverse", query: rng.pick(["painting", "print", "photograph"]) },
    { kind: "smk", smk: "painting" },
    { kind: "wellcome", ...rng.pick(WELLCOME) },
    { kind: "commons", room: rng.pick(COMMONS_ROOMS) },
    { kind: "commons", room: rng.pick(COMMONS_ROOMS) },
  ];
  if (hasSmithsonian) {
    const unit = rng.pick(SMITHSONIAN);
    slots.push({ kind: "smithsonian", unit: unit.code, region: unit.region });
  }
  return slots;
}

async function forcedReplacement(
  rng: Rng,
  get: Getter,
  apiKey: string,
  deadline: number,
  takeFrom: (list: WorkDraft[], allowEurope: boolean) => WorkDraft | null,
): Promise<WorkDraft | null> {
  const metRegions: Record<number, RegionName> = { 6: "asia", 5: "unknown", 10: "africa", 14: "asia" };
  const candidates: Slot[] = [
    ...rng.shuffle(COMMONS_ROOMS)
      .slice(0, 2)
      .map((room) => ({ kind: "commons" as const, room })),
    ...rng.shuffle(FORCED_MET).map((departmentId) => ({
      kind: "met" as const,
      departmentId,
      region: metRegions[departmentId] ?? "unknown",
    })),
    ...rng.shuffle(FORCED_CLEVELAND)
      .slice(0, 3)
      .map((department) => {
        const window = rng.pick(WINDOWS);
        return {
          kind: "cleveland" as const,
          department,
          region: CLEVELAND.find((item) => item.name === department)?.region ?? "unknown",
          after: window.after,
          before: window.before,
          type: "Painting",
        };
      }),
    ...(apiKey ? FORCED_SMITHSONIAN : []).map((unit) => ({
      kind: "smithsonian" as const,
      unit,
      region: SMITHSONIAN.find((item) => item.code === unit)?.region ?? "unknown",
    })),
  ];
  for (const slot of candidates) {
    if (Date.now() > deadline) return null;
    const list = await beforeDeadline(loadSlot(slot, rng, get, apiKey), deadline);
    const picked = takeFrom(slot.kind === "commons" ? rng.shuffle(list) : list, false);
    if (picked) return picked;
  }
  return null;
}

function beforeDeadline(list: Promise<WorkDraft[]>, deadline: number): Promise<WorkDraft[]> {
  const wait = Math.max(0, deadline - Date.now());
  return Promise.race([list, new Promise<WorkDraft[]>((resolve) => setTimeout(() => resolve([]), wait))]);
}

function ensureOutside<T extends { region: RegionName }>(picked: T[], pool: readonly T[]): T[] {
  if (picked.some((item) => item.region !== "europe")) return picked;
  const replacement = pool.find((item) => item.region !== "europe" && !picked.includes(item));
  if (!replacement || picked.length === 0) return picked;
  const next = picked.slice();
  next[next.length - 1] = replacement;
  return next;
}

function makeRng(seed: string): Rng {
  let state = hashSeed(seed) || 0x6d2b79f5;
  const next = () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (max: number) => Math.floor(next() * max);
  return {
    int,
    pick<T>(items: readonly T[]): T {
      return items[int(items.length)] as T;
    },
    shuffle<T>(items: readonly T[]): T[] {
      const copy = items.slice();
      for (let i = copy.length - 1; i > 0; i--) {
        const j = int(i + 1);
        const swap = copy[i] as T;
        copy[i] = copy[j] as T;
        copy[j] = swap;
      }
      return copy;
    },
  };
}

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/api_key=[^&\s]+/gi, "api_key=redacted").slice(0, 180);
}
