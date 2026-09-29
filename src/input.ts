export type InputFrame = {
  moveX: number;
  moveZ: number;
  lookDx: number;
  lookDy: number;
  turnX: number;
  turnY: number;
};

const MOVE_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD"]);
const TURN_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

export function createInput(options: {
  canvas: HTMLCanvasElement;
  stick: HTMLElement;
  knob: HTMLElement;
  mobile: boolean;
}): { read: () => InputFrame; setEnabled: (enabled: boolean) => void } {
  const { canvas, stick, knob, mobile } = options;
  const keys = new Set<string>();
  let enabled = false;
  let lookDx = 0;
  let lookDy = 0;
  let stickX = 0;
  let stickZ = 0;
  let looking = false;
  let lookPointer = -1;
  let lastX = 0;
  let lastY = 0;

  window.addEventListener("keydown", (event) => {
    if (MOVE_KEYS.has(event.code) || TURN_KEYS.has(event.code)) event.preventDefault();
    if (!enabled || event.repeat) return;
    keys.add(event.code);
  });
  window.addEventListener("keyup", (event) => {
    keys.delete(event.code);
  });
  window.addEventListener("blur", () => {
    keys.clear();
    resetStick();
  });

  document.addEventListener("mousemove", (event) => {
    if (!enabled || document.pointerLockElement !== canvas) return;
    lookDx += event.movementX;
    lookDy += event.movementY;
  });

  canvas.addEventListener("click", () => {
    if (!enabled || mobile || document.pointerLockElement === canvas) return;
    void canvas.requestPointerLock();
  });

  canvas.addEventListener("pointerdown", (event) => {
    if (!enabled || !mobile || event.clientX < window.innerWidth * 0.5) return;
    looking = true;
    lookPointer = event.pointerId;
    lastX = event.clientX;
    lastY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!looking || event.pointerId !== lookPointer) return;
    event.preventDefault();
    lookDx += event.clientX - lastX;
    lookDy += event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
  });
  const endLook = (event: PointerEvent) => {
    if (event.pointerId !== lookPointer) return;
    looking = false;
    lookPointer = -1;
  };
  canvas.addEventListener("pointerup", endLook);
  canvas.addEventListener("pointercancel", endLook);

  const resetStick = () => {
    stickX = 0;
    stickZ = 0;
    knob.style.transform = "translate(0px, 0px)";
  };

  const dragStick = (event: PointerEvent) => {
    const rect = stick.getBoundingClientRect();
    const dx = event.clientX - (rect.left + rect.width / 2);
    const dy = event.clientY - (rect.top + rect.height / 2);
    const max = rect.width * 0.32;
    const dist = Math.hypot(dx, dy) || 1;
    const clamped = Math.min(dist, max);
    const nx = dx / dist;
    const ny = dy / dist;
    knob.style.transform = `translate(${nx * clamped}px, ${ny * clamped}px)`;
    const strength = clamped / max;
    if (strength < 0.12) {
      stickX = 0;
      stickZ = 0;
      return;
    }
    stickX = nx * strength;
    stickZ = -ny * strength;
  };

  stick.addEventListener("pointerdown", (event) => {
    if (!enabled) return;
    event.preventDefault();
    event.stopPropagation();
    stick.setPointerCapture(event.pointerId);
    dragStick(event);
  });
  stick.addEventListener("pointermove", (event) => {
    if (!stick.hasPointerCapture(event.pointerId)) return;
    event.preventDefault();
    dragStick(event);
  });
  const endStick = (event: PointerEvent) => {
    if (!stick.hasPointerCapture(event.pointerId)) return;
    resetStick();
  };
  stick.addEventListener("pointerup", endStick);
  stick.addEventListener("pointercancel", endStick);

  return {
    setEnabled(next: boolean) {
      enabled = next;
      if (!next) {
        keys.clear();
        resetStick();
      }
    },
    read() {
      let moveX = 0;
      let moveZ = 0;
      let turnX = 0;
      let turnY = 0;
      if (enabled) {
        moveZ = (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0);
        moveX = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);
        if (Math.hypot(stickX, stickZ) > 0.05) {
          moveX = stickX;
          moveZ = stickZ;
        }
        turnX = (keys.has("ArrowRight") ? 1 : 0) - (keys.has("ArrowLeft") ? 1 : 0);
        turnY = (keys.has("ArrowDown") ? 1 : 0) - (keys.has("ArrowUp") ? 1 : 0);
      } else {
        lookDx = 0;
        lookDy = 0;
      }
      const frame = { moveX, moveZ, lookDx, lookDy, turnX, turnY };
      lookDx = 0;
      lookDy = 0;
      return frame;
    },
  };
}
