import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { frameSize, type HangSpot } from "./hang";
import { CELL, openingCell, WALL_H, type ChunkPlan, type Opening } from "./maze";
import type { Work } from "./fallback";

const HANG_Y = 1.55;
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

const materials = {
  wall: new THREE.MeshStandardMaterial({ color: WALL, roughness: 0.92, metalness: 0 }),
  floor: new THREE.MeshStandardMaterial({ color: FLOOR, roughness: 0.85, metalness: 0 }),
  ceiling: new THREE.MeshStandardMaterial({
    color: CEILING,
    roughness: 0.95,
    metalness: 0,
    side: THREE.BackSide,
  }),
  frame: new THREE.MeshStandardMaterial({ color: FRAME, roughness: 0.58, metalness: 0 }),
};

const wallBox = new THREE.BoxGeometry(CELL, WALL_H, CELL).translate(0, WALL_H / 2, 0);
const floorPlane = new THREE.PlaneGeometry(CELL, CELL).rotateX(-Math.PI / 2);
const ceilingPlane = new THREE.PlaneGeometry(CELL, CELL).rotateX(-Math.PI / 2).translate(0, WALL_H, 0);

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

  scene.add(new THREE.HemisphereLight(0xf4f7fb, 0xe7e1d6, 1.55));
  scene.add(new THREE.AmbientLight(0xffffff, 1.55));

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

  const walls: THREE.BufferGeometry[] = [];
  const floors: THREE.BufferGeometry[] = [];
  const ceilings: THREE.BufferGeometry[] = [];
  for (let y = 0; y < plan.size; y++) {
    for (let x = 0; x < plan.size; x++) {
      const px = (x + 0.5) * CELL;
      const pz = (y + 0.5) * CELL;
      if (plan.floor[y * plan.size + x] === 1) {
        floors.push(floorPlane.clone().translate(px, 0, pz));
        ceilings.push(ceilingPlane.clone().translate(px, 0, pz));
      } else {
        walls.push(wallBox.clone().translate(px, 0, pz));
      }
    }
  }
  const owned: THREE.BufferGeometry[] = [];
  for (const [pieces, material] of [
    [walls, materials.wall],
    [floors, materials.floor],
    [ceilings, materials.ceiling],
  ] as const) {
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
      for (const frame of frames) {
        for (const child of frame.group.children) (child as THREE.Mesh).geometry.dispose();
        frame.material.map?.dispose();
        frame.material.dispose();
      }
    },
  };
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
    work: null,
    setAspect(aspect: number) {
      buildFrame(group, material, aspect);
    },
  };
  slot.setAspect(0.8);
  parent.add(group);
  return slot;
}

function buildFrame(group: THREE.Group, pictureMaterial: THREE.Material, aspect: number): void {
  for (const child of group.children) (child as THREE.Mesh).geometry.dispose();
  group.clear();
  const { w, h } = frameSize(aspect);
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
}
