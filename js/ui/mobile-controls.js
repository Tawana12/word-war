'use strict';

const mobileControlsEl = document.querySelector('#mobileControls');
const joystickEl = document.querySelector('#joystick');
const joystickKnobEl = document.querySelector('#joystickKnob');
const mobileActionBtn = document.querySelector('#mobileActionBtn');
const fullscreenBtn = document.querySelector('#fullscreenBtn');
const gameWrapEl = document.querySelector('#wrap');

const touchUI =
  window.matchMedia('(pointer: coarse)').matches ||
  navigator.maxTouchPoints > 0;

document.documentElement.classList.toggle('touch-ui', touchUI);
if (mobileControlsEl) {
  mobileControlsEl.setAttribute('aria-hidden', touchUI ? 'false' : 'true');
}

let joystickPointerId = null;

function resetJoystick() {
  joystickPointerId = null;
  mobileInput.x = 0;
  mobileInput.y = 0;
  mobileInput.active = false;
  if (joystickKnobEl) {
    joystickKnobEl.style.transform = 'translate(-50%, -50%)';
  }
}

function updateJoystickFromPointer(event) {
  if (!joystickEl || !joystickKnobEl) return;

  const rect = joystickEl.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const maxRadius = rect.width * 0.34;

  let dx = event.clientX - centerX;
  let dy = event.clientY - centerY;
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
  // A gentle response curve keeps small adjustments precise while reaching
  // running speed without forcing the thumb to the edge of the stick.
  const magnitude = Math.pow(linearMagnitude, 0.9);
  const directionLength = Math.hypot(dx, dy) || 1;

  mobileInput.x = (dx / directionLength) * magnitude;
  mobileInput.y = (dy / directionLength) * magnitude;
  mobileInput.active = true;

  joystickKnobEl.style.transform =
    `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
}

joystickEl?.addEventListener('pointerdown', event => {
  event.preventDefault();
  joystickPointerId = event.pointerId;
  joystickEl.setPointerCapture?.(event.pointerId);
  updateJoystickFromPointer(event);
});

joystickEl?.addEventListener('pointermove', event => {
  if (event.pointerId !== joystickPointerId) return;
  event.preventDefault();
  updateJoystickFromPointer(event);
});

for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) {
  joystickEl?.addEventListener(eventName, event => {
    if (joystickPointerId !== null &&
      event.pointerId !== undefined &&
      event.pointerId !== joystickPointerId) return;
    resetJoystick();
  });
}

function triggerMobileAction(event) {
  event.preventDefault();
  if (!player || state.over) return;
  mobileActionBtn?.classList.add('pressed');
  action(player);
  navigator.vibrate?.(10);
}

mobileActionBtn?.addEventListener('pointerdown', triggerMobileAction);
for (const eventName of ['pointerup', 'pointercancel', 'pointerleave']) {
  mobileActionBtn?.addEventListener(eventName, () => {
    mobileActionBtn.classList.remove('pressed');
  });
}

function actionLabelFromContext() {
  if (!player) return 'ACT';
  const target = typeof getContextTarget === 'function'
    ? getContextTarget()
    : null;

  if (!target) return 'ACT';
  if (target.kind === 'raider') return 'SHOOT';
  if (target.kind === 'wall') return 'BUILD';
  if (target.kind === 'slot') {
    return player.inv?.stolen ? 'DELIVER' : player.inv ? 'PLACE' : 'STEAL';
  }
  if (target.kind === 'item') return 'PICK';
  if (player.inv?.type === 'bomb') return 'DROP';
  return 'ACT';
}

let mobileLabelTimer = 0;
const mobileControlsTickBase = tick;
tick = function mobileControlsTick(dt) {
  mobileControlsTickBase(dt);
  mobileLabelTimer -= dt;
  if (mobileLabelTimer <= 0) {
    if (mobileActionBtn) mobileActionBtn.textContent = actionLabelFromContext();
    mobileLabelTimer = 0.12;
  }
};

async function toggleFullscreen() {
  try {
    if (!document.fullscreenElement) {
      await gameWrapEl?.requestFullscreen?.();
    } else {
      await document.exitFullscreen?.();
    }
  } catch (_error) {
    // Some embedded previews block fullscreen. The responsive layout still
    // expands to the full size allowed by the host frame.
  }
}

fullscreenBtn?.addEventListener('click', toggleFullscreen);
document.addEventListener('fullscreenchange', () => {
  if (fullscreenBtn) {
    fullscreenBtn.textContent = document.fullscreenElement ? '×' : '⛶';
    fullscreenBtn.title = document.fullscreenElement
      ? 'Exit full screen'
      : 'Toggle full screen';
  }
});

window.addEventListener('blur', resetJoystick);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) resetJoystick();
});
