// input.js — raw keyboard and mouse state.
// One job: listen to the browser and keep a plain snapshot the player
// controller reads each tick. No game logic lives here.

export function createInput(canvas) {
  const input = {
    keys: new Set(),
    mouseDX: 0, mouseDY: 0,
    firing: false, aiming: false,
    locked: false,
    pressed: new Set(), // keys that went down since the last consumePress()
  };

  window.addEventListener('keydown', (e) => {
    if (!e.repeat) input.pressed.add(e.code);
    input.keys.add(e.code);
    if (['Space', 'Tab'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => input.keys.delete(e.code));
  window.addEventListener('blur', () => { input.keys.clear(); input.firing = false; });

  canvas.addEventListener('mousedown', (e) => {
    if (!input.locked) return;
    if (e.button === 0) input.firing = true;
    if (e.button === 2) input.aiming = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) input.firing = false;
    if (e.button === 2) input.aiming = false;
  });
  window.addEventListener('mousemove', (e) => {
    if (!input.locked) return;
    input.mouseDX += e.movementX || 0;
    input.mouseDY += e.movementY || 0;
  });
  document.addEventListener('pointerlockchange', () => {
    input.locked = document.pointerLockElement === canvas;
    if (!input.locked) input.firing = false;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  input.lockPointer = () => { canvas.requestPointerLock(); };
  input.unlockPointer = () => { if (input.locked) document.exitPointerLock(); };
  // Read and clear the mouse delta for this tick.
  input.consumeMouse = () => {
    const d = { dx: input.mouseDX, dy: input.mouseDY };
    input.mouseDX = 0; input.mouseDY = 0;
    return d;
  };
  input.consumePress = (code) => {
    const had = input.pressed.has(code);
    input.pressed.delete(code);
    return had;
  };
  input.clearPresses = () => input.pressed.clear();
  return input;
}
