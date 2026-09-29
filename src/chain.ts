import { hangWorks, worksFor } from "./art";
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
import { buildChunkView, type ChunkView, type FrameSlot, type Stage } from "./world";

/** Mazes built ahead of and behind the one you are in. Only one step each way is visible. */
const BUILD_REACH = 2;
const KEEP_REACH = 3;
const AVOID_BEHIND = 3;
const LIST_LENGTH = 12;

export type Chain = {
  spawn: { x: number; z: number; yaw: number };
  solid: (gx: number, gz: number) => boolean;
  update: (x: number, z: number) => void;
  frames: () => FrameSlot[];
  /** Settles once every picture visible from the spawn is up or has failed. */
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
  anisotropy: number,
  onProgress?: (fraction: number) => void,
): Chain {
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

  /**
   * Twenty frames draw on two lists of twelve, so a maze asks for alpha.2k and
   * alpha.2k+1. A hall's extra frames add alpha.2k.1, alpha.2k.2, and so on,
   * with one list to spare for works the mazes before already showed.
   */
  const mazeWorks = (k: number): Promise<Work[]> => {
    const chunk = plan(k);
    const names = [`${seed}.${2 * k}`, `${seed}.${2 * k + 1}`];
    if (chunk.hall) {
      const needed = Math.ceil(hangSpots(chunk, seed).length / LIST_LENGTH) + 1;
      for (let extra = 1; names.length < needed; extra++) names.push(`${seed}.${2 * k}.${extra}`);
    }
    return Promise.all(names.map(worksFor)).then((lists) => {
      const seen = new Set<string>();
      return lists.flat().filter((work) => {
        if (seen.has(work.id)) return false;
        seen.add(work.id);
        return true;
      });
    });
  };

  const build = (k: number) => {
    const chunk = plan(k);
    const view = buildChunkView(stage, chunk, hangSpots(chunk, seed));
    const entry: Built = { view, alive: true };
    built.set(k, entry);
    const tracked = starting && visible(k);
    if (tracked) total += view.frames.length;
    const behind: Promise<Work[]>[] = [];
    for (let back = 1; back <= AVOID_BEHIND && k - back >= 0; back++) behind.push(mazeWorks(k - back));
    void Promise.all([mazeWorks(k), ...behind]).then(([works, ...previous]) => {
      if (!entry.alive) return;
      const avoid = new Set(previous.flat().map((work) => work.id));
      hangWorks({
        frames: view.frames,
        works: works ?? [],
        avoid,
        anisotropy,
        alive: () => entry.alive,
        onSettle: tracked ? settle : undefined,
      });
    });
  };

  const visible = (k: number) => k >= current - 1 && k <= current + 1;

  const sync = () => {
    for (let k = Math.max(0, current - BUILD_REACH); k <= current + BUILD_REACH; k++) {
      if (!built.has(k)) build(k);
    }
    for (const [k, entry] of built) {
      if (k >= current - KEEP_REACH && k <= current + KEEP_REACH) continue;
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
