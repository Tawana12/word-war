'use strict';

// ================================================================
// DEVVIT KARMA BRIDGE
// Tracks the local player's role contribution and reports completed rounds
// to the parent React/Devvit shell. The server calculates the final Karma;
// this file never sends an arbitrary score value.
// ================================================================
(() => {
  const emptyStats = () => ({
    activeSeconds: 0,
    powerupsPicked: 0,
    usefulLettersPicked: 0,
    lettersPlaced: 0,
    correctLettersPlaced: 0,
    stolenLetters: 0,
    stolenDelivered: 0,
    cluesCollected: 0,
    shotsHit: 0,
    damageDealt: 0,
    eliminations: 0,
    carrierStops: 0,
    bombsDefused: 0,
    bricksPicked: 0,
    wallsBuilt: 0,
    rebuiltWalls: 0,
    blocks: 0,
    forcedDrops: 0,
    bombsPicked: 0,
    bombsPlanted: 0,
    wallsDestroyed: 0,
    lettersScattered: 0,
  });

  const tracker = {
    roundIndex: 0,
    roundStartedAt: performance.now(),
    stats: emptyStats(),
    reportedRounds: new Set(),
  };

  function roleKey(actor = player) {
    if (!actor) return 'RUNNER';
    const role = typeof publicRoleOf === 'function'
      ? publicRoleOf(actor)
      : (actor.publicRole || actor.role);
    if (role === 'GUARDIAN') {
      return actor.guardianDuty === 'WARDEN'
        ? 'OUTER_WARDEN'
        : 'INNER_SENTRY';
    }
    if (role === 'CAPTAIN') return 'CAPTAIN';
    if (role === 'SABOTEUR' || role === 'BOMBER') return 'SABOTEUR';
    return 'RUNNER';
  }

  function post(type, payload = {}) {
    window.parent.postMessage({ source: 'word-wars', type, ...payload }, '*');
  }

  function beginRound(index) {
    tracker.roundIndex = Number.isFinite(index) ? index : 0;
    tracker.roundStartedAt = performance.now();
    tracker.stats = emptyStats();
  }

  function outcomeFor(winnerTeam) {
    if (!winnerTeam) return 'draw';
    return winnerTeam === player?.team ? 'win' : 'loss';
  }

  function matchOutcome() {
    if (!state.demoMatch?.finished || !player) return null;
    const own = state.demoMatch.score[player.team] || 0;
    const enemy = state.demoMatch.score[otherTeam(player.team)] || 0;
    return own > enemy ? 'win' : own < enemy ? 'loss' : 'draw';
  }

  if (typeof startDemoRound === 'function') {
    const base = startDemoRound;
    startDemoRound = function karmaStartDemoRound(index = 0, options = {}) {
      const result = base(index, options);
      beginRound(index);
      return result;
    };
  }

  if (typeof startSoloWord === 'function') {
    const base = startSoloWord;
    startSoloWord = function karmaStartSoloWord(index = 0) {
      const result = base(index);
      beginRound(index);
      return result;
    };
    globalThis.startSoloWord = startSoloWord;
  }

  if (typeof startGame === 'function') {
    const base = startGame;
    startGame = function karmaStartGame(playerRole, playerDuty = null) {
      tracker.reportedRounds.clear();
      post('match-start', {
        mode: selectedSessionMode === SESSION_MODES.MULTIPLAYER
          ? 'multiplayer'
          : 'solo',
      });
      return base(playerRole, playerDuty);
    };
  }

  if (typeof pickup === 'function') {
    const base = pickup;
    pickup = function karmaPickup(actor, item) {
      if (!actor || !item) return base(actor, item);
      const usefulLetter =
        actor.isPlayer && item.type === 'letter' &&
        typeof getMissingLetters === 'function' &&
        getMissingLetters(actor.team).includes(item.char);
      const armedBomb = item.type === 'bomb' && item.ignited;
      const type = item.type;
      const result = base(actor, item);

      if (!result || !actor.isPlayer) return result;
      if (type === 'letter' && usefulLetter) tracker.stats.usefulLettersPicked += 1;
      if (type === 'intel') tracker.stats.cluesCollected += 1;
      if (type === 'wall') tracker.stats.bricksPicked += 1;
      if (type === 'bomb' && !armedBomb) tracker.stats.bombsPicked += 1;
      if (type === 'bomb' && armedBomb) tracker.stats.bombsDefused += 1;
      if (['speed', 'health', 'gun', 'golden'].includes(type)) {
        tracker.stats.powerupsPicked += 1;
      }
      return result;
    };
  }

  if (typeof deposit === 'function') {
    const base = deposit;
    deposit = function karmaDeposit(actor) {
      const carried = actor?.inv?.type === 'letter' ? actor.inv.char : null;
      const slot = actor?.isPlayer && carried
        ? slotFromHorizontalPosition(actor, actor.team)
        : null;
      const correct = Boolean(
        slot && carried && getTeamWord(actor.team)[slot.index] === carried
      );
      const result = base(actor);
      if (result && actor?.isPlayer) {
        tracker.stats.lettersPlaced += 1;
        if (correct) tracker.stats.correctLettersPlaced += 1;
      }
      return result;
    };
  }

  if (typeof takeEnemySlottedLetter === 'function') {
    const base = takeEnemySlottedLetter;
    takeEnemySlottedLetter = function karmaSteal(actor, requestedIndex = null) {
      const result = base(actor, requestedIndex);
      if (result && actor?.isPlayer) tracker.stats.stolenLetters += 1;
      return result;
    };
  }

  if (typeof dropStolenLetter === 'function') {
    const base = dropStolenLetter;
    dropStolenLetter = function karmaDeliverStolen(actor) {
      const wasStolen = Boolean(actor?.inv?.stolen);
      const result = base(actor);
      if (result && actor?.isPlayer && wasStolen) {
        tracker.stats.stolenDelivered += 1;
      }
      return result;
    };
  }

  if (typeof repair === 'function') {
    const base = repair;
    repair = function karmaRepair(actor) {
      const result = base(actor);
      if (result && actor?.isPlayer) {
        tracker.stats.wallsBuilt += 1;
        if (simTime > 24) tracker.stats.rebuiltWalls += 1;
      }
      return result;
    };
  }

  if (typeof armOrDrop === 'function') {
    const base = armOrDrop;
    armOrDrop = function karmaArmOrDrop(actor) {
      const planting = Boolean(
        actor?.isPlayer && actor.inv?.type === 'bomb' &&
        (roleKey(actor) === 'SABOTEUR')
      );
      const result = base(actor);
      if (planting) tracker.stats.bombsPlanted += 1;
      return result;
    };
  }

  if (typeof performDefenderIntercept === 'function') {
    const base = performDefenderIntercept;
    performDefenderIntercept = function karmaIntercept(defender, intruder) {
      const carriedStolen = Boolean(intruder?.inv?.stolen);
      const result = base(defender, intruder);
      if (result && defender?.isPlayer) {
        tracker.stats.blocks += 1;
        if (carriedStolen && !intruder?.inv?.stolen) tracker.stats.forcedDrops += 1;
      }
      return result;
    };
  }

  if (typeof damageRaider === 'function') {
    const base = damageRaider;
    damageRaider = function karmaDamageRaider(raider, damage, killer) {
      const before = Math.max(0, raider?.health || 0);
      const carryingStolen = Boolean(raider?.inv?.stolen);
      const result = base(raider, damage, killer);
      if (killer?.isPlayer && before > 0) {
        const dealt = Math.min(before, Math.max(0, damage || 0));
        tracker.stats.shotsHit += 1;
        tracker.stats.damageDealt += Math.round(dealt);
        if (raider?.health <= 0) {
          tracker.stats.eliminations += 1;
          if (carryingStolen) tracker.stats.carrierStops += 1;
        }
      }
      return result;
    };
  }

  if (typeof explode === 'function') {
    const base = explode;
    explode = function karmaExplosion(bomb) {
      const playerBomb = Boolean(
        player && (bomb?.droppedBy === player || bomb?.owner === player)
      );
      const enemyTeam = player ? otherTeam(player.team) : null;
      const wallsBefore = playerBomb && enemyTeam
        ? walls.filter(wall => wall.team === enemyTeam).length
        : 0;
      const lettersBefore = playerBomb && enemyTeam
        ? getProgress(enemyTeam).filter(Boolean).length
        : 0;
      const result = base(bomb);
      if (playerBomb && enemyTeam) {
        const wallsAfter = walls.filter(wall => wall.team === enemyTeam).length;
        const lettersAfter = getProgress(enemyTeam).filter(Boolean).length;
        tracker.stats.wallsDestroyed += Math.max(0, wallsBefore - wallsAfter);
        tracker.stats.lettersScattered += Math.max(0, lettersBefore - lettersAfter);
      }
      return result;
    };
  }

  if (typeof finishSoloWord === 'function') {
    const base = finishSoloWord;
    finishSoloWord = function karmaFinishSoloWord(success, reason = '') {
      const index = state.soloRun?.roundIndex ?? tracker.roundIndex;
      const alreadyResolving = Boolean(state.soloRun?.resolving || state.soloRun?.finished);
      const result = base(success, reason);

      if (!alreadyResolving && !tracker.reportedRounds.has(index)) {
        tracker.reportedRounds.add(index);
        tracker.stats.activeSeconds = Math.max(
          0,
          Math.min(120, Math.round((performance.now() - tracker.roundStartedAt) / 1000))
        );
        const finished = Boolean(state.soloRun?.finished);
        post('round-complete', {
          payload: {
            roundIndex: index,
            role: 'CAPTAIN',
            outcome: success ? 'win' : 'loss',
            matchFinished: finished,
            matchOutcome: finished ? (success ? 'win' : 'loss') : null,
            stats: { ...tracker.stats },
          },
        });
      }
      return result;
    };
    globalThis.finishSoloWord = finishSoloWord;
  }

  if (typeof finishDemoRound === 'function') {
    const base = finishDemoRound;
    finishDemoRound = function karmaFinishDemoRound(winnerTeam, reason = '') {
      const index = state.demoMatch?.roundIndex ?? tracker.roundIndex;
      const alreadyResolving = Boolean(
        state.demoMatch?.resolving || state.demoMatch?.finished
      );
      const result = base(winnerTeam, reason);

      if (!alreadyResolving && !tracker.reportedRounds.has(index)) {
        tracker.reportedRounds.add(index);
        tracker.stats.activeSeconds = Math.max(
          0,
          Math.min(120, Math.round((performance.now() - tracker.roundStartedAt) / 1000))
        );
        const authoritativeStats = selectedSessionMode === SESSION_MODES.MULTIPLAYER
          ? globalThis.getMultiplayerLocalStats?.()
          : null;
        const roundStats = authoritativeStats
          ? { ...tracker.stats, ...authoritativeStats, activeSeconds: tracker.stats.activeSeconds }
          : { ...tracker.stats };
        post('round-complete', {
          payload: {
            roundIndex: index,
            role: roleKey(player),
            outcome: outcomeFor(winnerTeam),
            matchFinished: Boolean(state.demoMatch?.finished),
            matchOutcome: matchOutcome(),
            stats: roundStats,
          },
        });
      }
      return result;
    };
  }

  if (globalThis.returnToMainMenu) {
    const base = globalThis.returnToMainMenu;
    globalThis.returnToMainMenu = function karmaReturnToMainMenu() {
      post('match-abandon');
      tracker.reportedRounds.clear();
      return base();
    };
  }
})();
