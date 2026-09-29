import * as THREE from "three";
import { createChain } from "./chain";
import type { Work } from "./fallback";
import { createInput } from "./input";
import { createPlaque } from "./overlay";
import { BOB_CYCLE, createWalker, EYE_HEIGHT, stepWalker, TOP_SPEED } from "./walk";
import { createFootsteps, measureSpace, type SoundSettings } from "./sound";
import { createStage } from "./world";

const SEED_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
/** A slow image host should not keep anyone at the door. */
const LOAD_LIMIT_MS = 15000;
const mobile = window.matchMedia("(pointer: coarse)").matches;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const canvas = document.querySelector("#view");
const gate = document.querySelector("#gate");
const walkButton = document.querySelector("#walk");
const stick = document.querySelector("#stick");
const knob = document.querySelector("#knob");
const plaqueRoot = document.querySelector("#plaque");
const plaqueText = document.querySelector("#plaque-text");
const plaqueToggle = document.querySelector("#plaque-toggle");
const loading = document.querySelector("#loading");
if (
  !(canvas instanceof HTMLCanvasElement) ||
  !(gate instanceof HTMLElement) ||
  !(walkButton instanceof HTMLButtonElement) ||
  !(stick instanceof HTMLElement) ||
  !(knob instanceof HTMLElement) ||
  !(plaqueRoot instanceof HTMLElement) ||
  !(plaqueText instanceof HTMLElement) ||
  !(plaqueToggle instanceof HTMLButtonElement) ||
  !(loading instanceof HTMLElement)
) {
  throw new Error("missing view");
}

const plaque = createPlaque(plaqueRoot, plaqueText, plaqueToggle);

const seed = currentSeed();
const world = createStage(canvas, mobile);
const loadingBar = loading.firstElementChild instanceof HTMLElement ? loading.firstElementChild : null;
const showProgress = (fraction: number) => {
  if (loadingBar) loadingBar.style.transform = `scaleX(${fraction})`;
  loading.setAttribute("aria-valuenow", String(Math.round(fraction * 100)));
};
const chain = createChain(
  seed,
  world,
  Math.min(8, world.renderer.capabilities.getMaxAnisotropy()),
  showProgress,
);
void Promise.race([chain.ready, new Promise((resolve) => setTimeout(resolve, LOAD_LIMIT_MS))]).then(() => {
  showProgress(1);
  loading.classList.add("done");
  walkButton.disabled = false;
  walkButton.textContent = "Walk";
});
const walker = createWalker(chain.spawn);
const input = createInput({ canvas, stick, knob, mobile });

const footsteps = createFootsteps(import.meta.env.DEV ? labSettings() : {});
let stepCount = 0;
let shownId: string | null = null;
let looping = false;
let last = performance.now();
const look = new THREE.Vector3();

new ResizeObserver(() => world.resize()).observe(canvas);

walkButton.addEventListener("click", () => {
  footsteps.start();
  input.setEnabled(true);
  gate.hidden = true;
  if (!mobile) void canvas.requestPointerLock();
});

// iOS interrupts audio on lock or app switch and only lets a gesture resume it.
window.addEventListener("pointerdown", () => {
  if (gate.hidden) footsteps.start();
});

window.addEventListener("hashchange", () => {
  location.reload();
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    looping = false;
    footsteps.suspend();
    return;
  }
  if (gate.hidden) footsteps.start();
  startLoop();
});

startLoop();

function startLoop(): void {
  if (looping || document.hidden) return;
  looping = true;
  last = performance.now();
  requestAnimationFrame(frame);
}

function frame(now: number): void {
  if (document.hidden) {
    looping = false;
    return;
  }
  let dt = (now - last) / 1000;
  last = now;
  if (!Number.isFinite(dt) || dt < 0) dt = 0;
  if (dt > 0.05) dt = 0.05;

  stepWalker(walker, input.read(), chain.solid, dt, reducedMotion.matches);
  chain.update(walker.x, walker.z);
  world.camera.position.set(walker.x, EYE_HEIGHT + walker.bob, walker.z);
  world.camera.rotation.y = walker.yaw;
  world.camera.rotation.x = walker.pitch;
  world.camera.rotation.z = 0;
  updatePlaque();
  footstep();
  world.renderer.render(world.scene, world.camera);
  requestAnimationFrame(frame);
}

function updatePlaque(): void {
  world.camera.getWorldDirection(look);
  let best: Work | null = null;
  let bestDot = 0.9;
  for (const frameSlot of chain.frames()) {
    const work = frameSlot.work;
    if (!work) continue;
    const point = frameSlot.center;
    const dx = point.x - world.camera.position.x;
    const dy = point.y - world.camera.position.y;
    const dz = point.z - world.camera.position.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > frameSlot.reach || dist < 0.001) continue;
    const nx = Math.sin(frameSlot.facing);
    const nz = Math.cos(frameSlot.facing);
    const inFront =
      (world.camera.position.x - point.x) * nx + (world.camera.position.z - point.z) * nz > 0.05;
    if (!inFront) continue;
    const dot = (dx / dist) * look.x + (dy / dist) * look.y + (dz / dist) * look.z;
    if (dot > bestDot) {
      bestDot = dot;
      best = work;
    }
  }
  const id = best?.id ?? null;
  if (id === shownId) return;
  shownId = id;
  plaque.set(best);
}

/** One step per bob cycle, landing where the bob is lowest. */
function footstep(): void {
  const count = Math.floor(walker.travel / BOB_CYCLE + 0.25);
  if (count === stepCount) return;
  stepCount = count;
  const speed = Math.min(1, walker.pace / TOP_SPEED);
  footsteps.step(measureSpace(walker.x, walker.z, chain.solid), walker.yaw, speed);
}

/** In development, steps use whatever was last set in the local sound lab at /lab/. */
function labSettings(): Partial<SoundSettings> {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem("museum:sound") ?? "null");
    return saved && typeof saved === "object" ? (saved as Partial<SoundSettings>) : {};
  } catch {
    return {};
  }
}

function currentSeed(): string {
  const raw = decodeURIComponent(location.hash.replace(/^#\/?/, "")).trim();
  if (SEED_PATTERN.test(raw)) return raw;
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  const generated = (bytes[0] || 1).toString(36);
  const next = new URL(location.href);
  next.hash = `/${generated}`;
  history.replaceState(null, "", `${next.pathname}${next.search}${next.hash}`);
  return generated;
}
