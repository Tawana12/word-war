'use strict';

const SESSION_MODES = Object.freeze({
  BOTS: 'bots',
  MULTIPLAYER: 'multiplayer',
});

let selectedSessionMode = null;

function assignGuardianDuties(roster, preferredPlayerDuty = null) {
  const guardians = roster.filter(actor => isGuardianRole(actor));
  if (!guardians.length) return;

  const playerGuardian = guardians.find(actor => actor.isPlayer) || null;

  if (playerGuardian) {
    const duty = preferredPlayerDuty === 'WARDEN' ? 'WARDEN' : 'SENTRY';
    setGuardianDuty(playerGuardian, duty);

    const partner = guardians.find(actor => actor !== playerGuardian);
    if (partner) {
      setGuardianDuty(partner, duty === 'SENTRY' ? 'WARDEN' : 'SENTRY');
    }
  } else {
    guardians.forEach((guardian, index) => {
      setGuardianDuty(guardian, index === 0 ? 'SENTRY' : 'WARDEN');
    });
  }

  guardians.forEach(placeGuardianForDuty);
}

function createBotRoster(playerRole, playerDuty = null) {
  // Three public roles, but five active characters per team:
  // two Runners, two Guardians and one Saboteur.
  // This restores the lively 5v5 battlefield without returning to
  // five separate role types.
  const composition = [
    'RUNNER',
    'RUNNER',
    'GUARDIAN',
    'GUARDIAN',
    'SABOTEUR',
  ];

  const redSpawnPoints = [
    { x: BASES.red.x + 68, y: BASES.red.y + 44 },
    { x: BASES.red.x + 172, y: BASES.red.y + 44 },
    { x: BASES.red.x + 68, y: BASES.red.y + 136 },
    { x: BASES.red.x + 172, y: BASES.red.y + 136 },
    { x: BASES.red.x + 120, y: BASES.red.y + 90 },
  ];

  const redBots = composition.map((role, index) => {
    const point = redSpawnPoints[index];
    return createActor(
      point.x,
      point.y,
      'red',
      role,
      ROLE_SPEEDS[role]
    );
  });

  const localPlayer = createActor(
    BASES.blue.x + 120,
    BASES.blue.y + 90,
    'blue',
    playerRole,
    ROLE_SPEEDS[playerRole],
    true
  );

  const remainingBlueRoles = [...composition];
  const selectedIndex = remainingBlueRoles.indexOf(playerRole);
  if (selectedIndex >= 0) remainingBlueRoles.splice(selectedIndex, 1);

  const blueSpawnPoints = [
    { x: BASES.blue.x + 68, y: BASES.blue.y + 44 },
    { x: BASES.blue.x + 172, y: BASES.blue.y + 44 },
    { x: BASES.blue.x + 68, y: BASES.blue.y + 136 },
    { x: BASES.blue.x + 172, y: BASES.blue.y + 136 },
  ];

  const blueBots = remainingBlueRoles.map((role, index) => {
    const point = blueSpawnPoints[index];
    return createActor(
      point.x,
      point.y,
      'blue',
      role,
      ROLE_SPEEDS[role]
    );
  });

  assignGuardianDuties(redBots);
  assignGuardianDuties([localPlayer, ...blueBots], playerDuty);

  return {
    player: localPlayer,
    bots: [...blueBots, ...redBots],
  };
}

function createSessionRoster(playerRole, playerDuty = null) {
  if (selectedSessionMode === SESSION_MODES.BOTS) {
    return createBotRoster(playerRole, playerDuty);
  }

  msg('This build currently runs bot matches.');
  return null;
}

function showModeStatus(text, isError = false) {
  const status = document.querySelector('#modeStatus');
  if (!status) return;

  status.textContent = text;
  status.classList.toggle('error', isError);
}

function openRoleSelection() {
  const modeScreen = document.querySelector('#modeScreen');
  modeScreen?.classList.add('hidden');
  document.querySelector('#instructionScreen')?.classList.add('hidden');
  document.querySelector('#roundScreen')?.classList.add('hidden');
  roleScreen.classList.remove('hidden');

  const hint = document.querySelector('#contextHint');
  if (hint) hint.textContent = 'Choose a job.';
}

function openModeSelection() {
  const modeScreen = document.querySelector('#modeScreen');
  modeScreen?.classList.remove('hidden');
  roleScreen.classList.add('hidden');
  document.querySelector('#instructionScreen')?.classList.add('hidden');
  document.querySelector('#roundScreen')?.classList.add('hidden');
}

function initializeSessionMenu() {
  const botButton = document.querySelector('#botModeBtn');
  const multiplayerButton = document.querySelector('#multiplayerModeBtn');
  const backButton = document.querySelector('#backToModeBtn');

  botButton?.addEventListener('click', () => {
    selectedSessionMode = SESSION_MODES.BOTS;
    showModeStatus('');
    openRoleSelection();
  });

  multiplayerButton?.addEventListener('click', () => {
    selectedSessionMode = SESSION_MODES.MULTIPLAYER;

    if (!multiplayerAdapter.isAvailable()) {
      showModeStatus(
        'The multiplayer interface is ready, but the Devvit transport is not connected yet. Implement js/net/multiplayer-adapter.js.',
        true
      );
      return;
    }

    openRoleSelection();
  });

  backButton?.addEventListener('click', () => {
    selectedSessionMode = null;
    openModeSelection();
  });
}

initializeSessionMenu();
