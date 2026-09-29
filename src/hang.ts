import { CELL, GRID, hashSeed, type Maze } from "./maze";

export type HangSpot = {
  x: number;
  z: number;
  facing: number;
};

const FRAME_INSET = 0.04;

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
 * Twelve hang points: dead-end walls first, then the longest straight runs.
 * On a run, pictures share one wall, stay 4 m apart, and skip the cells
 * beside a corner.
 */
export function hangSpots(maze: Maze, seed: string): HangSpot[] {
  const size = maze.size;
  const floor = maze.floor;
  const spots: HangSpot[] = [];

  const isFloor = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < size && y < size && floor[y * size + x] === 1;

  const neighbors = (x: number, y: number) => {
    const found: { x: number; y: number }[] = [];
    if (isFloor(x + 1, y)) found.push({ x: x + 1, y });
    if (isFloor(x - 1, y)) found.push({ x: x - 1, y });
    if (isFloor(x, y + 1)) found.push({ x, y: y + 1 });
    if (isFloor(x, y - 1)) found.push({ x, y: y - 1 });
    return found;
  };

  const straightAxis = (x: number, y: number): "h" | "v" | null => {
    const near = neighbors(x, y);
    if (near.length !== 2 || !near[0] || !near[1]) return null;
    const opposite =
      near[0].x - x === -(near[1].x - x) && near[0].y - y === -(near[1].y - y);
    if (!opposite) return null;
    return near[0].y === y ? "h" : "v";
  };

  const corner = (x: number, y: number) => isFloor(x, y) && straightAxis(x, y) === null;

  const besideCorner = (x: number, y: number) => neighbors(x, y).some((cell) => corner(cell.x, cell.y));

  const dead: { x: number; y: number }[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (isFloor(x, y) && neighbors(x, y).length === 1) dead.push({ x, y });
    }
  }
  dead.sort((a, b) => a.y - b.y || a.x - b.x);

  for (const cell of dead) {
    if (spots.length >= 12) break;
    const opening = neighbors(cell.x, cell.y)[0];
    if (!opening) continue;
    const dx = opening.x - cell.x;
    const dy = opening.y - cell.y;
    const wall = dx === 1 ? "w" : dx === -1 ? "e" : dy === 1 ? "n" : "s";
    pushSpot(spots, spotOnWall(cell.x, cell.y, wall));
  }

  type Run = { cells: { x: number; y: number }[]; axis: "h" | "v" };
  const runs: Run[] = [];
  for (let y = 0; y < size; y++) {
    let cells: { x: number; y: number }[] = [];
    const flush = () => {
      if (cells.length >= 3) runs.push({ cells, axis: "h" });
      cells = [];
    };
    for (let x = 0; x < size; x++) {
      if (straightAxis(x, y) === "h") cells.push({ x, y });
      else flush();
    }
    flush();
  }
  for (let x = 0; x < size; x++) {
    let cells: { x: number; y: number }[] = [];
    const flush = () => {
      if (cells.length >= 3) runs.push({ cells, axis: "v" });
      cells = [];
    };
    for (let y = 0; y < size; y++) {
      if (straightAxis(x, y) === "v") cells.push({ x, y });
      else flush();
    }
    flush();
  }

  runs.sort((a, b) => b.cells.length - a.cells.length || a.cells[0]!.y - b.cells[0]!.y || a.cells[0]!.x - b.cells[0]!.x);

  for (const run of runs) {
    if (spots.length >= 12) break;
    const first = run.cells[0];
    if (!first) continue;
    const side = hashSeed(`${seed}:${first.x},${first.y},${run.axis}`) & 1;
    const eligible = run.cells.filter((cell) => !besideCorner(cell.x, cell.y));
    let previous: { x: number; z: number } | null = null;
    for (const cell of eligible) {
      if (spots.length >= 12) break;
      const wall =
        run.axis === "h" ? (side === 0 ? "n" : "s") : side === 0 ? "w" : "e";
      const spot = spotOnWall(cell.x, cell.y, wall);
      if (previous && Math.hypot(spot.x - previous.x, spot.z - previous.z) < 4) continue;
      if (!pushSpot(spots, spot)) continue;
      previous = spot;
    }
  }

  return spots;
}

function spotOnWall(x: number, y: number, wall: "n" | "s" | "e" | "w"): HangSpot {
  const cx = (x + 0.5) * CELL;
  const cz = (y + 0.5) * CELL;
  if (wall === "n") return { x: cx, z: y * CELL + FRAME_INSET, facing: 0 };
  if (wall === "s") return { x: cx, z: (y + 1) * CELL - FRAME_INSET, facing: Math.PI };
  if (wall === "w") return { x: x * CELL + FRAME_INSET, z: cz, facing: Math.PI / 2 };
  return { x: (x + 1) * CELL - FRAME_INSET, z: cz, facing: -Math.PI / 2 };
}

function pushSpot(spots: HangSpot[], spot: HangSpot): boolean {
  if (xOut(spot.x) || xOut(spot.z)) return false;
  for (const existing of spots) {
    if (Math.hypot(existing.x - spot.x, existing.z - spot.z) < 4) return false;
  }
  spots.push(spot);
  return true;
}

function xOut(value: number): boolean {
  return value < FRAME_INSET || value > GRID * CELL - FRAME_INSET;
}
