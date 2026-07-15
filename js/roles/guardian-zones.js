'use strict';

// ================================================================
// LAYERED GUARDIAN DEFENCE
// SENTRY: remains inside its own base, is the only shooter and fires only
// at enemy Runners who cross the centre line into its team territory.
// WARDEN: remains outside, builds/repairs, carries exterior bombs away
// and physically intercepts Runners around the perimeter.
// ================================================================

const GUARDIAN_DUTIES = Object.freeze({
  SENTRY: 'SENTRY',
  WARDEN: 'WARDEN',
});

function guardianDutyOf(actor) {
  return actor?.guardianDuty || null;
}

function isInnerSentry(actor) {
  return isGuardianRole(actor) &&
    guardianDutyOf(actor) === GUARDIAN_DUTIES.SENTRY;
}

function isOuterWarden(actor) {
  return isGuardianRole(actor) &&
    guardianDutyOf(actor) === GUARDIAN_DUTIES.WARDEN;
}

function setGuardianDuty(actor, duty) {
  if (!actor || !isGuardianRole(actor)) return actor;

  actor.guardianDuty = duty === GUARDIAN_DUTIES.WARDEN
    ? GUARDIAN_DUTIES.WARDEN
    : GUARDIAN_DUTIES.SENTRY;
  actor.guardianZoneManaged = true;

  if (isInnerSentry(actor)) {
    actor.weaponTier = Math.max(1, actor.weaponTier || 0);
  } else {
    actor.weaponTier = 0;
    actor.gunAmmo = 0;
    actor.combatAimTarget = null;
    actor.combatAimTimer = 0;
    actor.burstRemaining = 0;
  }

  return actor;
}

function guardianFrontPosition(actor) {
  const base = BASES[actor.team];
  const side = actor.team === 'blue' ? 1 : -1;
  const wallDepth = CONFIG.WALL_SIZE + actor.r + 8;

  return {
    x: side > 0
      ? base.x + base.w + wallDepth
      : base.x - wallDepth,
    y: base.y + base.h / 2,
  };
}

function placeGuardianForDuty(actor) {
  if (!actor || !isGuardianRole(actor)) return;
  const base = BASES[actor.team];
  let point;

  if (isInnerSentry(actor)) {
    point = {
      x: base.x + base.w / 2,
      y: base.y + base.h / 2 + 45,
    };
  } else {
    point = guardianFrontPosition(actor);
  }

  actor.x = point.x;
  actor.y = point.y;
  actor.prevX = point.x;
  actor.prevY = point.y;
  actor.vx = 0;
  actor.vy = 0;
  actor.target = null;
  actor.targetItem = null;
  actor.navPath = [];
  actor.navPathIndex = 0;
}

function clampSentryInside(actor) {
  const base = BASES[actor.team];
  const margin = actor.r + 5;
  const nextX = clamp(actor.x, base.x + margin, base.x + base.w - margin);
  const nextY = clamp(actor.y, base.y + margin, base.y + base.h - margin);

  if (nextX !== actor.x) actor.vx = 0;
  if (nextY !== actor.y) actor.vy = 0;
  actor.x = nextX;
  actor.y = nextY;
}

function keepWardenOutside(actor) {
  if (!insideRect(actor, BASES[actor.team])) return;
  const point = guardianFrontPosition(actor);
  actor.x = point.x;
  actor.y = clamp(
    actor.y,
    BASES[actor.team].y + actor.r + 10,
    BASES[actor.team].y + BASES[actor.team].h - actor.r - 10
  );
  actor.prevX = actor.x;
  actor.prevY = actor.y;
  actor.vx = 0;
  actor.vy = 0;
  actor.target = null;
  actor.navPath = [];
  actor.navPathIndex = 0;

  if (actor.isPlayer) {
    msg('Outer Warden cannot enter the word grid. Guard the perimeter.');
  }
}

function enforceGuardianZone(actor) {
  if (!actor || actor.alive === false || !isGuardianRole(actor)) return;
  if (isInnerSentry(actor)) clampSentryInside(actor);
  if (isOuterWarden(actor)) keepWardenOutside(actor);
}

function bombMatchesDuty(item, actor) {
  if (!item || item.type !== 'bomb' || !item.ignited) return false;
  if ((item.pickupLockedUntil || 0) > simTime) return false;
  const inside = insideRect(item, BASES[actor.team]);
  return isInnerSentry(actor) ? inside : !inside;
}

function nearestDutyBomb(actor, range = Infinity) {
  let result = null;
  let best = range;

  for (const item of items) {
    if (!bombMatchesDuty(item, actor)) continue;
    if (isReservedByOther(actor, item)) continue;
    const distance = dist(actor, item);
    if (distance < best) {
      best = distance;
      result = item;
    }
  }
  return result;
}

function disarmInsideBomb(actor, bomb, announce = true) {
  if (!actor || !bomb || !isInnerSentry(actor)) return false;
  if (!items.includes(bomb) || !bombMatchesDuty(bomb, actor)) return false;

  clearReservation(actor);
  removeItem(bomb);
  actor.sentryBombTarget = null;
  actor.sentryDisarmTimer = 0;
  actor.target = null;
  actor.targetCommit = 0;
  actor.thinkTimer = 0;

  slotEffects.push({
    x: bomb.x,
    y: bomb.y,
    color: '#8fd3ff',
    time: CONFIG.SLOT_EFFECT_TIME,
    world: true,
  });

  if (announce) {
    msg(`${actor.team.toUpperCase()} INNER SENTRY DISARMED A GRID BOMB.`);
  }
  return true;
}

// Duty-specific item permissions.
const guardianZoneCollectBase = canActorCollectItem;
canActorCollectItem = function guardianZoneCanCollect(actor, item) {
  if (!actor || !item || !isGuardianRole(actor)) {
    return guardianZoneCollectBase(actor, item);
  }

  if (item.type === 'gun') {
    return isInnerSentry(actor) && guardianZoneCollectBase(actor, item);
  }

  if (item.type === 'wall') {
    return isOuterWarden(actor) && guardianZoneCollectBase(actor, item);
  }

  if (item.type === 'bomb' && item.ignited) {
    if (isInnerSentry(actor)) return false; // Sentry disarms directly.
    if (insideRect(item, BASES[actor.team])) return false;
  }

  return guardianZoneCollectBase(actor, item);
};

const guardianZoneRoleLabelBase = getItemRoleLabel;
getItemRoleLabel = function guardianZoneRoleLabel(item) {
  if (item?.type === 'gun') return 'Inner Sentry only';
  if (item?.type === 'wall') return 'Outer Warden only';
  return guardianZoneRoleLabelBase(item);
};

// Human Sentry: Space disarms a nearby interior bomb before attempting a shot.
const guardianZoneActionBase = action;
action = function guardianZoneAction(actor) {
  if (isInnerSentry(actor)) {
    const bomb = nearestDutyBomb(
      actor,
      actor.r + CONFIG.ITEM_RADIUS_OTHER + CONFIG.PICKUP_RANGE_PAD + 8
    );
    if (bomb && disarmInsideBomb(actor, bomb, true)) return;
  }
  return guardianZoneActionBase(actor);
};

// Capability routing used by merged-roles.js.
const guardianZoneActionCapabilityBase = actionCapabilityFor;
actionCapabilityFor = function guardianZoneActionCapability(actor) {
  if (isInnerSentry(actor)) return 'DEFENDER';
  return guardianZoneActionCapabilityBase(actor);
};

const guardianZoneBotCapabilityBase = botCapabilityFor;
botCapabilityFor = function guardianZoneBotCapability(bot) {
  if (isInnerSentry(bot)) return 'DEFENDER';
  if (isOuterWarden(bot)) {
    if (bot.inv?.type === 'bomb') return 'DEFENDER';
    if (bot.inv?.type === 'wall') return 'BUILDER';

    const outsideBomb = nearestDutyBomb(bot, 340);
    const outsideThreat = (ACTORS || []).some(actor =>
      actor.alive !== false &&
      actor.team !== bot.team &&
      isOuterWardenThreat(actor, bot.team) &&
      actorsCanSee(bot, actor)
    );

    return outsideBomb || outsideThreat ? 'DEFENDER' : 'BUILDER';
  }
  return guardianZoneBotCapabilityBase(bot);
};

function isOuterWardenThreat(actor, team) {
  if (!actor || actor.alive === false || actor.team === team) return false;
  if (insideRect(actor, BASES[team])) return false;

  if (isRunnerRole(actor)) {
    return isRaiderThreatToTeam(actor, team);
  }

  if (isSaboteurRole(actor)) {
    const carryingAttackItem = ['bomb', 'jammer'].includes(actor.inv?.type);
    return insideExpandedBase(actor, team, carryingAttackItem ? 190 : 115);
  }

  return false;
}

function closestGridIntruder(sentry) {
  return (ACTORS || [])
    .filter(actor =>
      actor.alive !== false &&
      actor.team !== sentry.team &&
      isRunnerRole(actor) &&
      isTerritoryIntruder(actor, sentry.team) &&
      actorsCanSee(sentry, actor)
    )
    .sort((a, b) => {
      const aLoot = a.inv?.stolen && a.inv.stolenFrom === sentry.team ? 0 : 1;
      const bLoot = b.inv?.stolen && b.inv.stolenFrom === sentry.team ? 0 : 1;
      return (aLoot - bLoot) || (dist(sentry, a) - dist(sentry, b));
    })[0] || null;
}

function closestSentryWatchTarget(sentry) {
  return (ACTORS || [])
    .filter(actor =>
      actor.alive !== false &&
      actor.team !== sentry.team &&
      isRunnerRole(actor) &&
      actorsCanSee(sentry, actor)
    )
    .sort((a, b) => {
      const aLoot = a.inv?.stolen && a.inv.stolenFrom === sentry.team ? 0 : 1;
      const bLoot = b.inv?.stolen && b.inv.stolenFrom === sentry.team ? 0 : 1;
      return (aLoot - bLoot) || (dist(sentry, a) - dist(sentry, b));
    })[0] || null;
}

function closestOutsideThreat(warden) {
  return (ACTORS || [])
    .filter(actor =>
      actor.alive !== false &&
      actor.team !== warden.team &&
      isOuterWardenThreat(actor, warden.team) &&
      actorsCanSee(warden, actor)
    )
    .sort((a, b) => {
      const aLoot = a.inv?.stolen && a.inv.stolenFrom === warden.team ? 0 : 1;
      const bLoot = b.inv?.stolen && b.inv.stolenFrom === warden.team ? 0 : 1;
      return (aLoot - bLoot) || (dist(warden, a) - dist(warden, b));
    })[0] || null;
}

function sentryPatrolPoint(bot) {
  const base = BASES[bot.team];
  const phase = simTime * 0.48 + bot.patrolPhase;
  return {
    x: base.x + base.w / 2 + Math.cos(phase) * 70,
    y: base.y + base.h / 2 + Math.sin(phase) * 48,
  };
}

const guardianZoneChooseBase = choose;
choose = function guardianZoneChoose(bot) {
  if (!bot || !isGuardianRole(bot)) return guardianZoneChooseBase(bot);

  bot.guardianZoneManaged = true;

  if (isInnerSentry(bot)) {
    clearReservation(bot);
    bot.aiRole = 'DEFENDER';
    bot.targetItem = null;
    bot.interceptTarget = null;

    const bomb = nearestDutyBomb(bot, 320);
    if (bomb) {
      bot.mode = 'SENTRY_DISARM';
      bot.sentryBombTarget = bomb;
      reserveItem(bot, bomb);
      bot.target = { x: bomb.x, y: bomb.y };
      return;
    }

    bot.sentryBombTarget = null;
    bot.sentryDisarmTimer = 0;
    const intruder = closestGridIntruder(bot);
    if (intruder) {
      bot.sentryWatchTarget = intruder;
      bot.mode = 'SENTRY_TRACK';
      bot.target = {
        x: clamp(
          intruder.x,
          BASES[bot.team].x + bot.r + 8,
          BASES[bot.team].x + BASES[bot.team].w - bot.r - 8
        ),
        y: clamp(
          intruder.y,
          BASES[bot.team].y + bot.r + 8,
          BASES[bot.team].y + BASES[bot.team].h - bot.r - 8
        ),
      };
      return;
    }

    // A Sentry that is not under attack still has a clear job: collect a
    // rifle refill when available, then patrol while visually tracking the
    // nearest enemy Runner across the field.
    if (bot.weaponTier < 2 || bot.gunAmmo <= 4) {
      const rifle = nearest(bot, item =>
        item.type === 'gun' &&
        !isReservedByOther(bot, item) &&
        canActorCollectItem(bot, item)
      );
      if (rifle) {
        bot.sentryWatchTarget = null;
        bot.mode = 'FETCH_RIFLE';
        bot.targetItem = rifle;
        reserveItem(bot, rifle);
        bot.target = { x: rifle.x, y: rifle.y };
        return;
      }
    }

    bot.sentryWatchTarget = closestSentryWatchTarget(bot);
    bot.mode = 'SENTRY_PATROL';
    bot.target = sentryPatrolPoint(bot);
    return;
  }

  if (isOuterWarden(bot)) {
    bot.sentryBombTarget = null;
    bot.sentryDisarmTimer = 0;

    if (bot.inv) return guardianZoneChooseBase(bot);

    const outsideBomb = nearestDutyBomb(bot, 340);
    if (outsideBomb) {
      bot.aiRole = 'DEFENDER';
      bot.mode = 'DISARM';
      bot.targetItem = outsideBomb;
      reserveItem(bot, outsideBomb);
      bot.target = { x: outsideBomb.x, y: outsideBomb.y };
      return;
    }

    const threat = closestOutsideThreat(bot);
    if (threat) {
      clearReservation(bot);
      bot.aiRole = 'DEFENDER';
      bot.mode = 'INTERCEPT_RAIDER';
      bot.interceptTarget = threat;
      bot.targetItem = null;
      bot.target = { x: threat.x, y: threat.y };
      return;
    }

    bot.aiRole = 'BUILDER';
    return guardianZoneChooseBase(bot);
  }

  return guardianZoneChooseBase(bot);
};

const guardianZoneUpdateBotBase = updateBot;
updateBot = function guardianZoneUpdateBot(bot, dt) {
  guardianZoneUpdateBotBase(bot, dt);
  if (!bot || !isGuardianRole(bot)) return;

  enforceGuardianZone(bot);

  if (isInnerSentry(bot) && bot.sentryWatchTarget?.alive !== false &&
    actorsCanSee(bot, bot.sentryWatchTarget)) {
    const dx = bot.sentryWatchTarget.x - bot.x;
    const dy = bot.sentryWatchTarget.y - bot.y;
    const length = Math.hypot(dx, dy) || 1;
    const blend = 1 - Math.exp(-7.5 * dt);
    bot.facingX += (dx / length - bot.facingX) * blend;
    bot.facingY += (dy / length - bot.facingY) * blend;
    const facingLength = Math.hypot(bot.facingX, bot.facingY) || 1;
    bot.facingX /= facingLength;
    bot.facingY /= facingLength;
  }

  if (isInnerSentry(bot) && bot.mode === 'SENTRY_DISARM') {
    const bomb = bot.sentryBombTarget;
    if (!bomb || !items.includes(bomb) || !bombMatchesDuty(bomb, bot)) {
      bot.sentryBombTarget = null;
      bot.sentryDisarmTimer = 0;
      bot.target = null;
      bot.thinkTimer = 0;
      return;
    }

    if (dist(bot, bomb) <= bot.r + bomb.r + CONFIG.PICKUP_RANGE_PAD + 5) {
      bot.sentryDisarmTimer = (bot.sentryDisarmTimer || 0) + dt;
      bot.vx *= Math.exp(-14 * dt);
      bot.vy *= Math.exp(-14 * dt);
      if (bot.sentryDisarmTimer >= 0.55) {
        disarmInsideBomb(bot, bomb, true);
      }
    } else {
      bot.sentryDisarmTimer = 0;
    }
  }
};

// Enforce zones after explosions, knockback and every wrapped tick system.
const guardianZoneTickBase = tick;
tick = function guardianZoneTick(dt) {
  guardianZoneTickBase(dt);
  if (!ACTORS) return;
  for (const actor of ACTORS) enforceGuardianZone(actor);
};

const guardianZoneContextBase = getContextTarget;
getContextTarget = function guardianZoneContextTarget() {
  if (!player || !isGuardianRole(player)) return guardianZoneContextBase();

  if (isInnerSentry(player)) {
    const bomb = nearestDutyBomb(
      player,
      player.r + CONFIG.ITEM_RADIUS_OTHER + CONFIG.PICKUP_RANGE_PAD + 8
    );
    if (bomb) {
      return {
        kind: 'item',
        item: bomb,
        allowed: true,
        text: 'Space: disarm bomb inside the grid',
      };
    }
  }

  if (isOuterWarden(player)) {
    const threat = closestOutsideThreat(player);
    if (threat && dist(player, threat) < 175) {
      return {
        kind: 'raider',
        actor: threat,
        allowed: false,
        text: 'Move into the intruder to block them — Outer Warden does not shoot',
      };
    }
  }

  return guardianZoneContextBase();
};

const guardianZoneRoleStripBase = updateRoleStrip;
updateRoleStrip = function guardianZoneRoleStrip(role, requestedDuty = null) {
  guardianZoneRoleStripBase(role);
  if (role !== 'GUARDIAN' || !roleStripEl) return;

  const duty = requestedDuty || player?.guardianDuty || GUARDIAN_DUTIES.SENTRY;
  if (duty === GUARDIAN_DUTIES.WARDEN) {
    roleStripEl.innerHTML =
      `<strong>GUARDIAN — OUTER WARDEN</strong>` +
      `Build walls · remove outside bombs · block escaping Runners<br>` +
      `<span style="color:#8f9aaa">Stay outside · Contact shoves · Space = role action</span>`;
    return;
  }

  roleStripEl.innerHTML =
    `<strong>GUARDIAN — INNER SENTRY</strong>` +
    `Protect your side · shoot Runners who cross the line · disarm inside bombs<br>` +
    `<span style="color:#8f9aaa">Stay inside · Space = shoot / disarm</span>`;
};

// A subtle local-player zone marker makes the restriction readable.
const guardianZoneWorldEffectsBase = drawWorldEffects;
drawWorldEffects = function guardianZoneWorldEffects() {
  guardianZoneWorldEffectsBase();
  if (!player || !isGuardianRole(player)) return;

  const base = BASES[player.team];
  const color = player.team === 'blue' ? '64,139,255' : '255,92,92';
  ctx.save();
  ctx.setLineDash([7, 5]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = `rgba(${color},0.70)`;
  ctx.strokeRect(base.x + 4, base.y + 4, base.w - 8, base.h - 8);
  ctx.setLineDash([]);
  ctx.fillStyle = `rgba(${color},0.08)`;
  if (isInnerSentry(player)) {
    ctx.fillRect(base.x + 5, base.y + 5, base.w - 10, base.h - 10);
  }
  ctx.fillStyle = '#f7f9fccc';
  ctx.font = '900 8px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(
    isInnerSentry(player) ? 'INNER SENTRY ZONE' : 'WARDEN: STAY OUTSIDE',
    base.x + base.w / 2,
    base.y + 14
  );
  ctx.restore();
};

window.__wordWarsGuardianZones = {
  duties: GUARDIAN_DUTIES,
  isInnerSentry,
  isOuterWarden,
  setGuardianDuty,
  placeGuardianForDuty,
  enforceGuardianZone,
};
