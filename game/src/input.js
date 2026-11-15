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

  // --- touch controls: a virtual stick for movement, drag-to-look on the
  // canvas, and on-screen buttons (markup in index.html, #touch-ui) that
  // feed the same snapshot fields the keyboard and mouse fill, so the
  // player controller never knows the difference.
  input.touchMode = false;
  input.touchMove = { x: 0, y: 0 };
  window.addEventListener('touchstart', () => {
    if (!input.touchMode) { input.touchMode = true; document.body.classList.add('touch'); }
  }, { passive: true });

  const joyEl = document.getElementById('joy');
  const knobEl = document.getElementById('joy-knob');
  let joyId = null, lookId = null, lookX = 0, lookY = 0;
  if (joyEl && knobEl) {
    const setKnob = (dx, dy) => {
      knobEl.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    };
    const joyMove = (t) => {
      const r = joyEl.getBoundingClientRect();
      const max = r.width / 2 - 6;
      let dx = t.clientX - (r.left + r.width / 2);
      let dy = t.clientY - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy);
      if (d > max) { dx = (dx / d) * max; dy = (dy / d) * max; }
      input.touchMove.x = dx / max;
      input.touchMove.y = dy / max;
      setKnob(dx, dy);
    };
    joyEl.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      joyId = t.identifier; joyMove(t);
    }, { passive: false });
    joyEl.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) if (t.identifier === joyId) joyMove(t);
    }, { passive: false });
    const joyEnd = (e) => {
      for (const t of e.changedTouches) if (t.identifier === joyId) {
        joyId = null; input.touchMove.x = 0; input.touchMove.y = 0; setKnob(0, 0);
      }
    };
    joyEl.addEventListener('touchend', joyEnd);
    joyEl.addEventListener('touchcancel', joyEnd);
  }

  // a touch that starts on the canvas itself is a look drag (the stick and
  // the buttons are separate elements and keep their own touches)
  canvas.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0];
    if (lookId === null) { lookId = t.identifier; lookX = t.clientX; lookY = t.clientY; }
  }, { passive: true });
  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) if (t.identifier === lookId) {
      input.mouseDX += (t.clientX - lookX) * 2.4;
      input.mouseDY += (t.clientY - lookY) * 2.4;
      lookX = t.clientX; lookY = t.clientY;
    }
  }, { passive: false });
  const lookEnd = (e) => {
    for (const t of e.changedTouches) if (t.identifier === lookId) lookId = null;
  };
  canvas.addEventListener('touchend', lookEnd);
  canvas.addEventListener('touchcancel', lookEnd);

  const bindBtn = (id, on, off) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('touchstart', (e) => { e.preventDefault(); on(el); }, { passive: false });
    const end = (e) => { e.preventDefault(); if (off) off(el); };
    el.addEventListener('touchend', end, { passive: false });
    el.addEventListener('touchcancel', end, { passive: false });
  };
  bindBtn('btn-fire', () => { input.firing = true; }, () => { input.firing = false; });
  bindBtn('btn-jump', () => input.keys.add('Space'), () => input.keys.delete('Space'));
  bindBtn('btn-act', () => input.keys.add('KeyE'), () => input.keys.delete('KeyE'));
  bindBtn('btn-aim', (el) => {
    input.aiming = !input.aiming;
    el.classList.toggle('on', input.aiming);
  });
  bindBtn('btn-crouch', (el) => {
    const on = !input.keys.has('ControlLeft');
    if (on) input.keys.add('ControlLeft'); else input.keys.delete('ControlLeft');
    el.classList.toggle('on', on);
  });
  bindBtn('btn-reload', () => input.pressed.add('KeyR'));
  let swapAlt = false;
  bindBtn('btn-swap', () => {
    swapAlt = !swapAlt;
    input.pressed.add(swapAlt ? 'Digit2' : 'Digit1');
  });
  const nadeCodes = ['Digit3', 'Digit4', 'Digit5'];
  let nadeIdx = 0;
  bindBtn('btn-nade', () => { input.pressed.add(nadeCodes[nadeIdx % 3]); nadeIdx++; });

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
