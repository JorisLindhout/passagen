/** Cell size in meters. A 21×21 grid is 50.4 m across. */
export const GRID = 21;
export const CELL = 2.4;
export const WALL_H = 3.2;

const BLACK = 0;
const WHITE = 1;
const MARK = 2;

const DX = [1, -1, 0, 0];
const DY = [0, 0, 1, -1];

export type Maze = {
  size: number;
  cell: number;
  floor: Uint8Array;
  spawn: { x: number; z: number; yaw: number };
};

export type Rng = {
  next(): number;
  int(max: number): number;
};

/** FNV-1a, then mulberry32. The same seed always rebuilds the same maze. */
export function makeRng(seed: string): Rng {
  let state = hashSeed(seed) || 0x6d2b79f5;
  const next = () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int(max: number) {
      return Math.floor(next() * max);
    },
  };
}

export function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * One MarkovJunior rule, WBB=WAW, written out in four directions.
 * The grid starts black. The center cell is white. Each step finds every
 * horizontal or vertical W B B, picks one, and writes W A W.
 * White and A are floor. Four extra wall cells between floors are opened
 * so a few loops exist.
 */
export function generateMaze(seed: string): Maze {
  const size = GRID;
  const grid = new Uint8Array(size * size);
  const center = (size / 2) | 0;
  grid[center * size + center] = WHITE;
  const rng = makeRng(seed);

  const at = (x: number, y: number) => grid[y * size + x] ?? BLACK;

  for (let guard = 0; guard < size * size * 4; guard++) {
    const matches: { x: number; y: number; dir: number }[] = [];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (at(x, y) !== WHITE) continue;
        for (let dir = 0; dir < 4; dir++) {
          const dx = DX[dir] ?? 0;
          const dy = DY[dir] ?? 0;
          const x1 = x + dx;
          const y1 = y + dy;
          const x2 = x + dx * 2;
          const y2 = y + dy * 2;
          if (x2 < 0 || y2 < 0 || x2 >= size || y2 >= size) continue;
          if (at(x1, y1) === BLACK && at(x2, y2) === BLACK) {
            matches.push({ x, y, dir });
          }
        }
      }
    }
    if (matches.length === 0) break;
    const chosen = matches[rng.int(matches.length)];
    if (!chosen) break;
    const dx = DX[chosen.dir] ?? 0;
    const dy = DY[chosen.dir] ?? 0;
    grid[(chosen.y + dy) * size + (chosen.x + dx)] = MARK;
    grid[(chosen.y + dy * 2) * size + (chosen.x + dx * 2)] = WHITE;
  }

  const open = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return false;
    return at(x, y) !== BLACK;
  };

  const doors: { x: number; y: number }[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (at(x, y) !== BLACK) continue;
      const horizontal = open(x - 1, y) && open(x + 1, y);
      const vertical = open(x, y - 1) && open(x, y + 1);
      if (horizontal || vertical) doors.push({ x, y });
    }
  }
  for (let i = doors.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const swap = doors[i];
    doors[i] = doors[j] ?? doors[i]!;
    doors[j] = swap ?? doors[j]!;
  }
  for (const door of doors.slice(0, 4)) {
    grid[door.y * size + door.x] = WHITE;
  }

  const floor = new Uint8Array(size * size);
  for (let i = 0; i < grid.length; i++) floor[i] = grid[i] === BLACK ? 0 : 1;

  const dead: { x: number; y: number; dx: number; dy: number }[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (floor[y * size + x] !== 1) continue;
      const neighbors: { dx: number; dy: number }[] = [];
      for (let dir = 0; dir < 4; dir++) {
        const nx = x + (DX[dir] ?? 0);
        const ny = y + (DY[dir] ?? 0);
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        if (floor[ny * size + nx] === 1) neighbors.push({ dx: DX[dir] ?? 0, dy: DY[dir] ?? 0 });
      }
      if (neighbors.length === 1 && neighbors[0]) {
        dead.push({ x, y, dx: neighbors[0].dx, dy: neighbors[0].dy });
      }
    }
  }

  const spot = dead.length > 0 ? dead[rng.int(dead.length)] : { x: center, y: center, dx: 0, dy: -1 };
  const spawn = spot ?? { x: center, y: center, dx: 0, dy: -1 };
  return {
    size,
    cell: CELL,
    floor,
    spawn: {
      x: (spawn.x + 0.5) * CELL,
      z: (spawn.y + 0.5) * CELL,
      yaw: Math.atan2(-spawn.dx, -spawn.dy),
    },
  };
}
