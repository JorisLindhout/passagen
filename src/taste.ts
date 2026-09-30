import { isFallback, type Work } from "./fallback";
import { TOP_SPEED } from "./walk";

/** What the worker hears about one work. Strings are cut short; the curator only needs the gist. */
export type TasteWork = {
  title: string;
  artist: string;
  date: string;
  culture: string;
  medium: string;
  kind: string;
  region: string;
  source: string;
  seconds: number;
  plaque: boolean;
  revisits: number;
  skips: number;
  score: number;
};

export type TasteSummary = {
  liked: TasteWork[];
  disliked: TasteWork[];
  favoriteArtists: string[];
  likesEphemera: boolean;
  likesUnnamed: boolean;
};

export type Taste = {
  /** Call every frame with the work in front of you, or null. */
  observe: (work: Work | null, view: { dt: number; distance: number; reach: number; pace: number }) => void;
  /** An explicit open of the plaque, not the automatic one when a work comes into view. */
  plaqueOpened: (work: Work) => void;
  /** Null until anything has been liked or passed by. */
  summary: () => TasteSummary | null;
};

const STORAGE_KEY = "museum:taste";
/** An earlier visit counts for this much of what it scored. */
const CARRY = 0.35;
const STORED = 40;
const SAVE_EVERY_MS = 30_000;

/** Slower than this counts as standing in front of the work. */
const STILL_PACE = 0.3;
const DWELL_CAP_S = 30;
/** Closer than this share of the plaque's reach counts as walking up to it. */
const APPROACH_SHARE = 0.5;
const REVISIT_GAP_S = 15;
const REVISIT_LOOK_S = 1;
const SKIP_LOOK_S = 0.6;
const SKIP_PACE = TOP_SPEED * 0.8;

const LIKED = 12;
const DISLIKED = 6;
const LIKED_SCORE = 0.8;
const FAVORITE_ARTIST_SCORE = 3;
const FAVORITE_ARTISTS = 5;
/** A loosened kind of work is asked for again only once someone clearly stopped for one. */
const RELAXED_SCORE = 1.5;
const TEXT_MAX = 120;

type Info = Pick<Work, "title" | "artist" | "date" | "culture" | "medium" | "kind" | "region" | "source" | "relaxed">;

type Entry = {
  info: Info;
  /** Score carried over, already faded, from earlier visits. */
  carried: number;
  dwell: number;
  plaques: number;
  revisits: number;
  approached: boolean;
  skips: number;
  lastLookEnd: number;
};

type Look = {
  id: string;
  length: number;
  maxPace: number;
  nearest: number;
  reach: number;
  revisit: boolean;
};

export function createTaste(): Taste {
  const entries = load();
  let clock = 0;
  let look: Look | null = null;

  const entryFor = (work: Work): Entry => {
    let entry = entries.get(work.id);
    if (!entry) {
      entry = { info: infoOf(work), carried: 0, dwell: 0, plaques: 0, revisits: 0, approached: false, skips: 0, lastLookEnd: -Infinity };
      entries.set(work.id, entry);
    }
    return entry;
  };

  const endLook = () => {
    if (!look) return;
    const entry = entries.get(look.id);
    if (entry) {
      if (look.length < SKIP_LOOK_S && look.maxPace >= SKIP_PACE && look.nearest <= look.reach) entry.skips += 1;
      entry.lastLookEnd = clock;
    }
    look = null;
  };

  const save = () => {
    try {
      const stored = [...entries.entries()]
        .map(([id, entry]) => ({ id, info: entry.info, score: round(score(entry)) }))
        .filter((item) => item.score !== 0)
        .sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
        .slice(0, STORED);
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, works: stored }));
    } catch {
      // Private windows and full storage only lose the memory of this visit.
    }
  };
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) save();
  });
  window.setInterval(save, SAVE_EVERY_MS);

  return {
    observe(work, view) {
      clock += view.dt;
      if (!work || isFallback(work)) {
        endLook();
        return;
      }
      if (look?.id !== work.id) {
        endLook();
        const entry = entryFor(work);
        look = {
          id: work.id,
          length: 0,
          maxPace: 0,
          nearest: Infinity,
          reach: view.reach,
          revisit: Number.isFinite(entry.lastLookEnd) && clock - entry.lastLookEnd >= REVISIT_GAP_S,
        };
      }
      const entry = entryFor(work);
      look.length += view.dt;
      look.maxPace = Math.max(look.maxPace, view.pace);
      look.nearest = Math.min(look.nearest, view.distance);
      if (view.pace < STILL_PACE) entry.dwell = Math.min(DWELL_CAP_S, entry.dwell + view.dt);
      if (!entry.approached && view.distance < view.reach * APPROACH_SHARE) entry.approached = true;
      if (look.revisit && look.length > REVISIT_LOOK_S) {
        entry.revisits += 1;
        look.revisit = false;
      }
    },
    plaqueOpened(work) {
      if (isFallback(work)) return;
      entryFor(work).plaques += 1;
    },
    summary() {
      const scored = [...entries.values()].map((entry) => ({ entry, score: score(entry) }));
      const liked = scored
        .filter((item) => item.score >= LIKED_SCORE)
        .sort((a, b) => b.score - a.score)
        .slice(0, LIKED);
      const disliked = scored
        .filter((item) => item.score < 0)
        .sort((a, b) => a.score - b.score)
        .slice(0, DISLIKED);
      if (liked.length === 0 && disliked.length === 0) return null;

      const byArtist = new Map<string, number>();
      for (const { entry, score: value } of scored) {
        const artist = entry.info.artist;
        if (!artist || /^unknown$/i.test(artist)) continue;
        byArtist.set(artist, (byArtist.get(artist) ?? 0) + value);
      }
      const favoriteArtists = [...byArtist.entries()]
        .filter(([, value]) => value >= FAVORITE_ARTIST_SCORE)
        .sort((a, b) => b[1] - a[1])
        .slice(0, FAVORITE_ARTISTS)
        .map(([artist]) => artist);

      const likes = (relaxed: string) =>
        scored.some((item) => item.entry.info.relaxed === relaxed && item.score >= RELAXED_SCORE);
      return {
        liked: liked.map(({ entry, score: value }) => describe(entry, value)),
        disliked: disliked.map(({ entry, score: value }) => describe(entry, value)),
        favoriteArtists,
        likesEphemera: likes("ephemera"),
        likesUnnamed: likes("unnamed"),
      };
    },
  };
}

function score(entry: Entry): number {
  return (
    entry.carried +
    Math.min(entry.dwell, DWELL_CAP_S) / 10 +
    2 * Math.min(entry.plaques, 2) +
    1.5 * Math.min(entry.revisits, 3) +
    (entry.approached ? 0.5 : 0) -
    0.3 * Math.min(entry.skips, 3)
  );
}

function describe(entry: Entry, value: number): TasteWork {
  return {
    title: entry.info.title,
    artist: entry.info.artist,
    date: entry.info.date,
    culture: entry.info.culture,
    medium: entry.info.medium,
    kind: entry.info.kind,
    region: entry.info.region,
    source: entry.info.source,
    seconds: Math.round(entry.dwell),
    plaque: entry.plaques > 0,
    revisits: entry.revisits,
    skips: entry.skips,
    score: round(value),
  };
}

function infoOf(work: Work): Info {
  return {
    title: cut(work.title),
    artist: cut(work.artist),
    date: cut(work.date),
    culture: cut(work.culture),
    medium: cut(work.medium),
    kind: cut(work.kind),
    region: cut(work.region),
    source: cut(work.source),
    relaxed: cut(work.relaxed),
  };
}

function load(): Map<string, Entry> {
  const entries = new Map<string, Entry>();
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    const works = saved && typeof saved === "object" ? (saved as { works?: unknown }).works : null;
    if (!Array.isArray(works)) return entries;
    for (const item of works.slice(0, STORED)) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      const id = typeof record.id === "string" ? record.id : "";
      const value = typeof record.score === "number" && Number.isFinite(record.score) ? record.score : 0;
      const info = record.info && typeof record.info === "object" ? (record.info as Record<string, unknown>) : null;
      if (!id || !info || value === 0) continue;
      entries.set(id, {
        info: {
          title: text(info.title),
          artist: text(info.artist),
          date: text(info.date),
          culture: text(info.culture),
          medium: text(info.medium),
          kind: text(info.kind),
          region: text(info.region),
          source: text(info.source),
          relaxed: text(info.relaxed),
        },
        carried: value * CARRY,
        dwell: 0,
        plaques: 0,
        revisits: 0,
        approached: false,
        skips: 0,
        lastLookEnd: -Infinity,
      });
    }
  } catch {
    entries.clear();
  }
  return entries;
}

function text(value: unknown): string {
  return typeof value === "string" ? cut(value) : "";
}

function cut(value: string): string {
  return value.slice(0, TEXT_MAX);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
