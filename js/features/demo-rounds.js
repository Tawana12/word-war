'use strict';

const DEMO_ROUNDS = Object.freeze([
  { blue: 'TEAMWORK', red: 'TOGETHER' },
  { blue: 'KINDNESS', red: 'LAUGHTER' },
  { blue: 'COMMUNITY', red: 'BELONGING' },
  { blue: 'ADVENTURE', red: 'DISCOVERY' },
  { blue: 'COMPASSION', red: 'CONNECTION' },
]);

const roundStatusEl = document.querySelector('#roundStatus');
const roundScreenEl = document.querySelector('#roundScreen');
const resultKickerEl = document.querySelector('#resultKicker');
const resultTitleEl = document.querySelector('#resultTitle');
const resultTextEl = document.querySelector('#resultText');
const resultButtonEl = document.querySelector('#resultButton');
const nextRolePreviewEl = document.querySelector('#nextRolePreview');
const nextRoleNameEl = document.querySelector('#nextRoleName');
const nextRoleJobEl = document.querySelector('#nextRoleJob');
const currentRoleChipEl = document.querySelector('#currentRoleChip');
const roleAnnouncementEl = document.querySelector('#roleAnnouncement');
const roleAnnouncementKickerEl = document.querySelector('#roleAnnouncementKicker');
const roleAnnouncementNameEl = document.querySelector('#roleAnnouncementName');
const roleAnnouncementJobEl = document.querySelector('#roleAnnouncementJob');
let roleAnnouncementTimer = null;

state.demoMatch = {
  roundIndex: 0,
  score: { blue: 0, red: 0 },
  resolving: false,
  finished: false,
  currentAssignment: null,
  nextAssignment: null,
};

const ROUND_ROLE_ASSIGNMENTS = Object.freeze([
  {
    role: 'RUNNER',
    duty: null,
    label: 'Runner',
    job: 'Collect and arrange letters.',
  },
  {
    role: 'GUARDIAN',
    duty: 'SENTRY',
    label: 'Inner Sentry',
    job: 'Stay inside and shoot intruding Runners.',
  },
  {
    role: 'GUARDIAN',
    duty: 'WARDEN',
    label: 'Outer Warden',
    job: 'Build walls and protect the perimeter.',
  },
  {
    role: 'SABOTEUR',
    duty: null,
    label: 'Saboteur',
    job: 'Carry bombs to enemy walls.',
  },
]);

function roundAssignmentKey(assignment) {
  if (!assignment) return '';
  return `${assignment.role}:${assignment.duty || ''}`;
}

function assignmentFromActor(actor) {
  if (!actor) return null;
  const role = publicRoleOf(actor);
  const duty = role === 'GUARDIAN' ? (actor.guardianDuty || 'SENTRY') : null;
  return ROUND_ROLE_ASSIGNMENTS.find(assignment =>
    assignment.role === role && assignment.duty === duty
  ) || ROUND_ROLE_ASSIGNMENTS[0];
}

function chooseDifferentRoundAssignment(current = null) {
  const active = current || state.demoMatch.currentAssignment || assignmentFromActor(player);
  const candidates = ROUND_ROLE_ASSIGNMENTS.filter(assignment =>
    roundAssignmentKey(assignment) !== roundAssignmentKey(active)
  );
  return candidates[Math.floor(Math.random() * candidates.length)] || active;
}

function prepareNextRoundAssignment() {
  const demo = state.demoMatch;
  demo.nextAssignment = chooseDifferentRoundAssignment(
    demo.currentAssignment || assignmentFromActor(player)
  );
  return demo.nextAssignment;
}

function applyRoundAssignment(assignment) {
  const demo = state.demoMatch;
  const target = assignment || chooseDifferentRoundAssignment();
  const roster = createSessionRoster(target.role, target.duty);

  if (!roster) return demo.currentAssignment || assignmentFromActor(player);

  player = roster.player;
  bots = roster.bots;
  ACTORS = [player, ...bots];
  demo.currentAssignment = target;
  demo.nextAssignment = null;
  return target;
}

function showRoleAnnouncement(assignment, changed = false) {
  if (!assignment || !roleAnnouncementEl) return;

  if (roleAnnouncementKickerEl) {
    roleAnnouncementKickerEl.textContent = changed ? 'NEW ROLE' : 'YOUR ROLE';
  }
  if (roleAnnouncementNameEl) roleAnnouncementNameEl.textContent = assignment.label;
  if (roleAnnouncementJobEl) roleAnnouncementJobEl.textContent = assignment.job;

  roleAnnouncementEl.classList.remove('hidden', 'show');
  void roleAnnouncementEl.offsetWidth;
  roleAnnouncementEl.classList.add('show');

  clearTimeout(roleAnnouncementTimer);
  roleAnnouncementTimer = setTimeout(() => {
    roleAnnouncementEl.classList.remove('show');
    setTimeout(() => roleAnnouncementEl.classList.add('hidden'), 180);
  }, changed ? 2600 : 1800);
}

function updateRoundHud() {
  const demo = state.demoMatch;
  if (roundStatusEl) {
    roundStatusEl.textContent =
      `Round ${demo.roundIndex + 1}/${DEMO_ROUNDS.length} · ` +
      `${demo.score.blue}–${demo.score.red}`;
  }

  const assignment = demo.currentAssignment || assignmentFromActor(player);
  if (currentRoleChipEl && assignment) {
    currentRoleChipEl.textContent = `YOU: ${assignment.label.toUpperCase()}`;
  }
}

function restoreRoundWalls() {
  walls.length = 0;

  for (const blueprint of blueprints) {
    const base = BASES[blueprint.team];
    const size = CONFIG.WALL_SIZE;
    const isCorner =
      (blueprint.x === base.x - size || blueprint.x === base.x + base.w) &&
      (blueprint.y === base.y - size || blueprint.y === base.y + base.h);
    const isBack =
      (blueprint.team === 'blue' && blueprint.edge === 'left') ||
      (blueprint.team === 'red' && blueprint.edge === 'right');

    if (isBack || isCorner) walls.push({ ...blueprint });
  }

  if (typeof instantiateMaze === 'function') {
    walls.push(...instantiateMaze(activeMazeIndex));
  }

  if (typeof mazePhase !== 'undefined') mazePhase = 'ACTIVE';
  if (typeof mazeTimer !== 'undefined') mazeTimer = 25;
  if (typeof mazeGhostWalls !== 'undefined') mazeGhostWalls = [];
  if (typeof navigationGridCache !== 'undefined') navigationGridCache.clear();
}

function resetActorForRound(actor) {
  if (actor?.isPlayer) globalThis.setInnerSentryFireHeld?.(false);
  actor.inv = null;
  actor.alive = true;
  actor.vx = 0;
  actor.vy = 0;
  actor.inputX = 0;
  actor.inputY = 0;
  actor.target = null;
  actor.targetItem = null;
  actor.targetSlotIndex = null;
  actor.buildTarget = null;
  actor.plantTarget = null;
  actor.interceptTarget = null;
  actor.combatAimTarget = null;
  actor.combatAimTimer = 0;
  actor.burstRemaining = 0;
  actor.burstRecovery = 0;
  actor.shootCooldown = 0;
  actor.stunTimer = 0;
  actor.respawnTimer = 0;
  actor.damageFlash = 0;
  actor.boost = 0;
  actor.aiRole = null;
  actor.hybridTaskUntil = 0;
  actor.thinkTimer = 0;
  actor.targetCommit = 0;
  actor.navPath = [];
  actor.navPathIndex = 0;
  actor.navRevision = -1;
  actor.coverTreeId = null;
  actor.raidSlotIndex = null;
  actor.raidTargetTeam = null;
  actor.failedItem = null;
  actor.failedItemUntil = 0;
  clearReservation(actor);

  if (isRunnerRole(actor)) {
    actor.maxHealth = 100;
    actor.health = 100;
    actor.lives = CONFIG.RAIDER_STARTING_LIVES;
  } else {
    actor.maxHealth = 0;
    actor.health = 0;
    actor.lives = 0;
  }

  if (isInnerSentry(actor)) {
    actor.weaponTier = 1;
    actor.gunAmmo = 0;
  } else if (isGuardianRole(actor)) {
    actor.weaponTier = 0;
    actor.gunAmmo = 0;
  }
}

function placeRoundActors() {
  for (const team of ['blue', 'red']) {
    const base = BASES[team];
    const teamActors = (ACTORS || []).filter(actor => actor.team === team);
    const runners = teamActors.filter(isRunnerRole);
    const saboteurs = teamActors.filter(isSaboteurRole);

    runners.forEach((actor, index) => {
      actor.x = base.x + (index === 0 ? 72 : 168);
      actor.y = base.y + 48;
      actor.prevX = actor.x;
      actor.prevY = actor.y;
      actor.facingX = team === 'blue' ? 1 : -1;
      actor.facingY = 0;
    });

    for (const actor of teamActors.filter(isGuardianRole)) {
      placeGuardianForDuty(actor);
    }

    saboteurs.forEach(actor => {
      actor.x = base.x + base.w / 2;
      actor.y = base.y + base.h - 38;
      actor.prevX = actor.x;
      actor.prevY = actor.y;
      actor.facingX = team === 'blue' ? 1 : -1;
      actor.facingY = 0;
    });
  }
}

function clearRoundObjects() {
  itemReservations.clear();
  items.length = 0;
  explosions.length = 0;
  slotEffects.length = 0;
  interceptEffects.length = 0;
  if (typeof bullets !== 'undefined') bullets.length = 0;
  globalThis.resetFortressWearState?.();
}

function resetSupplyPadCursors() {
  for (const key of Object.keys(supplyPadCursor)) {
    supplyPadCursor[key] = 0;
  }
}

function seedRoundSupplies() {
  resetSupplyPadCursors();
  seedRoundLetters();

  // Keep the Warden loop predictable after restarts and menu returns. Four
  // opening bricks place one near each normal brick supply area; fortress
  // wear continues to replace any built sections that later crumble.
  while (items.filter(item => item.type === 'wall').length < 4) {
    spawn('wall');
  }
  while (items.filter(item => item.type === 'bomb' && !item.ignited).length < 3) {
    spawn('bomb');
  }
  while (items.filter(item => item.type === 'speed').length < 2) {
    spawn('speed');
  }

  // One clearly visible clue card begins every round. It remains in the
  // field long enough for a human Runner to notice and collect it.
  while (items.filter(item => item.type === 'intel').length < CONFIG.INTEL_MAX) {
    const location = chooseOpenSpawn('intel', CONFIG.ITEM_RADIUS_OTHER + 4);
    createItemAt('intel', location.x, location.y, {
      expiresAt: simTime + CONFIG.INTEL_LIFETIME,
    });
  }
  state.intelTimer = randomBetween(CONFIG.INTEL_SPAWN_MIN, CONFIG.INTEL_SPAWN_MAX);

  while (combatItemCount('health') < CONFIG.MAX_HEALTH_ITEMS) {
    spawnCombatItem('health');
  }
  while (combatItemCount('gun') < CONFIG.MAX_GUN_ITEMS) {
    spawnCombatItem('gun');
  }

  combatSupplyTimer = 0;
}

function applyRoundWords(index) {
  const words = DEMO_ROUNDS[index];
  CONFIG.BLUE_WORD = words.blue;
  CONFIG.RED_WORD = words.red;
  refreshLetterPools();

  state.blue = Array(words.blue.length).fill(null);
  state.red = Array(words.red.length).fill(null);
  state.seconds = CONFIG.ROUND_SECONDS;
  state.spawnTimer = CONFIG.ITEM_SPAWN_INTERVAL;
  state.intelTimer = CONFIG.INTEL_SPAWN_MIN;
  state.jammedUntil.blue = 0;
  state.jammedUntil.red = 0;

  if (state.wordLocks) {
    state.wordLocks.blue = 0;
    state.wordLocks.red = 0;
  }
  if (state.letterFlow) {
    state.letterFlow.timer = 0;
    state.letterFlow.shortageSince.blue.clear();
    state.letterFlow.shortageSince.red.clear();
  }
  if (state.raidControl) {
    for (const team of ['blue', 'red']) {
      state.raidControl[team].activeActor = null;
      state.raidControl[team].cooldownUntil = 0;
    }
  }

  if (bsEl) bsEl.textContent = shuffle(words.blue);
  if (rsEl) rsEl.textContent = shuffle(words.red);
  if (timerEl) timerEl.textContent = '1:30';
}

function startDemoRound(index = 0, options = {}) {
  const demo = state.demoMatch;
  const advancingToNewRound = index > demo.roundIndex;
  const shouldChangeRole = options.changeRole ?? advancingToNewRound;
  let assignment = demo.currentAssignment || assignmentFromActor(player);

  if (shouldChangeRole && advancingToNewRound) {
    assignment = applyRoundAssignment(
      options.assignment || demo.nextAssignment || chooseDifferentRoundAssignment(assignment)
    );
  } else {
    demo.currentAssignment = assignment;
    demo.nextAssignment = null;
  }

  demo.roundIndex = index;
  demo.resolving = false;
  demo.finished = false;
  document.documentElement.classList.remove('round-ended');

  applyRoundWords(index);
  clearRoundObjects();
  restoreRoundWalls();

  for (const actor of ACTORS || []) resetActorForRound(actor);
  placeRoundActors();
  seedRoundSupplies();
  globalThis.resetFortressWearState?.();
  globalThis.resetMobileUiState?.();

  state.over = false;
  roundScreenEl?.classList.add('hidden');
  updateRoundHud();
  updateActorTreeCover();
  updateContextHint();
  updateRoleStrip(player.role, player.guardianDuty || null);
  globalThis.refreshMobileLayout?.();
  const roleNote = advancingToNewRound && assignment
    ? ` New role: ${assignment.label}.`
    : '';
  msg(`Round ${index + 1}.${roleNote} Form ${getTeamWord(player.team)}.`);
  showRoleAnnouncement(assignment, advancingToNewRound);
}

function showRoundResult(winnerTeam, reason) {
  const demo = state.demoMatch;
  const localTeam = player?.team || 'blue';
  const final = demo.finished;
  const localWon = winnerTeam === localTeam;
  const localLost = winnerTeam && winnerTeam !== localTeam;

  if (resultKickerEl) {
    resultKickerEl.textContent = final
      ? `FINAL · ${demo.score.blue}–${demo.score.red}`
      : `ROUND ${demo.roundIndex + 1} · ${demo.score.blue}–${demo.score.red}`;
  }

  if (resultTitleEl) {
    if (final) {
      resultTitleEl.textContent = demo.score[localTeam] > demo.score[otherTeam(localTeam)]
        ? 'YOU WON'
        : demo.score[localTeam] < demo.score[otherTeam(localTeam)]
          ? 'YOU LOST'
          : 'DRAW';
    } else {
      resultTitleEl.textContent = localWon
        ? 'ROUND WON'
        : localLost
          ? 'ROUND LOST'
          : 'ROUND DRAW';
    }
  }

  if (resultTextEl) resultTextEl.textContent = reason;

  if (final) {
    demo.nextAssignment = null;
    nextRolePreviewEl?.classList.add('hidden');
    if (resultButtonEl) resultButtonEl.textContent = 'PLAY AGAIN';
  } else {
    const nextAssignment = prepareNextRoundAssignment();
    nextRolePreviewEl?.classList.remove('hidden');
    if (nextRoleNameEl) nextRoleNameEl.textContent = nextAssignment.label;
    if (nextRoleJobEl) nextRoleJobEl.textContent = nextAssignment.job;
    if (resultButtonEl) {
      resultButtonEl.textContent = `NEXT ROUND AS ${nextAssignment.label.toUpperCase()}`;
    }
  }
  document.documentElement.classList.add('round-ended');
  roundScreenEl?.classList.remove('hidden');
}

function finishDemoRound(winnerTeam, reason = '') {
  const demo = state.demoMatch;
  if (demo.resolving || demo.finished) return;

  demo.resolving = true;
  state.over = true;

  if (winnerTeam === 'blue' || winnerTeam === 'red') {
    demo.score[winnerTeam] += 1;
  }

  const reachedThree = demo.score.blue >= 3 || demo.score.red >= 3;
  const lastRound = demo.roundIndex >= DEMO_ROUNDS.length - 1;
  demo.finished = reachedThree || lastRound;
  updateRoundHud();

  const defaultReason = winnerTeam
    ? `${winnerTeam === 'blue' ? 'Blue' : 'Red'} formed ${getTeamWord(winnerTeam)}.`
    : 'Neither team completed the message.';
  showRoundResult(winnerTeam, reason || defaultReason);
}

function resolveTimedRound() {
  const blueCorrect = correctSlotCount('blue');
  const redCorrect = correctSlotCount('red');
  const blueFilled = filledSlotCount('blue');
  const redFilled = filledSlotCount('red');

  if (blueCorrect > redCorrect) {
    finishDemoRound('blue', 'Time. Blue had more letters in the correct place.');
  } else if (redCorrect > blueCorrect) {
    finishDemoRound('red', 'Time. Red had more letters in the correct place.');
  } else if (blueFilled > redFilled) {
    finishDemoRound('blue', 'Time. Blue placed more letters.');
  } else if (redFilled > blueFilled) {
    finishDemoRound('red', 'Time. Red placed more letters.');
  } else {
    finishDemoRound(null, 'Time. The round ended level.');
  }
}

winner = function demoRoundWinner() {
  if (state.over || state.demoMatch.resolving) return;
  if (isWordComplete('blue')) {
    finishDemoRound('blue', `Blue formed ${getTeamWord('blue')}.`);
  } else if (isWordComplete('red')) {
    finishDemoRound('red', `Red formed ${getTeamWord('red')}.`);
  }
};

resultButtonEl?.addEventListener('click', () => {
  if (state.demoMatch.finished) {
    globalThis.returnToMainMenu?.();
    return;
  }
  startDemoRound(state.demoMatch.roundIndex + 1, {
    assignment: state.demoMatch.nextAssignment,
  });
});

window.__wordWarsRounds = {
  rounds: DEMO_ROUNDS,
  state: state.demoMatch,
  start: startDemoRound,
  finish: finishDemoRound,
  resolveTimedRound,
};
