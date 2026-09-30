import * as THREE from "three";
import { FALLBACK_WORKS, sanitizeWorks, type Work } from "./fallback";
import type { TasteSummary } from "./taste";
import type { FrameSlot } from "./world";

/** The worker ignores more than this many seen works, so the most recent go. */
const SEEN_LIMIT = 2000;

/** One maze's works, chosen for this visitor. Any failure leaves the fallback images. */
export function worksForMaze(request: { count: number; seen: string[]; taste: TasteSummary | null }): Promise<Work[]> {
  return fetch("/api/works", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...request, seen: request.seen.slice(-SEEN_LIMIT) }),
  })
    .then(async (response) => (response.ok ? sanitizeWorks(await response.json()) : []))
    .catch(() => [] as Work[]);
}

/** Main-thread time per frame for sending pictures to the GPU. At least one goes each frame. */
const UPLOAD_BUDGET_MS = 4;
/** A hall's larger frames get proportionally more pixels, up to this much. */
const HALL_SIDE_GAIN = 1.25;

type Upload = {
  texture: THREE.Texture;
  maxSide: number;
  alive: () => boolean;
  done: () => void;
};

export type Uploader = {
  add: (upload: Upload) => void;
  /** Call once per animation frame. */
  step: () => void;
};

/**
 * Sends pictures to the GPU a few at a time, before their maze comes into
 * view. Left to the renderer, every picture of a maze that just came into
 * view uploads in the same frame, and the walk stalls for a moment.
 */
export function createUploader(renderer: THREE.WebGLRenderer): Uploader {
  const queue: Upload[] = [];
  return {
    add(upload) {
      queue.push(upload);
    },
    step() {
      const start = performance.now();
      let upload: Upload | undefined;
      while ((upload = queue.shift())) {
        if (upload.alive()) {
          shrink(upload.texture, upload.maxSide);
          renderer.initTexture(upload.texture);
        }
        upload.done();
        if (performance.now() - start > UPLOAD_BUDGET_MS) break;
      }
    },
  };
}

/**
 * Redraws a picture no larger than it needs to be on the GPU, and lets the
 * copy go once it has been uploaded; a phone runs out of memory long before
 * it runs out of time to draw.
 */
function shrink(texture: THREE.Texture, maxSide: number): void {
  const image = texture.image as HTMLImageElement;
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  const scale = maxSide / Math.max(width, height);
  if (!(scale < 1)) return;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (!context) return;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  texture.image = canvas;
  texture.onUpdate = () => {
    canvas.width = 1;
    canvas.height = 1;
  };
}

const FALLBACK_IDS = new Set(FALLBACK_WORKS.map((work) => work.id));

/**
 * Hangs a maze's list, skipping any work another maze already showed. A
 * picture that fails to load gives way to the list's spare works, then to
 * the fallback images, first those not yet shown this visit, so a slow
 * museum or a dead API still leaves pictures without hanging the same eight
 * everywhere.
 */
export function hangWorks(options: {
  frames: FrameSlot[];
  works: Work[];
  avoid: Set<string>;
  anisotropy: number;
  /** Longest side of a corridor picture on the GPU. */
  maxSide: number;
  uploader: Uploader;
  alive: () => boolean;
  /** Called once per frame, when its picture is up or has failed for good. */
  onSettle?: () => void;
  /** Called for every work put in a frame, spares and fallbacks included. */
  onShown?: (work: Work) => void;
}): void {
  const { frames, avoid, anisotropy, maxSide, uploader, alive } = options;
  const settle = options.onSettle ?? (() => {});
  const shown = options.onShown ?? (() => {});
  const chosen = options.works.filter((work) => !avoid.has(work.id));
  const spares = chosen.slice(frames.length);
  const fresh = FALLBACK_WORKS.filter((work) => !avoid.has(work.id) && !chosen.some((item) => item.id === work.id));
  const next = (index: number): Work =>
    spares.shift() ?? fresh.shift() ?? FALLBACK_WORKS[index % FALLBACK_WORKS.length]!;

  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin("anonymous");
  const apply = (slot: FrameSlot, texture: THREE.Texture) => {
    settle();
    if (!alive()) {
      texture.dispose();
      return;
    }
    slot.material.map?.dispose();
    slot.material.map = texture;
    slot.material.color.set(0xffffff);
    slot.material.needsUpdate = true;
  };
  const upload = (slot: FrameSlot, texture: THREE.Texture) => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = anisotropy;
    const image = texture.image as HTMLImageElement;
    void image
      .decode()
      .catch(() => {})
      .then(() => {
        uploader.add({
          texture,
          maxSide: Math.round(maxSide * Math.min(slot.scale, HALL_SIDE_GAIN)),
          alive,
          done: () => apply(slot, texture),
        });
      });
  };

  const hang = (slot: FrameSlot, work: Work, index: number) => {
    slot.work = work;
    slot.setAspect(work.aspect);
    shown(work);
    loader.load(
      work.image,
      (texture) => upload(slot, texture),
      undefined,
      () => {
        if (!alive() || FALLBACK_IDS.has(work.id)) {
          settle();
          return;
        }
        hang(slot, next(index), index);
      },
    );
  };

  frames.forEach((slot, index) => hang(slot, chosen[index] ?? next(index), index));
}
