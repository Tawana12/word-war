'use strict';

const pauseBtnEl = document.querySelector('#pauseBtn');
const pauseMenuEl = document.querySelector('#pauseMenu');
const resumeBtnEl = document.querySelector('#resumeBtn');
const restartRoundBtnEl = document.querySelector('#restartRoundBtn');
const restartMatchBtnEl = document.querySelector('#restartMatchBtn');
const mainMenuBtnEl = document.querySelector('#mainMenuBtn');

state.paused = false;

function canPauseGame() {
  return Boolean(
    player &&
    !state.over &&
    document.documentElement.classList.contains('game-started') &&
    !document.querySelector('#roundScreen:not(.hidden)')
  );
}

function openPauseMenu(playFx = true) {
  if (!canPauseGame() || state.paused) return;
  state.paused = true;
  document.documentElement.classList.add('game-paused');
  pauseMenuEl?.classList.remove('hidden');
  pauseBtnEl?.setAttribute('aria-expanded', 'true');
  if (typeof resetJoystick === 'function') resetJoystick();
  globalThis.setInnerSentryFireHeld?.(false);
  if (playFx) globalThis.playGameSound?.('pause');
}

function closePauseMenu(playFx = true) {
  if (!state.paused) return;
  state.paused = false;
  document.documentElement.classList.remove('game-paused');
  pauseMenuEl?.classList.add('hidden');
  pauseBtnEl?.setAttribute('aria-expanded', 'false');
  if (playFx) globalThis.playGameSound?.('resume');
}

pauseBtnEl?.addEventListener('click', () => openPauseMenu());
resumeBtnEl?.addEventListener('click', () => closePauseMenu());

restartRoundBtnEl?.addEventListener('click', () => {
  closePauseMenu(false);
  if (selectedSessionMode === SESSION_MODES.SOLO) {
    globalThis.startSoloWord?.(state.soloRun?.roundIndex || 0);
  } else {
    startDemoRound(state.demoMatch.roundIndex, { changeRole: false });
  }
  globalThis.playGameSound?.('uiClick');
});

restartMatchBtnEl?.addEventListener('click', () => {
  closePauseMenu(false);
  if (selectedSessionMode === SESSION_MODES.SOLO) {
    globalThis.initializeSoloRun?.();
  } else {
    initializeDemoMatch();
  }
  globalThis.playGameSound?.('uiClick');
});

mainMenuBtnEl?.addEventListener('click', () => {
  globalThis.playGameSound?.('uiClick');
  globalThis.returnToMainMenu?.();
});

document.addEventListener('keydown', event => {
  if (!['Escape', 'KeyP'].includes(event.code)) return;
  if (event.repeat) return;

  if (state.paused) {
    closePauseMenu();
  } else {
    openPauseMenu();
  }
});

// Losing focus should freeze the match instead of letting bots and the timer
// continue while the player is in another app or browser tab.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && canPauseGame()) openPauseMenu(false);
});
