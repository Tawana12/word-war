'use strict';

// ================================================================
// SOLO WORD HUNT
// A separate solo mode: one Captain, one open field, falling letters,
// visible mines and mobile Hunters. Faction Battle and Multiplayer retain
// their original territory/role rules.
// ================================================================
(() => {
  const WORD_COUNT = DEMO_ROUNDS.length;
  const SOLO_DOCK = Object.freeze({ x: 350, y: 535, w: 300, h: 130 });
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const SOLO_MAZE_WARNING_TIME = 2.1;
  const SOLO_MAZE_OPEN_TIME = 2.0;
  const SOLO_MAZE_PATTERNS = Object.freeze([
    Object.freeze([
      { x: 130, y: 205, w: 170, h: 24 },
      { x: 700, y: 205, w: 170, h: 24 },
      { x: 405, y: 130, w: 24, h: 125 },
      { x: 571, y: 325, w: 24, h: 125 },
    ]),
    Object.freeze([
      { x: 210, y: 130, w: 24, h: 170 },
      { x: 766, y: 300, w: 24, h: 165 },
      { x: 375, y: 250, w: 250, h: 24 },
      { x: 105, y: 405, w: 160, h: 24 },
    ]),
    Object.freeze([
      { x: 135, y: 150, w: 210, h: 24 },
      { x: 655, y: 385, w: 210, h: 24 },
      { x: 330, y: 310, w: 24, h: 135 },
      { x: 646, y: 125, w: 24, h: 135 },
    ]),
  ]);

  const ROUND_SETTINGS = Object.freeze([
    {
      seconds: 92,
      hunterCap: 2,
      hunterSpawnEvery: 10.5,
      hunterSpeed: 232,
      hunterHealth: 42,
      hunterDamage: 6,
      hunterCooldown: 0.82,
      mines: 3,
      mineDamage: 29,
      mineEvery: 21,
      dropEvery: 3.9,
    },
    {
      seconds: 96,
      hunterCap: 2,
      hunterSpawnEvery: 8.8,
      hunterSpeed: 240,
      hunterHealth: 47,
      hunterDamage: 7,
      hunterCooldown: 0.72,
      mines: 4,
      mineDamage: 32,
      mineEvery: 18,
      dropEvery: 3.6,
    },
    {
      seconds: 100,
      hunterCap: 3,
      hunterSpawnEvery: 8,
      hunterSpeed: 248,
      hunterHealth: 52,
      hunterDamage: 8,
      hunterCooldown: 0.64,
      mines: 5,
      mineDamage: 34,
      mineEvery: 16,
      dropEvery: 3.35,
    },
    {
      seconds: 104,
      hunterCap: 4,
      hunterSpawnEvery: 7.2,
      hunterSpeed: 256,
      hunterHealth: 57,
      hunterDamage: 9,
      hunterCooldown: 0.58,
      mines: 6,
      mineDamage: 37,
      mineEvery: 14,
      dropEvery: 3.1,
    },
    {
      seconds: 108,
      hunterCap: 5,
      hunterSpawnEvery: 6.3,
      hunterSpeed: 264,
      hunterHealth: 62,
      hunterDamage: 10,
      hunterCooldown: 0.52,
      mines: 7,
      mineDamage: 40,
      mineEvery: 12.5,
      dropEvery: 2.85,
    },
  ]);

  const ORIGINAL_CONFIG = Object.freeze({
    ROUND_SECONDS: CONFIG.ROUND_SECONDS,
    ITEM_SPAWN_INTERVAL: CONFIG.ITEM_SPAWN_INTERVAL,
    MAX_LETTERS: CONFIG.MAX_LETTERS,
    MAX_WALLS_ITEM: CONFIG.MAX_WALLS_ITEM,
    MAX_BOMBS: CONFIG.MAX_BOMBS,
    MAX_SPEED_BOOSTS: CONFIG.MAX_SPEED_BOOSTS,
    MAX_HEALTH_ITEMS: CONFIG.MAX_HEALTH_ITEMS,
    MAX_GUN_ITEMS: CONFIG.MAX_GUN_ITEMS,
    PICKUP_RANGE_PAD: CONFIG.PICKUP_RANGE_PAD,
    PISTOL_DAMAGE: CONFIG.PISTOL_DAMAGE,
    PISTOL_COOLDOWN: CONFIG.PISTOL_COOLDOWN,
    SENTRY_PLAYER_AIM_MIN_DOT: CONFIG.SENTRY_PLAYER_AIM_MIN_DOT,
    SENTRY_PLAYER_AIM_LATERAL_PAD: CONFIG.SENTRY_PLAYER_AIM_LATERAL_PAD,
    DEFENDER_AIM_TIME: CONFIG.DEFENDER_AIM_TIME,
    TREE_HIDE_CHANCE: CONFIG.TREE_HIDE_CHANCE,
  });

  const ORIGINAL_BLUE_BASE = Object.freeze({ ...BASES.blue });
  const ORIGINAL_RED_BASE = Object.freeze({ ...BASES.red });

  const soloHudEl = document.querySelector('#soloHud');
  const soloHealthTextEl = document.querySelector('#soloHealthText');
  const soloHealthFillEl = document.querySelector('#soloHealthFill');
  const soloWordProgressEl = document.querySelector('#soloWordProgress');
  const soloKillsTextEl = document.querySelector('#soloKillsText');
  const soloCoverStatusEl = document.querySelector('#soloCoverStatus');
  const upgradeScreenEl = document.querySelector('#soloUpgradeScreen');
  const upgradeChoicesEl = document.querySelector('#soloUpgradeChoices');
  const upgradeSummaryEl = document.querySelector('#soloUpgradeSummary');

  const soloDrops = [];
  const soloMines = [];
  const soloSpawnWarnings = [];
  const soloMazeGhostWalls = [];

  const upgradeDefinitions = Object.freeze([
    {
      id: 'rapid-fire',
      name: 'Rapid Fire',
      description: 'Shoot faster.',
      apply(run) {
        run.fireRateBonus += 0.025;
      },
    },
    {
      id: 'tougher',
      name: 'Tougher',
      description: '+20 max health.',
      apply(run) {
        run.healthBonus += 20;
        if (player) {
          player.maxHealth += 20;
          player.health = Math.min(player.maxHealth, player.health + 34);
        }
      },
    },
    {
      id: 'quick-feet',
      name: 'Quick Feet',
      description: 'Move 7% faster.',
      apply(run) {
        run.speedBonus += 0.07;
      },
    },
    {
      id: 'letter-magnet',
      name: 'Letter Magnet',
      description: 'Reach pickups farther.',
      apply(run) {
        run.pickupBonus += 9;
      },
    },
    {
      id: 'steady-aim',
      name: 'Steady Aim',
      description: 'Stronger, wider shots.',
      apply(run) {
        run.damageBonus += 3;
        run.aimBonus += 0.06;
      },
    },
    {
      id: 'mine-armor',
      name: 'Mine Armor',
      description: 'Mines deal less damage.',
      apply(run) {
        run.mineDamageScale = Math.max(0.48, run.mineDamageScale - 0.18);
      },
    },
  ]);

  state.soloRun = state.soloRun || null;

  function soloActive() {
    return selectedSessionMode === SESSION_MODES.SOLO && Boolean(state.soloRun?.active);
  }

  globalThis.isSoloFieldRunActive = soloActive;

  function currentSettings() {
    const index = clamp(state.soloRun?.roundIndex || 0, 0, ROUND_SETTINGS.length - 1);
    return ROUND_SETTINGS[index];
  }

  function soloCargo() {
    const run = state.soloRun;
    if (!run) return [];
    run.letterCargo = Array.isArray(run.letterCargo) ? run.letterCargo : [];
    return run.letterCargo;
  }

  function syncSoloCargoInventory(actor = player) {
    if (!actor || !state.soloRun) return;
    const cargo = soloCargo();
    actor.inv = cargo.length
      ? { type: 'letter', char: cargo[0], ignited: false, timer: 0 }
      : null;
  }

  function soloCargoHasRoom() {
    const run = state.soloRun;
    return Boolean(run && soloCargo().length < Math.max(1, run.carryCapacity || 1));
  }

  function collectSoloLetter(actor, item) {
    if (!actor || !item || item.type !== 'letter' || !soloCargoHasRoom()) return false;
    soloCargo().push(item.char);
    clearReservation(actor);
    removeItem(item);
    syncSoloCargoInventory(actor);
    if (actor.isPlayer) {
      msg(`Picked up ${item.char} · ${soloCargo().length}/${state.soloRun.carryCapacity} letters`);
    }
    return true;
  }

  function applyCarryPowerup(actor, item) {
    if (!actor || !item || !['carry2', 'carry3'].includes(item.type)) return false;
    const capacity = item.type === 'carry3' ? 3 : 2;
    state.soloRun.carryCapacity = Math.max(state.soloRun.carryCapacity || 1, capacity);
    clearReservation(actor);
    removeItem(item);
    msg(`+${capacity} CARRY active · hold up to ${capacity} letters and keep firing.`);
    return true;
  }

  function createSoloState() {
    return {
      active: true,
      roundIndex: 0,
      wordsCompleted: 0,
      resolving: false,
      finished: false,
      kills: 0,
      roundKills: 0,
      healthBonus: 0,
      speedBonus: 0,
      pickupBonus: 0,
      damageBonus: 0,
      aimBonus: 0,
      fireRateBonus: 0,
      mineDamageScale: 1,
      chosenUpgrades: [],
      hunterTimer: 4.5,
      mineTimer: 8,
      dropTimer: 2.5,
      criticalLetterTimer: 4,
      wordStartedAt: 0,
      autoPickupCooldown: 0,
      carryCapacity: 1,
      letterCargo: [],
      mazePhase: 'ACTIVE',
      mazeTimer: 18,
      mazePatternIndex: 0,
      nextMazePatternIndex: 1,
    };
  }

  function restoreSharedRules() {
    Object.assign(CONFIG, ORIGINAL_CONFIG);
    Object.assign(BASES.blue, ORIGINAL_BLUE_BASE);
    Object.assign(BASES.red, ORIGINAL_RED_BASE);
  }

  function configureSoloRules() {
    const run = state.soloRun;
    const settings = currentSettings();

    CONFIG.ROUND_SECONDS = settings.seconds;
    CONFIG.ITEM_SPAWN_INTERVAL = 9999;
    CONFIG.MAX_LETTERS = 30;
    CONFIG.MAX_WALLS_ITEM = 0;
    CONFIG.MAX_BOMBS = 0;
    CONFIG.MAX_SPEED_BOOSTS = 3;
    CONFIG.MAX_HEALTH_ITEMS = 2;
    CONFIG.MAX_GUN_ITEMS = 1;
    CONFIG.PICKUP_RANGE_PAD = 24 + run.pickupBonus;
    CONFIG.PISTOL_DAMAGE = 18 + run.damageBonus;
    CONFIG.PISTOL_COOLDOWN = Math.max(0.105, 0.19 - run.fireRateBonus);
    CONFIG.SENTRY_PLAYER_AIM_MIN_DOT = Math.max(0.10, 0.24 - run.aimBonus);
    CONFIG.SENTRY_PLAYER_AIM_LATERAL_PAD = 116 + run.aimBonus * 180;
    CONFIG.DEFENDER_AIM_TIME = 0.16;
    // Letters stay visible, but trees still conceal actors from Hunters.
    CONFIG.TREE_HIDE_CHANCE = 0;

    Object.assign(BASES.blue, {
      ...SOLO_DOCK,
      c: '#e4ca62',
    });
  }

  function rectContainsPoint(rect, x, y, padding = 0) {
    return x >= rect.x - padding && x <= rect.x + rect.w + padding &&
      y >= rect.y - padding && y <= rect.y + rect.h + padding;
  }

  function soloPointClear(x, y, radius = 18) {
    if (rectContainsPoint(SOLO_DOCK, x, y, radius + 28)) return false;
    if (trees.some(tree => Math.hypot(tree.x - x, tree.y - y) < tree.r + radius + 8)) return false;
    if (soloMines.some(mine => Math.hypot(mine.x - x, mine.y - y) < mine.r + radius + 40)) return false;
    if (soloDrops.some(drop => Math.hypot(drop.x - x, drop.y - y) < radius + 44)) return false;
    if (walls.some(wall => {
      const nearestX = clamp(x, wall.x, wall.x + wall.w);
      const nearestY = clamp(y, wall.y, wall.y + wall.h);
      return Math.hypot(x - nearestX, y - nearestY) < radius + 12;
    })) return false;
    if (items.some(item => Math.hypot(item.x - x, item.y - y) < item.r + radius + 22)) return false;
    if ((ACTORS || []).some(actor => actor.alive !== false && Math.hypot(actor.x - x, actor.y - y) < actor.r + radius + 48)) return false;
    return true;
  }

  function randomOpenSoloPoint(radius = 18) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const x = 72 + Math.random() * (CONFIG.W - 144);
      const y = 108 + Math.random() * (CONFIG.H - 235);
      if (soloPointClear(x, y, radius)) return { x, y };
    }
    return {
      x: 120 + Math.random() * 760,
      y: 150 + Math.random() * 320,
    };
  }

  function rectsOverlap(a, b, padding = 0) {
    return a.x < b.x + b.w + padding &&
      a.x + a.w + padding > b.x &&
      a.y < b.y + b.h + padding &&
      a.y + a.h + padding > b.y;
  }

  function circleTouchesRect(circle, rect, padding = 0) {
    const nearestX = clamp(circle.x, rect.x, rect.x + rect.w);
    const nearestY = clamp(circle.y, rect.y, rect.y + rect.h);
    return Math.hypot(circle.x - nearestX, circle.y - nearestY) <
      (circle.r || 0) + padding;
  }

  function soloMazeRectAllowed(rect) {
    if (rectsOverlap(rect, SOLO_DOCK, 48)) return false;
    if (trees.some(tree => circleTouchesRect(tree, rect, 18))) return false;
    if (soloMines.some(mine => circleTouchesRect(mine, rect, 28))) return false;
    if (soloDrops.some(drop => circleTouchesRect({ ...drop, r: 18 }, rect, 22))) return false;
    if (items.some(item => circleTouchesRect(item, rect, 24))) return false;
    if ((ACTORS || []).some(actor => actor.alive !== false && circleTouchesRect(actor, rect, 34))) return false;
    return true;
  }

  function removeSoloMazeWalls() {
    for (let index = walls.length - 1; index >= 0; index--) {
      if (walls[index].soloMaze) walls.splice(index, 1);
    }
    if (typeof navigationGridCache !== 'undefined') navigationGridCache.clear();
    if (typeof mazeRevision !== 'undefined') mazeRevision += 1;
  }

  function mazeWallsForPattern(index, ghost = false) {
    const pattern = SOLO_MAZE_PATTERNS[index % SOLO_MAZE_PATTERNS.length] || [];
    return pattern
      .filter(soloMazeRectAllowed)
      .map(rect => ({
        ...rect,
        team: 'neutral',
        field: true,
        soloMaze: true,
        ghost,
      }));
  }

  function applySoloMazePattern(index) {
    removeSoloMazeWalls();
    walls.push(...mazeWallsForPattern(index));
    if (typeof navigationGridCache !== 'undefined') navigationGridCache.clear();
    if (typeof mazeRevision !== 'undefined') mazeRevision += 1;
  }

  function beginSoloMaze() {
    const run = state.soloRun;
    if (!run) return;
    run.mazePatternIndex = run.roundIndex % SOLO_MAZE_PATTERNS.length;
    run.nextMazePatternIndex = (run.mazePatternIndex + 1) % SOLO_MAZE_PATTERNS.length;
    run.mazePhase = 'ACTIVE';
    run.mazeTimer = 18 + Math.random() * 5;
    soloMazeGhostWalls.length = 0;
    applySoloMazePattern(run.mazePatternIndex);
  }

  function updateSoloMaze(dt) {
    const run = state.soloRun;
    if (!run) return;
    run.mazeTimer -= dt;
    if (run.mazeTimer > 0) return;

    if (run.mazePhase === 'ACTIVE') {
      run.nextMazePatternIndex = (run.mazePatternIndex + 1) % SOLO_MAZE_PATTERNS.length;
      soloMazeGhostWalls.length = 0;
      soloMazeGhostWalls.push(...mazeWallsForPattern(run.nextMazePatternIndex, true));
      run.mazePhase = 'WARNING';
      run.mazeTimer = SOLO_MAZE_WARNING_TIME;
      return;
    }

    if (run.mazePhase === 'WARNING') {
      removeSoloMazeWalls();
      soloMazeGhostWalls.length = 0;
      run.mazePhase = 'OPEN';
      run.mazeTimer = SOLO_MAZE_OPEN_TIME;
      return;
    }

    run.mazePatternIndex = run.nextMazePatternIndex;
    applySoloMazePattern(run.mazePatternIndex);
    run.mazePhase = 'ACTIVE';
    run.mazeTimer = 17 + Math.random() * 6;
  }

  function drawSoloMazeWarning() {
    if (!soloActive() || state.soloRun?.mazePhase !== 'WARNING') return;
    const pulse = 0.15 + (Math.sin(simTime * 9) + 1) * 0.08;
    ctx.save();
    ctx.setLineDash([7, 6]);
    for (const wall of soloMazeGhostWalls) {
      ctx.fillStyle = `rgba(241,202,92,${pulse})`;
      ctx.strokeStyle = 'rgba(255,236,170,.78)';
      ctx.lineWidth = 2;
      ctx.fillRect(wall.x, wall.y, wall.w, wall.h);
      ctx.strokeRect(wall.x, wall.y, wall.w, wall.h);
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  function queueSoloDrop(type, options = {}) {
    const point = options.point || randomOpenSoloPoint(type === 'mine' ? 22 : 18);
    soloDrops.push({
      type,
      char: options.char || null,
      x: point.x,
      y: point.y,
      delay: Math.max(0, options.delay || 0),
      time: 0,
      duration: options.duration || 0.82,
      landed: false,
    });
  }

  function landSoloDrop(drop) {
    if (drop.type === 'mine') {
      soloMines.push({
        x: drop.x,
        y: drop.y,
        r: 16,
        armedAt: simTime + 0.72,
        phase: Math.random() * Math.PI * 2,
      });
      return;
    }

    const item = createItemAt(drop.type, drop.x, drop.y, {
      char: drop.char || undefined,
      revealed: true,
      revealTime: simTime,
      bornAt: simTime,
    });
    item.hiddenByTree = null;
    item.revealed = true;
    item.soloDrop = true;
  }

  function updateSoloDrops(dt) {
    for (let index = soloDrops.length - 1; index >= 0; index--) {
      const drop = soloDrops[index];
      if (drop.delay > 0) {
        drop.delay -= dt;
        continue;
      }
      drop.time += dt;
      if (drop.time < drop.duration) continue;
      landSoloDrop(drop);
      soloDrops.splice(index, 1);
    }
  }

  function neededLetterStillInPlay(char) {
    if (soloCargo().includes(char)) return true;
    if (items.some(item => item.type === 'letter' && item.char === char)) return true;
    if (soloDrops.some(drop => drop.type === 'letter' && drop.char === char)) return true;
    return false;
  }

  function scheduleCriticalLetter() {
    const missing = getMissingLetters('blue');
    if (!missing.length) return;

    const demand = new Map();
    for (const char of missing) demand.set(char, (demand.get(char) || 0) + 1);

    for (const char of demand.keys()) {
      if (!neededLetterStillInPlay(char)) {
        const urgent = state.seconds <= 24;
        let point = null;
        if (urgent && player) {
          for (let attempt = 0; attempt < 24; attempt++) {
            const angle = Math.random() * Math.PI * 2;
            const radius = 55 + Math.random() * 90;
            const x = clamp(player.x + Math.cos(angle) * radius, 55, CONFIG.W - 55);
            const y = clamp(player.y + Math.sin(angle) * radius, 105, CONFIG.H - 145);
            if (soloPointClear(x, y, 18)) {
              point = { x, y };
              break;
            }
          }
        }
        queueSoloDrop('letter', { char, point: point || undefined, delay: 0.15 });
        return;
      }
    }
  }

  function scheduleOpeningField() {
    const word = getTeamWord('blue');
    const chars = [...word];
    for (let index = chars.length - 1; index > 0; index--) {
      const swap = Math.floor(Math.random() * (index + 1));
      [chars[index], chars[swap]] = [chars[swap], chars[index]];
    }

    chars.forEach((char, index) => {
      queueSoloDrop('letter', {
        char,
        delay: 0.25 + index * 0.48,
        duration: 0.72,
      });
    });

    for (let index = 0; index < 3; index++) {
      queueSoloDrop('letter', {
        char: ALPHABET[Math.floor(Math.random() * ALPHABET.length)],
        delay: 1.4 + index * 1.1,
      });
    }

    const settings = currentSettings();
    for (let index = 0; index < settings.mines; index++) {
      queueSoloDrop('mine', { delay: 1.2 + index * 0.75 });
    }

    queueSoloDrop('health', { delay: 4.2 });
    queueSoloDrop(state.soloRun.roundIndex >= 2 ? 'carry3' : 'carry2', { delay: 5.4 });
    if (state.soloRun.roundIndex >= 1) queueSoloDrop('speed', { delay: 6.2 });
    if (state.soloRun.roundIndex >= 2) queueSoloDrop('gun', { delay: 8.0 });
  }

  function dropRandomSupply() {
    const roll = Math.random();
    if (player && player.health < player.maxHealth * 0.48 && roll < 0.48) {
      queueSoloDrop('health');
      return;
    }
    if (roll < 0.58) {
      const missing = getMissingLetters('blue');
      const char = missing.length && Math.random() < 0.72
        ? missing[Math.floor(Math.random() * missing.length)]
        : ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
      queueSoloDrop('letter', { char });
      return;
    }
    if (roll < 0.76) {
      queueSoloDrop('speed');
      return;
    }
    if (roll < 0.86) {
      queueSoloDrop('health');
      return;
    }
    if (roll < 0.94) {
      queueSoloDrop(Math.random() < 0.55 ? 'carry2' : 'carry3');
      return;
    }
    queueSoloDrop('gun');
  }

  function spawnPointOnEdge() {
    const side = Math.floor(Math.random() * 4);
    const margin = 34;
    if (side === 0) return { x: margin, y: 130 + Math.random() * 340 };
    if (side === 1) return { x: CONFIG.W - margin, y: 130 + Math.random() * 340 };
    if (side === 2) return { x: 130 + Math.random() * 740, y: 104 };
    return { x: 130 + Math.random() * 740, y: 500 };
  }

  function spawnSoloHunter() {
    if (!soloActive() || !player) return null;
    const settings = currentSettings();
    const point = spawnPointOnEdge();
    const hunter = createActor(
      point.x,
      point.y,
      'red',
      'RUNNER',
      settings.hunterSpeed
    );

    hunter.publicRole = 'HUNTER';
    hunter.soloShooter = true;
    hunter.maxHealth = settings.hunterHealth;
    hunter.health = settings.hunterHealth;
    hunter.lives = 1;
    hunter.weaponTier = 1;
    hunter.gunAmmo = 0;
    hunter.soloShotDamage = settings.hunterDamage;
    hunter.soloShotCooldown = settings.hunterCooldown;
    hunter.soloShotRange = 410;
    hunter.soloShotSpeed = 610;
    hunter.soloOrbitSign = Math.random() < 0.5 ? -1 : 1;
    hunter.soloOrbitTimer = 1.5 + Math.random() * 2.5;
    hunter.soloSpawnGrace = 0.85;
    hunter.shootCooldown = 0.9 + Math.random() * 0.6;
    hunter.soloLastSeenX = player.x;
    hunter.soloLastSeenY = player.y;
    hunter.soloSearchPhase = Math.random() * Math.PI * 2;

    bots.push(hunter);
    ACTORS.push(hunter);
    soloSpawnWarnings.push({ x: point.x, y: point.y, time: 0.85, max: 0.85 });
    return hunter;
  }

  function removeSoloHunter(hunter) {
    const botIndex = bots.indexOf(hunter);
    if (botIndex >= 0) bots.splice(botIndex, 1);
    const actorIndex = ACTORS.indexOf(hunter);
    if (actorIndex >= 0) ACTORS.splice(actorIndex, 1);
  }

  function activeHunters() {
    return (bots || []).filter(bot => bot.soloShooter && bot.alive !== false);
  }

  function updateSoloHunter(hunter, dt) {
    if (!player || player.alive === false || hunter.alive === false) return;

    decayTimers(hunter, dt);
    hunter.soloSpawnGrace = Math.max(0, (hunter.soloSpawnGrace || 0) - dt);
    hunter.soloOrbitTimer -= dt;
    if (hunter.soloOrbitTimer <= 0) {
      hunter.soloOrbitSign *= -1;
      hunter.soloOrbitTimer = 1.35 + Math.random() * 2.2;
    }

    updateActorTreeCover();
    const canSeeCaptain = actorsCanSee(hunter, player);
    if (canSeeCaptain) {
      hunter.soloLastSeenX = player.x;
      hunter.soloLastSeenY = player.y;
    }

    // Trees genuinely break pursuit. A Hunter searches the last visible point
    // instead of tracking the Captain through the canopy.
    const leadTime = player.inv?.type === 'letter' ? 0.26 : 0.17;
    const searchRadius = canSeeCaptain ? 0 : 28;
    const targetX = canSeeCaptain
      ? player.x + (player.vx || 0) * leadTime
      : (hunter.soloLastSeenX ?? player.x) + Math.cos(simTime * 1.7 + hunter.soloSearchPhase) * searchRadius;
    const targetY = canSeeCaptain
      ? player.y + (player.vy || 0) * leadTime
      : (hunter.soloLastSeenY ?? player.y) + Math.sin(simTime * 1.7 + hunter.soloSearchPhase) * searchRadius;
    const dx = targetX - hunter.x;
    const dy = targetY - hunter.y;
    const distance = Math.hypot(dx, dy) || 1;
    const nx = dx / distance;
    const ny = dy / distance;
    const tangentX = -ny * hunter.soloOrbitSign;
    const tangentY = nx * hunter.soloOrbitSign;

    const lowHealth = hunter.health <= hunter.maxHealth * 0.34;
    const captainHasLetter = player.inv?.type === 'letter';
    const desiredRange = !canSeeCaptain ? 72 : lowHealth ? 350 : captainHasLetter ? 190 : 245;
    let radial = clamp((distance - desiredRange) / 105, -1, 1);
    let strafe = canSeeCaptain
      ? (distance < 470 ? 0.92 : 0.42)
      : 0.34;

    // A Hunter that was just hit dodges rather than freezing in the same arc.
    if ((hunter.damageFlash || 0) > 0.04) {
      strafe *= 1.34;
      radial -= 0.12;
    }

    let moveX = nx * radial + tangentX * strafe;
    let moveY = ny * radial + tangentY * strafe;

    // Do not make the AI look suicidal: Hunters steer around visible mines.
    for (const mine of soloMines) {
      const mineDx = hunter.x - mine.x;
      const mineDy = hunter.y - mine.y;
      const mineDistance = Math.hypot(mineDx, mineDy) || 1;
      if (mineDistance > 112) continue;
      const strength = (112 - mineDistance) / 112 * 1.7;
      moveX += (mineDx / mineDistance) * strength;
      moveY += (mineDy / mineDistance) * strength;
    }

    // Slide around the temporary solo maze instead of repeatedly colliding
    // with the same wall edge.
    for (const wall of walls) {
      if (!wall.soloMaze) continue;
      const nearestX = clamp(hunter.x, wall.x, wall.x + wall.w);
      const nearestY = clamp(hunter.y, wall.y, wall.y + wall.h);
      const wallDx = hunter.x - nearestX;
      const wallDy = hunter.y - nearestY;
      const wallDistance = Math.hypot(wallDx, wallDy) || 1;
      if (wallDistance > 62) continue;
      const strength = (62 - wallDistance) / 62 * 1.65;
      moveX += (wallDx / wallDistance) * strength;
      moveY += (wallDy / wallDistance) * strength;
    }

    // Keep multiple Hunters spread out so the player sees a moving crossfire
    // rather than one stacked red blob.
    for (const other of activeHunters()) {
      if (other === hunter) continue;
      const otherDx = hunter.x - other.x;
      const otherDy = hunter.y - other.y;
      const otherDistance = Math.hypot(otherDx, otherDy) || 1;
      if (otherDistance > 74) continue;
      const strength = (74 - otherDistance) / 74 * 0.95;
      moveX += (otherDx / otherDistance) * strength;
      moveY += (otherDy / otherDistance) * strength;
    }

    const moveLength = Math.hypot(moveX, moveY) || 1;
    moveX /= moveLength;
    moveY /= moveLength;

    hunter.facingX += (nx - hunter.facingX) * (1 - Math.exp(-18 * dt));
    hunter.facingY += (ny - hunter.facingY) * (1 - Math.exp(-18 * dt));
    const facingLength = Math.hypot(hunter.facingX, hunter.facingY) || 1;
    hunter.facingX /= facingLength;
    hunter.facingY /= facingLength;

    driveActor(hunter, moveX, moveY, dt, true);
  }

  function detonateMine(mine) {
    const index = soloMines.indexOf(mine);
    if (index >= 0) soloMines.splice(index, 1);

    explosions.push({
      x: mine.x,
      y: mine.y,
      r: 0,
      a: 0.92,
      maxR: 80,
      growRate: 410,
    });

    if (!player || player.alive === false) return;
    const settings = currentSettings();
    const damage = Math.round(settings.mineDamage * state.soloRun.mineDamageScale);
    damageRaider(player, damage, null);

    const dx = player.x - mine.x;
    const dy = player.y - mine.y;
    const distance = Math.hypot(dx, dy) || 1;
    player.vx += (dx / distance) * 330;
    player.vy += (dy / distance) * 330;
    player.stunTimer = Math.max(player.stunTimer, 0.16);
    navigator.vibrate?.([35, 25, 45]);
  }

  function updateSoloMines(dt) {
    if (!player || player.alive === false) return;
    for (let index = soloMines.length - 1; index >= 0; index--) {
      const mine = soloMines[index];
      if (simTime < mine.armedAt) continue;
      if (Math.hypot(player.x - mine.x, player.y - mine.y) <= player.r + mine.r + 2) {
        detonateMine(mine);
      }
    }
  }

  function updateSpawnWarnings(dt) {
    for (let index = soloSpawnWarnings.length - 1; index >= 0; index--) {
      soloSpawnWarnings[index].time -= dt;
      if (soloSpawnWarnings[index].time <= 0) soloSpawnWarnings.splice(index, 1);
    }
  }

  function updateSoloHud() {
    const visible = soloActive() && player;
    soloHudEl?.classList.toggle('hidden', !visible);
    document.documentElement.classList.toggle('solo-running', Boolean(visible));
    if (!visible) return;

    const health = Math.max(0, Math.ceil(player.health || 0));
    const healthRatio = player.maxHealth > 0
      ? clamp(player.health / player.maxHealth, 0, 1)
      : 0;

    if (soloHealthTextEl) soloHealthTextEl.textContent = `${health}`;
    if (soloHealthFillEl) {
      soloHealthFillEl.style.width = `${Math.round(healthRatio * 100)}%`;
      soloHealthFillEl.classList.toggle('danger', healthRatio <= 0.28);
    }
    if (soloWordProgressEl) {
      soloWordProgressEl.textContent = `WORD ${state.soloRun.roundIndex + 1}/${WORD_COUNT} · CARRY ${soloCargo().length}/${state.soloRun.carryCapacity || 1}`;
    }
    if (soloKillsTextEl) soloKillsTextEl.textContent = `${state.soloRun.kills}`;
    const hiddenInTree = player.coverTreeId != null;
    soloCoverStatusEl?.classList.toggle('hidden', !hiddenInTree);
  }

  function randomUpgradeChoices(count = 3) {
    const copy = [...upgradeDefinitions];
    for (let index = copy.length - 1; index > 0; index--) {
      const swap = Math.floor(Math.random() * (index + 1));
      [copy[index], copy[swap]] = [copy[swap], copy[index]];
    }
    return copy.slice(0, count);
  }

  function showSoloUpgrade() {
    const run = state.soloRun;
    if (!run || !upgradeChoicesEl) return;
    upgradeChoicesEl.replaceChildren();
    if (upgradeSummaryEl) {
      upgradeSummaryEl.textContent = `HP ${Math.ceil(player.health)} · ${run.kills} hunters down`;
    }

    for (const upgrade of randomUpgradeChoices()) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'solo-upgrade-option';
      button.innerHTML = `<strong>${upgrade.name}</strong><span>${upgrade.description}</span>`;
      button.addEventListener('click', () => {
        upgrade.apply(run);
        run.chosenUpgrades.push(upgrade.id);
        upgradeScreenEl?.classList.add('hidden');
        globalThis.startSoloWord?.(run.roundIndex + 1);
      }, { once: true });
      upgradeChoicesEl.appendChild(button);
    }

    upgradeScreenEl?.classList.remove('hidden');
  }

  function resetCaptainForWord(firstWord) {
    const previousHealth = player.health;
    resetActorForRound(player);
    player.publicRole = 'CAPTAIN';
    player.role = 'CAPTAIN';
    player.maxSpeed = ROLE_SPEEDS.CAPTAIN * (1 + state.soloRun.speedBonus);
    player.maxHealth = 100 + state.soloRun.healthBonus;
    player.health = firstWord
      ? player.maxHealth
      : Math.min(player.maxHealth, Math.max(1, previousHealth) + 24);
    player.weaponTier = Math.max(1, player.weaponTier || 1);
    player.gunAmmo = player.weaponTier >= 2 ? Math.max(player.gunAmmo || 0, 8) : 0;
    player.lives = 1;
    player.alive = true;
    player.x = CONFIG.W / 2;
    player.y = SOLO_DOCK.y - 44;
    player.prevX = player.x;
    player.prevY = player.y;
    player.facingX = 0;
    player.facingY = -1;
    state.soloRun.letterCargo = [];
    syncSoloCargoInventory(player);
  }

  function startSoloWord(index = 0) {
    const run = state.soloRun;
    if (!run || !player) return;

    const firstWord = index === 0 && run.wordsCompleted === 0;
    run.roundIndex = index;
    run.roundKills = 0;
    run.resolving = false;
    run.finished = false;
    run.hunterTimer = index === 0 ? 3.1 : 2.6;
    run.mineTimer = 8.5;
    run.dropTimer = 3.4;
    run.criticalLetterTimer = 3.0;
    run.wordStartedAt = simTime;

    state.demoMatch.roundIndex = index;
    state.demoMatch.resolving = false;
    state.demoMatch.finished = false;
    state.demoMatch.currentAssignment = {
      role: 'CAPTAIN', duty: null, label: 'Word Hunter',
      job: 'Find letters, avoid mines and shoot Hunters.',
    };
    state.demoMatch.nextAssignment = null;

    configureSoloRules();
    applyRoundWords(index);
    state.seconds = CONFIG.ROUND_SECONDS;
    state.spawnTimer = 9999;
    state.intelTimer = Infinity;
    state.worldEventTimer = Infinity;
    state.internalBombTimer = Infinity;
    if (state.eventDirector) {
      state.eventDirector.nextAt = Infinity;
      state.eventDirector.activeType = '';
      state.eventDirector.activeUntil = 0;
    }
    if (typeof combatSupplyTimer !== 'undefined') combatSupplyTimer = 9999;

    clearRoundObjects();
    walls.length = 0;
    soloMazeGhostWalls.length = 0;
    soloDrops.length = 0;
    soloMines.length = 0;
    soloSpawnWarnings.length = 0;

    for (const hunter of [...bots]) {
      if (hunter.soloShooter) removeSoloHunter(hunter);
    }
    bots.length = 0;
    ACTORS = [player];

    resetCaptainForWord(firstWord);
    beginSoloMaze();
    scheduleOpeningField();

    state.over = false;
    state.paused = false;
    document.documentElement.classList.remove('round-ended', 'game-paused');
    document.querySelector('#pauseMenu')?.classList.add('hidden');
    document.querySelector('#pauseBtn')?.setAttribute('aria-expanded', 'false');
    roundScreenEl?.classList.add('hidden');
    upgradeScreenEl?.classList.add('hidden');
    if (hudLayer) hudLayer.style.display = 'block';

    if (timerEl) {
      timerEl.textContent = `${Math.floor(state.seconds / 60)}:${String(state.seconds % 60).padStart(2, '0')}`;
    }
    if (bsEl) bsEl.textContent = shuffle(getTeamWord('blue'));
    const blueLabel = document.querySelector('.team.blue .label');
    if (blueLabel) blueLabel.textContent = 'JUMBLED — FORM THE WORD';
    document.querySelector('.team.red')?.setAttribute('aria-hidden', 'true');
    const roleChip = document.querySelector('#currentRoleChip');
    if (roleChip) roleChip.textContent = 'WORD HUNT';

    updateRoundHud();
    updateRoleStrip('CAPTAIN');
    updateActorTreeCover();
    updateContextHint();
    updateSoloHud();
    globalThis.refreshMobileLayout?.();
    msg(`Find the letters. Stay alive.`);
  }

  function showSoloFinal(success, reason) {
    const run = state.soloRun;
    run.finished = true;
    state.demoMatch.finished = true;
    state.demoMatch.resolving = true;
    state.over = true;
    document.documentElement.classList.add('round-ended');

    if (resultKickerEl) {
      resultKickerEl.textContent = `WORD HUNT · ${run.wordsCompleted}/${WORD_COUNT} WORDS`;
    }
    if (resultTitleEl) resultTitleEl.textContent = success ? 'RUN CLEARED' : 'RUN ENDED';
    if (resultTextEl) resultTextEl.textContent = reason;
    nextRolePreviewEl?.classList.add('hidden');
    if (resultButtonEl) resultButtonEl.textContent = 'PLAY AGAIN';
    roundScreenEl?.classList.remove('hidden');
  }

  function finishSoloWord(success, reason = '') {
    const run = state.soloRun;
    if (!run || run.resolving || run.finished) return;
    run.resolving = true;
    state.demoMatch.resolving = true;
    state.over = true;

    if (!success) {
      showSoloFinal(false, reason || 'You were taken down before completing the word.');
      return;
    }

    run.wordsCompleted += 1;
    state.demoMatch.score.blue = run.wordsCompleted;
    updateRoundHud();

    if (run.wordsCompleted >= WORD_COUNT) {
      showSoloFinal(true, `Five words complete · ${run.kills} Hunters defeated.`);
      return;
    }

    showSoloUpgrade();
  }

  function resolveSoloTimedRound() {
    if (!soloActive() || state.soloRun?.resolving) return;
    globalThis.finishSoloWord?.(false, 'Time ran out before the word was complete.');
  }

  function initializeSoloRun() {
    state.soloRun = createSoloState();
    state.demoMatch.roundIndex = 0;
    state.demoMatch.score.blue = 0;
    state.demoMatch.score.red = 0;
    state.demoMatch.finished = false;
    state.demoMatch.resolving = false;
    globalThis.startSoloWord?.(0);
  }

  function openSoloBriefing() {
    document.querySelector('#modeScreen')?.classList.add('hidden');
    document.querySelector('#soloBriefingScreen')?.classList.remove('hidden');
  }

  function startSoloFromMenu() {
    document.querySelector('#modeScreen')?.classList.add('hidden');
    document.querySelector('#soloBriefingScreen')?.classList.add('hidden');
    startGame('CAPTAIN', null);
  }

  document.querySelector('#soloStartBtn')?.addEventListener('click', startSoloFromMenu);
  document.querySelector('#soloBriefingBackBtn')?.addEventListener('click', () => {
    selectedSessionMode = null;
    document.querySelector('#soloBriefingScreen')?.classList.add('hidden');
    document.querySelector('#modeScreen')?.classList.remove('hidden');
  });

  // ----------------------------------------------------------------
  // Contextual Captain capabilities
  // ----------------------------------------------------------------
  const baseIsInnerSentry = isInnerSentry;
  isInnerSentry = function soloOpenFieldShooter(actor) {
    if (soloActive() && (actor?.isPlayer && publicRoleOf(actor) === 'CAPTAIN')) return true;
    if (soloActive() && actor?.soloShooter) return true;
    return baseIsInnerSentry(actor);
  };

  ROLE_RULES.CAPTAIN = {
    job: 'Find the word before the field takes you down',
    summary: 'Letters · pistol · health · speed',
    allowed: ['letter', 'health', 'speed', 'gun', 'carry2', 'carry3'],
  };

  const baseCanActorCollectItem = canActorCollectItem;
  canActorCollectItem = function soloCaptainCanCollect(actor, item) {
    if (soloActive() && actor?.isPlayer && publicRoleOf(actor) === 'CAPTAIN') {
      if (!item || actor.alive === false) return false;
      if (item.type === 'letter') return soloCargoHasRoom();
      if (['carry2', 'carry3'].includes(item.type)) {
        const offered = item.type === 'carry3' ? 3 : 2;
        return offered > (state.soloRun.carryCapacity || 1);
      }
      if (actor.inv && !globalThis.isInstantPowerupItem?.(item)) return false;
      if (item.type === 'health') return actor.health < actor.maxHealth;
      if (item.type === 'gun') return actor.weaponTier < 2 || actor.gunAmmo < CONFIG.RIFLE_AMMO;
      return ['health', 'speed', 'gun'].includes(item.type);
    }
    return baseCanActorCollectItem(actor, item);
  };

  const baseGetItemRoleLabel = getItemRoleLabel;
  getItemRoleLabel = function soloItemRoleLabel(item) {
    if (soloActive()) return 'Word Hunter';
    return baseGetItemRoleLabel(item);
  };

  function pickupSoloItem(actor, item) {
    if (!actor || !item) return false;
    if (item.type === 'letter') return collectSoloLetter(actor, item);
    if (['carry2', 'carry3'].includes(item.type)) return applyCarryPowerup(actor, item);
    const temporaryRole = item.type === 'gun' ? 'DEFENDER' : 'OPERATOR';
    return withTemporaryRole(actor, temporaryRole, () => pickup(actor, item));
  }

  function collectTouchedSoloItem() {
    const run = state.soloRun;
    if (!run || !player || player.alive === false) return false;
    if (run.autoPickupCooldown > 0) return false;

    const touched = items
      .filter(item =>
        isItemVisible(item) &&
        canActorCollectItem(player, item) &&
        (!player.inv || item.type === 'letter' || ['carry2', 'carry3'].includes(item.type) || globalThis.isInstantPowerupItem?.(item)) &&
        !isRecentlyDropped(player, item)
      )
      .map(item => ({ item, distance: dist(player, item) }))
      .filter(entry => entry.distance <= player.r + entry.item.r + 9)
      .sort((a, b) => {
        const aUseful = a.item.type === 'letter' && getMissingLetters('blue').includes(a.item.char) ? 1 : 0;
        const bUseful = b.item.type === 'letter' && getMissingLetters('blue').includes(b.item.char) ? 1 : 0;
        return bUseful - aUseful || a.distance - b.distance;
      })[0]?.item || null;

    if (!touched) return false;
    const collected = pickupSoloItem(player, touched);
    if (collected) run.autoPickupCooldown = 0.12;
    return collected;
  }

  function captainCapability(actor) {
    if (actor.inv?.type === 'letter') return 'OPERATOR';

    const nearby = preferredActionItem(actor, item =>
      isItemVisible(item) && canActorCollectItem(actor, item)
    );
    if (nearby) return 'OPERATOR';

    return 'DEFENDER';
  }

  const baseActionCapabilityFor = actionCapabilityFor;
  actionCapabilityFor = function soloCaptainCapability(actor) {
    if (soloActive() && actor?.isPlayer && publicRoleOf(actor) === 'CAPTAIN') {
      return captainCapability(actor);
    }
    return baseActionCapabilityFor(actor);
  };

  const baseBotCapabilityFor = botCapabilityFor;
  botCapabilityFor = function soloHunterCapability(bot) {
    if (soloActive() && bot?.soloShooter) return 'DEFENDER';
    return baseBotCapabilityFor(bot);
  };

  const baseUpdateBot = updateBot;
  updateBot = function soloHunterUpdate(bot, dt) {
    if (soloActive() && bot?.soloShooter) {
      updateSoloHunter(bot, dt);
      return;
    }
    return baseUpdateBot(bot, dt);
  };

  const baseEliminateActor = eliminateActor;
  eliminateActor = function soloEliminateActor(actor, killer = null) {
    if (!(soloActive() && actor?.soloShooter)) {
      return baseEliminateActor(actor, killer);
    }

    if (actor.alive === false) return;
    actor.alive = false;
    actor.health = 0;
    actor.vx = 0;
    actor.vy = 0;
    actor.inv = null;
    clearReservation(actor);
    state.soloRun.kills += 1;
    state.soloRun.roundKills += 1;

    explosions.push({
      x: actor.x,
      y: actor.y,
      r: 0,
      a: 0.78,
      maxR: 42,
      growRate: 280,
    });

    const point = { x: actor.x, y: actor.y };
    removeSoloHunter(actor);

    const rewardRoll = Math.random();
    if (rewardRoll < 0.30) queueSoloDrop('health', { point, delay: 0.05, duration: 0.48 });
    else if (rewardRoll < 0.47) queueSoloDrop('speed', { point, delay: 0.05, duration: 0.48 });
    else if (rewardRoll < 0.60) {
      const missing = getMissingLetters('blue');
      if (missing.length) {
        queueSoloDrop('letter', {
          char: missing[Math.floor(Math.random() * missing.length)],
          point,
          delay: 0.05,
          duration: 0.48,
        });
      }
    }
  };

  const baseLegalDefenderTargets = legalDefenderTargets;
  legalDefenderTargets = function soloOpenTargets(defender) {
    if (!soloActive()) return baseLegalDefenderTargets(defender);
    if (!defender || defender.alive === false || !isInnerSentry(defender)) return [];

    const profile = weaponProfile(defender);
    return (ACTORS || []).filter(actor =>
      actor.alive !== false &&
      actor.team !== defender.team &&
      (actor.soloShooter || actor.isPlayer) &&
      actorsCanSee(defender, actor) &&
      dist(defender, actor) <= profile.range &&
      clearShotLine(defender, actor)
    );
  };

  const baseGetContextTarget = getContextTarget;
  getContextTarget = function soloContextTarget() {
    if (!soloActive() || !player || publicRoleOf(player) !== 'CAPTAIN') {
      return baseGetContextTarget();
    }

    if (soloCargo().length) {
      const slot = slotFromHorizontalPosition(player, 'blue');
      if (slot) {
        return {
          kind: 'slot',
          slot,
          team: 'blue',
          allowed: true,
          text: `Place ${soloCargo()[0]} · ${soloCargo().length} carried`,
        };
      }
    }

    const item = preferredActionItem(player, candidate =>
      isItemVisible(candidate) &&
      canActorCollectItem(player, candidate) &&
      !isRecentlyDropped(player, candidate)
    );
    if (item) {
      return {
        kind: 'item',
        item,
        allowed: true,
        text: `Pick ${['carry2','carry3'].includes(item.type) ? '+' + (item.type === 'carry3' ? '3' : '2') : getItemDisplayName(item)}`,
      };
    }

    const target = directionalDefenderTarget(player);
    if (target) {
      return {
        kind: 'raider',
        actor: target,
        allowed: player.shootCooldown <= 0,
        text: 'Fire',
      };
    }

    if (soloCargo().length) {
      return {
        kind: 'drop',
        allowed: true,
        text: `Drop ${soloCargo()[0]}`,
      };
    }

    return {
      kind: 'aim',
      allowed: true,
      text: 'Fire',
    };
  };

  const baseSoloAction = action;
  action = function soloCaptainAction(actor) {
    if (!(soloActive() && actor?.isPlayer && publicRoleOf(actor) === 'CAPTAIN')) {
      return baseSoloAction(actor);
    }
    if (state.over || actor.alive === false) return;

    const nearbyItem = preferredActionItem(actor, item =>
      isItemVisible(item) && canActorCollectItem(actor, item)
    );
    if (nearbyItem && pickupSoloItem(actor, nearbyItem)) return;

    if (soloCargo().length) {
      syncSoloCargoInventory(actor);
      const slot = slotFromHorizontalPosition(actor, 'blue');
      if (slot) {
        const placed = withTemporaryRole(actor, 'OPERATOR', () => deposit(actor));
        if (placed) {
          if (actor.inv?.type === 'letter') soloCargo()[0] = actor.inv.char;
          else soloCargo().shift();
          syncSoloCargoInventory(actor);
          return;
        }
      }

      const target = directionalDefenderTarget(actor);
      if (target) {
        shootDefender(actor, false, target);
        return;
      }

      const dropped = soloCargo().shift();
      syncSoloCargoInventory(actor);
      items.push({
        type: 'letter', char: dropped,
        x: clamp(actor.x + Math.cos(simTime * 10) * CONFIG.DROP_ITEM_OFFSET, 20, CONFIG.W - 20),
        y: clamp(actor.y + Math.sin(simTime * 10) * CONFIG.DROP_ITEM_OFFSET, 20, CONFIG.H - 20),
        r: CONFIG.ITEM_RADIUS_LETTER,
        ignited: false, timer: 0, droppedBy: actor, dropTime: simTime,
        hiddenByTree: null, revealed: true, revealTime: 0,
      });
      state.soloRun.autoPickupCooldown = Math.max(
        state.soloRun.autoPickupCooldown || 0,
        CONFIG.DROP_REJECT_GRACE
      );
      msg(`Tile ${dropped} dropped · ${soloCargo().length}/${state.soloRun.carryCapacity} carried`);
      return;
    }

    const selectedSlot = slotFromHorizontalPosition(actor, 'blue');
    if (selectedSlot && getProgress('blue')[selectedSlot.index] && soloCargoHasRoom()) {
      const char = getProgress('blue')[selectedSlot.index];
      getProgress('blue')[selectedSlot.index] = null;
      soloCargo().push(char);
      syncSoloCargoInventory(actor);
      addSlotEffect('blue', selectedSlot.index, '#53d8fb');
      msg(`Picked '${char}' up · ${soloCargo().length}/${state.soloRun.carryCapacity} letters`);
      return;
    }

    const target = directionalDefenderTarget(actor);
    if (target) shootDefender(actor, false, target);
  };

  const baseActionLabelFromContext = actionLabelFromContext;
  actionLabelFromContext = function soloActionLabel(context = null) {
    if (!soloActive()) return baseActionLabelFromContext(context);
    const target = context || getContextTarget();
    if (target?.kind === 'item') return itemActionLabel(target.item);
    if (target?.kind === 'slot') return 'PLACE';
    if (target?.kind === 'drop') return 'DROP';
    return 'FIRE';
  };

  const baseUpdateRoleStrip = updateRoleStrip;
  updateRoleStrip = function soloRoleStrip(role, duty = null) {
    if (soloActive() && role === 'CAPTAIN') {
      if (roleStripEl) roleStripEl.innerHTML = '<strong>WORD HUNT</strong>Walk over tiles · Space / FIRE shoots';
      return;
    }
    return baseUpdateRoleStrip(role, duty);
  };

  // ----------------------------------------------------------------
  // Solo rendering
  // ----------------------------------------------------------------
  function drawSoloMines() {
    if (!soloActive()) return;
    for (const mine of soloMines) {
      const armed = simTime >= mine.armedAt;
      const pulse = 1 + Math.sin(simTime * 7 + mine.phase) * 0.10;
      ctx.save();
      ctx.translate(mine.x, mine.y);
      ctx.scale(pulse, pulse);
      ctx.beginPath();
      ctx.arc(0, 0, mine.r + 7, 0, Math.PI * 2);
      ctx.fillStyle = armed ? 'rgba(226,72,72,0.13)' : 'rgba(245,197,82,0.12)';
      ctx.fill();
      ctx.strokeStyle = armed ? '#e65353' : '#e2c35f';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, mine.r, 0, Math.PI * 2);
      ctx.fillStyle = armed ? '#6f2424' : '#665a2d';
      ctx.fill();
      ctx.strokeStyle = '#1a1d22';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#f3e6c7';
      ctx.font = 'bold 15px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('×', 0, 1);
      ctx.restore();
    }
  }

  function drawSoloDrops() {
    if (!soloActive()) return;
    for (const drop of soloDrops) {
      if (drop.delay > 0) continue;
      const progress = clamp(drop.time / drop.duration, 0, 1);
      const ease = 1 - Math.pow(1 - progress, 3);
      const fallingY = drop.y - (1 - ease) * 135;
      const shadowScale = 0.45 + ease * 0.55;
      const color = drop.type === 'mine' ? '#e65353'
        : drop.type === 'health' ? '#55d47b'
          : drop.type === 'speed' ? '#60c9ff'
            : drop.type === 'gun' ? '#b7c7dd'
              : ['carry2', 'carry3'].includes(drop.type) ? '#d99cff'
                : '#f4d06f';

      ctx.save();
      ctx.globalAlpha = 0.22 + progress * 0.52;
      ctx.beginPath();
      ctx.ellipse(drop.x, drop.y, 24 * shadowScale, 10 * shadowScale, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#15181d';
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(drop.x, drop.y, 25 - progress * 5, 0, Math.PI * 2);
      ctx.strokeStyle = `${color}aa`;
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.translate(drop.x, fallingY);
      ctx.fillStyle = color;
      ctx.strokeStyle = '#1a1d22';
      ctx.lineWidth = 2;
      if (drop.type === 'letter') {
        ctx.fillRect(-13, -13, 26, 26);
        ctx.strokeRect(-13, -13, 26, 26);
        ctx.fillStyle = '#2d250e';
        ctx.font = 'bold 16px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(drop.char || '?', 0, 1);
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, 13, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(
          drop.type === 'mine' ? '×'
            : drop.type === 'health' ? '+'
              : drop.type === 'speed' ? '»'
                : drop.type === 'carry2' ? '+2'
                  : drop.type === 'carry3' ? '+3'
                    : 'R',
          0,
          0
        );
      }
      ctx.restore();
    }
  }

  const baseDrawItems = drawItems;
  drawItems = function soloDrawItems() {
    if (soloActive()) drawSoloMines();
    baseDrawItems();
    if (soloActive()) {
      for (const item of items) {
        if (!['carry2', 'carry3'].includes(item.type) || !isItemVisible(item)) continue;
        ctx.save();
        ctx.beginPath();
        ctx.arc(item.x, item.y, item.r + 2, 0, Math.PI * 2);
        ctx.fillStyle = '#d99cff';
        ctx.fill();
        ctx.strokeStyle = '#24152f';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#24152f';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(item.type === 'carry3' ? '+3' : '+2', item.x, item.y);
        ctx.restore();
      }
      drawSoloDrops();
    }
  };

  const baseDrawWorldEffects = drawWorldEffects;
  drawWorldEffects = function soloWorldEffects() {
    baseDrawWorldEffects();
    if (!soloActive()) return;

    drawSoloMazeWarning();

    ctx.save();
    for (const warning of soloSpawnWarnings) {
      const progress = 1 - warning.time / warning.max;
      const radius = 12 + progress * 30;
      ctx.beginPath();
      ctx.arc(warning.x, warning.y, radius, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(235,78,78,${Math.max(0, 1 - progress)})`;
      ctx.lineWidth = 4;
      ctx.stroke();
    }

    for (const hunter of activeHunters()) {
      const x = hunter.x;
      const y = hunter.y;
      const fx = hunter.facingX || -1;
      const fy = hunter.facingY || 0;
      ctx.strokeStyle = '#ff8c72';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x + fx * 9, y + fy * 9);
      ctx.lineTo(x + fx * 19, y + fy * 19);
      ctx.stroke();
    }
    ctx.restore();
  };

  // ----------------------------------------------------------------
  // Solo flow wrappers
  // ----------------------------------------------------------------
  const baseWinner = winner;
  winner = function soloWinner() {
    if (!soloActive()) return baseWinner();
    if (state.over || state.soloRun?.resolving) return;
    if (isWordComplete('blue')) {
      globalThis.finishSoloWord?.(true, `${getTeamWord('blue')} complete.`);
    }
  };

  const baseTick = tick;
  tick = function soloTick(dt) {
    baseTick(dt);
    if (!soloActive() || state.over || !player) return;

    const run = state.soloRun;
    const settings = currentSettings();
    run.hunterTimer -= dt;
    run.mineTimer -= dt;
    run.dropTimer -= dt;
    run.criticalLetterTimer -= dt;
    run.autoPickupCooldown = Math.max(0, run.autoPickupCooldown - dt);

    updateActorTreeCover();
    updateSoloDrops(dt);
    updateSoloMines(dt);
    updateSoloMaze(dt);
    updateSpawnWarnings(dt);
    collectTouchedSoloItem();

    if (run.hunterTimer <= 0 && activeHunters().length < settings.hunterCap) {
      spawnSoloHunter();
      run.hunterTimer = settings.hunterSpawnEvery * (0.82 + Math.random() * 0.34);
    }

    if (run.mineTimer <= 0 && soloMines.length < settings.mines + 2) {
      queueSoloDrop('mine');
      run.mineTimer = settings.mineEvery * (0.82 + Math.random() * 0.35);
    }

    if (run.dropTimer <= 0) {
      dropRandomSupply();
      run.dropTimer = settings.dropEvery * (0.84 + Math.random() * 0.34);
    }

    if (run.criticalLetterTimer <= 0) {
      scheduleCriticalLetter();
      run.criticalLetterTimer = state.seconds <= 24 ? 1.8 : 3.2;
    }

    updateSoloHud();

    if (player.alive === false || player.health <= 0) {
      globalThis.finishSoloWord?.(false, 'A Hunter took you down before the word was complete.');
    }
  };

  globalThis.openSoloBriefing = openSoloBriefing;
  globalThis.startSoloFortressFromMenu = startSoloFromMenu;
  globalThis.initializeSoloRun = initializeSoloRun;
  globalThis.startSoloWord = startSoloWord;
  globalThis.finishSoloWord = finishSoloWord;
  globalThis.resolveSoloTimedRound = resolveSoloTimedRound;
  globalThis.updateSoloHud = updateSoloHud;
  globalThis.resetSoloRun = () => {
    state.soloRun = null;
    soloDrops.length = 0;
    soloMines.length = 0;
    soloSpawnWarnings.length = 0;
    soloMazeGhostWalls.length = 0;
    removeSoloMazeWalls();
    soloHudEl?.classList.add('hidden');
    soloCoverStatusEl?.classList.add('hidden');
    upgradeScreenEl?.classList.add('hidden');
    document.documentElement.classList.remove('solo-running');
    const blueLabel = document.querySelector('.team.blue .label');
    if (blueLabel) blueLabel.textContent = 'JUMBLED — FORM A WORD';
    document.querySelector('.team.red')?.removeAttribute('aria-hidden');
    restoreSharedRules();
  };
})();
