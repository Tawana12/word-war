'use strict';

let last = performance.now();
let accumulator = 0;
let gameLoopStarted = false;
let pendingRole = null;
let pendingDuty = null;

function frame(now) {
  let frameDt = (now - last) / 1000;
  last = now;
  if (frameDt > CONFIG.MAX_FRAME_DT) frameDt = CONFIG.MAX_FRAME_DT;
  accumulator += frameDt;

  while (accumulator >= CONFIG.FIXED_DT) {
    tick(CONFIG.FIXED_DT);
    accumulator -= CONFIG.FIXED_DT;
  }

  draw(accumulator / CONFIG.FIXED_DT);
  requestAnimationFrame(frame);
}

draw();

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
  hudLayer.style.display = 'block';
  startGame(pendingRole, pendingDuty);
});

function startGame(playerRole, playerDuty = null) {
  const roster = createSessionRoster(playerRole, playerDuty);

  if (!roster) {
    roleScreen.classList.remove('hidden');
    return;
  }

  player = roster.player;
  bots = roster.bots;
  ACTORS = [player, ...bots];
  updateRoleStrip(player.role, player.guardianDuty || null);
  initializeDemoMatch();
  updateActorTreeCover();
  updateContextHint();
  hud();

  last = performance.now();
  accumulator = 0;
  if (!gameLoopStarted) {
    gameLoopStarted = true;
    requestAnimationFrame(frame);
  }

  if (!countdownId) {
    countdownId = setInterval(() => {
      if (!player || state.over) return;

      state.seconds = Math.max(0, state.seconds - 1);
      timerEl.textContent =
        Math.floor(state.seconds / 60) + ':' +
        String(state.seconds % 60).padStart(2, '0');

      if (state.seconds === 0) resolveTimedRound();
    }, 1000);
  }
}

function initializeDemoMatch() {
  state.demoMatch.roundIndex = 0;
  state.demoMatch.score.blue = 0;
  state.demoMatch.score.red = 0;
  state.demoMatch.finished = false;
  state.demoMatch.resolving = false;
  startDemoRound(0);
}
