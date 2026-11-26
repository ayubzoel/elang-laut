// Keyboard and mouse input for Elang Laut.
// Keyboard flies the plane (arrows + W/S + A/D); the mouse drags the chase
// camera a little and the wheel trims the throttle. One-shot keys are consumed
// so a single press never fires twice.

export function createInput(canvas) {
  const keys = new Set();
  const pressed = new Set();
  const drag = { active: false, x: 0, y: 0, dx: 0, dy: 0 };
  let wheelDelta = 0;

  function onKeyDown(e) {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
      e.preventDefault();
    }
    if (!keys.has(e.code)) pressed.add(e.code);
    keys.add(e.code);
  }
  function onKeyUp(e) {
    keys.delete(e.code);
  }
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', () => keys.clear());

  canvas.addEventListener('pointerdown', (e) => {
    drag.active = true;
    drag.x = e.clientX;
    drag.y = e.clientY;
  });
  window.addEventListener('pointermove', (e) => {
    if (!drag.active) return;
    drag.dx += e.clientX - drag.x;
    drag.dy += e.clientY - drag.y;
    drag.x = e.clientX;
    drag.y = e.clientY;
  });
  window.addEventListener('pointerup', () => {
    drag.active = false;
  });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    wheelDelta += e.deltaY;
  }, { passive: false });

  return {
    // Analog axes for this frame: pitch up positive, roll right positive.
    axes() {
      const pitch = (keys.has('ArrowDown') ? 1 : 0) - (keys.has('ArrowUp') ? 1 : 0);
      const roll = (keys.has('ArrowRight') ? 1 : 0) - (keys.has('ArrowLeft') ? 1 : 0);
      const yaw = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
      return {
        pitch,
        roll,
        yaw,
        throttleUp: keys.has('KeyW'),
        throttleDown: keys.has('KeyS'),
        brake: keys.has('Space'),
      };
    },
    consumeWheel() {
      const d = wheelDelta;
      wheelDelta = 0;
      return d;
    },
    consumeDrag() {
      const d = { dx: drag.dx, dy: drag.dy };
      drag.dx = 0;
      drag.dy = 0;
      // Drag offsets decay back to centre so the camera settles behind the plane.
      return d;
    },
    wasPressed(code) {
      if (pressed.has(code)) {
        pressed.delete(code);
        return true;
      }
      return false;
    },
    isDown(code) {
      return keys.has(code);
    },
    dispose() {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    },
  };
}
