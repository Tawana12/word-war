'use strict';

// ================================================================
// HUMAN-FIRST SUBMISSION PASS
// Keep the first match focused on the core loop:
// letters, walls, bombs, health, weapons and speed.
// Experimental systems remain in the codebase but do not surface here.
// ================================================================
Object.assign(CONFIG, {
  CLEAN_BUILD: true,
  MAX_JAMMERS: 0,
  GOLDEN_MAX: 0,
  INTEL_MAX: 1,
  INTEL_LIFETIME: 40,
  INTEL_SPAWN_MIN: 24,
  INTEL_SPAWN_MAX: 32,
});

// Remove experimental items that may have spawned while scripts loaded.
for (let index = items.length - 1; index >= 0; index--) {
  if (['jammer', 'golden'].includes(items[index].type)) {
    removeItem(items[index]);
  }
}

if (SUPPLY_PADS.jammer) SUPPLY_PADS.jammer.length = 0;
if (SUPPLY_PADS.golden) SUPPLY_PADS.golden.length = 0;

state.intelTimer = 12;
state.worldEventTimer = Infinity;
state.internalBombTimer = Infinity;
state.activeEventUntil = 0;
state.activeEventName = '';

if (state.eventDirector) {
  state.eventDirector.nextAt = Infinity;
  state.eventDirector.activeType = '';
  state.eventDirector.activeUntil = 0;
}

if (state.shields) {
  for (const team of ['blue', 'red']) {
    state.shields[team].charge = 0;
    state.shields[team].hits = 0;
    state.shields[team].until = 0;
  }
}

if (typeof chooseDirectorEvent === 'function') {
  chooseDirectorEvent = function cleanChooseDirectorEvent() {
    return null;
  };
}

if (typeof triggerDirectedEvent === 'function') {
  triggerDirectedEvent = function cleanTriggerDirectedEvent() {
    return false;
  };
}

// The word ends the match immediately. No extra lock-in rule to explain.
winner = function humanWinner() {
  if (isWordComplete('blue')) {
    end(`BLUE COMPLETED ${getTeamWord('blue')}!`);
  } else if (isWordComplete('red')) {
    end(`RED COMPLETED ${getTeamWord('red')}!`);
  }
};

// Only the systems visible in the clean build appear in permissions/copy.
Object.assign(ROLE_RULES.RUNNER, {
  job: 'Collect and steal',
  summary: 'Letters · clue cards · health · speed',
  allowed: ['letter', 'intel', 'health', 'speed'],
});
Object.assign(ROLE_RULES.GUARDIAN, {
  job: 'Protect the word',
  summary: 'Walls · weapons · armed bombs · speed',
  allowed: ['wall', 'gun', 'armed-bomb', 'speed'],
});
Object.assign(ROLE_RULES.SABOTEUR, {
  job: 'Break the defence',
  summary: 'Bombs · speed',
  allowed: ['bomb', 'speed'],
});

const humanRoleStripBase = updateRoleStrip;
updateRoleStrip = function humanRoleStrip(role, duty = null) {
  if (!roleStripEl) return;

  if (role === 'GUARDIAN' && duty === 'SENTRY') {
    roleStripEl.innerHTML =
      '<strong>INNER SENTRY</strong>Stay inside · shoot intruders · disarm bombs · Space acts';
    return;
  }

  if (role === 'GUARDIAN' && duty === 'WARDEN') {
    roleStripEl.innerHTML =
      '<strong>OUTER WARDEN</strong>Stay outside · build walls · block escapes · Space acts';
    return;
  }

  if (role === 'RUNNER') {
    roleStripEl.innerHTML =
      '<strong>RUNNER</strong>Collect letters or clue cards · place or steal · Space acts';
    return;
  }

  if (role === 'SABOTEUR') {
    roleStripEl.innerHTML =
      '<strong>SABOTEUR</strong>Carry a bomb to the enemy defence · Space plants it';
    return;
  }

  humanRoleStripBase(role, duty);
};

// Keep tuning controls out of the player experience.
const debugVisible = new URLSearchParams(location.search).get('debug') === '1';
document.querySelector('.dev-tools')?.toggleAttribute('hidden', !debugVisible);

// Prevent identical bot announcements from hammering the message bar.
const humanMessageBase = msg;
let humanLastMessage = '';
let humanLastMessageAt = -999;
msg = function humanMessage(text) {
  const value = String(text || '')
    .replace(/^WORLD EVENT:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!value) return;
  if (value === humanLastMessage && simTime - humanLastMessageAt < 1.1) return;

  humanLastMessage = value;
  humanLastMessageAt = simTime;
  humanMessageBase(value);
};
