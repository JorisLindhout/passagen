import { CLEVELAND, MET_DEPARTMENTS, PLACES, SMITHSONIAN, WINDOWS } from "./catalog";
import { curate } from "./curator";
import { createGetter } from "./http";
import { rejectReason, relaxation, type Relax } from "./kind";
import { queryArtic } from "./sources/artic";
import { CLEVELAND_TYPES, queryCleveland } from "./sources/cleveland";
import { COMMONS_ROOMS, COMMONS_WIDE, queryCommons, type CommonsRoom } from "./sources/commons";
import { queryMet, type MetClassification } from "./sources/met";
import { OPENVERSE_QUERIES, queryOpenverse } from "./sources/openverse";
import { querySmithsonian } from "./sources/smithsonian";
import { querySmk, SMK_KINDS, type SmkKind } from "./sources/smk";
import { queryWellcome } from "./sources/wellcome";
import {
  artistKey,
  aspectOk,
  type ClientWork,
  type Getter,
  type RegionName,
  type TasteSummary,
  type WorkDraft,
} from "./types";

export type Rng = {
  int(max: number): number;
  pick<T>(items: readonly T[]): T;
  shuffle<T>(items: readonly T[]): T[];
};

export type Slot =
  | { kind: "met"; departmentId: number; classification: MetClassification; region: RegionName; q?: string }
  | { kind: "artic"; place: string; region: RegionName }
  | { kind: "cleveland"; department: string; region: RegionName; after: number; before: number; type: string }
  | { kind: "smithsonian"; unit: string; region: RegionName }
  | { kind: "openverse"; query: string }
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

const MET_QUERIES = ["portrait", "landscape", "flower", "bird", "figure", "river", "woman", "city"];

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

/** Searches in one template; past the quorum, the maze goes out once this many have answered. */
const SLOT_QUORUM = 12;
/** Spare searches run alongside the template, so an empty or stalled one is covered without another round trip. */
const SPARES = 3;
/** Most searches are back by now; past it, the list goes out as soon as enough of them have answered. */
const QUORUM_MS = 3_000;
/** A search still out after this is left behind. */
const SEARCH_MS = 5_000;
const DEADLINE_MS = 10_000;
/** Share of a template's searches the curator fills from the visitor's taste; the rest stay random. */
const CURATED_SHARE = 0.7;
/** In the random part, at most one work in this many resolves to Europe. */
const EUROPE_EVERY = 3;
/** An artist the visitor keeps stopping for may hang this often in one maze; anyone else once. */
const FAVORITE_REPEATS = 3;
/** Works in the random part that only hang because a filter was loosened, so a visitor can come across them at all. */
const RELAXED_EXPLORE = 1;

type Part = "curated" | "explore";

/**
 * One maze's works for one visitor, never the same twice. About seven in ten
 * searches follow the visitor's taste; the rest are random, as before, and
 * only they keep the cap on European works. With no taste yet, or no
 * curator, every search is random.
 */
export async function chooseMaze(options: {
  count: number;
  seen: string[];
  taste: TasteSummary | null;
  env: Env;
}): Promise<WorkDraft[]> {
  const { count, seen, taste, env } = options;
  const key = typeof env.SMITHSONIAN_API_KEY === "string" ? env.SMITHSONIAN_API_KEY.trim() : "";
  const hasKey = key.length > 0;
  const rng = makeRng(crypto.randomUUID());
  const get = createGetter(48);

  const template = rng.shuffle(buildSlots(rng, hasKey));
  const positions = template.map((_, index) => index).slice(0, Math.round(template.length * CURATED_SHARE));
  const curated = taste ? await curate(env, taste, template, positions) : template.map(() => null);
  const slots = template.map((slot, index) => curated[index] ?? slot);
  const parts: Part[] = template.map((_, index) => (curated[index] ? "curated" : "explore"));

  const start = Date.now();
  const deadline = start + DEADLINE_MS;
  const usedIds = new Set(seen);
  /** Two images of one object share its museum page. */
  const usedPages = new Set<string>();
  /** Museums catalogue copies of one print separately; the same label twice reads as a repeat. */
  const usedLabels = new Set<string>();
  const artistCounts = new Map<string, number>();
  const favorites = new Set((taste?.favoriteArtists ?? []).map(artistKey).filter((name) => name !== null));
  const curatedRelax: Relax = { ephemera: taste?.likesEphemera, unnamed: taste?.likesUnnamed };
  const rejected: Record<string, number> = {};
  const rejectedIds = new Set<string>();
  const picked: { work: WorkDraft; part: Part }[] = [];

  const curatedSlots = parts.filter((part) => part === "curated").length;
  const exploreTarget = Math.round((count * (slots.length - curatedSlots)) / slots.length);
  const curatedTarget = count - exploreTarget;
  const europeCap = Math.ceil(exploreTarget / EUROPE_EVERY);
  let europeExplore = 0;
  let relaxedExplore = 0;
  const taken = (part: Part) => picked.reduce((sum, item) => sum + (item.part === part ? 1 : 0), 0);
  const short = () => count - picked.length;

  const accept = (work: WorkDraft, part: Part, capEurope: boolean) => {
    if (!work.id || !work.imageUrl || !aspectOk(work.aspect)) return false;
    if (usedIds.has(work.id) || (work.pageUrl && usedPages.has(work.pageUrl))) return false;
    if (usedLabels.has(labelOf(work))) return false;
    const relax: Relax =
      part === "curated" ? curatedRelax : relaxedExplore < RELAXED_EXPLORE ? { ephemera: true, unnamed: true } : {};
    const reason = rejectReason(work, relax);
    if (reason) {
      if (!rejectedIds.has(work.id)) {
        rejectedIds.add(work.id);
        const label = `${work.source}: ${reason}`;
        rejected[label] = (rejected[label] ?? 0) + 1;
      }
      return false;
    }
    const artist = artistKey(work.artist);
    if (artist && (artistCounts.get(artist) ?? 0) >= (favorites.has(artist) ? FAVORITE_REPEATS : 1)) return false;
    if (capEurope && part === "explore" && work.region === "europe" && europeExplore >= europeCap) return false;
    return true;
  };
  const commit = (work: WorkDraft, part: Part) => {
    usedIds.add(work.id);
    if (work.pageUrl) usedPages.add(work.pageUrl);
    usedLabels.add(labelOf(work));
    const artist = artistKey(work.artist);
    if (artist) artistCounts.set(artist, (artistCounts.get(artist) ?? 0) + 1);
    const relaxed = rejectReason(work) ? relaxation(work) : null;
    if (relaxed) {
      work.relaxed = relaxed;
      if (part === "explore") relaxedExplore += 1;
    }
    if (part === "explore" && work.region === "europe") europeExplore += 1;
    picked.push({ work, part });
  };
  const spareSlots = rng.shuffle(backupSlots(rng, hasKey)).slice(0, SPARES);
  const loaded = await gather(
    [...slots, ...spareSlots].map((slot) => loadSlot(slot, makeRng(crypto.randomUUID()), get, key)),
    slots.length,
    start,
  );
  const lists = loaded.slice(0, slots.length).map((list) => rng.shuffle(list));
  const spares = loaded.slice(slots.length).map((list) => rng.shuffle(list));

  /** One work per search per round, so a source that answers with twenty does not fill the part alone. */
  const roundRobin = (from: WorkDraft[][], part: Part, target: () => number, capEurope = true) => {
    const cursors = from.map(() => 0);
    let moved = true;
    while (moved && target() > 0) {
      moved = false;
      from.forEach((list, index) => {
        if (target() <= 0) return;
        while (cursors[index]! < list.length) {
          const work = list[cursors[index]!];
          cursors[index]! += 1;
          if (work && accept(work, part, capEurope)) {
            commit(work, part);
            moved = true;
            return;
          }
        }
      });
    }
  };
  const listsOf = (part: Part) => lists.filter((_, index) => parts[index] === part);
  roundRobin(listsOf("curated"), "curated", () => curatedTarget - taken("curated"));
  roundRobin(listsOf("explore"), "explore", () => exploreTarget - taken("explore"));
  roundRobin(spares, "explore", () => exploreTarget - taken("explore"));

  // Thin searches leave their share to the rest; the European cap gives way last, before a frame stays bare.
  roundRobin([...lists, ...spares], "explore", short);
  if (short() > 0 && Date.now() < deadline) {
    const extra = await Promise.all(
      topUpSlots(rng, hasKey).map((slot) =>
        beforeDeadline(loadSlot(slot, makeRng(crypto.randomUUID()), get, key), deadline),
      ),
    );
    spares.push(...extra.map((list) => rng.shuffle(list)));
    roundRobin(spares, "explore", short);
  }
  roundRobin([...lists, ...spares], "explore", short, false);

  console.log(
    JSON.stringify({
      message: "maze chosen",
      asked: count,
      curated: taken("curated"),
      explore: taken("explore"),
      curatedSearches: curatedSlots,
      relaxed: picked.filter((item) => item.work.relaxed).map((item) => item.work.relaxed),
      rejected,
    }),
  );
  return rng.shuffle(picked).map((item) => item.work).slice(0, count);
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
      if ((primaryIn || Date.now() - start >= QUORUM_MS) && usable >= SLOT_QUORUM) finish();
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

function labelOf(work: WorkDraft): string {
  return [work.title, work.artist, work.medium, work.date].join("|").toLowerCase();
}

export function toClient(work: WorkDraft, image: string): ClientWork {
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
    image,
    kind: work.kind,
    region: work.region,
    relaxed: work.relaxed ?? "",
  };
}

/**
 * Twelve searches per list: half from the US museums and Openverse, half from
 * SMK, Wellcome, and museums across Asia, Latin America, and Oceania by way
 * of Wikimedia Commons, plus one Commons room of photographs, collages, or
 * digital work.
 */
export function buildSlots(rng: Rng, hasSmithsonian: boolean): Slot[] {
  const articCount = hasSmithsonian ? 1 : 2;
  const met = ensureOutside(rng.shuffle(MET_DEPARTMENTS).slice(0, 2), MET_DEPARTMENTS);
  const places = ensureOutside(rng.shuffle(PLACES).slice(0, articCount), PLACES);
  const cleveland = ensureOutside(rng.shuffle(CLEVELAND).slice(0, 1), CLEVELAND);
  const windows = rng.shuffle(WINDOWS);
  const units = hasSmithsonian ? rng.shuffle(SMITHSONIAN).slice(0, 1) : [];
  const wellcome = rng.shuffle(WELLCOME).slice(0, 2);
  const rooms = [...rng.shuffle(COMMONS_ROOMS).slice(0, 2), rng.pick(COMMONS_WIDE)];
  const slots: Slot[] = [
    ...met.map((item) => metSlot(rng, item)),
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
    { kind: "openverse", query: rng.pick(OPENVERSE_QUERIES) },
    { kind: "smk", smk: smkKind(rng) },
    ...wellcome.map((item) => ({ kind: "wellcome" as const, ...item })),
    ...rooms.map((room) => ({ kind: "commons" as const, room })),
  ];
  return slots;
}

function metSlot(rng: Rng, department: (typeof MET_DEPARTMENTS)[number]): Slot {
  return {
    kind: "met",
    departmentId: department.id,
    classification: rng.pick(department.classifications),
    region: department.region,
  };
}

/** Paintings half the time; SMK's prints and drawings would otherwise fill most of its turns. */
function smkKind(rng: Rng): SmkKind {
  return rng.int(2) === 0 ? "painting" : rng.pick(SMK_KINDS.filter((kind) => kind !== "painting"));
}

export async function loadSlot(slot: Slot, rng: Rng, get: Getter, apiKey: string): Promise<WorkDraft[]> {
  try {
    switch (slot.kind) {
      case "met":
        return await queryMet({
          departmentId: slot.departmentId,
          classification: slot.classification,
          region: slot.region,
          q: slot.q ?? rng.pick(MET_QUERIES),
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

export function backupSlots(rng: Rng, hasSmithsonian: boolean): Slot[] {
  const met = rng.pick(MET_DEPARTMENTS);
  const place = rng.pick(PLACES);
  const cleveland = rng.pick(CLEVELAND);
  const window = rng.pick(WINDOWS);
  const slots: Slot[] = [
    metSlot(rng, met),
    { kind: "artic", place: place.place, region: place.region },
    {
      kind: "cleveland",
      department: cleveland.name,
      region: cleveland.region,
      after: window.after,
      before: window.before,
      type: rng.pick(CLEVELAND_TYPES),
    },
    { kind: "openverse", query: rng.pick(OPENVERSE_QUERIES) },
    { kind: "smk", smk: smkKind(rng) },
    { kind: "wellcome", ...rng.pick(WELLCOME) },
    { kind: "commons", room: rng.pick(COMMONS_ROOMS) },
    { kind: "commons", room: rng.pick(COMMONS_WIDE) },
  ];
  if (hasSmithsonian) {
    const unit = rng.pick(SMITHSONIAN);
    slots.push({ kind: "smithsonian", unit: unit.code, region: unit.region });
  }
  return slots;
}

/**
 * One more round, all at once, for a maze still short: a few non-European
 * searches, so the random part can stay within its cap, and some ordinary
 * ones. The Met is left out; it spends five requests on two works.
 */
function topUpSlots(rng: Rng, hasSmithsonian: boolean): Slot[] {
  const forced: Slot[] = [
    ...rng
      .shuffle(COMMONS_ROOMS)
      .slice(0, 2)
      .map((room) => ({ kind: "commons" as const, room })),
    ...rng
      .shuffle(FORCED_CLEVELAND)
      .slice(0, 2)
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
    ...(hasSmithsonian ? rng.shuffle(FORCED_SMITHSONIAN).slice(0, 1) : []).map((unit) => ({
      kind: "smithsonian" as const,
      unit,
      region: SMITHSONIAN.find((item) => item.code === unit)?.region ?? "unknown",
    })),
  ];
  const ordinary = backupSlots(rng, false).filter((slot) => slot.kind !== "met");
  return [...forced, ...rng.shuffle(ordinary).slice(0, 3)];
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

export function makeRng(seed: string): Rng {
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
