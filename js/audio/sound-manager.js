'use strict';

// SOUND SETUP
// 1. Put your files in assets/audio/ using the names below.
// 2. Change enabled to true.
// 3. Adjust masterVolume if needed.
const WORD_WARS_SOUND_CONFIG = Object.freeze({
  enabled: false,
  masterVolume: 0.68,
  files: {
    uiClick: 'assets/audio/ui-click.mp3',
    letterPickup: 'assets/audio/letter-pickup.mp3',
    powerupPickup: 'assets/audio/powerup-pickup.mp3',
    letterPlace: 'assets/audio/letter-place.mp3',
    shoot: 'assets/audio/shoot.mp3',
    explosion: 'assets/audio/explosion.mp3',
    roundWin: 'assets/audio/round-win.mp3',
    roundLose: 'assets/audio/round-lose.mp3',
    roundDraw: 'assets/audio/round-draw.mp3',
    pause: 'assets/audio/pause.mp3',
    resume: 'assets/audio/resume.mp3',
  },
});

const wordWarsAudioCache = new Map();

function playGameSound(name, volume = 1) {
  if (!WORD_WARS_SOUND_CONFIG.enabled) return;
  const src = WORD_WARS_SOUND_CONFIG.files[name];
  if (!src) return;

  let template = wordWarsAudioCache.get(name);
  if (!template) {
    template = new Audio(src);
    template.preload = 'auto';
    wordWarsAudioCache.set(name, template);
  }

  const sound = template.cloneNode();
  sound.volume = Math.max(
    0,
    Math.min(1, WORD_WARS_SOUND_CONFIG.masterVolume * volume)
  );
  sound.play().catch(() => {
    // Browsers may block sound until the first user gesture. The next action
    // will try again automatically.
  });
}

globalThis.playGameSound = playGameSound;
globalThis.WORD_WARS_SOUND_CONFIG = WORD_WARS_SOUND_CONFIG;

// Final wrappers are installed after the gameplay files, so they observe the
// completed public role system without changing any gameplay result.
if (typeof pickup === 'function') {
  const soundPickupBase = pickup;
  pickup = function soundPickup(actor, item) {
    const pickedUp = soundPickupBase(actor, item);
    if (pickedUp && actor?.isPlayer) {
      playGameSound(
        item?.type === 'letter' ? 'letterPickup' : 'powerupPickup'
      );
    }
    return pickedUp;
  };
}

if (typeof deposit === 'function') {
  const soundDepositBase = deposit;
  deposit = function soundDeposit(actor) {
    const placed = soundDepositBase(actor);
    if (placed && actor?.isPlayer) playGameSound('letterPlace');
    return placed;
  };
}

if (typeof shootDefender === 'function') {
  const soundShootBase = shootDefender;
  shootDefender = function soundShoot(defender, ...args) {
    const fired = soundShootBase(defender, ...args);
    if (fired && defender?.isPlayer) playGameSound('shoot', 0.82);
    return fired;
  };
}

if (typeof explode === 'function') {
  const soundExplosionBase = explode;
  explode = function soundExplosion(bomb) {
    const result = soundExplosionBase(bomb);
    playGameSound('explosion', 0.9);
    return result;
  };
}

if (typeof showRoundResult === 'function') {
  const soundRoundResultBase = showRoundResult;
  showRoundResult = function soundRoundResult(winnerTeam, reason) {
    const result = soundRoundResultBase(winnerTeam, reason);
    const localTeam = player?.team || 'blue';
    playGameSound(
      !winnerTeam
        ? 'roundDraw'
        : winnerTeam === localTeam
          ? 'roundWin'
          : 'roundLose'
    );
    return result;
  };
}

document.addEventListener('click', event => {
  if (event.target.closest('button')) playGameSound('uiClick', 0.55);
});
