import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { frameSize, type HangSpot } from "./hang";
import { CELL, WALL_H, type Maze } from "./maze";
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
  work: Work | null;
  setAspect: (aspect: number) => void;
};

export type World = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  frames: FrameSlot[];
  resize: () => void;
};

export function createWorld(
  canvas: HTMLCanvasElement,
  maze: Maze,
  spots: HangSpot[],
  mobile: boolean,
): World {
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

  const wallMaterial = new THREE.MeshStandardMaterial({
    color: WALL,
    roughness: 0.92,
    metalness: 0,
  });
  const floorMaterial = new THREE.MeshStandardMaterial({
    color: FLOOR,
    roughness: 0.85,
    metalness: 0,
  });
  const ceilingMaterial = new THREE.MeshStandardMaterial({
    color: CEILING,
    roughness: 0.95,
    metalness: 0,
    side: THREE.BackSide,
  });

  const wallBox = new THREE.BoxGeometry(CELL, WALL_H, CELL);
  wallBox.translate(0, WALL_H / 2, 0);
  const floorPlane = new THREE.PlaneGeometry(CELL, CELL);
  floorPlane.rotateX(-Math.PI / 2);
  const ceilingPlane = new THREE.PlaneGeometry(CELL, CELL);
  ceilingPlane.rotateX(-Math.PI / 2);
  ceilingPlane.translate(0, WALL_H, 0);

  const walls: THREE.BufferGeometry[] = [];
  const floors: THREE.BufferGeometry[] = [];
  const ceilings: THREE.BufferGeometry[] = [];
  for (let y = 0; y < maze.size; y++) {
    for (let x = 0; x < maze.size; x++) {
      const px = (x + 0.5) * CELL;
      const pz = (y + 0.5) * CELL;
      if (maze.floor[y * maze.size + x] === 1) {
        const floorPiece = floorPlane.clone();
        floorPiece.translate(px, 0, pz);
        floors.push(floorPiece);
        const ceilingPiece = ceilingPlane.clone();
        ceilingPiece.translate(px, 0, pz);
        ceilings.push(ceilingPiece);
      } else {
        const wallPiece = wallBox.clone();
        wallPiece.translate(px, 0, pz);
        walls.push(wallPiece);
      }
    }
  }

  addMerged(scene, walls, wallMaterial);
  addMerged(scene, floors, floorMaterial);
  addMerged(scene, ceilings, ceilingMaterial);
  wallBox.dispose();
  floorPlane.dispose();
  ceilingPlane.dispose();

  const frameMaterial = new THREE.MeshStandardMaterial({
    color: FRAME,
    roughness: 0.58,
    metalness: 0,
  });
  const frames = spots.map((spot) => makeFrame(scene, frameMaterial, spot));

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

  return { renderer, scene, camera, frames, resize };
}

function addMerged(
  scene: THREE.Scene,
  pieces: THREE.BufferGeometry[],
  material: THREE.Material,
): void {
  if (pieces.length === 0) return;
  const merged = mergeGeometries(pieces, false);
  for (const piece of pieces) piece.dispose();
  if (!merged) return;
  scene.add(new THREE.Mesh(merged, material));
}

function makeFrame(scene: THREE.Scene, frameMaterial: THREE.Material, spot: HangSpot): FrameSlot {
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
    work: null,
    setAspect(aspect: number) {
      buildFrame(group, material, frameMaterial, aspect);
    },
  };
  slot.setAspect(0.8);
  scene.add(group);
  return slot;
}

function buildFrame(
  group: THREE.Group,
  pictureMaterial: THREE.Material,
  frameMaterial: THREE.Material,
  aspect: number,
): void {
  for (const child of group.children) {
    const mesh = child as THREE.Mesh;
    mesh.geometry.dispose();
  }
  group.clear();
  const { w, h } = frameSize(aspect);
  const picture = new THREE.Mesh(new THREE.PlaneGeometry(w, h), pictureMaterial);
  picture.name = "picture";
  picture.position.z = 0.02;
  const bar = 0.042;
  const depth = 0.028;
  const parts: { geometry: THREE.BufferGeometry; x: number; y: number }[] = [
    { geometry: new THREE.BoxGeometry(w + bar * 2, bar, depth), x: 0, y: h / 2 + bar / 2 },
    { geometry: new THREE.BoxGeometry(w + bar * 2, bar, depth), x: 0, y: -(h / 2 + bar / 2) },
    { geometry: new THREE.BoxGeometry(bar, h, depth), x: -(w / 2 + bar / 2), y: 0 },
    { geometry: new THREE.BoxGeometry(bar, h, depth), x: w / 2 + bar / 2, y: 0 },
  ];
  group.add(picture);
  for (const part of parts) {
    const mesh = new THREE.Mesh(part.geometry, frameMaterial);
    mesh.position.set(part.x, part.y, 0.01);
    group.add(mesh);
  }
}
