'use strict';

      const CONFIG = {
        W: 1000, H: 700,
        BLUE_WORD: 'TEAMWORK', RED_WORD: 'TOGETHER',
        MATCH_SECONDS: 90,
        ROUND_SECONDS: 90,

        PLAYER_RADIUS: 13, BOT_RADIUS: 12,
        ITEM_RADIUS_LETTER: 13, ITEM_RADIUS_OTHER: 12, SLOT_SIZE: 30,
        WALL_SIZE: 30, MAX_STEP_FRACTION: 0.5,

        // Softer acceleration keeps keyboard movement responsive without
        // snapping between eight rigid directions.
        ACCEL: 1180, DECEL: 1680,
        PLAYER_INPUT_SMOOTH_RATE: 13.5,
        PLAYER_RELEASE_SMOOTH_RATE: 21,
        PLAYER_INPUT_DEADZONE: 0.012,
        MOBILE_INPUT_SMOOTH_RATE: 18,
        MOBILE_RELEASE_SMOOTH_RATE: 24,
        MOBILE_JOYSTICK_DEADZONE: 0.045,
        MOBILE_PICKUP_ASSIST: 27,
        MOBILE_TARGET_RELEASE_PAD: 24,
        MOBILE_TARGET_LOCK_TIME: 0.62,
        MOBILE_FACING_WEIGHT: 38,
        MOBILE_CAMERA_FOLLOW_RATE: 8.5,
        // 0.90 shows roughly 10% more of the arena on landscape phones.
        // Raise toward 1 to zoom in; lower toward 0.82 to zoom out further.
        MOBILE_CAMERA_ZOOM: 0.90,
        MOBILE_CAMERA_PLAYER_SCREEN_Y: 0.53,
        MOBILE_ACTION_BUFFER_TIME: 0.24,
        BOOST_MULTIPLIER: 1.6, BOOST_DURATION: 5,

        PICKUP_RANGE_PAD: 12, LETTER_PICKUP_ASSIST: 16, DEPOSIT_RANGE: 58, SLOT_VERTICAL_RANGE: 88,
        REPAIR_RANGE: 72, BUILD_HOLD_ZONE: 105, BOMB_ARM_RANGE: 75,
        // Bombs resolve quickly, but the blast itself lingers long enough
        // for players to understand what was destroyed or scattered.
        BOMB_FUSE: 2.2, BOMB_BLAST_RADIUS: 115, BOMB_WALL_RADIUS: 105,
        BOMB_KNOCKBACK_SPEED: 560, MAX_KNOCKBACK_SPEED: 900,
        BOMB_STUN_TIME: 0.35, EXPLOSION_GROW_RATE: 335, EXPLOSION_FADE_RATE: 1.15,
        BOMB_DEFENDER_LOCK: 0.65,

        DEFENDER_INTERCEPT_PADDING: 195,
        DEFENDER_LOOT_CHASE_BONUS: 150,
        DEFENDER_ALERT_SCAN_INTERVAL: 0.08,
        DEFENDER_INTERCEPT_CONTACT_PAD: 4,
        DEFENDER_INTERCEPT_COOLDOWN: 0.85,
        DEFENDER_INTERCEPT_STUN: 0.12,
        DEFENDER_INTERCEPT_PUSH: 260,
        DEFENDER_INTERCEPT_STEP: 5,

        JAMMER_DURATION: 3.6, MAX_JAMMERS: 0,

        // Slightly busier supply flow for the 5v5 roster.
        ITEM_SPAWN_INTERVAL: 4.6,
        MAX_LETTERS: 24,
        LETTER_FIELD_MIN: 16,
        LETTER_FIELD_TARGET: 20,
        LETTER_FLOW_CHECK: 1.1,
        LETTER_RESCUE_GRACE: 1.8,
        LETTER_RESCUE_NO_RAIDER_GRACE: 0.55,
        MAX_WALLS_ITEM: 5, MAX_BOMBS: 4, MAX_SPEED_BOOSTS: 3,
        SPAWN_X_MIN: 120, SPAWN_X_RANGE: 760,
        SPAWN_Y_MIN: 100, SPAWN_Y_RANGE: 520,
        DROP_ITEM_OFFSET: 25, DROP_REJECT_GRACE: 1.6,

        STUCK_TIME_THRESHOLD: 0.55, DETOUR_TIME: 0.75, DETOUR_DISTANCE: 145,
        SEPARATION_PAD: 5, SEPARATION_STRENGTH: 0.62, WALL_LOOKAHEAD: 38,
        // Bots remain active, but no longer complete several jobs before
        // the player can read the battlefield.
        BOT_THINK_INTERVAL: 0.40, BOT_TARGET_COMMIT_TIME: 1.85, BOT_BASE_SPEED_MULTIPLIER: 0.96,
        BOT_STEER_SMOOTH_RATE: 5.4,
        BOT_CORNER_LOOKAHEAD: 54,
        BOT_ARRIVAL_SLOW_RADIUS: 96,
        BOT_STOP_RADIUS: 8,
        WALL_AVOID_HOLD_TIME: 0.42,

        BOT_PROGRESS_SAMPLE: 0.32,
        BOT_SOFT_STALL_TIME: 0.95,
        BOT_HARD_STALL_TIME: 1.85,
        BOT_RECOVERY_TIME: 0.78,
        BOT_FAILED_ITEM_COOLDOWN: 1.4,
        BOT_ARRIVAL_FAIL_TIME: 0.58,
        SLOT_GAP: 4, SLOT_MIN_SIZE: 16, SLOT_SIDE_PADDING: 24,
        TREE_REVEAL_PAD: 10, TREE_HIDE_CHANCE: 0.52,
        SPAWN_ITEM_GAP: 28, SPAWN_TREE_GAP: 11, SPAWN_BASE_GAP: 16,
        SUPPLY_PAD_JITTER: 9,
        SLOT_EFFECT_TIME: 0.35,
        FIXED_DT: 1 / 120, MAX_FRAME_DT: 0.05,
      };

      const BASES = {
        blue: { x: 40, y: 250, w: 240, h: 180, c: '#2176ff' },
        red: { x: 720, y: 250, w: 240, h: 180, c: '#ff3b3b' },
      };

      const ROLE_SPEEDS = {
        RUNNER: 310,
        GUARDIAN: 285,
        SABOTEUR: 280,

        // Legacy capability speeds remain available to the compatibility
        // adapter while the older systems are gradually migrated.
        OPERATOR: 305,
        COLLECTOR: 270,
        RAIDER: 315,
        BOMBER: 275,
        BUILDER: 255,
        DEFENDER: 325,
      };

      const PUBLIC_ROLES = Object.freeze({
        RUNNER: 'RUNNER',
        GUARDIAN: 'GUARDIAN',
        SABOTEUR: 'SABOTEUR',
      });

      function roleNameOf(value) {
        return typeof value === 'string' ? value : value?.role;
      }

      function isRunnerRole(value) {
        return ['RUNNER', 'OPERATOR', 'COLLECTOR', 'RAIDER']
          .includes(roleNameOf(value));
      }

      function isGuardianRole(value) {
        return ['GUARDIAN', 'BUILDER', 'DEFENDER']
          .includes(roleNameOf(value));
      }

      function isSaboteurRole(value) {
        return ['SABOTEUR', 'BOMBER']
          .includes(roleNameOf(value));
      }

      function withTemporaryRole(actor, role, callback) {
        if (!actor) return callback();
        const previousRole = actor.role;
        actor.role = role;
        try {
          return callback();
        } finally {
          actor.role = previousRole;
        }
      }

      const canvas = document.querySelector('#game');
      const ctx = canvas.getContext('2d');
      const msgEl = document.querySelector('#msg');
      const cargoEl = null;
      const timerEl = document.querySelector('#timer');
      const speedValEl = document.querySelector('#speedVal');
      const slider = document.querySelector('#botSpeedSlider');
      const roleScreen = document.querySelector('#roleScreen');
      const hudLayer = document.querySelector('#hudLayer');
      const bsEl = document.querySelector('#bs');
      const rsEl = document.querySelector('#rs');
      const roleStripEl = document.querySelector('#roleStrip');
      const contextHintEl = document.querySelector('#contextHint');

      const state = {
        blue: Array(CONFIG.BLUE_WORD.length).fill(null),
        red: Array(CONFIG.RED_WORD.length).fill(null),
        jammedUntil: { blue: 0, red: 0 },
        seconds: CONFIG.MATCH_SECONDS, spawnTimer: 0, over: false
      };
      const keys = {};
      const mobileInput = { x: 0, y: 0, active: false };
      let spaceHeld = false;
      let botSpeed = 0.85;
      let simTime = 0;

      const items = [];
      const walls = [];
      const blueprints = [];
      const explosions = [];
      const slotEffects = [];
      const interceptEffects = [];
      const trees = [
        { id: 0, x: 145, y: 125, r: 33 },
        { id: 1, x: 340, y: 135, r: 36 },
        { id: 2, x: 660, y: 135, r: 36 },
        { id: 3, x: 855, y: 125, r: 33 },
        { id: 4, x: 330, y: 305, r: 34 },
        { id: 5, x: 500, y: 250, r: 38 },
        { id: 6, x: 670, y: 305, r: 34 },
        { id: 7, x: 180, y: 585, r: 34 },
        { id: 8, x: 390, y: 555, r: 37 },
        { id: 9, x: 610, y: 555, r: 37 },
        { id: 10, x: 820, y: 585, r: 34 }
      ].map(tree => ({ ...tree, sway: Math.random() * Math.PI * 2 }));

      // Predictable, symmetrical supply areas keep power-ups visible and fair.
      // A little jitter prevents every item from appearing on the exact same pixel.
      const SUPPLY_PADS = {
        speed: [
          { x: 500, y: 92 }, { x: 500, y: 625 },
          { x: 230, y: 115 }, { x: 770, y: 115 }
        ],
        bomb: [
          { x: 500, y: 175 }, { x: 310, y: 500 }, { x: 690, y: 500 },
          { x: 385, y: 625 }, { x: 615, y: 625 }
        ],
        wall: [
          { x: 285, y: 105 }, { x: 715, y: 105 },
          { x: 275, y: 555 }, { x: 725, y: 555 }
        ],
        jammer: [
          { x: 420, y: 110 }, { x: 580, y: 110 },
          { x: 500, y: 590 }
        ]
      };
      const supplyPadCursor = { speed: 0, bomb: 0, wall: 0, jammer: 0 };

      const itemReservations = new Map();
      let player, bots, ACTORS, countdownId;

      function msg(t) { msgEl.textContent = t; msgEl.classList.remove('flash'); void msgEl.offsetWidth; msgEl.classList.add('flash'); clearTimeout(msgEl._flashTimer); msgEl._flashTimer = setTimeout(() => msgEl.classList.remove('flash'), 180); }
      function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
      function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
      function insideRect(a, b) { return a.x > b.x && a.x < b.x + b.w && a.y > b.y && a.y < b.y + b.h; }
      function hitRect(c, r) {
        const x = Math.max(r.x, Math.min(c.x, r.x + r.w));
        const y = Math.max(r.y, Math.min(c.y, r.y + r.h));
        return (c.x - x) ** 2 + (c.y - y) ** 2 < c.r ** 2;
      }

      function shuffle(s) {
        let a = [...s];
        do {
          for (let i = a.length - 1; i; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
          }
        } while (a.join('') === s);
        return a.join('');
      }

      function createActor(x, y, team, role, maxSpeed, isPlayer = false) {
        return {
          x, y, prevX: x, prevY: y, vx: 0, vy: 0, team, role,
          publicRole: role,
          guardianDuty: null,
          guardianZoneManaged: false,
          aiRole: null,
          hybridTaskUntil: 0,
          maxSpeed, isPlayer,
          r: isPlayer ? CONFIG.PLAYER_RADIUS : CONFIG.BOT_RADIUS,
          inputX: 0,
          inputY: 0,
          facingX: team === 'blue' ? 1 : -1,
          facingY: 0,
          inv: null, target: null, targetItem: null,
          boost: 0, stunTimer: 0, stuck: 0, lastX: x, lastY: y,
          detour: 0, detourTarget: null, thinkTimer: 0, targetCommit: 0, reservedItem: null,
          steerX: 0, steerY: 0, avoidSide: Math.random() < 0.5 ? -1 : 1, avoidTimer: 0,
          patrolPhase: Math.random() * Math.PI * 2, mode: 'IDLE', targetSlotIndex: null,
          buildTarget: null,
          treeSearchIndex: Math.floor(Math.random() * trees.length),
          coverTreeId: null,
          raidSlotIndex: null,
          raidTargetTeam: null,
          plantTarget: null,
          plantMode: null,
          interceptTarget: null,
          interceptCooldown: 0,
          interceptFlash: 0,
          defenderAlertTimer: 0,

          progressTimer: 0,
          progressX: x,
          progressY: y,
          noProgressTime: 0,
          arrivalFailTime: 0,
          recoverUntil: 0,
          failedItem: null,
          failedItemUntil: 0,
          recoveryCount: 0,

          // Only Runners are valid combat targets. Guardians and
          // Saboteurs do not carry a health/lives state in this mode.
          maxHealth: isRunnerRole(role) ? 100 : 0,
          health: isRunnerRole(role) ? 100 : 0,
          alive: true,
          lives: isRunnerRole(role) ? 2 : 0,
          respawnTimer: 0,
          damageFlash: 0,
          shootCooldown: 0,
          weaponTier: isGuardianRole(role) ? 1 : 0,
          gunAmmo: 0,

          combatAimTarget: null,
          combatAimTimer: 0,
          burstRemaining: 0,
          burstRecovery: 0,

          navPath: [],
          navPathIndex: 0,
          navGoalX: x,
          navGoalY: y,
          navRevision: -1,
          navRepathAt: 0,
        };
      }
