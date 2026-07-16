'use strict';

const SESSION_MODES = Object.freeze({
  SOLO: 'solo',
  BOTS: 'bots',
  MULTIPLAYER: 'multiplayer',
});

let selectedSessionMode = null;

const MULTIPLAYER_SLOT_LAYOUT = Object.freeze([
  { id: 'blue-runner-1', team: 'blue', role: 'RUNNER', duty: null, label: 'Runner' },
  { id: 'red-runner-1', team: 'red', role: 'RUNNER', duty: null, label: 'Runner' },
  { id: 'blue-sentry', team: 'blue', role: 'GUARDIAN', duty: 'SENTRY', label: 'Inner Sentry' },
  { id: 'red-sentry', team: 'red', role: 'GUARDIAN', duty: 'SENTRY', label: 'Inner Sentry' },
  { id: 'blue-warden', team: 'blue', role: 'GUARDIAN', duty: 'WARDEN', label: 'Outer Warden' },
  { id: 'red-warden', team: 'red', role: 'GUARDIAN', duty: 'WARDEN', label: 'Outer Warden' },
  { id: 'blue-saboteur', team: 'blue', role: 'SABOTEUR', duty: null, label: 'Saboteur' },
  { id: 'red-saboteur', team: 'red', role: 'SABOTEUR', duty: null, label: 'Saboteur' },
  { id: 'blue-runner-2', team: 'blue', role: 'RUNNER', duty: null, label: 'Runner' },
  { id: 'red-runner-2', team: 'red', role: 'RUNNER', duty: null, label: 'Runner' },
]);

function multiplayerSpawnPoint(slot) {
  const base = BASES[slot.team];
  const points = slot.team === 'blue'
    ? {
        'blue-runner-1': { x: base.x + 68, y: base.y + 44 },
        'blue-runner-2': { x: base.x + 172, y: base.y + 44 },
        'blue-sentry': { x: base.x + base.w / 2, y: base.y + base.h / 2 + 45 },
        'blue-warden': { x: base.x + base.w + CONFIG.WALL_SIZE + 22, y: base.y + base.h / 2 },
        'blue-saboteur': { x: base.x + base.w / 2, y: base.y + base.h - 38 },
      }
    : {
        'red-runner-1': { x: base.x + 68, y: base.y + 44 },
        'red-runner-2': { x: base.x + 172, y: base.y + 44 },
        'red-sentry': { x: base.x + base.w / 2, y: base.y + base.h / 2 + 45 },
        'red-warden': { x: base.x - CONFIG.WALL_SIZE - 22, y: base.y + base.h / 2 },
        'red-saboteur': { x: base.x + base.w / 2, y: base.y + base.h - 38 },
      };
  return points[slot.id] || { x: base.x + base.w / 2, y: base.y + base.h / 2 };
}

function createMultiplayerRoster(room, identity) {
  if (!room || !identity) return null;
  const occupied = new Map((room.players || []).map(entry => [entry.slotId, entry]));
  const allActors = [];
  const aiBots = [];
  const remoteHumans = [];
  let localPlayer = null;

  for (const slot of MULTIPLAYER_SLOT_LAYOUT) {
    const occupant = occupied.get(slot.id) || null;
    const isLocal = Boolean(occupant && occupant.userId === identity.userId);
    const point = multiplayerSpawnPoint(slot);
    const actor = createActor(
      point.x,
      point.y,
      slot.team,
      slot.role,
      ROLE_SPEEDS[slot.role],
      isLocal
    );

    actor.multiplayerSlotId = slot.id;
    actor.multiplayerUserId = occupant?.userId || null;
    actor.multiplayerUsername = occupant?.username || 'BOT';
    actor.multiplayerHuman = Boolean(occupant);
    actor.multiplayerConnected = occupant ? occupant.connected !== false : false;
    actor.multiplayerBot = !occupant;
    actor.publicRole = slot.role;

    if (slot.role === 'GUARDIAN') {
      setGuardianDuty(actor, slot.duty);
      placeGuardianForDuty(actor);
    }

    if (isLocal) localPlayer = actor;
    else if (occupant) remoteHumans.push(actor);
    else aiBots.push(actor);
    allActors.push(actor);
  }

  if (!localPlayer) return null;
  return {
    player: localPlayer,
    bots: aiBots,
    actors: allActors,
    remoteHumans,
  };
}

globalThis.MULTIPLAYER_SLOT_LAYOUT = MULTIPLAYER_SLOT_LAYOUT;
globalThis.createMultiplayerRoster = createMultiplayerRoster;

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


function createSoloRoster() {
  // Solo Word Hunt is intentionally not a team match. The Captain begins
  // alone and dedicated Hunter enemies are spawned by solo-fortress.js.
  const localPlayer = createActor(
    CONFIG.W / 2,
    CONFIG.H * 0.66,
    'blue',
    'CAPTAIN',
    ROLE_SPEEDS.CAPTAIN,
    true
  );
  localPlayer.publicRole = 'CAPTAIN';
  localPlayer.maxHealth = 100;
  localPlayer.health = 100;
  localPlayer.weaponTier = 1;
  localPlayer.gunAmmo = 0;
  localPlayer.lives = 1;

  return { player: localPlayer, bots: [] };
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
  if (selectedSessionMode === SESSION_MODES.SOLO) {
    return createSoloRoster();
  }

  if (selectedSessionMode === SESSION_MODES.BOTS) {
    return createBotRoster(playerRole, playerDuty);
  }

  if (selectedSessionMode === SESSION_MODES.MULTIPLAYER) {
    return createMultiplayerRoster(
      globalThis.multiplayerRoomState,
      globalThis.multiplayerIdentity
    );
  }

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
  document.querySelector('#multiplayerLobbyScreen')?.classList.add('hidden');
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
  document.querySelector('#multiplayerLobbyScreen')?.classList.add('hidden');
}

function initializeSessionMenu() {
  const soloButton = document.querySelector('#soloModeBtn');
  const multiplayerButton = document.querySelector('#multiplayerModeBtn');
  const backButton = document.querySelector('#backToModeBtn');

  soloButton?.addEventListener('click', () => {
    selectedSessionMode = SESSION_MODES.SOLO;
    showModeStatus('');
    globalThis.openSoloBriefing?.();
  });

  multiplayerButton?.addEventListener('click', () => {
    showModeStatus('');

    if (multiplayerAdapter.isWebMode?.() &&
        typeof globalThis.ensureWebMultiplayerNickname === 'function' &&
        !globalThis.ensureWebMultiplayerNickname()) {
      showModeStatus('Enter your player name first.', true);
      return;
    }

    selectedSessionMode = SESSION_MODES.MULTIPLAYER;

    if (!multiplayerAdapter.isAvailable()) {
      showModeStatus('Open this game through its Reddit post to join multiplayer.', true);
      return;
    }

    document.querySelector('#modeScreen')?.classList.add('hidden');
    roleScreen.classList.add('hidden');
    document.querySelector('#multiplayerLobbyScreen')?.classList.remove('hidden');
    globalThis.joinMultiplayerLobby?.();
  });

  backButton?.addEventListener('click', () => {
    selectedSessionMode = null;
    openModeSelection();
  });
}

initializeSessionMenu();
