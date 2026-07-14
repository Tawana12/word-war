'use strict';

// ================================================================
// MERGED ROLE ADAPTER
// Public game roles:
//   RUNNER   = Operator + Raider
//   GUARDIAN = Builder + Defender
//   SABOTEUR = Bomber
//
// Existing gameplay systems still contain proven legacy capability logic.
// This adapter selects the correct capability for each action/AI decision
// while keeping one stable public role for rendering and multiplayer state.
// ================================================================

function publicRoleOf(actor) {
  return actor?.publicRole || actor?.role;
}

const RAID_RULES = Object.freeze({
  OPENING_DELAY: 12,
  TEAM_COOLDOWN: 8.5,
  FAILED_COOLDOWN: 5.5,
  TASK_TIME: 4.4,
  WINDOW_PERIOD: 20,
  WINDOW_START: 16.4,
  MIN_ENEMY_LETTERS: 2,
});

state.raidControl = state.raidControl || {
  blue: { activeActor: null, cooldownUntil: 0 },
  red: { activeActor: null, cooldownUntil: 0 },
};

function raidControlFor(team) {
  return state.raidControl[team];
}

function cleanupRaidControl(team) {
  const control = raidControlFor(team);
  const active = control.activeActor;

  if (!active) return control;

  const stillRaiding =
    active.alive !== false &&
    active.team === team &&
    isRunnerRole(active) &&
    (active.inv?.stolen || active.aiRole === 'RAIDER');

  if (!stillRaiding) control.activeActor = null;
  return control;
}

function beginTeamRaid(actor) {
  if (!actor) return false;
  const control = cleanupRaidControl(actor.team);
  if (control.activeActor && control.activeActor !== actor) return false;
  if (simTime < control.cooldownUntil && !actor.inv?.stolen) return false;
  control.activeActor = actor;
  return true;
}

function finishTeamRaid(actorOrTeam, cooldown = RAID_RULES.TEAM_COOLDOWN) {
  const team = typeof actorOrTeam === 'string'
    ? actorOrTeam
    : actorOrTeam?.team;
  if (!team || !state.raidControl[team]) return;

  const control = state.raidControl[team];
  if (typeof actorOrTeam === 'string' ||
    !control.activeActor ||
    control.activeActor === actorOrTeam) {
    control.activeActor = null;
    control.cooldownUntil = Math.max(
      control.cooldownUntil,
      simTime + cooldown
    );
  }
}

function nearestActionItem(actor, types) {
  return preferredActionItem(actor, item =>
    types.includes(item.type) && isItemVisible(item)
  );
}

function runnerActionCapability(actor) {
  if (actor.inv?.stolen) return 'RAIDER';
  if (actor.inv?.type === 'letter') return 'OPERATOR';

  if (!actor.inv) {
    // Nearby loose letters take priority over raiding a word slot. Without
    // this check, a Runner near the enemy grid could be routed into the
    // Raider action and appear unable to collect the highlighted field tile.
    const nearbyLetter = nearestActionItem(
      actor,
      ['letter', 'intel', 'golden']
    );
    if (nearbyLetter) return 'OPERATOR';

    const enemyTeam = otherTeam(actor.team);
    const enemySlot = enemyLetterSlot(actor, enemyTeam);

    if (enemySlot && dist(actor, enemySlot) <= CONFIG.DEPOSIT_RANGE + 18) {
      return 'RAIDER';
    }

    if (actor.health < actor.maxHealth &&
      nearestActionItem(actor, ['health'])) {
      return 'RAIDER';
    }
  }

  return 'OPERATOR';
}

function guardianActionCapability(actor) {
  if (typeof isInnerSentry === 'function' && isInnerSentry(actor)) {
    return 'DEFENDER';
  }

  if (actor.inv?.type === 'wall') return 'BUILDER';
  if (actor.inv?.type === 'bomb') return 'DEFENDER';

  if (!actor.inv) {
    const armedBomb = nearestActionItem(actor, ['bomb']);
    if (armedBomb?.ignited &&
      (!insideRect(armedBomb, BASES[actor.team]) ||
        typeof isOuterWarden !== 'function' ||
        !isOuterWarden(actor))) {
      return 'DEFENDER';
    }

    const wallItem = nearestActionItem(actor, ['wall']);
    if (wallItem) return 'BUILDER';

    const ownWall = walls.find(wall =>
      wall.team === actor.team &&
      Math.hypot(
        actor.x - (wall.x + wall.w / 2),
        actor.y - (wall.y + wall.h / 2)
      ) < 52
    );
    if (ownWall) return 'BUILDER';
  }

  // Warden contact defence uses the Defender capability but never shoots.
  return 'DEFENDER';
}

function actionCapabilityFor(actor) {
  const role = publicRoleOf(actor);
  if (role === 'RUNNER') return runnerActionCapability(actor);
  if (role === 'GUARDIAN') return guardianActionCapability(actor);
  if (role === 'SABOTEUR') return 'BOMBER';
  return actor.role;
}

const mergedRoleActionBase = action;
action = function mergedRoleAction(actor) {
  if (!actor) return;
  const capability = actionCapabilityFor(actor);
  return withTemporaryRole(
    actor,
    capability,
    () => mergedRoleActionBase(actor)
  );
};

function visibleNeededLetterExists(bot) {
  const missing = getMissingLetters(bot.team);
  return items.some(item =>
    item.type === 'letter' &&
    isItemVisible(item) &&
    missing.includes(item.char)
  );
}

function runnerBotCapability(bot) {
  const control = cleanupRaidControl(bot.team);

  if (bot.inv?.stolen) {
    beginTeamRaid(bot);
    return 'RAIDER';
  }

  if (bot.inv?.type === 'letter') return 'OPERATOR';

  if (bot.health <= bot.maxHealth * 0.62 &&
    items.some(item => item.type === 'health')) {
    return 'RAIDER';
  }

  // Continue a committed raid briefly, but never allow both team Runners
  // to become Raiders at the same time.
  if (bot.aiRole === 'RAIDER' && simTime < (bot.hybridTaskUntil || 0)) {
    if (beginTeamRaid(bot)) return 'RAIDER';
    return 'OPERATOR';
  }

  if (bot.aiRole === 'RAIDER' && simTime >= (bot.hybridTaskUntil || 0)) {
    finishTeamRaid(bot, RAID_RULES.FAILED_COOLDOWN);
  }

  if (bot.aiRole === 'OPERATOR' && simTime < (bot.hybridTaskUntil || 0)) {
    return 'OPERATOR';
  }

  const enemyTeam = otherTeam(bot.team);
  const enemyLetterCount = getProgress(enemyTeam)
    .filter(Boolean).length;
  const ownUsefulLetterAvailable = visibleNeededLetterExists(bot);
  const raidWindow =
    ((simTime + bot.patrolPhase * 2.7) % RAID_RULES.WINDOW_PERIOD) >
    RAID_RULES.WINDOW_START;

  const anotherRaiderActive = Boolean(
    control.activeActor && control.activeActor !== bot
  );

  const canRaid =
    simTime >= RAID_RULES.OPENING_DELAY &&
    simTime >= control.cooldownUntil &&
    !anotherRaiderActive &&
    enemyLetterCount >= RAID_RULES.MIN_ENEMY_LETTERS &&
    (!ownUsefulLetterAvailable || raidWindow);

  if (canRaid && beginTeamRaid(bot)) {
    bot.hybridTaskUntil = simTime + RAID_RULES.TASK_TIME;
    return 'RAIDER';
  }

  bot.hybridTaskUntil = simTime + 6.5;
  return 'OPERATOR';
}

function guardianBotCapability(bot) {
  if (typeof isInnerSentry === 'function' && isInnerSentry(bot)) {
    return 'DEFENDER';
  }

  if (bot.inv?.type === 'bomb') return 'DEFENDER';
  if (bot.inv?.type === 'wall') return 'BUILDER';

  const base = BASES[bot.team];
  const baseCenter = {
    x: base.x + base.w / 2,
    y: base.y + base.h / 2,
  };

  const outsideBomb = !isTeamJammed(bot.team) && items.some(item =>
    item.type === 'bomb' &&
    item.ignited &&
    !insideRect(item, base) &&
    (item.pickupLockedUntil || 0) <= simTime &&
    Math.hypot(item.x - baseCenter.x, item.y - baseCenter.y) < 325
  );

  const outsideRunnerThreat = (ACTORS || []).some(actor =>
    actor.team !== bot.team &&
    isRunnerRole(actor) &&
    actor.alive !== false &&
    !insideRect(actor, base) &&
    isRaiderThreatToTeam(actor, bot.team) &&
    actorsCanSee(bot, actor)
  );

  if (outsideBomb || outsideRunnerThreat) return 'DEFENDER';
  return 'BUILDER';
}

function botCapabilityFor(bot) {
  const role = publicRoleOf(bot);
  if (role === 'RUNNER') return runnerBotCapability(bot);
  if (role === 'GUARDIAN') return guardianBotCapability(bot);
  if (role === 'SABOTEUR') return 'BOMBER';
  return bot.role;
}

const mergedRoleChooseBase = choose;
choose = function mergedRoleChoose(bot) {
  const capability = botCapabilityFor(bot);
  bot.aiRole = capability;
  return withTemporaryRole(
    bot,
    capability,
    () => mergedRoleChooseBase(bot)
  );
};

const mergedRoleUpdateBotBase = updateBot;
updateBot = function mergedRoleUpdateBot(bot, dt) {
  const capability = bot.aiRole || botCapabilityFor(bot);
  return withTemporaryRole(
    bot,
    capability,
    () => mergedRoleUpdateBotBase(bot, dt)
  );
};

window.__wordWarsRoles = {
  publicRoleOf,
  actionCapabilityFor,
  botCapabilityFor,
  raidControl: state.raidControl,
  beginTeamRaid,
  finishTeamRaid,
};
