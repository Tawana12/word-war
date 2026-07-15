'use strict';

// Constructed perimeter sections do not last forever. A small predictable
// decay cycle keeps the Outer Warden building throughout the round instead
// of finishing the fortress once and becoming idle.
Object.assign(CONFIG, {
  FORTRESS_WEAR_INTERVAL: 22,
  FORTRESS_WEAR_FRACTION: 1 / 3,
  FORTRESS_WEAR_MIN_AGE: 8,
});

let fortressWearTimer = CONFIG.FORTRESS_WEAR_INTERVAL;
const fortressDust = [];

function resetFortressWearState() {
  fortressWearTimer = CONFIG.FORTRESS_WEAR_INTERVAL;
  fortressDust.length = 0;
}

function shuffleFortressWalls(list) {
  const copy = [...list];
  for (let index = copy.length - 1; index > 0; index--) {
    const swap = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

function wallAge(wall) {
  return simTime - (Number.isFinite(wall.builtAt) ? wall.builtAt : simTime);
}

function crumbleConstructedWalls(team) {
  const candidates = walls.filter(wall =>
    wall.team === team &&
    !wall.field &&
    wall.builtByGuardian === true &&
    wallAge(wall) >= CONFIG.FORTRESS_WEAR_MIN_AGE
  );

  if (!candidates.length) return 0;

  const amount = Math.max(
    1,
    Math.ceil(candidates.length * CONFIG.FORTRESS_WEAR_FRACTION)
  );
  const selected = shuffleFortressWalls(candidates).slice(0, amount);

  for (const wall of selected) {
    const index = walls.indexOf(wall);
    if (index >= 0) walls.splice(index, 1);

    fortressDust.push({
      x: wall.x + wall.w / 2,
      y: wall.y + wall.h / 2,
      life: 0.8,
      size: Math.max(wall.w, wall.h),
      team,
    });
  }

  // Replace the lost building opportunities with loose bricks so Wardens can
  // react immediately rather than waiting on the general item lottery.
  let looseBricks = items.filter(item => item.type === 'wall').length;
  const refill = Math.min(amount, Math.max(0, CONFIG.MAX_WALLS_ITEM - looseBricks));
  for (let index = 0; index < refill; index++) {
    spawn('wall');
    looseBricks += 1;
  }

  if (typeof navigationGridCache !== 'undefined') navigationGridCache.clear();
  if (typeof mazeRevision !== 'undefined') mazeRevision += 1;
  return selected.length;
}

function triggerFortressWear() {
  const blue = crumbleConstructedWalls('blue');
  const red = crumbleConstructedWalls('red');
  const total = blue + red;

  if (total > 0) {
    msg(`FORTRESS WEAR — ${total} built wall section${total === 1 ? '' : 's'} crumbled.`);
  }
}

function updateFortressDust(dt) {
  for (let index = fortressDust.length - 1; index >= 0; index--) {
    fortressDust[index].life -= dt;
    if (fortressDust[index].life <= 0) fortressDust.splice(index, 1);
  }
}

const fortressWearTickBase = tick;
tick = function fortressWearTick(dt) {
  fortressWearTickBase(dt);
  if (state.over || !ACTORS || globalThis.isSoloFieldRunActive?.()) return;

  fortressWearTimer -= dt;
  if (fortressWearTimer <= 0) {
    triggerFortressWear();
    fortressWearTimer = CONFIG.FORTRESS_WEAR_INTERVAL;
  }

  updateFortressDust(dt);
};

const fortressWearEffectsBase = drawWorldEffects;
drawWorldEffects = function fortressWearEffects() {
  fortressWearEffectsBase();
  if (globalThis.isSoloFieldRunActive?.()) return;

  ctx.save();
  for (const dust of fortressDust) {
    const progress = 1 - dust.life / 0.8;
    const alpha = Math.max(0, dust.life / 0.8);
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = dust.team === 'blue' ? '#80adff' : '#ff8e8e';
    ctx.lineWidth = 3;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(
      dust.x - dust.size / 2 - progress * 8,
      dust.y - dust.size / 2 - progress * 8,
      dust.size + progress * 16,
      dust.size + progress * 16
    );
  }
  ctx.setLineDash([]);
  ctx.restore();
};

window.__wordWarsFortressWear = {
  trigger: triggerFortressWear,
  reset: resetFortressWearState,
  timer: () => fortressWearTimer,
};

globalThis.resetFortressWearState = resetFortressWearState;
