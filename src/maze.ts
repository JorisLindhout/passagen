/** One maze is a 15×15 block of 2.4 m cells, 36 m across. Mazes chain without end. */
export const CHUNK = 15;
export const CELL = 2.4;
export const WALL_H = 3.2;

const BLACK = 0;
const WHITE = 1;
const GRAY = 2;
const RED = 3;

const DX = [1, -1, 0, 0];
const DY = [0, 0, 1, -1];

/** Steps a corridor may run straight before it must turn. Two steps is five cells, 12 m. */
const MAX_RUN = 2;
const TURN_WEIGHT = 3;
const DOORS = 2;
const DOOR_MIN_SPAN = 20;
const EXIT_MIN_SPAN = 12;
/** Longest straight line of floor cells a maze may keep, 21.6 m. */
const MAX_LINE = 9;
const ATTEMPTS = 12;

/** 0 north (−z), 1 east (+x), 2 south (+z), 3 west (−x). */
export type Side = 0 | 1 | 2 | 3;
export const SIDE_DX = [0, 1, 0, -1];
export const SIDE_DY = [-1, 0, 1, 0];

/** A gap in the outer wall, at an odd coordinate along that side. */
export type Opening = { side: Side; along: number };

export type ChunkPlan = {
  index: number;
  bx: number;
  bz: number;
  size: number;
  floor: Uint8Array;
  entry: Opening | null;
  exit: Opening;
  /** Local meters. Only the first maze has a spawn. */
  spawn: { x: number; z: number; yaw: number } | null;
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

export function oppositeSide(side: Side): Side {
  return ((side + 2) % 4) as Side;
}

export function openingCell(opening: Opening, size: number): { x: number; y: number } {
  if (opening.side === 0) return { x: opening.along, y: 0 };
  if (opening.side === 1) return { x: size - 1, y: opening.along };
  if (opening.side === 2) return { x: opening.along, y: size - 1 };
  return { x: 0, y: opening.along };
}

function openingNode(opening: Opening, size: number): { x: number; y: number } {
  if (opening.side === 0) return { x: opening.along, y: 1 };
  if (opening.side === 1) return { x: size - 2, y: opening.along };
  if (opening.side === 2) return { x: opening.along, y: size - 2 };
  return { x: 1, y: opening.along };
}

/**
 * The first maze in a chain has no entry and spawns in a dead end. Every
 * later maze starts at the gap the previous exit leads into.
 */
export function planChunk(
  seed: string,
  index: number,
  entry: Opening | null,
  bx: number,
  bz: number,
): ChunkPlan {
  let best: ChunkPlan | null = null;
  let bestLine = Infinity;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const plan = tryChunk(seed, index, attempt, entry, bx, bz);
    const line = longestLine(plan.floor, plan.size);
    if (line < bestLine) {
      best = plan;
      bestLine = line;
    }
    if (line <= MAX_LINE) break;
  }
  return best!;
}

function tryChunk(
  seed: string,
  index: number,
  attempt: number,
  entry: Opening | null,
  bx: number,
  bz: number,
): ChunkPlan {
  const size = CHUNK;
  const rng = makeRng(`maze:${seed}:${index}:${attempt}`);
  const nodes = (size - 1) / 2;
  const start = entry
    ? openingNode(entry, size)
    : { x: 1 + 2 * rng.int(nodes), y: 1 + 2 * rng.int(nodes) };

  const floor = carve(rng, size, start);
  openDoors(rng, floor, size);

  let origin = start;
  let spawn: ChunkPlan["spawn"] = null;
  if (!entry) {
    const dead = deadEnds(floor, size);
    const pick = dead.length > 0 ? dead[rng.int(dead.length)] : undefined;
    const cell = pick ?? { x: start.x, y: start.y, dx: 0, dy: -1 };
    origin = cell;
    spawn = {
      x: (cell.x + 0.5) * CELL,
      z: (cell.y + 0.5) * CELL,
      yaw: Math.atan2(-cell.dx, -cell.dy),
    };
  }

  const exit = chooseExit(rng, floor, size, origin, entry?.side ?? null);
  for (const opening of entry ? [entry, exit] : [exit]) {
    const cell = openingCell(opening, size);
    floor[cell.y * size + cell.x] = 1;
  }

  return { index, bx, bz, size, floor, entry, exit, spawn };
}

/**
 * MarkovJunior's backtracker, written out: RBB=GGR carves forward from the
 * head, and when nothing matches, RGG=WWR walks the head back along its path.
 * The forward rule prefers turns and refuses a third straight step, so no
 * corridor gives a long view.
 */
function carve(rng: Rng, size: number, start: { x: number; y: number }): Uint8Array {
  const grid = new Uint8Array(size * size);
  const heading = new Int8Array(size * size).fill(-1);
  const run = new Uint8Array(size * size);
  const inside = (x: number, y: number) => x >= 1 && y >= 1 && x <= size - 2 && y <= size - 2;

  let hx = start.x;
  let hy = start.y;
  grid[hy * size + hx] = RED;

  for (let guard = 0; guard < size * size * 4; guard++) {
    const here = hy * size + hx;
    const options: { dir: number; weight: number; straight: boolean }[] = [];
    for (let dir = 0; dir < 4; dir++) {
      const dx = DX[dir] ?? 0;
      const dy = DY[dir] ?? 0;
      if (!inside(hx + dx * 2, hy + dy * 2)) continue;
      const mid = (hy + dy) * size + (hx + dx);
      const far = (hy + dy * 2) * size + (hx + dx * 2);
      if (grid[mid] !== BLACK || grid[far] !== BLACK) continue;
      const straight = heading[here] === dir;
      const weight = straight ? ((run[here] ?? 0) >= MAX_RUN ? 0 : 1) : TURN_WEIGHT;
      options.push({ dir, weight, straight });
    }

    if (options.length > 0) {
      let total = options.reduce((sum, option) => sum + option.weight, 0);
      if (total === 0) {
        for (const option of options) option.weight = 1;
        total = options.length;
      }
      let roll = rng.next() * total;
      let chosen = options[options.length - 1]!;
      for (const option of options) {
        roll -= option.weight;
        if (roll < 0) {
          chosen = option;
          break;
        }
      }
      const dx = DX[chosen.dir] ?? 0;
      const dy = DY[chosen.dir] ?? 0;
      const next = (hy + dy * 2) * size + (hx + dx * 2);
      grid[here] = GRAY;
      grid[(hy + dy) * size + (hx + dx)] = GRAY;
      grid[next] = RED;
      heading[next] = chosen.dir;
      run[next] = chosen.straight ? (run[here] ?? 0) + 1 : 1;
      hx += dx * 2;
      hy += dy * 2;
      continue;
    }

    let moved = false;
    for (let dir = 0; dir < 4; dir++) {
      const dx = DX[dir] ?? 0;
      const dy = DY[dir] ?? 0;
      if (!inside(hx + dx * 2, hy + dy * 2)) continue;
      const mid = (hy + dy) * size + (hx + dx);
      const far = (hy + dy * 2) * size + (hx + dx * 2);
      if (grid[mid] !== GRAY || grid[far] !== GRAY) continue;
      grid[here] = WHITE;
      grid[mid] = WHITE;
      grid[far] = RED;
      hx += dx * 2;
      hy += dy * 2;
      moved = true;
      break;
    }
    if (!moved) {
      grid[here] = WHITE;
      break;
    }
  }

  const floor = new Uint8Array(size * size);
  for (let i = 0; i < grid.length; i++) floor[i] = grid[i] === BLACK ? 0 : 1;
  return floor;
}

/** Opens walls whose two sides are far apart along the corridors, so loops are long. */
function openDoors(rng: Rng, floor: Uint8Array, size: number): void {
  const isFloor = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < size && y < size && floor[y * size + x] === 1;
  const candidates: { x: number; y: number; span: number }[] = [];
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      if (floor[y * size + x] === 1) continue;
      let a: { x: number; y: number } | null = null;
      let b: { x: number; y: number } | null = null;
      if (x % 2 === 0 && y % 2 === 1 && isFloor(x - 1, y) && isFloor(x + 1, y)) {
        a = { x: x - 1, y };
        b = { x: x + 1, y };
      } else if (x % 2 === 1 && y % 2 === 0 && isFloor(x, y - 1) && isFloor(x, y + 1)) {
        a = { x, y: y - 1 };
        b = { x, y: y + 1 };
      }
      if (!a || !b) continue;
      floor[y * size + x] = 1;
      const line = lineThrough(floor, size, x, y, a.y === y ? 1 : 0, a.y === y ? 0 : 1);
      floor[y * size + x] = 0;
      if (line > MAX_LINE) continue;
      const span = distances(floor, size, a)[b.y * size + b.x] ?? -1;
      candidates.push({ x, y, span });
    }
  }
  const far = candidates.filter((door) => door.span >= DOOR_MIN_SPAN);
  const pool = far.length >= DOORS ? far : candidates.sort((p, q) => q.span - p.span).slice(0, DOORS * 3);
  const chosen: { x: number; y: number }[] = [];
  while (chosen.length < DOORS && pool.length > 0) {
    const [door] = pool.splice(rng.int(pool.length), 1);
    if (!door) break;
    if (chosen.some((other) => Math.abs(other.x - door.x) + Math.abs(other.y - door.y) < 6)) continue;
    chosen.push(door);
  }
  for (const door of chosen) floor[door.y * size + door.x] = 1;
}

/** The exit is the edge node farthest along the corridors, on a side other than the entry. */
function chooseExit(
  rng: Rng,
  floor: Uint8Array,
  size: number,
  origin: { x: number; y: number },
  entrySide: Side | null,
): Opening {
  const dist = distances(floor, size, origin);
  const all: { opening: Opening; span: number; reach: number }[] = [];
  for (const side of [0, 1, 2, 3] as Side[]) {
    if (side === entrySide) continue;
    for (let along = 1; along < size - 1; along += 2) {
      const opening = { side, along };
      const node = openingNode(opening, size);
      const reach = dist[node.y * size + node.x] ?? -1;
      if (reach < 0) continue;
      const span = Math.abs(node.x - origin.x) + Math.abs(node.y - origin.y);
      all.push({ opening, span, reach });
    }
  }
  const spread = all.filter((item) => item.span >= EXIT_MIN_SPAN);
  const pool = spread.length > 0 ? spread : all;
  const best = pool.reduce((max, item) => Math.max(max, item.reach), -1);
  const top = pool.filter((item) => item.reach === best);
  const pick = top[rng.int(top.length)] ?? all[0];
  return pick ? pick.opening : { side: entrySide === 0 ? 2 : 0, along: 1 };
}

function deadEnds(floor: Uint8Array, size: number): { x: number; y: number; dx: number; dy: number }[] {
  const found: { x: number; y: number; dx: number; dy: number }[] = [];
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      if (floor[y * size + x] !== 1) continue;
      const open: { dx: number; dy: number }[] = [];
      for (let dir = 0; dir < 4; dir++) {
        const dx = DX[dir] ?? 0;
        const dy = DY[dir] ?? 0;
        if (floor[(y + dy) * size + (x + dx)] === 1) open.push({ dx, dy });
      }
      if (open.length === 1 && open[0]) found.push({ x, y, dx: open[0].dx, dy: open[0].dy });
    }
  }
  return found;
}

function lineThrough(floor: Uint8Array, size: number, x: number, y: number, dx: number, dy: number): number {
  let count = 1;
  for (let step = 1; ; step++) {
    const nx = x + dx * step;
    const ny = y + dy * step;
    if (nx < 0 || ny < 0 || nx >= size || ny >= size || floor[ny * size + nx] !== 1) break;
    count++;
  }
  for (let step = 1; ; step++) {
    const nx = x - dx * step;
    const ny = y - dy * step;
    if (nx < 0 || ny < 0 || nx >= size || ny >= size || floor[ny * size + nx] !== 1) break;
    count++;
  }
  return count;
}

function longestLine(floor: Uint8Array, size: number): number {
  let best = 0;
  for (let y = 0; y < size; y++) {
    let run = 0;
    for (let x = 0; x < size; x++) {
      run = floor[y * size + x] === 1 ? run + 1 : 0;
      if (run > best) best = run;
    }
  }
  for (let x = 0; x < size; x++) {
    let run = 0;
    for (let y = 0; y < size; y++) {
      run = floor[y * size + x] === 1 ? run + 1 : 0;
      if (run > best) best = run;
    }
  }
  return best;
}

function distances(floor: Uint8Array, size: number, from: { x: number; y: number }): Int32Array {
  const dist = new Int32Array(size * size).fill(-1);
  const start = from.y * size + from.x;
  if (floor[start] !== 1) return dist;
  const queue = [start];
  dist[start] = 0;
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head]!;
    const x = cell % size;
    const y = (cell / size) | 0;
    for (let dir = 0; dir < 4; dir++) {
      const nx = x + (DX[dir] ?? 0);
      const ny = y + (DY[dir] ?? 0);
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const next = ny * size + nx;
      if (floor[next] !== 1 || dist[next] !== -1) continue;
      dist[next] = (dist[cell] ?? 0) + 1;
      queue.push(next);
    }
  }
  return dist;
}
