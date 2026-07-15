'use strict';

let last = performance.now();
let accumulator = 0;
let gameLoopStarted = false;
let pendingRole = null;
let pendingDuty = null;

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

  while (accumulator >= CONFIG.FIXED_DT) {
    tick(CONFIG.FIXED_DT);
    accumulator -= CONFIG.FIXED_DT;
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
  document.querySelector('#pauseMenu')?.classList.add('hidden');
}

function returnToMainMenu() {
  closePauseMenu?.(false);

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
  if (contextHintEl) contextHintEl.textContent = 'Choose a role.';
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
  initializeDemoMatch();
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

      state.seconds = Math.max(0, state.seconds - 1);
      timerEl.textContent =
        Math.floor(state.seconds / 60) + ':' +
        String(state.seconds % 60).padStart(2, '0');

      if (state.seconds === 0) resolveTimedRound();
    }, 1000);
  }
}

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
