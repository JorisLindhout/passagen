import { createUploader, hangWorks, worksForMaze } from "./art";
import type { Work } from "./fallback";
import { hangSpots } from "./hang";
import {
  CELL,
  CHUNK,
  openingCell,
  oppositeSide,
  planChunk,
  SIDE_DX,
  SIDE_DY,
  type ChunkPlan,
} from "./maze";
import type { TasteSummary } from "./taste";
import { buildChunkView, type ChunkView, type FrameSlot, type Stage } from "./world";

/**
 * Mazes built ahead of and behind the one you are in. Only one step each way
 * is visible, but every built maze has its pictures on the GPU, so a maze is
 * dropped as soon as it falls out of reach.
 */
const BUILD_REACH = 2;
/**
 * Works asked for beyond a maze's frames: for ones another maze hung while
 * this one was asking, and for pictures that fail to load. Wellcome's image
 * server alone leaves one frame in five or so without a picture.
 */
const SPARE_WORKS = 12;
const OPENING_WAIT_MS = 15000;

export type Chain = {
  spawn: { x: number; z: number; yaw: number };
  solid: (gx: number, gz: number) => boolean;
  /** Call once per animation frame with where you stand. */
  update: (x: number, z: number) => void;
  frames: () => FrameSlot[];
  /** Settles once every picture in the first maze is up or has failed. */
  ready: Promise<void>;
};

type Built = { view: ChunkView; alive: boolean };

/**
 * Maze k is built from the seed and k, and joins maze k+1 through a gap in its
 * outer wall. You see the maze you are in and its two neighbors. The gap at
 * each far end is closed with a wall piece, so a maze appears and disappears
 * only where no line of sight reaches.
 */
export function createChain(
  seed: string,
  stage: Stage,
  pictures: { anisotropy: number; maxSide: number },
  onProgress?: (fraction: number) => void,
  taste?: () => TasteSummary | null,
): Chain {
  const uploader = createUploader(stage.renderer);
  const plans: ChunkPlan[] = [];
  const built = new Map<number, Built>();
  const blocks = new Map<string, number>();
  let current = 0;
  let starting = true;
  let total = 0;
  let settled = 0;
  let markReady = () => {};
  const ready = new Promise<void>((resolve) => {
    markReady = resolve;
  });
  /** The other mazes wait for the first one, so their searches and pictures do not compete with it. */
  const opened = Promise.race([ready, new Promise<void>((resolve) => setTimeout(resolve, OPENING_WAIT_MS))]);
  const settle = () => {
    settled += 1;
    onProgress?.(Math.min(1, settled / total));
    if (settled >= total) markReady();
  };

  const plan = (k: number): ChunkPlan => {
    while (plans.length <= k) {
      const prev = plans[plans.length - 1];
      if (!prev) {
        plans.push(planChunk(seed, 0, null, 0, 0));
        continue;
      }
      const side = prev.exit.side;
      plans.push(
        planChunk(
          seed,
          prev.index + 1,
          { side: oppositeSide(side), along: prev.exit.along },
          prev.bx + (SIDE_DX[side] ?? 0),
          prev.bz + (SIDE_DY[side] ?? 0),
        ),
      );
    }
    return plans[k]!;
  };

  /** Every work hung this visit, and the maze it hangs in. Nothing hangs twice in one visit. */
  const visitSeen = new Map<string, number>();
  /** What each maze hung, so walking back finds the same pictures. */
  const hung = new Map<number, Work[]>();

  /** One request per maze, asked for when the maze is built, with the taste as it stands then. */
  const mazeWorks = (k: number): Promise<Work[]> => {
    const again = hung.get(k);
    if (again) return Promise.resolve(again);
    return worksForMaze({
      count: hangSpots(plan(k), seed).length + SPARE_WORKS,
      seen: [...visitSeen.keys()],
      taste: taste?.() ?? null,
    });
  };

  const build = (k: number) => {
    const chunk = plan(k);
    const view = buildChunkView(stage, chunk, hangSpots(chunk, seed));
    const entry: Built = { view, alive: true };
    built.set(k, entry);
    const tracked = starting && k === current;
    if (tracked) total += view.frames.length;
    const turn = starting && !tracked ? opened : Promise.resolve();
    void turn.then(() => mazeWorks(k)).then((works) => {
      if (!entry.alive) return;
      const avoid = new Set<string>();
      for (const [id, maze] of visitSeen) if (maze !== k) avoid.add(id);
      hangWorks({
        frames: view.frames,
        works,
        avoid,
        anisotropy: pictures.anisotropy,
        maxSide: pictures.maxSide,
        uploader,
        alive: () => entry.alive,
        onSettle: tracked ? settle : undefined,
        onShown: (work) => {
          if (!visitSeen.has(work.id)) visitSeen.set(work.id, k);
        },
      });
      if (!hung.has(k) && works.length > 0) hung.set(k, works);
    });
  };

  const visible = (k: number) => k >= current - 1 && k <= current + 1;

  const sync = () => {
    for (let k = Math.max(0, current - BUILD_REACH); k <= current + BUILD_REACH; k++) {
      if (!built.has(k)) build(k);
    }
    for (const [k, entry] of built) {
      if (k >= current - BUILD_REACH && k <= current + BUILD_REACH) continue;
      entry.alive = false;
      entry.view.dispose();
      built.delete(k);
    }
    blocks.clear();
    for (const [k, entry] of built) {
      const shown = visible(k);
      entry.view.group.visible = shown;
      entry.view.setPlugs(k >= current, k <= current);
      if (shown) {
        const chunk = plan(k);
        blocks.set(`${chunk.bx},${chunk.bz}`, k);
      }
    }
  };

  const solid = (gx: number, gz: number): boolean => {
    const bx = Math.floor(gx / CHUNK);
    const bz = Math.floor(gz / CHUNK);
    const k = blocks.get(`${bx},${bz}`);
    if (k === undefined) return true;
    const chunk = plan(k);
    const lx = gx - bx * CHUNK;
    const lz = gz - bz * CHUNK;
    if (chunk.floor[lz * chunk.size + lx] !== 1) return true;
    if (chunk.entry && k < current) {
      const cell = openingCell(chunk.entry, chunk.size);
      if (cell.x === lx && cell.y === lz) return true;
    }
    if (k > current) {
      const cell = openingCell(chunk.exit, chunk.size);
      if (cell.x === lx && cell.y === lz) return true;
    }
    return false;
  };

  const update = (x: number, z: number) => {
    uploader.step();
    const bx = Math.floor(Math.floor(x / CELL) / CHUNK);
    const bz = Math.floor(Math.floor(z / CELL) / CHUNK);
    const k = blocks.get(`${bx},${bz}`);
    if (k === undefined || k === current) return;
    current = k;
    sync();
  };

  const frames = () => {
    const list: FrameSlot[] = [];
    for (const [k, entry] of built) if (visible(k)) list.push(...entry.view.frames);
    return list;
  };

  sync();
  starting = false;
  if (total === 0) markReady();
  const first = plan(0);
  const spawn = first.spawn ?? { x: (first.size * CELL) / 2, z: (first.size * CELL) / 2, yaw: 0 };
  return { spawn, solid, update, frames, ready };
}
