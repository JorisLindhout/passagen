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
  let stickId = -1;
  let looking = false;
  let lookPointer = -1;
  let lastX = 0;
  let lastY = 0;
  let originX = 0;
  let originY = 0;

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
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      keys.clear();
      resetStick();
    }
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

  const resetStick = () => {
    stickId = -1;
    stickX = 0;
    stickZ = 0;
    knob.style.transform = "translate(0px, 0px)";
    stick.hidden = true;
  };

  const dragStick = (event: PointerEvent) => {
    const dx = event.clientX - originX;
    const dy = event.clientY - originY;
    const max = stick.offsetWidth * 0.36;
    const dist = Math.hypot(dx, dy) || 1;
    const clamped = Math.min(dist, max);
    const nx = dx / dist;
    const ny = dy / dist;
    knob.style.transform = `translate(${nx * clamped}px, ${ny * clamped}px)`;
    const strength = clamped / max;
    stickX = deadzone(nx * strength);
    stickZ = deadzone(-ny * strength);
  };

  // The first finger down anywhere becomes the walking stick, centred where it
  // lands so either thumb can use it. A second finger drags to look around.
  canvas.addEventListener("pointerdown", (event) => {
    if (!enabled || !mobile) return;
    if (stickId === -1) {
      stickId = event.pointerId;
      originX = event.clientX;
      originY = event.clientY;
      stick.style.left = `${originX}px`;
      stick.style.top = `${originY}px`;
      stick.hidden = false;
      dragStick(event);
    } else if (!looking) {
      looking = true;
      lookPointer = event.pointerId;
      lastX = event.clientX;
      lastY = event.clientY;
    } else {
      return;
    }
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // The pointer id still tracks the drag until pointerup.
    }
  });
  canvas.addEventListener("pointermove", (event) => {
    if (event.pointerId === stickId) {
      event.preventDefault();
      dragStick(event);
      return;
    }
    if (!looking || event.pointerId !== lookPointer) return;
    event.preventDefault();
    lookDx += event.clientX - lastX;
    lookDy += event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
  });
  const endPointer = (event: PointerEvent) => {
    if (event.pointerId === stickId) resetStick();
    if (event.pointerId === lookPointer) {
      looking = false;
      lookPointer = -1;
    }
  };
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);
  window.addEventListener("pointerup", endPointer);
  window.addEventListener("pointercancel", endPointer);

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
        turnX = (keys.has("ArrowRight") ? 1 : 0) - (keys.has("ArrowLeft") ? 1 : 0);
        turnY = (keys.has("ArrowDown") ? 1 : 0) - (keys.has("ArrowUp") ? 1 : 0);
        if (mobile && stickId !== -1) {
          if (moveX === 0 && moveZ === 0) moveZ = stickZ;
          if (turnX === 0) turnX = stickX;
        }
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

/** Ignores small drift on one axis so walking straight does not also turn. */
function deadzone(value: number): number {
  const dead = 0.2;
  const size = Math.abs(value);
  if (size < dead) return 0;
  return (Math.sign(value) * (size - dead)) / (1 - dead);
}
