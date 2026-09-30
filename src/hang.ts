import { CELL, hashSeed, inHall, makeRng, type ChunkPlan, type Hall } from "./maze";

export type HangSpot = {
  x: number;
  z: number;
  facing: number;
  /** 1 in the corridors. A hall hangs larger frames. */
  scale: number;
};

export const WORKS_PER_MAZE = 30;
const FRAME_INSET = 0.04;
/** Center to center, so two frames never share a cell or crowd a corner. */
const MIN_GAP = 3.4;
/** A hall picks one spacing and one frame size for all its walls. */
const HALL_PITCH_MIN = 2.7;
const HALL_PITCH_MAX = 4.6;
const HALL_SCALE_MIN = 1.15;
const HALL_SCALE_MAX = 1.6;

type Wall = "n" | "s" | "e" | "w";

/** Longest side stays near eye height. Aspect is width / height. */
export function frameSize(aspect: number, scale = 1): { w: number; h: number } {
  const safe = Number.isFinite(aspect) && aspect > 0 ? aspect : 0.8;
  const maxW = 1.2 * scale;
  const maxH = 1.4 * scale;
  let w = maxW;
  let h = w / safe;
  if (h > maxH) {
    h = maxH;
    w = h * safe;
  }
  return { w, h };
}

/**
 * Up to thirty hang points in one maze, in local meters. First the back wall
 * of each dead end, then the wall a corridor runs into at a turn or a T, seen
 * from the longest approach, then the straight runs, one wall per run, every
 * other cell. The gaps in the outer wall count as floor, so nothing hangs
 * across a passage. A hall's own walls come first and do not count toward
 * the thirty.
 */
export function hangSpots(plan: ChunkPlan, seed: string): HangSpot[] {
  const hall = plan.hall ? hallSpots(plan, plan.hall, seed) : [];
  return [...hall, ...corridorSpots(plan, seed)];
}

function corridorSpots(plan: ChunkPlan, seed: string): HangSpot[] {
  const { size, floor, hall } = plan;
  const spots: HangSpot[] = [];
  const full = () => spots.length >= WORKS_PER_MAZE;
  const hash = (key: string) => hashSeed(`${seed}:${plan.index}:${key}`);

  const isFloor = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < size && y < size && floor[y * size + x] === 1;
  const interior = (x: number, y: number) => x >= 1 && y >= 1 && x <= size - 2 && y <= size - 2;

  const openings = (x: number, y: number) => {
    const found: { dx: number; dy: number }[] = [];
    if (isFloor(x + 1, y)) found.push({ dx: 1, dy: 0 });
    if (isFloor(x - 1, y)) found.push({ dx: -1, dy: 0 });
    if (isFloor(x, y + 1)) found.push({ dx: 0, dy: 1 });
    if (isFloor(x, y - 1)) found.push({ dx: 0, dy: -1 });
    return found;
  };

  /** The wall straight ahead when you walk in through this opening. */
  const facedFrom = (dx: number, dy: number): Wall => (dx === 1 ? "w" : dx === -1 ? "e" : dy === 1 ? "n" : "s");

  const reach = (x: number, y: number, dx: number, dy: number) => {
    let steps = 0;
    while (isFloor(x + dx * (steps + 1), y + dy * (steps + 1))) steps += 1;
    return steps;
  };

  const straightAxis = (x: number, y: number): "h" | "v" | null => {
    if (!interior(x, y) || !isFloor(x, y) || inHall(hall, x, y)) return null;
    const near = openings(x, y);
    if (near.length !== 2 || !near[0] || !near[1]) return null;
    if (near[0].dx !== -near[1].dx || near[0].dy !== -near[1].dy) return null;
    return near[0].dy === 0 ? "h" : "v";
  };

  const dead: { x: number; y: number; wall: Wall }[] = [];
  const ends: { x: number; y: number; wall: Wall; approach: number }[] = [];
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      if (!isFloor(x, y) || inHall(hall, x, y)) continue;
      const near = openings(x, y);
      if (near.length === 1 && near[0]) {
        dead.push({ x, y, wall: facedFrom(near[0].dx, near[0].dy) });
        continue;
      }
      if (near.length === 2 && straightAxis(x, y) === null) {
        const views = near.map((open) => ({ wall: facedFrom(open.dx, open.dy), approach: reach(x, y, open.dx, open.dy) }));
        views.sort((a, b) => b.approach - a.approach || (hash(`${x},${y}`) & 1 ? -1 : 1));
        if (views[0]) ends.push({ x, y, ...views[0] });
        continue;
      }
      if (near.length === 3) {
        const stem = [
          { dx: 1, dy: 0 },
          { dx: -1, dy: 0 },
          { dx: 0, dy: 1 },
          { dx: 0, dy: -1 },
        ].find((dir) => !isFloor(x - dir.dx, y - dir.dy));
        if (stem && isFloor(x + stem.dx, y + stem.dy)) {
          ends.push({ x, y, wall: facedFrom(stem.dx, stem.dy), approach: reach(x, y, stem.dx, stem.dy) });
        }
      }
    }
  }

  dead.sort((a, b) => a.y - b.y || a.x - b.x);
  for (const cell of dead) {
    if (full()) break;
    pushSpot(spots, spotOnWall(cell.x, cell.y, cell.wall), size);
  }

  ends.sort((a, b) => b.approach - a.approach || a.y - b.y || a.x - b.x);
  for (const cell of ends) {
    if (full()) break;
    if (cell.approach < 2) continue;
    pushSpot(spots, spotOnWall(cell.x, cell.y, cell.wall), size);
  }

  type Run = { cells: { x: number; y: number }[]; axis: "h" | "v" };
  const runs: Run[] = [];
  const collect = (axis: "h" | "v") => {
    for (let a = 0; a < size; a++) {
      let cells: { x: number; y: number }[] = [];
      const flush = () => {
        if (cells.length >= 2) runs.push({ cells, axis });
        cells = [];
      };
      for (let b = 0; b < size; b++) {
        const x = axis === "h" ? b : a;
        const y = axis === "h" ? a : b;
        if (straightAxis(x, y) === axis) cells.push({ x, y });
        else flush();
      }
      flush();
    }
  };
  collect("h");
  collect("v");
  runs.sort(
    (a, b) =>
      b.cells.length - a.cells.length || a.cells[0]!.y - b.cells[0]!.y || a.cells[0]!.x - b.cells[0]!.x,
  );

  for (const run of runs) {
    if (full()) break;
    const first = run.cells[0];
    if (!first) continue;
    const side = hash(`${first.x},${first.y},${run.axis}`) & 1;
    const wall: Wall = run.axis === "h" ? (side === 0 ? "n" : "s") : side === 0 ? "w" : "e";
    for (const cell of run.cells) {
      if (full()) break;
      pushSpot(spots, spotOnWall(cell.x, cell.y, wall), size);
    }
  }

  return spots;
}

/**
 * Each unbroken stretch of hall wall between corners and doorways holds as
 * many frames as fit at the hall's spacing, evenly spread and centered. A
 * stretch too short for one stays bare.
 */
function hallSpots(plan: ChunkPlan, hall: Hall, seed: string): HangSpot[] {
  const { size, floor } = plan;
  const rng = makeRng(`hang:${seed}:${plan.index}`);
  const pitch = HALL_PITCH_MIN + (HALL_PITCH_MAX - HALL_PITCH_MIN) * rng.next();
  const scale = HALL_SCALE_MIN + (HALL_SCALE_MAX - HALL_SCALE_MIN) * rng.next();
  const isWall = (x: number, y: number) =>
    x < 0 || y < 0 || x >= size || y >= size || floor[y * size + x] !== 1;

  const sides = [
    { length: hall.w, behind: (i: number) => isWall(hall.x + i, hall.y - 1), start: hall.x, place: (along: number) => ({ x: along, z: hall.y * CELL + FRAME_INSET, facing: 0 }) },
    { length: hall.w, behind: (i: number) => isWall(hall.x + i, hall.y + hall.h), start: hall.x, place: (along: number) => ({ x: along, z: (hall.y + hall.h) * CELL - FRAME_INSET, facing: Math.PI }) },
    { length: hall.h, behind: (i: number) => isWall(hall.x - 1, hall.y + i), start: hall.y, place: (along: number) => ({ x: hall.x * CELL + FRAME_INSET, z: along, facing: Math.PI / 2 }) },
    { length: hall.h, behind: (i: number) => isWall(hall.x + hall.w, hall.y + i), start: hall.y, place: (along: number) => ({ x: (hall.x + hall.w) * CELL - FRAME_INSET, z: along, facing: -Math.PI / 2 }) },
  ];

  const spots: HangSpot[] = [];
  for (const side of sides) {
    let from = -1;
    for (let i = 0; i <= side.length; i++) {
      const wall = i < side.length && side.behind(i);
      if (wall && from < 0) from = i;
      if (wall || from < 0) continue;
      const begin = (side.start + from) * CELL;
      const span = (i - from) * CELL;
      const count = Math.floor(span / pitch);
      for (let k = 0; k < count; k++) {
        spots.push({ ...side.place(begin + (span * (k + 0.5)) / count), scale });
      }
      from = -1;
    }
  }
  return spots;
}

function spotOnWall(x: number, y: number, wall: Wall): HangSpot {
  const cx = (x + 0.5) * CELL;
  const cz = (y + 0.5) * CELL;
  if (wall === "n") return { x: cx, z: y * CELL + FRAME_INSET, facing: 0, scale: 1 };
  if (wall === "s") return { x: cx, z: (y + 1) * CELL - FRAME_INSET, facing: Math.PI, scale: 1 };
  if (wall === "w") return { x: x * CELL + FRAME_INSET, z: cz, facing: Math.PI / 2, scale: 1 };
  return { x: (x + 1) * CELL - FRAME_INSET, z: cz, facing: -Math.PI / 2, scale: 1 };
}

function pushSpot(spots: HangSpot[], spot: HangSpot, size: number): boolean {
  const limit = size * CELL - FRAME_INSET;
  if (spot.x < FRAME_INSET || spot.x > limit || spot.z < FRAME_INSET || spot.z > limit) return false;
  for (const existing of spots) {
    if (Math.hypot(existing.x - spot.x, existing.z - spot.z) < MIN_GAP) return false;
  }
  spots.push(spot);
  return true;
}
