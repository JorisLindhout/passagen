import * as THREE from "three";
import { FALLBACK_WORKS, sanitizeWorks, type Work } from "./fallback";
import type { FrameSlot } from "./world";

const lists = new Map<string, Promise<Work[]>>();

/** One list per maze. An empty answer is not kept, so a later visit asks again. */
export function worksFor(seed: string): Promise<Work[]> {
  const cached = lists.get(seed);
  if (cached) return cached;
  const request = fetch(`/api/works?seed=${encodeURIComponent(seed)}`)
    .then(async (response) => (response.ok ? sanitizeWorks(await response.json()) : []))
    .catch(() => [] as Work[])
    .then((works) => {
      if (works.length === 0) lists.delete(seed);
      return works;
    });
  lists.set(seed, request);
  return request;
}

/**
 * Hangs a maze's list, skipping any work the previous mazes already showed.
 * The fallback images fill what is left, so a dead API still leaves pictures.
 */
export function hangWorks(options: {
  frames: FrameSlot[];
  works: Work[];
  avoid: Set<string>;
  anisotropy: number;
  alive: () => boolean;
}): void {
  const { frames, avoid, anisotropy, alive } = options;
  const chosen = options.works.filter((work) => !avoid.has(work.id));
  for (const fallback of FALLBACK_WORKS) {
    if (chosen.length >= frames.length) break;
    if (chosen.some((work) => work.id === fallback.id)) continue;
    chosen.push(fallback);
  }

  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin("anonymous");
  const apply = (slot: FrameSlot, texture: THREE.Texture) => {
    if (!alive()) {
      texture.dispose();
      return;
    }
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = anisotropy;
    slot.material.map?.dispose();
    slot.material.map = texture;
    slot.material.color.set(0xffffff);
    slot.material.needsUpdate = true;
  };

  frames.forEach((slot, index) => {
    const work = chosen[index];
    if (!work) return;
    slot.work = work;
    slot.setAspect(work.aspect);
    loader.load(
      work.image,
      (texture) => apply(slot, texture),
      undefined,
      () => {
        if (!alive()) return;
        const fallback = FALLBACK_WORKS[index % FALLBACK_WORKS.length];
        if (!fallback || fallback.id === work.id) return;
        slot.work = fallback;
        slot.setAspect(fallback.aspect);
        loader.load(fallback.image, (texture) => apply(slot, texture));
      },
    );
  });
}
