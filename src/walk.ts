import { CELL } from "./maze";

export const EYE_HEIGHT = 1.6;
export const BODY_RADIUS = 0.32;
export const TOP_SPEED = 1.3;
export const ACCEL = 3.5;
export const BRAKE = 6;
export const BOB_AMPLITUDE = 0.015;
export const BOB_CYCLE = 0.65;

const LOOK_SENS = 0.0022;
const KEY_YAW = 1.5;
const KEY_PITCH = 1.15;
const PITCH_LIMIT = 1.15;

export type Walker = {
  x: number;
  z: number;
  vx: number;
  vz: number;
  yaw: number;
  pitch: number;
  travel: number;
  bob: number;
};

export type WalkInput = {
  moveX: number;
  moveZ: number;
  lookDx: number;
  lookDy: number;
  turnX: number;
  turnY: number;
};

export function createWalker(spawn: { x: number; z: number; yaw: number }): Walker {
  return {
    x: spawn.x,
    z: spawn.z,
    vx: 0,
    vz: 0,
    yaw: spawn.yaw,
    pitch: 0,
    travel: 0,
    bob: 0,
  };
}

export function blocked(x: number, z: number, floor: Uint8Array, size: number): boolean {
  const radius = BODY_RADIUS;
  const minGX = Math.floor((x - radius) / CELL);
  const maxGX = Math.floor((x + radius - 1e-6) / CELL);
  const minGZ = Math.floor((z - radius) / CELL);
  const maxGZ = Math.floor((z + radius - 1e-6) / CELL);
  const limit = radius * radius - 1e-8;
  for (let gz = minGZ; gz <= maxGZ; gz++) {
    for (let gx = minGX; gx <= maxGX; gx++) {
      const solid =
        gx < 0 || gz < 0 || gx >= size || gz >= size || floor[gz * size + gx] !== 1;
      if (!solid) continue;
      const nearestX = clamp(x, gx * CELL, (gx + 1) * CELL);
      const nearestZ = clamp(z, gz * CELL, (gz + 1) * CELL);
      const dx = x - nearestX;
      const dz = z - nearestZ;
      if (dx * dx + dz * dz < limit) return true;
    }
  }
  return false;
}

export function stepWalker(
  walker: Walker,
  input: WalkInput,
  floor: Uint8Array,
  size: number,
  dt: number,
  reducedMotion: boolean,
): void {
  if (dt <= 0) return;

  walker.yaw -= input.lookDx * LOOK_SENS;
  walker.yaw -= input.turnX * KEY_YAW * dt;
  walker.pitch += input.lookDy * LOOK_SENS;
  walker.pitch += input.turnY * KEY_PITCH * dt;
  if (walker.pitch > PITCH_LIMIT) walker.pitch = PITCH_LIMIT;
  if (walker.pitch < -PITCH_LIMIT) walker.pitch = -PITCH_LIMIT;

  let ix = input.moveX;
  let iz = input.moveZ;
  let magnitude = Math.hypot(ix, iz);
  if (magnitude > 1) {
    ix /= magnitude;
    iz /= magnitude;
    magnitude = 1;
  }

  if (magnitude > 0.02) {
    const sin = Math.sin(walker.yaw);
    const cos = Math.cos(walker.yaw);
    const forwardX = -sin;
    const forwardZ = -cos;
    const rightX = cos;
    const rightZ = -sin;
    const scale = TOP_SPEED * magnitude;
    const wishX = (forwardX * iz + rightX * ix) * scale;
    const wishZ = (forwardZ * iz + rightZ * ix) * scale;
    approach(walker, wishX, wishZ, ACCEL * dt);
  } else {
    const speed = Math.hypot(walker.vx, walker.vz);
    const drop = BRAKE * dt;
    if (speed <= drop) {
      walker.vx = 0;
      walker.vz = 0;
    } else {
      const keep = (speed - drop) / speed;
      walker.vx *= keep;
      walker.vz *= keep;
    }
  }

  const speed = Math.hypot(walker.vx, walker.vz);
  if (speed > TOP_SPEED) {
    const scale = TOP_SPEED / speed;
    walker.vx *= scale;
    walker.vz *= scale;
  }

  const beforeX = walker.x;
  const beforeZ = walker.z;
  const nextX = walker.x + walker.vx * dt;
  if (!blocked(nextX, walker.z, floor, size)) walker.x = nextX;
  const nextZ = walker.z + walker.vz * dt;
  if (!blocked(walker.x, nextZ, floor, size)) walker.z = nextZ;

  const moved = Math.hypot(walker.x - beforeX, walker.z - beforeZ);
  if (moved > 0) walker.travel += moved;

  const moving = Math.hypot(walker.vx, walker.vz) > 0.05 && moved > 0;
  if (reducedMotion || !moving) {
    walker.bob += (0 - walker.bob) * Math.min(1, dt * 10);
  } else {
    walker.bob = Math.sin((walker.travel / BOB_CYCLE) * Math.PI * 2) * BOB_AMPLITUDE;
  }
}

function approach(walker: Walker, wishX: number, wishZ: number, maxDelta: number): void {
  const dx = wishX - walker.vx;
  const dz = wishZ - walker.vz;
  const distance = Math.hypot(dx, dz);
  if (distance <= maxDelta || distance === 0) {
    walker.vx = wishX;
    walker.vz = wishZ;
    return;
  }
  const scale = maxDelta / distance;
  walker.vx += dx * scale;
  walker.vz += dz * scale;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
