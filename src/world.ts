import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { frameSize, type HangSpot } from "./hang";
import {
  CELL,
  hallDoorways,
  inHall,
  openingCell,
  SIDE_DX,
  SIDE_DY,
  WALL_H,
  type ChunkPlan,
  type Hall,
  type Opening,
} from "./maze";
import type { Work } from "./fallback";

const HANG_Y = 1.55;
const MIN_FRAME_BOTTOM = 0.7;
/** How near a frame the plaque appears, for a frame of ordinary size. */
const PLAQUE_REACH = 2.2;
const WALL = 0xf3f0ea;
const FLOOR = 0xd7d1c5;
const CEILING = 0xf7f8fa;
const FRAME = 0xe4dfd6;

export type FrameSlot = {
  group: THREE.Group;
  material: THREE.MeshStandardMaterial;
  facing: number;
  /** World position of the picture's center. */
  center: THREE.Vector3;
  /** Meters within which the plaque appears. */
  reach: number;
  work: Work | null;
  setAspect: (aspect: number) => void;
};

export type Stage = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  resize: () => void;
};

export type ChunkView = {
  group: THREE.Group;
  frames: FrameSlot[];
  setPlugs: (entryOpen: boolean, exitOpen: boolean) => void;
  dispose: () => void;
};

const PANEL = 0xfffdf8;
const PANEL_SIZE = 1.25;
/** Contact shadow where floor or ceiling meets a wall: depth at the wall, and reach in meters. */
const AO_DEPTH = 0.34;
const AO_REACH = 0.32;
const AO_PX_PER_CELL = 16;

const materials = {
  wall: new THREE.MeshStandardMaterial({
    color: WALL,
    roughness: 0.92,
    metalness: 0,
    aoMap: wallShade(WALL_H),
  }),
  floor: new THREE.MeshStandardMaterial({ color: FLOOR, roughness: 0.85, metalness: 0 }),
  ceiling: new THREE.MeshStandardMaterial({
    color: CEILING,
    roughness: 0.95,
    metalness: 0,
    side: THREE.BackSide,
    aoMapIntensity: 0.6,
  }),
  frame: new THREE.MeshStandardMaterial({ color: FRAME, roughness: 0.58, metalness: 0 }),
  panel: new THREE.MeshBasicMaterial({ color: PANEL }),
  frameShadow: new THREE.MeshBasicMaterial({
    color: 0x2c2620,
    map: frameShadow(),
    transparent: true,
    opacity: 0.2,
    depthWrite: false,
  }),
};

const wallBox = new THREE.BoxGeometry(CELL, WALL_H, CELL).translate(0, WALL_H / 2, 0);
const floorPlane = new THREE.PlaneGeometry(CELL, CELL).rotateX(-Math.PI / 2);
const ceilingPlane = new THREE.PlaneGeometry(CELL, CELL).rotateX(-Math.PI / 2).translate(0, WALL_H, 0);
const panelPlane = new THREE.PlaneGeometry(PANEL_SIZE, PANEL_SIZE)
  .rotateX(Math.PI / 2)
  .translate(0, WALL_H - 0.004, 0);

export function createStage(canvas: HTMLCanvasElement, mobile: boolean): Stage {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: !mobile,
    powerPreference: "high-performance",
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setClearColor(WALL, 1);
  renderer.shadowMap.enabled = false;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(WALL);
  scene.fog = new THREE.FogExp2(WALL, 0.011);

  const camera = new THREE.PerspectiveCamera(70, 1, 0.08, 80);
  camera.rotation.order = "YXZ";
  scene.add(camera);

  scene.add(new THREE.HemisphereLight(0xfffcf7, 0xc8c2b8, 2.7));
  scene.add(new THREE.AmbientLight(0xffffff, 0.95));

  const resize = () => {
    const width = canvas.clientWidth;
    const height = Math.max(1, canvas.clientHeight);
    const cap = mobile ? 1.5 : 2;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cap));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  resize();

  return { renderer, scene, camera, resize };
}

/** One maze: walls, floor, and ceiling each merged into a single mesh, in local meters. */
export function buildChunkView(stage: Stage, plan: ChunkPlan, spots: HangSpot[]): ChunkView {
  const group = new THREE.Group();
  group.position.set(plan.bx * plan.size * CELL, 0, plan.bz * plan.size * CELL);

  const span = plan.size * CELL;
  const hall = plan.hall;
  const raise = hall ? hall.height - WALL_H : 0;
  const walls: THREE.BufferGeometry[] = [];
  const tallWalls: THREE.BufferGeometry[] = [];
  const floors: THREE.BufferGeometry[] = [];
  const ceilings: THREE.BufferGeometry[] = [];
  const panels: THREE.BufferGeometry[] = [];
  for (let y = 0; y < plan.size; y++) {
    for (let x = 0; x < plan.size; x++) {
      const px = (x + 0.5) * CELL;
      const pz = (y + 0.5) * CELL;
      if (plan.floor[y * plan.size + x] === 1) {
        const lift = inHall(hall, x, y) ? raise : 0;
        floors.push(mazeUv(floorPlane.clone().translate(px, 0, pz), span));
        ceilings.push(mazeUv(ceilingPlane.clone().translate(px, lift, pz), span));
        panels.push(panelPlane.clone().translate(px, lift, pz));
      } else if (hall && besideHall(hall, x, y)) {
        tallWalls.push(new THREE.BoxGeometry(CELL, hall.height, CELL).translate(px, hall.height / 2, pz));
      } else {
        walls.push(wallBox.clone().translate(px, 0, pz));
      }
    }
  }
  if (hall) {
    for (const cell of hallDoorways(plan.floor, plan.size, hall)) tallWalls.push(doorHeader(hall, cell % plan.size, Math.floor(cell / plan.size)));
  }

  const shade = floorShade(plan);
  const floorMaterial = materials.floor.clone();
  floorMaterial.aoMap = shade;
  const ceilingMaterial = materials.ceiling.clone();
  ceilingMaterial.aoMap = shade;
  const tallShade = hall ? wallShade(hall.height) : null;
  const tallMaterial = tallShade ? materials.wall.clone() : null;
  if (tallMaterial) tallMaterial.aoMap = tallShade;

  const owned: THREE.BufferGeometry[] = [];
  for (const [pieces, material] of [
    [walls, materials.wall],
    [tallWalls, tallMaterial ?? materials.wall],
    [floors, floorMaterial],
    [ceilings, ceilingMaterial],
    [panels, materials.panel],
  ] as const) {
    if (pieces.length === 0) continue;
    const merged = mergeGeometries(pieces, false);
    for (const piece of pieces) piece.dispose();
    if (!merged) continue;
    owned.push(merged);
    group.add(new THREE.Mesh(merged, material));
  }

  const plug = (opening: Opening | null) => {
    if (!opening) return null;
    const cell = openingCell(opening, plan.size);
    const mesh = new THREE.Mesh(wallBox, materials.wall);
    mesh.position.set((cell.x + 0.5) * CELL, 0, (cell.y + 0.5) * CELL);
    group.add(mesh);
    return mesh;
  };
  const entryPlug = plug(plan.entry);
  const exitPlug = plug(plan.exit);

  const frames = spots.map((spot) => makeFrame(group, spot));
  stage.scene.add(group);

  return {
    group,
    frames,
    setPlugs(entryOpen, exitOpen) {
      if (entryPlug) entryPlug.visible = !entryOpen;
      if (exitPlug) exitPlug.visible = !exitOpen;
    },
    dispose() {
      stage.scene.remove(group);
      for (const geometry of owned) geometry.dispose();
      shade.dispose();
      floorMaterial.dispose();
      ceilingMaterial.dispose();
      tallShade?.dispose();
      tallMaterial?.dispose();
      for (const frame of frames) {
        for (const child of frame.group.children) (child as THREE.Mesh).geometry.dispose();
        frame.material.map?.dispose();
        frame.material.dispose();
      }
    },
  };
}

/** A wall cell touching the hall, corners included, rises to the hall's ceiling. */
function besideHall(hall: Hall, x: number, y: number): boolean {
  return x >= hall.x - 1 && y >= hall.y - 1 && x <= hall.x + hall.w && y <= hall.y + hall.h;
}

/** Closes the wall above a doorway, from the corridor ceiling up to the hall's, facing into the hall. */
function doorHeader(hall: Hall, x: number, y: number): THREE.BufferGeometry {
  const rise = hall.height - WALL_H;
  const geometry = new THREE.PlaneGeometry(CELL, rise);
  const uv = geometry.getAttribute("uv");
  const base = WALL_H / hall.height;
  for (let i = 0; i < uv.count; i++) uv.setY(i, base + uv.getY(i) * (1 - base));
  const mid = WALL_H + rise / 2;
  if (y < hall.y) return geometry.translate((x + 0.5) * CELL, mid, hall.y * CELL);
  if (y >= hall.y + hall.h) return geometry.rotateY(Math.PI).translate((x + 0.5) * CELL, mid, (hall.y + hall.h) * CELL);
  if (x < hall.x) return geometry.rotateY(Math.PI / 2).translate(hall.x * CELL, mid, (y + 0.5) * CELL);
  return geometry.rotateY(-Math.PI / 2).translate((hall.x + hall.w) * CELL, mid, (y + 0.5) * CELL);
}

function makeFrame(parent: THREE.Group, spot: HangSpot): FrameSlot {
  const group = new THREE.Group();
  group.position.set(spot.x, HANG_Y, spot.z);
  group.rotation.y = spot.facing;
  const material = new THREE.MeshStandardMaterial({
    color: 0xd4cdc2,
    roughness: 0.62,
    metalness: 0,
  });
  const slot: FrameSlot = {
    group,
    material,
    facing: spot.facing,
    center: new THREE.Vector3(spot.x, HANG_Y, spot.z).add(parent.position),
    reach: PLAQUE_REACH * spot.scale,
    work: null,
    setAspect(aspect: number) {
      const y = buildFrame(group, material, aspect, spot.scale);
      group.position.y = y;
      slot.center.y = y;
    },
  };
  slot.setAspect(0.8);
  parent.add(group);
  return slot;
}

/** Returns the height of the picture's center: eye level, or higher when a large frame would reach too low. */
function buildFrame(group: THREE.Group, pictureMaterial: THREE.Material, aspect: number, scale: number): number {
  for (const child of group.children) (child as THREE.Mesh).geometry.dispose();
  group.clear();
  const { w, h } = frameSize(aspect, scale);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.16, h + 0.22), materials.frameShadow);
  shadow.position.set(0, -0.07, -0.037);
  group.add(shadow);
  const picture = new THREE.Mesh(new THREE.PlaneGeometry(w, h), pictureMaterial);
  picture.position.z = 0.02;
  group.add(picture);
  const bar = 0.042;
  const depth = 0.028;
  const parts = [
    { geometry: new THREE.BoxGeometry(w + bar * 2, bar, depth), x: 0, y: h / 2 + bar / 2 },
    { geometry: new THREE.BoxGeometry(w + bar * 2, bar, depth), x: 0, y: -(h / 2 + bar / 2) },
    { geometry: new THREE.BoxGeometry(bar, h, depth), x: -(w / 2 + bar / 2), y: 0 },
    { geometry: new THREE.BoxGeometry(bar, h, depth), x: w / 2 + bar / 2, y: 0 },
  ];
  for (const part of parts) {
    const mesh = new THREE.Mesh(part.geometry, materials.frame);
    mesh.position.set(part.x, part.y, 0.01);
    group.add(mesh);
  }
  return Math.max(HANG_Y, h / 2 + MIN_FRAME_BOTTOM);
}

/** Floor and ceiling share one shade texture that spans the whole maze. */
function mazeUv(geometry: THREE.BufferGeometry, span: number): THREE.BufferGeometry {
  const position = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  for (let i = 0; i < position.count; i++) {
    uv.setXY(i, position.getX(i) / span, 1 - position.getZ(i) / span);
  }
  return geometry;
}

/**
 * Light from above leaves the edges of the floor and ceiling a little darker
 * where they meet a wall, and darker still in corners. Baked per maze.
 */
function floorShade(plan: ChunkPlan): THREE.CanvasTexture {
  const { size, floor } = plan;
  const n = size * AO_PX_PER_CELL;
  const canvas = document.createElement("canvas");
  canvas.width = n;
  canvas.height = n;
  const context = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  if (!context) return texture;
  const image = context.createImageData(n, n);
  const beyond = [plan.entry, plan.exit].flatMap((opening) => {
    if (!opening) return [];
    const cell = openingCell(opening, size);
    return [{ x: cell.x + (SIDE_DX[opening.side] ?? 0), y: cell.y + (SIDE_DY[opening.side] ?? 0) }];
  });
  const wall = (x: number, y: number) => {
    if (x >= 0 && y >= 0 && x < size && y < size) return floor[y * size + x] !== 1;
    return !beyond.some((cell) => cell.x === x && cell.y === y);
  };
  for (let py = 0; py < n; py++) {
    const mz = (py + 0.5) / AO_PX_PER_CELL;
    const cz = Math.floor(mz);
    for (let px = 0; px < n; px++) {
      const mx = (px + 0.5) / AO_PX_PER_CELL;
      const cx = Math.floor(mx);
      let light = 1;
      if (!wall(cx, cz)) {
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            if ((dx === 0 && dz === 0) || !wall(cx + dx, cz + dz)) continue;
            const gx = Math.max(cx + dx - mx, 0, mx - (cx + dx + 1));
            const gz = Math.max(cz + dz - mz, 0, mz - (cz + dz + 1));
            light *= 1 - AO_DEPTH * Math.exp(-(Math.hypot(gx, gz) * CELL) / AO_REACH);
          }
        }
      }
      const value = Math.round(light * 255);
      const offset = (py * n + px) * 4;
      image.data[offset] = value;
      image.data[offset + 1] = value;
      image.data[offset + 2] = value;
      image.data[offset + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  texture.needsUpdate = true;
  return texture;
}

/** Walls darken toward the floor and a touch under the ceiling. v runs 0 at the floor to 1 at the top. */
function wallShade(wallHeight: number): THREE.CanvasTexture {
  const rows = Math.round((128 * wallHeight) / WALL_H);
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = rows;
  const context = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  if (!context) return texture;
  const image = context.createImageData(1, rows);
  for (let row = 0; row < rows; row++) {
    const height = (1 - (row + 0.5) / rows) * wallHeight;
    const light = 1 - 0.34 * Math.exp(-height / 0.5) - 0.08 * Math.exp(-(wallHeight - height) / 0.22);
    const value = Math.round(light * 255);
    image.data[row * 4] = value;
    image.data[row * 4 + 1] = value;
    image.data[row * 4 + 2] = value;
    image.data[row * 4 + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  texture.needsUpdate = true;
  return texture;
}

/** A soft rectangle, used behind each frame so it reads as standing off the wall. */
function frameShadow(): THREE.CanvasTexture {
  const n = 64;
  const canvas = document.createElement("canvas");
  canvas.width = n;
  canvas.height = n;
  const context = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  if (!context) return texture;
  const image = context.createImageData(n, n);
  const soft = (t: number) => {
    const edge = Math.min(1, Math.max(0, (1 - Math.abs(t)) / 0.35));
    return edge * edge * (3 - 2 * edge);
  };
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const alpha = soft(((x + 0.5) / n) * 2 - 1) * soft(((y + 0.5) / n) * 2 - 1);
      const offset = (y * n + x) * 4;
      image.data[offset] = 255;
      image.data[offset + 1] = 255;
      image.data[offset + 2] = 255;
      image.data[offset + 3] = Math.round(alpha * 255);
    }
  }
  context.putImageData(image, 0, 0);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}
