import * as THREE from "three";
import { FALLBACK_WORKS, sanitizeWorks, type Work } from "./fallback";
import { hangSpots } from "./hang";
import { createInput } from "./input";
import { generateMaze } from "./maze";
import { setPlaque } from "./overlay";
import { createWalker, EYE_HEIGHT, stepWalker } from "./walk";
import { createWorld, type FrameSlot } from "./world";

const SEED_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const mobile = window.matchMedia("(pointer: coarse)").matches;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const canvas = document.querySelector("#view");
const gate = document.querySelector("#gate");
const walkButton = document.querySelector("#walk");
const stick = document.querySelector("#stick");
const knob = document.querySelector("#knob");
if (
  !(canvas instanceof HTMLCanvasElement) ||
  !(gate instanceof HTMLElement) ||
  !(walkButton instanceof HTMLButtonElement) ||
  !(stick instanceof HTMLElement) ||
  !(knob instanceof HTMLElement)
) {
  throw new Error("missing view");
}

const seed = currentSeed();
const maze = generateMaze(seed);
const spots = hangSpots(maze, seed);
const world = createWorld(canvas, maze, spots, mobile);
const walker = createWalker(maze.spawn);
const input = createInput({ canvas, stick, knob, mobile });

let audio: AudioContext | null = null;
let noise: AudioBuffer | null = null;
let stepMark = 0;
let shownId: string | null = null;
let looping = false;
let last = performance.now();
const look = new THREE.Vector3();

new ResizeObserver(() => world.resize()).observe(canvas);

void loadWorks(seed, world.frames);

walkButton.addEventListener("click", () => {
  startAudio();
  input.setEnabled(true);
  gate.hidden = true;
  if (mobile) stick.hidden = false;
  if (!mobile) void canvas.requestPointerLock();
});

window.addEventListener("hashchange", () => {
  location.reload();
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    looping = false;
    return;
  }
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

  const travelBefore = walker.travel;
  stepWalker(walker, input.read(), maze.floor, maze.size, dt, reducedMotion.matches);
  world.camera.position.set(walker.x, EYE_HEIGHT + walker.bob, walker.z);
  world.camera.rotation.y = walker.yaw;
  world.camera.rotation.x = walker.pitch;
  world.camera.rotation.z = 0;
  updatePlaque();
  if (walker.travel - travelBefore > 0) footstep(walker.travel);
  world.renderer.render(world.scene, world.camera);
  requestAnimationFrame(frame);
}

function updatePlaque(): void {
  world.camera.getWorldDirection(look);
  let best: Work | null = null;
  let bestDot = 0.9;
  for (const frameSlot of world.frames) {
    const work = frameSlot.work;
    if (!work) continue;
    const point = frameSlot.group.position;
    const dx = point.x - world.camera.position.x;
    const dy = point.y - world.camera.position.y;
    const dz = point.z - world.camera.position.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > 2.2 || dist < 0.001) continue;
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
  setPlaque(best);
}

async function loadWorks(nextSeed: string, frames: FrameSlot[]): Promise<void> {
  let chosen: Work[] = [];
  try {
    const response = await fetch(`/api/works?seed=${encodeURIComponent(nextSeed)}`);
    if (!response.ok) throw new Error(String(response.status));
    chosen = sanitizeWorks(await response.json());
  } catch {
    chosen = [];
  }
  if (chosen.length === 0) chosen = FALLBACK_WORKS.slice();
  else if (chosen.length < frames.length) {
    for (const fallback of FALLBACK_WORKS) {
      if (chosen.length >= frames.length) break;
      if (chosen.some((work) => work.id === fallback.id)) continue;
      chosen.push(fallback);
    }
  }

  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin("anonymous");
  const anisotropy = Math.min(8, world.renderer.capabilities.getMaxAnisotropy());
  const apply = (frameSlot: FrameSlot, texture: THREE.Texture) => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = anisotropy;
    frameSlot.material.map = texture;
    frameSlot.material.color.set(0xffffff);
    frameSlot.material.needsUpdate = true;
  };
  frames.forEach((frameSlot, index) => {
    const work = chosen[index];
    if (!work) return;
    frameSlot.work = work;
    frameSlot.setAspect(work.aspect);
    loader.load(
      work.image,
      (texture) => apply(frameSlot, texture),
      undefined,
      () => {
        const fallback = FALLBACK_WORKS[index % FALLBACK_WORKS.length];
        if (!fallback || fallback.id === work.id) return;
        frameSlot.work = fallback;
        frameSlot.setAspect(fallback.aspect);
        loader.load(fallback.image, (texture) => apply(frameSlot, texture));
      },
    );
  });
}

function startAudio(): void {
  if (audio) {
    void audio.resume();
    return;
  }
  audio = new AudioContext();
  const length = Math.floor(audio.sampleRate * 0.045);
  noise = audio.createBuffer(1, length, audio.sampleRate);
  const data = noise.getChannelData(0);
  for (let i = 0; i < length; i++) {
    const envelope = 1 - i / length;
    data[i] = (Math.random() * 2 - 1) * envelope * envelope;
  }
  void audio.resume();
}

function footstep(travel: number): void {
  if (!audio || !noise || travel - stepMark < 0.325) return;
  stepMark = travel;
  const source = audio.createBufferSource();
  source.buffer = noise;
  const filter = audio.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 260;
  const gain = audio.createGain();
  gain.gain.value = 0.03;
  source.connect(filter);
  filter.connect(gain);
  gain.connect(audio.destination);
  source.start();
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
