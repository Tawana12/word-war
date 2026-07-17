'use strict';

let last = performance.now();
let accumulator = 0;
let gameLoopStarted = false;
let pendingRole = null;
let pendingDuty = null;

const DEFAULT_PERFORMANCE_CONFIG = Object.freeze({
  fixedDt: CONFIG.FIXED_DT,
  pickupRangePad: CONFIG.PICKUP_RANGE_PAD,
  letterPickupAssist: CONFIG.LETTER_PICKUP_ASSIST,
  depositRange: CONFIG.DEPOSIT_RANGE,
  repairRange: CONFIG.REPAIR_RANGE,
  bombArmRange: CONFIG.BOMB_ARM_RANGE,
  botThinkInterval: CONFIG.BOT_THINK_INTERVAL,
});

function applyGamePerformanceProfile(multiplayer = false) {
  const coarsePointer = globalThis.matchMedia?.('(pointer: coarse)')?.matches;
  const lowCoreDevice = Number(navigator.hardwareConcurrency || 8) <= 4;

  globalThis.WORD_WARS_LOW_FX = Boolean(multiplayer && (coarsePointer || lowCoreDevice));

  // A 60 Hz simulation is already smoother than the network stream and cuts
  // multiplayer CPU/collision work roughly in half compared with 120 Hz.
  CONFIG.FIXED_DT = multiplayer ? 1 / 60 : DEFAULT_PERFORMANCE_CONFIG.fixedDt;

  // Make network interactions forgiving. Both the host and joining clients run
  // this profile, so pickup/drop validation uses the same ranges everywhere.
  CONFIG.PICKUP_RANGE_PAD = multiplayer
    ? DEFAULT_PERFORMANCE_CONFIG.pickupRangePad + (coarsePointer ? 18 : 12)
    : DEFAULT_PERFORMANCE_CONFIG.pickupRangePad;
  CONFIG.LETTER_PICKUP_ASSIST = multiplayer
    ? DEFAULT_PERFORMANCE_CONFIG.letterPickupAssist + (coarsePointer ? 14 : 10)
    : DEFAULT_PERFORMANCE_CONFIG.letterPickupAssist;
  CONFIG.DEPOSIT_RANGE = multiplayer
    ? DEFAULT_PERFORMANCE_CONFIG.depositRange + (coarsePointer ? 16 : 10)
    : DEFAULT_PERFORMANCE_CONFIG.depositRange;
  CONFIG.REPAIR_RANGE = multiplayer
    ? DEFAULT_PERFORMANCE_CONFIG.repairRange + 10
    : DEFAULT_PERFORMANCE_CONFIG.repairRange;
  CONFIG.BOMB_ARM_RANGE = multiplayer
    ? DEFAULT_PERFORMANCE_CONFIG.bombArmRange + 10
    : DEFAULT_PERFORMANCE_CONFIG.bombArmRange;
  CONFIG.BOT_THINK_INTERVAL = multiplayer
    ? Math.max(DEFAULT_PERFORMANCE_CONFIG.botThinkInterval, globalThis.WORD_WARS_LOW_FX ? 0.68 : 0.58)
    : DEFAULT_PERFORMANCE_CONFIG.botThinkInterval;
}


function frame(now) {
  if (state.paused) {
    const pausedFrameDt = Math.min(
      CONFIG.MAX_FRAME_DT,
      Math.max(0, (now - last) / 1000)
    );
    last = now;
    accumulator = 0;
    globalThis.updateMobileCameraFrame?.(pausedFrameDt);
    draw(1);
    requestAnimationFrame(frame);
    return;
  }

  let frameDt = (now - last) / 1000;
  last = now;
  if (frameDt > CONFIG.MAX_FRAME_DT) frameDt = CONFIG.MAX_FRAME_DT;
  accumulator += frameDt;

  let simulationSteps = 0;
  const maxSimulationSteps = globalThis.WORD_WARS_LOW_FX ? 2 : 4;
  while (accumulator >= CONFIG.FIXED_DT && simulationSteps < maxSimulationSteps) {
    tick(CONFIG.FIXED_DT);
    accumulator -= CONFIG.FIXED_DT;
    simulationSteps += 1;
  }
  // Never replay a long backlog after a mobile frame stall. A stale physics
  // burst feels worse than dropping excess accumulated time in realtime play.
  if (simulationSteps >= maxSimulationSteps && accumulator >= CONFIG.FIXED_DT) {
    accumulator = 0;
  }

  // DOM camera transforms run once per displayed frame rather than once per
  // 120 Hz simulation step. This avoids repeated layout reads/writes on phones.
  globalThis.updateMobileCameraFrame?.(frameDt);
  draw(accumulator / CONFIG.FIXED_DT);
  requestAnimationFrame(frame);
}

draw();

function clearPlayerInputState() {
  for (const key of Object.keys(keys)) delete keys[key];
  mobileInput.x = 0;
  mobileInput.y = 0;
  mobileInput.active = false;
  spaceHeld = false;
  globalThis.setInnerSentryFireHeld?.(false);
}

function resetFreshMatchSystems() {
  simTime = 0;
  clearPlayerInputState();
  itemReservations.clear();

  if (typeof activeMazeIndex !== 'undefined') activeMazeIndex = 0;
  if (typeof pendingMazeIndex !== 'undefined') pendingMazeIndex = 1;
  if (typeof mazePhase !== 'undefined') mazePhase = 'ACTIVE';
  if (typeof mazeTimer !== 'undefined') mazeTimer = 25;
  if (typeof mazeGhostWalls !== 'undefined') mazeGhostWalls = [];
  if (typeof navigationGridCache !== 'undefined') navigationGridCache.clear();

  for (const key of Object.keys(supplyPadCursor)) {
    supplyPadCursor[key] = 0;
  }

  globalThis.resetFortressWearState?.();
  globalThis.resetMobileUiState?.();
}

function hideAllAppOverlays() {
  document.querySelector('#modeScreen')?.classList.add('hidden');
  roleScreen?.classList.add('hidden');
  document.querySelector('#instructionScreen')?.classList.add('hidden');
  document.querySelector('#roundScreen')?.classList.add('hidden');
  document.querySelector('#soloBriefingScreen')?.classList.add('hidden');
  document.querySelector('#soloUpgradeScreen')?.classList.add('hidden');
  document.querySelector('#soloIntroOverlay')?.classList.add('hidden');
  document.querySelector('#pauseMenu')?.classList.add('hidden');
  document.querySelector('#multiplayerLobbyScreen')?.classList.add('hidden');
}

function returnToMainMenu() {
  applyGamePerformanceProfile(false);
  closePauseMenu?.(false);
  globalThis.endMultiplayerRuntime?.();

  state.paused = false;
  state.over = true;
  state.seconds = CONFIG.ROUND_SECONDS;
  state.spawnTimer = CONFIG.ITEM_SPAWN_INTERVAL;

  if (state.demoMatch) {
    state.demoMatch.roundIndex = 0;
    state.demoMatch.score.blue = 0;
    state.demoMatch.score.red = 0;
    state.demoMatch.resolving = false;
    state.demoMatch.finished = false;
    state.demoMatch.currentAssignment = null;
    state.demoMatch.nextAssignment = null;
  }

  clearPlayerInputState();
  clearRoundObjects?.();
  walls.length = 0;
  globalThis.resetFortressWearState?.();

  player = null;
  bots = [];
  ACTORS = [];
  pendingRole = null;
  pendingDuty = null;
  selectedSessionMode = null;
  globalThis.resetSoloRun?.();
  showModeStatus?.('');

  document.documentElement.classList.remove(
    'game-started',
    'game-paused',
    'round-ended'
  );

  hideAllAppOverlays();
  document.querySelector('#modeScreen')?.classList.remove('hidden');
  document.querySelector('#roleAnnouncement')?.classList.add('hidden');
  document.querySelector('#nextRolePreview')?.classList.add('hidden');

  if (hudLayer) hudLayer.style.display = 'none';
  if (roleStripEl) {
    roleStripEl.innerHTML =
      '<strong>WORD WARS</strong>Move with WASD or arrows · Space acts';
  }
  if (contextHintEl) contextHintEl.textContent = 'Choose a mode.';
  if (msgEl) msgEl.textContent = 'Complete your word before the other team.';
  if (timerEl) timerEl.textContent = '1:30';
  document.querySelector('#currentRoleChip')?.replaceChildren(
    document.createTextNode('YOU: RUNNER')
  );

  globalThis.resetMobileUiState?.();
  last = performance.now();
  accumulator = 0;
  draw(1);
}

globalThis.returnToMainMenu = returnToMainMenu;

document.querySelectorAll('.role-option').forEach(button => {
  button.addEventListener('click', event => {
    pendingRole = event.currentTarget.dataset.role;
    pendingDuty = event.currentTarget.dataset.duty || null;
    openInstructionScreen(pendingRole, pendingDuty);
  });
});

document.querySelector('#instructionBackBtn')?.addEventListener('click', () => {
  closeInstructionScreen();
  roleScreen.classList.remove('hidden');
});

document.querySelector('#startMatchBtn')?.addEventListener('click', () => {
  if (!pendingRole) return;
  closeInstructionScreen();
  startGame(pendingRole, pendingDuty);
});

function startGame(playerRole, playerDuty = null) {
  applyGamePerformanceProfile(false);
  resetFreshMatchSystems();
  const roster = createSessionRoster(playerRole, playerDuty);

  if (!roster) {
    roleScreen.classList.remove('hidden');
    return;
  }

  player = roster.player;
  bots = roster.bots;
  ACTORS = [player, ...bots];
  state.paused = false;

  hideAllAppOverlays();
  document.documentElement.classList.add('game-started');
  document.documentElement.classList.remove('round-ended', 'game-paused');
  if (hudLayer) hudLayer.style.display = 'block';

  updateRoleStrip(player.role, player.guardianDuty || null);
  if (selectedSessionMode === SESSION_MODES.SOLO) {
    globalThis.initializeSoloRun?.();
  } else {
    initializeDemoMatch();
  }
  updateActorTreeCover();
  updateContextHint();
  hud();
  globalThis.refreshMobileLayout?.();

  last = performance.now();
  accumulator = 0;
  if (!gameLoopStarted) {
    gameLoopStarted = true;
    requestAnimationFrame(frame);
  }

  if (!countdownId) {
    countdownId = setInterval(() => {
      if (!player || state.over || state.paused) return;
      if (
        selectedSessionMode === SESSION_MODES.MULTIPLAYER &&
        globalThis.multiplayerRuntime?.active &&
        !globalThis.multiplayerRuntime?.isHost
      ) return;

      state.seconds = Math.max(0, state.seconds - 1);
      timerEl.textContent =
        Math.floor(state.seconds / 60) + ':' +
        String(state.seconds % 60).padStart(2, '0');

      if (state.seconds === 0) {
        if (selectedSessionMode === SESSION_MODES.SOLO) {
          globalThis.resolveSoloTimedRound?.();
        } else {
          resolveTimedRound();
        }
      }
    }, 1000);
  }
}

function startMultiplayerGame(room, identity, assignment) {
  if (!room || !identity || !assignment) return;
  applyGamePerformanceProfile(true);
  selectedSessionMode = SESSION_MODES.MULTIPLAYER;
  globalThis.multiplayerRoomState = room;
  globalThis.multiplayerIdentity = identity;

  resetFreshMatchSystems();
  const roster = createMultiplayerRoster(room, identity);
  if (!roster) {
    showModeStatus?.('Your assigned multiplayer slot could not be created.', true);
    globalThis.returnToMainMenu?.();
    return;
  }

  player = roster.player;
  bots = roster.bots;
  ACTORS = roster.actors;
  state.paused = false;

  hideAllAppOverlays();
  document.documentElement.classList.add('game-started');
  document.documentElement.classList.remove('round-ended', 'game-paused');
  if (hudLayer) hudLayer.style.display = 'block';

  globalThis.beginMultiplayerRuntime?.(room, identity, assignment);
  updateRoleStrip(player.role, player.guardianDuty || null);
  initializeDemoMatch();
  updateActorTreeCover();
  updateContextHint();
  hud();
  globalThis.refreshMobileLayout?.();

  const assignmentLabel = assignment.role === 'INNER_SENTRY'
    ? 'INNER SENTRY'
    : assignment.role === 'OUTER_WARDEN'
      ? 'OUTER WARDEN'
      : assignment.role;
  document.querySelector('#currentRoleChip')?.replaceChildren(
    document.createTextNode(`YOU: ${assignmentLabel}`)
  );

  window.parent.postMessage({
    source: 'word-wars',
    type: 'match-start',
    mode: 'multiplayer',
  }, '*');

  last = performance.now();
  accumulator = 0;
  if (!gameLoopStarted) {
    gameLoopStarted = true;
    requestAnimationFrame(frame);
  }

  if (!countdownId) {
    countdownId = setInterval(() => {
      if (!player || state.over || state.paused) return;
      if (!globalThis.multiplayerRuntime?.isHost) return;
      state.seconds = Math.max(0, state.seconds - 1);
      timerEl.textContent =
        Math.floor(state.seconds / 60) + ':' +
        String(state.seconds % 60).padStart(2, '0');
      if (state.seconds === 0) resolveTimedRound();
    }, 1000);
  }
}

globalThis.startMultiplayerGame = startMultiplayerGame;

function initializeDemoMatch() {
  resetFreshMatchSystems();
  state.demoMatch.roundIndex = 0;
  state.demoMatch.score.blue = 0;
  state.demoMatch.score.red = 0;
  state.demoMatch.finished = false;
  state.demoMatch.resolving = false;
  state.demoMatch.currentAssignment = assignmentFromActor(player);
  state.demoMatch.nextAssignment = null;
  document.documentElement.classList.remove('round-ended');
  startDemoRound(0, { changeRole: false });
}
