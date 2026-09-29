import { CELL, hashSeed, type ChunkPlan } from "./maze";

export type HangSpot = {
  x: number;
  z: number;
  facing: number;
};

export const WORKS_PER_MAZE = 20;
const FRAME_INSET = 0.04;
/** Center to center, so two frames never share a cell or crowd a corner. */
const MIN_GAP = 3.4;

type Wall = "n" | "s" | "e" | "w";

/** Longest side stays near eye height. Aspect is width / height. */
export function frameSize(aspect: number): { w: number; h: number } {
  const safe = Number.isFinite(aspect) && aspect > 0 ? aspect : 0.8;
  const maxW = 1.2;
  const maxH = 1.4;
  let w = maxW;
  let h = w / safe;
  if (h > maxH) {
    h = maxH;
    w = h * safe;
  }
  return { w, h };
}

/**
 * Up to twenty hang points in one maze, in local meters. First the back wall
 * of each dead end, then the wall a corridor runs into at a turn or a T, seen
 * from the longest approach, then the straight runs, one wall per run, every
 * other cell. The gaps in the outer wall count as floor, so nothing hangs
 * across a passage.
 */
export function hangSpots(plan: ChunkPlan, seed: string): HangSpot[] {
  const { size, floor } = plan;
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
    if (!interior(x, y) || !isFloor(x, y)) return null;
    const near = openings(x, y);
    if (near.length !== 2 || !near[0] || !near[1]) return null;
    if (near[0].dx !== -near[1].dx || near[0].dy !== -near[1].dy) return null;
    return near[0].dy === 0 ? "h" : "v";
  };

  const dead: { x: number; y: number; wall: Wall }[] = [];
  const ends: { x: number; y: number; wall: Wall; approach: number }[] = [];
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      if (!isFloor(x, y)) continue;
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

function spotOnWall(x: number, y: number, wall: Wall): HangSpot {
  const cx = (x + 0.5) * CELL;
  const cz = (y + 0.5) * CELL;
  if (wall === "n") return { x: cx, z: y * CELL + FRAME_INSET, facing: 0 };
  if (wall === "s") return { x: cx, z: (y + 1) * CELL - FRAME_INSET, facing: Math.PI };
  if (wall === "w") return { x: x * CELL + FRAME_INSET, z: cz, facing: Math.PI / 2 };
  return { x: (x + 1) * CELL - FRAME_INSET, z: cz, facing: -Math.PI / 2 };
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
