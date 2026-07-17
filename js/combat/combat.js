'use strict';

// ================================================================
// DEFENDER / RAIDER COMBAT + FIELD MAZE
// Shooting is intentionally role-specific:
//   - Defenders defend their fortress and only target enemy Runners.
//   - Raiders can heal, steal one letter and be eliminated from the match.
// This keeps the word game readable instead of turning every role into a shooter.
// ================================================================
Object.assign(CONFIG, {
  MAX_HEALTH_ITEMS: 5,
  MAX_GUN_ITEMS: 2,
  HEALTH_RECOVERY: 42,
  COMBAT_SUPPLY_CHECK: 3.8,

  DEFENDER_AIM_TIME: 0.34,

  // Human Inner Sentry aiming is directional but deliberately forgiving.
  // The player points with movement/facing and may hold Fire/Space.
  SENTRY_PLAYER_AIM_MIN_DOT: 0.30,
  SENTRY_PLAYER_AIM_LATERAL_PAD: 92,
  SENTRY_PLAYER_LEAD_FACTOR: 0.52,
  SENTRY_PLAYER_AIM_LINE: 175,

  PISTOL_RANGE: 430,
  PISTOL_DAMAGE: 15,
  PISTOL_COOLDOWN: 0.21,
  PISTOL_BURST_SIZE: 3,
  PISTOL_BURST_RECOVERY: 1.30,
  PISTOL_BULLET_SPEED: 720,

  RIFLE_RANGE: 520,
  RIFLE_DAMAGE: 18,
  RIFLE_COOLDOWN: 0.14,
  RIFLE_BURST_SIZE: 3,
  RIFLE_BURST_RECOVERY: 1.15,
  RIFLE_BULLET_SPEED: 920,
  RIFLE_AMMO: 18,

  RAIDER_STARTING_LIVES: 2,
  RAIDER_RESPAWN_TIME: 7.0,
  RAIDER_RESPAWN_HEALTH: 72,

  BULLET_RADIUS: 3,
  BULLET_LIFETIME_PAD: 0.10,
});

const bullets = [];
let combatSupplyTimer = 0;
let playerSentryFireHeld = false;

function setInnerSentryFireHeld(held) {
  playerSentryFireHeld = Boolean(held);
}

globalThis.setInnerSentryFireHeld = setInnerSentryFireHeld;
globalThis.isInnerSentryFireHeld = () => playerSentryFireHeld;

SUPPLY_PADS.health = [
  { x: 245, y: 610 },
  { x: 755, y: 610 },
  { x: 365, y: 105 },
  { x: 635, y: 105 },
  { x: 500, y: 520 },
];
SUPPLY_PADS.gun = [
  { x: BASES.blue.x + BASES.blue.w / 2, y: BASES.blue.y + 38 },
  { x: BASES.red.x + BASES.red.w / 2, y: BASES.red.y + 38 },
];
supplyPadCursor.health = 0;
supplyPadCursor.gun = 0;

if (!ROLE_RULES.RUNNER.allowed.includes('health')) {
  ROLE_RULES.RUNNER.allowed.push('health');
}
ROLE_RULES.RUNNER.job = 'Build the word and raid the enemy';
ROLE_RULES.RUNNER.summary = 'Letters · Intel · Golden · Health · Speed · Stealing';

if (!ROLE_RULES.GUARDIAN.allowed.includes('gun')) {
  ROLE_RULES.GUARDIAN.allowed.push('gun');
}
ROLE_RULES.GUARDIAN.job = 'Protect the fortress in two layers';
ROLE_RULES.GUARDIAN.summary = 'Inner Sentry or Outer Warden';

// Legacy capability rules remain for temporary role adaptation.
if (!ROLE_RULES.RAIDER.allowed.includes('health')) ROLE_RULES.RAIDER.allowed.push('health');
if (!ROLE_RULES.DEFENDER.allowed.includes('gun')) ROLE_RULES.DEFENDER.allowed.push('gun');

function combatItemCount(type) {
  return items.filter(item => item.type === type).length;
}

function spawnCombatItem(type) {
  const radius = CONFIG.ITEM_RADIUS_OTHER;
  const location = chooseOpenSpawn(type, radius);
  return createItemAt(type, location.x, location.y);
}

// Start with enough support items to demonstrate the combat loop,
// then replenish them slowly.
while (combatItemCount('health') < CONFIG.MAX_HEALTH_ITEMS) {
  spawnCombatItem('health');
}
while (combatItemCount('gun') < CONFIG.MAX_GUN_ITEMS) {
  spawnCombatItem('gun');
}

const combatCanCollectBase = canActorCollectItem;
canActorCollectItem = function combatCanActorCollectItem(actor, item) {
  if (!actor || !item || actor.alive === false) return false;

  if (item.type === 'health') {
    return isRunnerRole(actor) &&
      actor.health < actor.maxHealth;
  }

  if (item.type === 'gun') {
    return typeof isInnerSentry === 'function' &&
      isInnerSentry(actor) &&
      (actor.weaponTier < 2 || actor.gunAmmo < CONFIG.RIFLE_AMMO);
  }

  return combatCanCollectBase(actor, item);
};

const combatRoleLabelBase = getItemRoleLabel;
getItemRoleLabel = function combatItemRoleLabel(item) {
  if (item?.type === 'health') return 'Runner only';
  if (item?.type === 'gun') return 'Inner Sentry only';
  return combatRoleLabelBase(item);
};

const combatDisplayNameBase = getItemDisplayName;
getItemDisplayName = function combatItemDisplayName(item) {
  if (item?.type === 'health') return 'Health Pack';
  if (item?.type === 'gun') return 'Rifle Upgrade';
  return combatDisplayNameBase(item);
};

const combatPickupBase = pickup;
pickup = function combatPickup(actor, item) {
  if (!item || actor?.alive === false) return false;

  if (item.type === 'health') {
    if (!canActorCollectItem(actor, item)) {
      if (actor.isPlayer) {
        msg(
          !isRunnerRole(actor)
            ? 'Health Pack: Runner only.'
            : 'Your Runner is already at full health.'
        );
      }
      return false;
    }

    actor.health = Math.min(
      actor.maxHealth,
      actor.health + CONFIG.HEALTH_RECOVERY
    );
    clearReservation(actor);
    removeItem(item);
    actor.damageFlash = 0;
    if (actor.isPlayer) {
      msg(`Health restored to ${Math.ceil(actor.health)}.`);
    }
    return true;
  }

  if (item.type === 'gun') {
    if (!canActorCollectItem(actor, item)) {
      if (actor.isPlayer) msg('Rifle Upgrade: Inner Sentry only.');
      return false;
    }

    actor.weaponTier = 2;
    actor.gunAmmo = CONFIG.RIFLE_AMMO;
    clearReservation(actor);
    removeItem(item);
    if (actor.isPlayer) {
      msg(`Rifle equipped — ${CONFIG.RIFLE_AMMO} shots.`);
    }
    return true;
  }

  return combatPickupBase(actor, item);
};

const combatActionBase = action;
action = function combatAction(actor) {
  if (!actor || actor.alive === false) {
    if (actor?.isPlayer) msg('You have been eliminated.');
    return;
  }

  // Health is collected automatically on contact. Rifle crates remain
  // deliberate so Space never consumes an unexpected nearby item.
  const instantItem = nearest(actor, item =>
    item.type === 'gun' &&
    dist(actor, item) < actor.r + item.r + CONFIG.PICKUP_RANGE_PAD
  );

  if (instantItem && pickup(actor, instantItem)) return;

  // Human Defender: Space fires at the best visible enemy Runner.
  // When no legal shot exists, Space falls through to bomb defusing,
  // pickups and the normal role action.
  if (typeof isInnerSentry === 'function' && isInnerSentry(actor)) {
    const target = defenderShootTarget(actor);
    if (target && shootDefender(actor, false, target)) return;
  }

  combatActionBase(actor);
};

function weaponProfile(actor) {
  if (globalThis.isSoloFieldRunActive?.() && actor?.soloShooter) {
    return {
      name: 'Hunter Pistol',
      range: actor.soloShotRange || 410,
      damage: actor.soloShotDamage || 8,
      cooldown: actor.soloShotCooldown || 0.62,
      burstSize: 2,
      burstRecovery: 0.72,
      speed: actor.soloShotSpeed || 610,
      color: '#ff8c72',
    };
  }

  const rifleActive =
    actor.weaponTier >= 2 &&
    actor.gunAmmo > 0;

  return rifleActive
    ? {
      name: 'Rifle',
      range: CONFIG.RIFLE_RANGE,
      damage: CONFIG.RIFLE_DAMAGE,
      cooldown: CONFIG.RIFLE_COOLDOWN,
      burstSize: CONFIG.RIFLE_BURST_SIZE,
      burstRecovery: CONFIG.RIFLE_BURST_RECOVERY,
      speed: CONFIG.RIFLE_BULLET_SPEED,
      color: '#8fd3ff',
    }
    : {
      name: 'Pistol',
      range: CONFIG.PISTOL_RANGE,
      damage: CONFIG.PISTOL_DAMAGE,
      cooldown: CONFIG.PISTOL_COOLDOWN,
      burstSize: CONFIG.PISTOL_BURST_SIZE,
      burstRecovery: CONFIG.PISTOL_BURST_RECOVERY,
      speed: CONFIG.PISTOL_BULLET_SPEED,
      color: '#ffe49b',
    };
}

function segmentIntersectsRect(x1, y1, x2, y2, rect, padding = 0) {
  const minX = rect.x - padding;
  const minY = rect.y - padding;
  const maxX = rect.x + rect.w + padding;
  const maxY = rect.y + rect.h + padding;

  const dx = x2 - x1;
  const dy = y2 - y1;
  let t0 = 0;
  let t1 = 1;

  const checks = [
    [-dx, x1 - minX],
    [dx, maxX - x1],
    [-dy, y1 - minY],
    [dy, maxY - y1],
  ];

  for (const [p, q] of checks) {
    if (Math.abs(p) < 1e-9) {
      if (q < 0) return false;
      continue;
    }

    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }

  return true;
}

function clearShotLine(shooter, target) {
  for (const wall of walls) {
    if (segmentIntersectsRect(
      shooter.x,
      shooter.y,
      target.x,
      target.y,
      wall,
      2
    )) {
      return false;
    }
  }
  return true;
}

function sentryAimVector(defender) {
  const fallbackX = defender?.team === 'red' ? -1 : 1;
  const rawX = Number.isFinite(defender?.facingX)
    ? defender.facingX
    : fallbackX;
  const rawY = Number.isFinite(defender?.facingY)
    ? defender.facingY
    : 0;
  const length = Math.hypot(rawX, rawY) || 1;
  return { x: rawX / length, y: rawY / length };
}

function legalDefenderTargets(defender) {
  const soloOpenCombat = Boolean(globalThis.isSoloFieldRunActive?.());
  if (!defender || defender.alive === false ||
    typeof isInnerSentry !== 'function' ||
    !isInnerSentry(defender) ||
    (!soloOpenCombat && !insideRect(defender, BASES[defender.team]))) return [];

  const profile = weaponProfile(defender);
  return (ACTORS || []).filter(actor =>
    actor.alive !== false &&
    isRunnerRole(actor) &&
    actor.team !== defender.team &&
    isTerritoryIntruder(actor, defender.team) &&
    actorsCanSee(defender, actor) &&
    dist(defender, actor) <= profile.range &&
    clearShotLine(defender, actor)
  );
}

function directionalDefenderTarget(defender) {
  const aim = sentryAimVector(defender);
  const minDot = CONFIG.SENTRY_PLAYER_AIM_MIN_DOT;
  const lateralPad = CONFIG.SENTRY_PLAYER_AIM_LATERAL_PAD;
  let best = null;
  let bestScore = -Infinity;

  for (const actor of legalDefenderTargets(defender)) {
    const dx = actor.x - defender.x;
    const dy = actor.y - defender.y;
    const distance = Math.hypot(dx, dy) || 1;
    const dot = (dx / distance) * aim.x + (dy / distance) * aim.y;
    const lateral = Math.abs(dx * aim.y - dy * aim.x);

    // A wide cone keeps mobile aiming forgiving, while the lateral limit
    // prevents a target far to the side from being selected accidentally.
    if (dot < minDot || lateral > lateralPad + distance * 0.18) continue;

    const carryingStolenLetter = Boolean(
      actor.inv?.stolen && actor.inv.stolenFrom === defender.team
    );
    const score =
      dot * 900 -
      lateral * 2.7 -
      distance * 0.30 +
      (carryingStolenLetter ? 260 : 0);

    if (score > bestScore) {
      bestScore = score;
      best = actor;
    }
  }

  return best;
}

function defenderShootTarget(defender) {
  if (defender?.isPlayer) return directionalDefenderTarget(defender);

  return legalDefenderTargets(defender)
    .sort((a, b) => {
      const aLoot =
        a.inv?.stolen && a.inv.stolenFrom === defender.team ? 0 : 1;
      const bLoot =
        b.inv?.stolen && b.inv.stolenFrom === defender.team ? 0 : 1;
      return (aLoot - bLoot) || (dist(defender, a) - dist(defender, b));
    })[0] || null;
}

function shootDefender(defender, announceFailure = false, lockedTarget = null) {
  const soloOpenCombat = Boolean(globalThis.isSoloFieldRunActive?.());
  if (!defender || defender.alive === false ||
    typeof isInnerSentry !== 'function' ||
    !isInnerSentry(defender) ||
    (!soloOpenCombat && !insideRect(defender, BASES[defender.team]))) return false;

  const mayCarrySoloLetter = Boolean(
    soloOpenCombat && defender.isPlayer && defender.inv?.type === 'letter'
  );
  if (defender.inv && !mayCarrySoloLetter) {
    if (announceFailure && defender.isPlayer) {
      msg('You cannot shoot while carrying an item.');
    }
    return false;
  }

  if (defender.shootCooldown > 0) return false;

  const lockedTargetValid = lockedTarget &&
    lockedTarget.alive !== false &&
    isRunnerRole(lockedTarget) &&
    lockedTarget.team !== defender.team &&
    isTerritoryIntruder(lockedTarget, defender.team) &&
    actorsCanSee(defender, lockedTarget) &&
    dist(defender, lockedTarget) <= weaponProfile(defender).range &&
    clearShotLine(defender, lockedTarget);

  const target = lockedTargetValid
    ? lockedTarget
    : defenderShootTarget(defender);
  if (!target) {
    if (announceFailure && defender.isPlayer) {
      msg('No enemy Runner has crossed the white line.');
    }
    return false;
  }

  const profile = weaponProfile(defender);
  const currentDx = target.x - defender.x;
  const currentDy = target.y - defender.y;
  const currentDistance = Math.hypot(currentDx, currentDy) || 1;
  const travelTime = currentDistance / profile.speed;
  const leadFactor = defender.isPlayer
    ? CONFIG.SENTRY_PLAYER_LEAD_FACTOR
    : 0.36;
  const aimX = target.x + (target.vx || 0) * travelTime * leadFactor;
  const aimY = target.y + (target.vy || 0) * travelTime * leadFactor;
  const dx = aimX - defender.x;
  const dy = aimY - defender.y;
  const length = Math.hypot(dx, dy) || 1;

  // A successful shot also settles the visible facing direction, making
  // repeated fire feel connected to the direction the player is pointing.
  defender.facingX = dx / length;
  defender.facingY = dy / length;

  bullets.push({
    x: defender.x + (dx / length) * (defender.r + 5),
    y: defender.y + (dy / length) * (defender.r + 5),
    prevX: defender.x,
    prevY: defender.y,
    vx: (dx / length) * profile.speed,
    vy: (dy / length) * profile.speed,
    team: defender.team,
    owner: defender,
    damage: profile.damage,
    color: profile.color,
    radius: CONFIG.BULLET_RADIUS,
    life: profile.range / profile.speed + CONFIG.BULLET_LIFETIME_PAD,
  });

  defender.shootCooldown = profile.cooldown;

  if (defender.weaponTier >= 2 && defender.gunAmmo > 0) {
    defender.gunAmmo -= 1;
    if (defender.gunAmmo <= 0) {
      defender.weaponTier = 1;
      if (defender.isPlayer) msg('Rifle empty — switched back to pistol.');
    }
  }

  return true;
}

function eliminateActor(actor, killer = null) {
  if (!actor || actor.alive === false) return;

  if (isRunnerRole(actor) && typeof finishTeamRaid === 'function') {
    finishTeamRaid(actor, 7.5);
  }

  const dropped = isRunnerRole(actor)
    ? dropRaiderLootOnIntercept(actor)
    : '';

  const hasReserveLife =
    isRunnerRole(actor) &&
    actor.lives > 1;

  if (isRunnerRole(actor)) {
    actor.lives = Math.max(0, actor.lives - 1);
  }

  actor.alive = false;
  actor.health = 0;
  actor.vx = 0;
  actor.vy = 0;
  actor.stunTimer = 0;
  actor.target = null;
  actor.targetItem = null;
  actor.interceptTarget = null;
  actor.combatAimTarget = null;
  actor.combatAimTimer = 0;
  actor.burstRemaining = 0;
  actor.burstRecovery = 0;
  actor.inv = null;
  clearReservation(actor);

  const teamName = actor.team.toUpperCase();

  if (hasReserveLife) {
    actor.respawnTimer = CONFIG.RAIDER_RESPAWN_TIME;

    const notice = dropped
      ? `${teamName} RUNNER DOWN — dropped ${dropped}. Returning in ${CONFIG.RAIDER_RESPAWN_TIME.toFixed(0)}s.`
      : `${teamName} RUNNER DOWN — returning in ${CONFIG.RAIDER_RESPAWN_TIME.toFixed(0)}s.`;

    msg(notice);

    if (actor.isPlayer && roleStripEl) {
      roleStripEl.innerHTML =
        `<strong>RUNNER — DOWNED</strong>` +
        `Returning in ${CONFIG.RAIDER_RESPAWN_TIME.toFixed(0)} seconds · 1 life remains.<br>` +
        `<span style="color:#8f9aaa">Your team continues while you recover.</span>`;
    }
    return;
  }

  actor.respawnTimer = 0;
  const notice = dropped
    ? `${teamName} RUNNER ELIMINATED — dropped ${dropped}!`
    : `${teamName} RUNNER ELIMINATED!`;

  msg(notice);

  if (actor.isPlayer) {
    updateRoleStrip(actor.role);
    if (roleStripEl) {
      roleStripEl.innerHTML =
        `<strong>RUNNER — ELIMINATED</strong>` +
        `Your team continues without its Raider.<br>` +
        `<span style="color:#8f9aaa">You can watch the rest of the match.</span>`;
    }
  }
}

function damageRaider(raider, damage, killer) {
  if (!raider || raider.alive === false ||
    !isRunnerRole(raider)) return;

  raider.health = Math.max(0, raider.health - damage);
  raider.damageFlash = 0.20;

  if (raider.health <= 0) {
    eliminateActor(raider, killer);
  } else if (raider.isPlayer && !globalThis.isSoloFieldRunActive?.()) {
    msg(`Hit! Runner health: ${Math.ceil(raider.health)}.`);
  }
}

function updateBullets(dt) {
  for (let index = bullets.length - 1; index >= 0; index--) {
    const bullet = bullets[index];
    bullet.life -= dt;
    bullet.prevX = bullet.x;
    bullet.prevY = bullet.y;
    const nextX = bullet.x + bullet.vx * dt;
    const nextY = bullet.y + bullet.vy * dt;

    const wallHit = walls.some(wall =>
      segmentIntersectsRect(
        bullet.x,
        bullet.y,
        nextX,
        nextY,
        wall,
        bullet.radius
      )
    );

    // Sentry fire belongs to its own territory and stops at the white line.
    const crossedTerritoryLine = !pointInTeamTerritory(nextX, bullet.team);

    if (wallHit || crossedTerritoryLine || bullet.life <= 0) {
      bullets.splice(index, 1);
      continue;
    }

    bullet.x = nextX;
    bullet.y = nextY;

    const target = (ACTORS || []).find(actor =>
      actor.alive !== false &&
      isRunnerRole(actor) &&
      actor.team !== bullet.team &&
      isTerritoryIntruder(actor, bullet.team) &&
      Math.hypot(actor.x - bullet.x, actor.y - bullet.y) <=
      actor.r + bullet.radius
    );

    if (target) {
      damageRaider(target, bullet.damage, bullet.owner);
      bullets.splice(index, 1);
    }
  }
}

function drawBullets() {
  for (const bullet of bullets) {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(
      bullet.x - bullet.vx * 0.012,
      bullet.y - bullet.vy * 0.012
    );
    ctx.lineTo(bullet.x, bullet.y);
    ctx.strokeStyle = bullet.color;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.shadowColor = bullet.color;
    ctx.shadowBlur = 6;
    ctx.stroke();
    ctx.restore();
  }
}

const combatChooseBase = choose;
choose = function combatChoose(bot) {
  if (bot.alive === false) return;

  if (bot.role === 'RAIDER' && !bot.inv &&
    bot.health <= bot.maxHealth * 0.62) {
    const health = nearest(bot, item =>
      item.type === 'health' &&
      !isReservedByOther(bot, item) &&
      canActorCollectItem(bot, item)
    );

    if (health) {
      bot.mode = 'FETCH_HEALTH';
      bot.targetItem = health;
      reserveItem(bot, health);
      bot.target = { x: health.x, y: health.y };
      return;
    }
  }

  if (bot.role === 'DEFENDER' && !bot.inv &&
    (bot.weaponTier < 2 || bot.gunAmmo <= 4)) {
    const gun = nearest(bot, item =>
      item.type === 'gun' &&
      !isReservedByOther(bot, item) &&
      canActorCollectItem(bot, item)
    );

    if (gun) {
      bot.mode = 'FETCH_RIFLE';
      bot.targetItem = gun;
      reserveItem(bot, gun);
      bot.target = { x: gun.x, y: gun.y };
      return;
    }
  }

  combatChooseBase(bot);
};

const combatUpdateBotBase = updateBot;
updateBot = function combatUpdateBot(bot, dt) {
  if (!bot || bot.alive === false) {
    if (bot) {
      bot.vx = 0;
      bot.vy = 0;
    }
    return;
  }

  combatUpdateBotBase(bot, dt);
};

const combatDriveActorBase = driveActor;
driveActor = function combatDriveActor(actor, dirx, diry, dt, isBot) {
  if (!actor || actor.alive === false) {
    if (actor) {
      actor.vx = 0;
      actor.vy = 0;
    }
    return;
  }
  combatDriveActorBase(actor, dirx, diry, dt, isBot);
};

const combatSeparationBase = separationVector;
separationVector = function combatSeparation(actor, roster) {
  return combatSeparationBase(
    actor,
    roster.filter(other => other.alive !== false)
  );
};

const combatEnforceCapsBase = enforceItemCaps;
enforceItemCaps = function combatEnforceCaps() {
  combatEnforceCapsBase();

  for (const [type, cap] of [
    ['health', CONFIG.MAX_HEALTH_ITEMS],
    ['gun', CONFIG.MAX_GUN_ITEMS],
  ]) {
    const matching = items.filter(item => item.type === type);
    while (matching.length > cap) {
      const extra = matching.pop();
      if (extra) removeItem(extra);
    }
  }
};

const combatContextBase = getContextTarget;
getContextTarget = function combatContextTarget() {
  if (player?.alive === false) {
    return {
      kind: 'status',
      allowed: false,
      text: player.respawnTimer > 0
        ? `DOWNED — returning in ${player.respawnTimer.toFixed(1)}s`
        : 'ELIMINATED — your team is continuing the match',
    };
  }

  if (typeof isInnerSentry === 'function' && isInnerSentry(player)) {
    const target = defenderShootTarget(player);
    if (target) {
      const profile = weaponProfile(player);
      const weaponText = profile.name === 'Rifle'
        ? `Rifle ${player.gunAmmo} shots`
        : 'Pistol';

      return {
        kind: 'raider',
        actor: target,
        allowed: player.shootCooldown <= 0,
        text: player.shootCooldown <= 0
          ? `Hold Space: fire toward intruder · ${weaponText}`
          : `${weaponText} reloading`,
      };
    }

    const visibleIntruder = legalDefenderTargets(player)
      .sort((a, b) => dist(player, a) - dist(player, b))[0] || null;
    if (visibleIntruder) {
      return {
        kind: 'aim',
        actor: visibleIntruder,
        allowed: false,
        text: 'Point toward the intruder, then hold Fire / Space',
      };
    }
  }

  const context = combatContextBase();
  if (context?.kind === 'item' && context.item?.type === 'health') {
    return {
      kind: 'status',
      allowed: true,
      text: 'Walk over the Health Pack',
    };
  }
  return context;
};

const combatUpdateRoleStripBase = updateRoleStrip;
updateRoleStrip = function combatUpdateRoleStrip(role) {
  combatUpdateRoleStripBase(role);
  const rule = ROLE_RULES[role];
  if (!rule || !roleStripEl) return;

  roleStripEl.innerHTML =
    `<strong>${role} — ${rule.job}</strong>${rule.summary}<br>` +
    `<span style="color:#8f9aaa">` +
    `Move WASD / Arrows · Space = Role Action` +
    `</span>`;
};

function resetDefenderFireControl(defender) {
  defender.combatAimTarget = null;
  defender.combatAimTimer = 0;
  defender.burstRemaining = 0;
}

function updateDefenderFireControl(defender, dt) {
  if (!defender || defender.alive === false ||
    typeof isInnerSentry !== 'function' ||
    !isInnerSentry(defender) || defender.isPlayer) return;

  defender.burstRecovery = Math.max(
    0,
    (defender.burstRecovery || 0) - dt
  );

  if (defender.inv) {
    resetDefenderFireControl(defender);
    return;
  }

  const target = defenderShootTarget(defender);

  if (!target) {
    resetDefenderFireControl(defender);
    return;
  }

  if (defender.combatAimTarget !== target) {
    defender.combatAimTarget = target;
    defender.combatAimTimer = CONFIG.DEFENDER_AIM_TIME;
    defender.burstRemaining = 0;
    return;
  }

  if (!clearShotLine(defender, target) ||
    !actorsCanSee(defender, target)) {
    resetDefenderFireControl(defender);
    return;
  }

  if (defender.combatAimTimer > 0) {
    defender.combatAimTimer = Math.max(
      0,
      defender.combatAimTimer - dt
    );
    return;
  }

  if (defender.burstRecovery > 0) return;

  const profile = weaponProfile(defender);

  if (defender.burstRemaining <= 0) {
    defender.burstRemaining = profile.burstSize;
  }

  if (defender.shootCooldown > 0) return;

  if (shootDefender(defender, false, target)) {
    defender.burstRemaining -= 1;

    if (defender.burstRemaining <= 0) {
      defender.burstRecovery = profile.burstRecovery;
      defender.combatAimTimer = 0.18;
    }
  }
}

function respawnRaider(actor) {
  const base = BASES[actor.team];
  const side = actor.team === 'blue' ? 1 : -1;

  actor.x = base.x + base.w / 2 + side * 24;
  actor.y = base.y + base.h / 2 + 48;
  actor.prevX = actor.x;
  actor.prevY = actor.y;
  actor.vx = 0;
  actor.vy = 0;
  actor.health = CONFIG.RAIDER_RESPAWN_HEALTH;
  actor.alive = true;
  actor.respawnTimer = 0;
  actor.damageFlash = 0.35;
  actor.coverTreeId = null;
  actor.inv = null;
  actor.raidSlotIndex = null;
  actor.raidTargetTeam = null;
  actor.target = null;
  actor.targetItem = null;
  actor.targetCommit = 0;
  actor.thinkTimer = 0;
  actor.navPath = [];
  actor.navPathIndex = 0;
  actor.navRevision = -1;
  actor.noProgressTime = 0;
  actor.stuck = 0;
  clearReservation(actor);

  if (actor.isPlayer) {
    updateRoleStrip(actor.role);
    msg(`You are back with ${Math.ceil(actor.health)} health and one final life.`);
  } else {
    msg(`${actor.team.toUpperCase()} Runner has returned to the field.`);
  }
}

function collectTouchedHealth(actor) {
  if (!actor || actor.alive === false || !isRunnerRole(actor)) return false;
  if (actor.health >= actor.maxHealth) return false;

  const pack = items.find(item =>
    item.type === 'health' &&
    dist(actor, item) <= actor.r + item.r + 3
  );

  return pack ? pickup(actor, pack) : false;
}

function isHumanControlledActor(actor) {
  return Boolean(actor && (actor.isPlayer || actor.multiplayerHuman));
}

function collectTouchedSpeed(actor) {
  if (!actor || actor.alive === false || !isHumanControlledActor(actor)) return false;
  if ((actor.boost || 0) > 0.35) return false;

  const boost = items.find(item =>
    item.type === 'speed' &&
    isItemVisible(item) &&
    dist(actor, item) <= actor.r + item.r + 3
  );

  return boost ? pickup(actor, boost) : false;
}

const combatTickBase = tick;
tick = function combatTick(dt) {
  combatTickBase(dt);
  if (state.over || !ACTORS) return;

  for (const actor of ACTORS) {
    actor.shootCooldown = Math.max(0, actor.shootCooldown - dt);
    actor.damageFlash = Math.max(0, actor.damageFlash - dt);
    collectTouchedHealth(actor);
    collectTouchedSpeed(actor);

    if (isRunnerRole(actor) &&
      actor.alive === false &&
      actor.respawnTimer > 0) {
      actor.respawnTimer = Math.max(0, actor.respawnTimer - dt);
      if (actor.respawnTimer <= 0) respawnRaider(actor);
    }
  }

  const soloLetterCargo = Boolean(
    globalThis.isSoloFieldRunActive?.() && player?.inv?.type === 'letter'
  );
  if (playerSentryFireHeld && player &&
    player.alive !== false &&
    typeof isInnerSentry === 'function' &&
    isInnerSentry(player) &&
    (!player.inv || soloLetterCargo) &&
    !state.paused &&
    !state.over) {
    const nearbyDutyBomb = typeof nearestDutyBomb === 'function'
      ? nearestDutyBomb(
          player,
          player.r + CONFIG.ITEM_RADIUS_OTHER + CONFIG.PICKUP_RANGE_PAD + 8
        )
      : null;

    // A nearby bomb keeps the action button dedicated to disarming. Otherwise
    // holding Fire/Space repeatedly shoots as soon as the pointed target is legal.
    if (!nearbyDutyBomb) {
      const target = directionalDefenderTarget(player);
      if (target) shootDefender(player, false, target);
    }
  }

  for (const defender of ACTORS) {
    updateDefenderFireControl(defender, dt);
  }

  updateBullets(dt);

  combatSupplyTimer -= dt;
  if (combatSupplyTimer <= 0) {
    if (combatItemCount('health') < CONFIG.MAX_HEALTH_ITEMS) {
      spawnCombatItem('health');
    }

    if (combatItemCount('gun') < CONFIG.MAX_GUN_ITEMS &&
      Math.random() < 0.48) {
      spawnCombatItem('gun');
    }

    combatSupplyTimer = CONFIG.COMBAT_SUPPLY_CHECK;
  }
};

const combatDrawActorsBase = drawActors;
drawActors = function combatDrawActors(alpha = 1) {
  if (!ACTORS) return;

  const fullRoster = ACTORS;
  ACTORS = fullRoster.filter(actor => actor.alive !== false);

  try {
    combatDrawActorsBase(alpha);
  } finally {
    ACTORS = fullRoster;
  }

  for (const actor of fullRoster) {
    if (actor.alive === false) continue;

    const x = actor.prevX + (actor.x - actor.prevX) * alpha;
    const y = actor.prevY + (actor.y - actor.prevY) * alpha;
    const width = 28;
    const height = 4;
    const barY = y + actor.r + 8;

    ctx.save();

    // Only Runners are shootable, so only Runners show health and lives.
    if (isRunnerRole(actor)) {
      const ratio = clamp(actor.health / actor.maxHealth, 0, 1);
      ctx.fillStyle = '#111c';
      ctx.fillRect(x - width / 2, barY, width, height);
      ctx.fillStyle = ratio > 0.5
        ? '#42d66b'
        : ratio > 0.25
          ? '#f1c84b'
          : '#ef5350';
      ctx.fillRect(x - width / 2, barY, width * ratio, height);
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 1;
      ctx.strokeRect(x - width / 2, barY, width, height);
    }

    if (actor.damageFlash > 0 && isRunnerRole(actor)) {
      ctx.beginPath();
      ctx.arc(x, y, actor.r + 5, 0, Math.PI * 2);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    if (typeof isInnerSentry === 'function' &&
      isInnerSentry(actor) &&
      actor.weaponTier >= 2 &&
      actor.gunAmmo > 0) {
      ctx.fillStyle = '#8fd3ff';
      ctx.font = 'bold 7px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`R${actor.gunAmmo}`, x, y + actor.r + 12);
    }

    if (isRunnerRole(actor)) {
      ctx.fillStyle = '#f4f6fb';
      ctx.font = 'bold 7px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(
        `${Math.max(0, actor.lives)} ${actor.lives === 1 ? 'life' : 'lives'}`,
        x,
        barY + 12
      );
    }

    if (typeof isInnerSentry === 'function' &&
      isInnerSentry(actor) &&
      actor.combatAimTarget?.alive !== false &&
      actor.combatAimTimer > 0) {
      const target = actor.combatAimTarget;
      const pulse = 1 + Math.sin(simTime * 14) * 0.12;

      ctx.beginPath();
      ctx.arc(
        target.x,
        target.y,
        (target.r + 7) * pulse,
        0,
        Math.PI * 2
      );
      ctx.strokeStyle = '#ffc45caa';
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#ffc45c';
      ctx.font = 'bold 7px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('AIM', x, y - actor.r - 10);
    }

    ctx.restore();
  }
};

function drawPlayerSentryAim(alpha = 1) {
  const soloLetterCargo = Boolean(
    globalThis.isSoloFieldRunActive?.() && player?.inv?.type === 'letter'
  );
  if (!player || player.alive === false || state.over ||
    typeof isInnerSentry !== 'function' ||
    !isInnerSentry(player) || (player.inv && !soloLetterCargo) ||
    !insideRect(player, BASES[player.team])) return;

  const aim = sentryAimVector(player);
  const target = directionalDefenderTarget(player);
  const profile = weaponProfile(player);
  const playerX = player.prevX + (player.x - player.prevX) * alpha;
  const playerY = player.prevY + (player.y - player.prevY) * alpha;
  const startX = playerX + aim.x * (player.r + 6);
  const startY = playerY + aim.y * (player.r + 6);
  const targetX = target
    ? target.prevX + (target.x - target.prevX) * alpha
    : null;
  const targetY = target
    ? target.prevY + (target.y - target.prevY) * alpha
    : null;
  const targetDistance = target
    ? Math.hypot(targetX - playerX, targetY - playerY)
    : 0;
  const aimLength = target
    ? Math.min(profile.range, targetDistance)
    : Math.min(profile.range, CONFIG.SENTRY_PLAYER_AIM_LINE);
  const endX = target ? targetX : startX + aim.x * aimLength;
  const endY = target ? targetY : startY + aim.y * aimLength;
  const ready = Boolean(target) && player.shootCooldown <= 0;

  ctx.save();
  ctx.globalAlpha = target ? 0.82 : 0.34;
  ctx.strokeStyle = target ? (ready ? '#ffe46b' : '#ffc45c') : '#f7e79a';
  ctx.lineWidth = target ? 2.5 : 1.5;
  ctx.setLineDash(target ? [] : [5, 7]);
  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.lineTo(endX, endY);
  ctx.stroke();
  ctx.setLineDash([]);

  if (target) {
    const pulse = 1 + Math.sin(simTime * 12) * 0.08;
    ctx.beginPath();
    ctx.arc(targetX, targetY, (target.r + 7) * pulse, 0, Math.PI * 2);
    ctx.strokeStyle = ready ? '#ffe46b' : '#ffc45c';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.restore();
}

const combatDrawBase = draw;
draw = function combatDraw(alpha = 1) {
  combatDrawBase(alpha);
  drawPlayerSentryAim(alpha);
  drawBullets();
};

// Browser-console diagnostics:
// __wordWarsCombatDebug.status()
// __wordWarsCombatDebug.tryPlayerShot()
window.__wordWarsCombatDebug = {
  status() {
    if (!player) {
      return { enabled: false, reason: 'No player has spawned.' };
    }

    const target = defenderShootTarget(player);
    const profile = weaponProfile(player);

    return {
      enabled:
        typeof isInnerSentry === 'function' &&
        isInnerSentry(player) &&
        player.alive !== false,
      role: player.role,
      alive: player.alive !== false,
      cooldown: player.shootCooldown,
      carrying: player.inv?.type || null,
      weapon: profile.name,
      range: profile.range,
      targetFound: Boolean(target),
      directionalAim: player.isPlayer ? sentryAimVector(player) : null,
      fireHeld: playerSentryFireHeld,
      targetDistance: target ? dist(player, target) : null,
      targetVisible: target ? actorsCanSee(player, target) : null,
      clearShot: target ? clearShotLine(player, target) : null,
      bulletsActive: bullets.length,
    };
  },

  tryPlayerShot() {
    return shootDefender(player, true);
  },
};

