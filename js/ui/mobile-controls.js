'use strict';

const mobileControlsEl = document.querySelector('#mobileControls');
const joystickEl = document.querySelector('#joystick');
const joystickKnobEl = document.querySelector('#joystickKnob');
const mobileActionBtn = document.querySelector('#mobileActionBtn');
const fullscreenBtn = document.querySelector('#fullscreenBtn');
const gameWrapEl = document.querySelector('#wrap');
const mobileStageEl = document.querySelector('#stage');
const mobileGameCanvas = document.querySelector('#game');
const rotateOverlayEl = document.querySelector('#rotateOverlay');
const landscapeBtn = document.querySelector('#landscapeBtn');

const touchUI =
  window.matchMedia('(pointer: coarse)').matches ||
  navigator.maxTouchPoints > 0 ||
  new URLSearchParams(location.search).has('touch');

// Other gameplay files can read this at runtime without changing desktop rules.
globalThis.__wordWarsTouchUI = touchUI;
document.documentElement.classList.toggle('touch-ui', touchUI);

const mobileLandscapeQuery = window.matchMedia('(orientation: landscape)');
let joystickPointerId = null;
let joystickOriginX = 0;
let joystickOriginY = 0;
let mobileCameraTop = null;
let mobileLabelTimer = 0;
let mobileTargetLock = { item: null, until: 0 };
let mobileActionBufferedUntil = 0;

function mobileLandscapeReady() {
  return touchUI && mobileLandscapeQuery.matches;
}

function mobileGameIsActive() {
  return Boolean(
    player &&
    player.alive !== false &&
    !state.over &&
    !document.querySelector('.overlay:not(.hidden)')
  );
}

function syncMobileOrientation() {
  const ready = mobileLandscapeReady();
  document.documentElement.classList.toggle('mobile-landscape', ready);
  rotateOverlayEl?.setAttribute('aria-hidden', ready ? 'true' : 'false');
  if (!ready) resetJoystick();
  updateMobileCamera(1 / 60, true);
}

function resetJoystick() {
  joystickPointerId = null;
  mobileInput.x = 0;
  mobileInput.y = 0;
  mobileInput.active = false;

  if (joystickEl) {
    joystickEl.classList.remove('active');
    // Return to the comfortable fixed home position after each gesture.
    joystickEl.style.left = '';
    joystickEl.style.top = '';
    joystickEl.style.right = '';
    joystickEl.style.bottom = '';
  }
  if (joystickKnobEl) {
    joystickKnobEl.style.transform = 'translate(-50%, -50%)';
  }
}

function placeFloatingJoystick(clientX, clientY) {
  if (!mobileStageEl || !joystickEl) return;

  const stageRect = mobileStageEl.getBoundingClientRect();
  const size = joystickEl.offsetWidth || 132;
  const half = size / 2;

  // Keep the stick away from notches, edges and the top HUD. It can still
  // float under the thumb, but never gets trapped in a corner.
  const horizontalInset = Math.max(34, stageRect.width * 0.035);
  const bottomInset = Math.max(24, stageRect.height * 0.055);
  const hudClearance = Math.max(58, stageRect.height * 0.13);
  const safeLeft = half + horizontalInset;
  const safeRight = Math.max(
    safeLeft,
    Math.min(stageRect.width * 0.49 - half, stageRect.width - half - horizontalInset)
  );
  const safeTop = half + hudClearance;
  const safeBottom = Math.max(safeTop, stageRect.height - half - bottomInset);
  const localX = Math.max(safeLeft, Math.min(safeRight, clientX - stageRect.left));
  const localY = Math.max(safeTop, Math.min(safeBottom, clientY - stageRect.top));

  joystickOriginX = stageRect.left + localX;
  joystickOriginY = stageRect.top + localY;
  joystickEl.style.left = `${localX - half}px`;
  joystickEl.style.top = `${localY - half}px`;
  joystickEl.style.right = 'auto';
  joystickEl.style.bottom = 'auto';
  joystickEl.classList.add('active');
}

function updateJoystickFromPoint(clientX, clientY) {
  if (!joystickEl || !joystickKnobEl) return;

  const maxRadius = (joystickEl.offsetWidth || 132) * 0.36;
  let dx = clientX - joystickOriginX;
  let dy = clientY - joystickOriginY;
  let distance = Math.hypot(dx, dy);

  if (distance > maxRadius) {
    dx = (dx / distance) * maxRadius;
    dy = (dy / distance) * maxRadius;
    distance = maxRadius;
  }

  const normalized = maxRadius ? distance / maxRadius : 0;
  const deadzone = CONFIG.MOBILE_JOYSTICK_DEADZONE;
  const linearMagnitude = normalized <= deadzone
    ? 0
    : (normalized - deadzone) / (1 - deadzone);

  // Precise near the centre; full running speed arrives before the rim.
  const magnitude = Math.pow(linearMagnitude, 0.88);
  const directionLength = Math.hypot(dx, dy) || 1;

  mobileInput.x = (dx / directionLength) * magnitude;
  mobileInput.y = (dy / directionLength) * magnitude;
  mobileInput.active = true;

  joystickKnobEl.style.transform =
    `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
}

function beginFloatingJoystick(event) {
  if (!mobileLandscapeReady() || !mobileGameIsActive()) return;
  if (event.target.closest('button, a, input, [role="button"]')) return;
  if (!mobileStageEl) return;

  const rect = mobileStageEl.getBoundingClientRect();
  if (event.clientX > rect.left + rect.width * 0.58) return;
  if (joystickPointerId !== null) return;

  event.preventDefault();
  joystickPointerId = event.pointerId;
  mobileStageEl.setPointerCapture?.(event.pointerId);
  placeFloatingJoystick(event.clientX, event.clientY);
  updateJoystickFromPoint(event.clientX, event.clientY);
}

mobileStageEl?.addEventListener('pointerdown', beginFloatingJoystick, {
  passive: false,
});

mobileStageEl?.addEventListener('pointermove', event => {
  if (event.pointerId !== joystickPointerId) return;
  event.preventDefault();
  updateJoystickFromPoint(event.clientX, event.clientY);
}, { passive: false });

for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  mobileStageEl?.addEventListener(eventName, event => {
    if (joystickPointerId !== null &&
      event.pointerId !== undefined &&
      event.pointerId !== joystickPointerId) return;
    resetJoystick();
  });
}

// Mobile interaction focus -------------------------------------------------
// Desktop keeps the exact original pickup rules. Touch devices receive a
// small accessibility radius and a short target lock so adjacent letters do
// not flicker between selections while the thumb is moving.
const mobilePreferredActionItemBase = preferredActionItem;
preferredActionItem = function mobilePreferredActionItem(
  actor,
  predicate,
  range = null
) {
  if (!touchUI || !actor?.isPlayer) {
    return mobilePreferredActionItemBase(actor, predicate, range);
  }

  const now = performance.now() / 1000;
  const mobileAssist = CONFIG.MOBILE_PICKUP_ASSIST || 0;
  const releasePad = CONFIG.MOBILE_TARGET_RELEASE_PAD || 0;

  const interactionLimit = item => {
    if (range !== null) return range;
    const letterAssist = item.type === 'letter'
      ? (CONFIG.LETTER_PICKUP_ASSIST || 0)
      : 0;
    return actor.r + item.r + CONFIG.PICKUP_RANGE_PAD +
      letterAssist + mobileAssist;
  };

  const locked = mobileTargetLock.item;
  if (locked &&
    now < mobileTargetLock.until &&
    items.includes(locked) &&
    predicate(locked) &&
    dist(actor, locked) <= interactionLimit(locked) + releasePad) {
    return locked;
  }

  mobileTargetLock.item = null;
  mobileTargetLock.until = 0;

  const inputLength = Math.hypot(mobileInput.x, mobileInput.y);
  const facingX = inputLength > 0.08
    ? mobileInput.x / inputLength
    : (actor.facingX || 0);
  const facingY = inputLength > 0.08
    ? mobileInput.y / inputLength
    : (actor.facingY || 0);
  const facingWeight = CONFIG.MOBILE_FACING_WEIGHT || 30;
  const candidates = [];

  for (const item of items) {
    if (!predicate(item)) continue;
    const distance = dist(actor, item);
    if (distance > interactionLimit(item)) continue;

    const directionLength = distance || 1;
    const facingDot =
      ((item.x - actor.x) / directionLength) * facingX +
      ((item.y - actor.y) / directionLength) * facingY;
    const behindPenalty = facingDot < -0.2 ? 24 : 0;

    candidates.push({
      item,
      score:
        distance - Math.max(0, facingDot) * facingWeight + behindPenalty,
    });
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => a.score - b.score);

  mobileTargetLock.item = candidates[0].item;
  mobileTargetLock.until = now + (CONFIG.MOBILE_TARGET_LOCK_TIME || 0.42);
  return candidates[0].item;
};

function itemActionLabel(item) {
  if (!item) return 'PICK';
  if (item.type === 'letter') return `PICK ${item.char || ''}`.trim();
  if (item.type === 'speed') return 'BOOST';
  if (item.type === 'health') return 'HEAL';
  if (item.type === 'gun') return 'RIFLE';
  if (item.type === 'wall') return 'BRICK';
  if (item.type === 'bomb') return item.ignited ? 'DEFUSE' : 'BOMB';
  return 'PICK';
}

function actionLabelFromContext(target = null) {
  if (!player) return 'ACT';
  const context = target || (
    typeof getContextTarget === 'function'
      ? getContextTarget()
      : null
  );

  if (!context) {
    if (player.inv?.type === 'bomb') return 'DROP';
    if (player.inv?.type === 'wall') return 'BUILD';
    if (player.inv?.type === 'letter') return 'PLACE';
    return 'ACT';
  }

  if (context.allowed === false) return 'BLOCKED';
  if (context.kind === 'raider') return 'SHOOT';
  if (context.kind === 'wall') return 'BUILD';
  if (context.kind === 'item') return itemActionLabel(context.item);
  if (context.kind === 'slot') {
    if (player.inv?.stolen) return 'DELIVER';
    if (player.inv) return 'PLACE';
    return 'STEAL';
  }
  return 'ACT';
}

function triggerMobileAction(event) {
  event.preventDefault();
  event.stopPropagation();
  if (!mobileLandscapeReady() || !player || state.over) return;

  const context = typeof getContextTarget === 'function'
    ? getContextTarget()
    : null;
  mobileActionBtn?.classList.add('pressed');

  const hadInventory = Boolean(player.inv);
  action(player);

  if (context && context.allowed !== false) {
    mobileActionBufferedUntil = 0;
    navigator.vibrate?.(context.kind === 'item' ? 14 : 9);
    return;
  }

  // A short mobile-only input buffer makes pickup feel forgiving while the
  // player is still gliding into range. Context-free inventory actions still
  // run immediately and are never repeated.
  mobileActionBufferedUntil = !context && !hadInventory
    ? performance.now() / 1000 + (CONFIG.MOBILE_ACTION_BUFFER_TIME || 0.24)
    : 0;
}

mobileActionBtn?.addEventListener('pointerdown', triggerMobileAction, {
  passive: false,
});
for (const eventName of ['pointerup', 'pointercancel', 'pointerleave']) {
  mobileActionBtn?.addEventListener(eventName, event => {
    event.preventDefault();
    mobileActionBtn.classList.remove('pressed');
  });
}

// Mobile camera ------------------------------------------------------------
// The desktop still shows the whole 1000x700 arena. Landscape phones fill
// their width and smoothly crop/follow vertically, making tiles and players
// large enough to read without stretching the canvas.
function updateMobileCamera(dt = 1 / 60, immediate = false) {
  if (!mobileGameCanvas || !mobileStageEl) return;

  if (!mobileLandscapeReady()) {
    mobileCameraTop = null;
    mobileGameCanvas.style.transform = '';
    mobileGameCanvas.style.width = '';
    mobileGameCanvas.style.left = '';
    mobileGameCanvas.style.right = '';
    return;
  }

  const rect = mobileStageEl.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  // Keep desktop untouched. On landscape phones, render the arena slightly
  // narrower and centre it so players can see more of the battlefield.
  const zoom = Math.max(0.78, Math.min(1, CONFIG.MOBILE_CAMERA_ZOOM || 0.90));
  const canvasWidth = rect.width * zoom;
  const canvasLeft = (rect.width - canvasWidth) / 2;
  mobileGameCanvas.style.width = `${canvasWidth.toFixed(2)}px`;
  mobileGameCanvas.style.left = `${canvasLeft.toFixed(2)}px`;
  mobileGameCanvas.style.right = 'auto';

  const scale = canvasWidth / CONFIG.W;
  const renderedHeight = CONFIG.H * scale;
  let desiredTop;

  if (renderedHeight <= rect.height) {
    desiredTop = (rect.height - renderedHeight) / 2;
  } else {
    const playerY = player?.y ?? CONFIG.H / 2;
    desiredTop =
      rect.height * (CONFIG.MOBILE_CAMERA_PLAYER_SCREEN_Y || 0.56) -
      playerY * scale;
    desiredTop = Math.max(rect.height - renderedHeight, Math.min(0, desiredTop));
  }

  if (mobileCameraTop === null || immediate) {
    mobileCameraTop = desiredTop;
  } else {
    const rate = CONFIG.MOBILE_CAMERA_FOLLOW_RATE || 10;
    const blend = 1 - Math.exp(-rate * dt);
    mobileCameraTop += (desiredTop - mobileCameraTop) * blend;
  }

  mobileGameCanvas.style.transform =
    `translate3d(0, ${mobileCameraTop.toFixed(2)}px, 0)`;
}

const mobileControlsTickBase = tick;
tick = function mobileControlsTick(dt) {
  mobileControlsTickBase(dt);
  updateMobileCamera(dt);

  const active = mobileGameIsActive();
  mobileControlsEl?.classList.toggle('game-active', active);

  // Consume a slightly early action as soon as a valid target comes into
  // range. This is especially useful while steering with the left thumb.
  const now = performance.now() / 1000;
  if (active && mobileActionBufferedUntil > now) {
    const bufferedContext = typeof getContextTarget === 'function'
      ? getContextTarget()
      : null;
    if (bufferedContext && bufferedContext.allowed !== false) {
      action(player);
      mobileActionBufferedUntil = 0;
      navigator.vibrate?.(bufferedContext.kind === 'item' ? 14 : 9);
    }
  } else if (mobileActionBufferedUntil && mobileActionBufferedUntil <= now) {
    mobileActionBufferedUntil = 0;
  }

  mobileLabelTimer -= dt;
  if (mobileLabelTimer <= 0) {
    const context = typeof getContextTarget === 'function'
      ? getContextTarget()
      : null;

    if (mobileActionBtn) {
      const label = actionLabelFromContext(context);
      mobileActionBtn.textContent = label;
      mobileActionBtn.setAttribute('aria-label', label);
      mobileActionBtn.classList.toggle(
        'ready',
        Boolean(context && context.allowed !== false)
      );
      mobileActionBtn.classList.toggle(
        'blocked',
        Boolean(context && context.allowed === false)
      );
    }

    mobileLabelTimer = 0.08;
  }
};

async function enterLandscapeFullscreen() {
  if (!touchUI) return;
  try {
    if (!document.fullscreenElement) {
      await gameWrapEl?.requestFullscreen?.();
    }
  } catch (_error) {
    // Embedded previews can block fullscreen.
  }

  try {
    await screen.orientation?.lock?.('landscape');
  } catch (_error) {
    // iOS and some embedded browsers require the player to rotate manually.
  }
}

async function toggleFullscreen() {
  try {
    if (!document.fullscreenElement) {
      await gameWrapEl?.requestFullscreen?.();
      if (touchUI) await screen.orientation?.lock?.('landscape');
    } else {
      await document.exitFullscreen?.();
    }
  } catch (_error) {
    // Responsive layout remains usable when fullscreen is unavailable.
  }
}

fullscreenBtn?.addEventListener('click', toggleFullscreen);
landscapeBtn?.addEventListener('click', enterLandscapeFullscreen);
document.querySelector('#startMatchBtn')?.addEventListener('click', () => {
  if (touchUI) enterLandscapeFullscreen();
});

document.addEventListener('fullscreenchange', () => {
  if (fullscreenBtn) {
    fullscreenBtn.textContent = document.fullscreenElement ? '×' : '⛶';
    fullscreenBtn.title = document.fullscreenElement
      ? 'Exit full screen'
      : 'Toggle full screen';
  }
  updateMobileCamera(1 / 60, true);
});

mobileLandscapeQuery.addEventListener?.('change', syncMobileOrientation);
window.addEventListener('resize', () => updateMobileCamera(1 / 60, true));
window.addEventListener('orientationchange', syncMobileOrientation);
window.addEventListener('blur', resetJoystick);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) resetJoystick();
});

if (mobileControlsEl) {
  mobileControlsEl.setAttribute('aria-hidden', touchUI ? 'false' : 'true');
}
syncMobileOrientation();
