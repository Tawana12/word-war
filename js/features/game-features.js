'use strict';

      // ================================================================
      // FEATURE EXPANSION: Intel, bomb tiers, shields, events and lock-in
      // ================================================================
      Object.assign(CONFIG, {
        INTEL_LIFETIME: 14,
        INTEL_CARD_TIME: 5.5,
        INTEL_SPAWN_MIN: 22,
        INTEL_SPAWN_MAX: 34,
        WORLD_EVENT_MIN: 30,
        WORLD_EVENT_MAX: 44,
        WORLD_EVENT_ACTIVE_TIME: 10,
        WORD_LOCK_TIME: 5,
        SHIELD_BRICK_COST: 999,
        SHIELD_DURATION: 8,
        TREASURE_TREE_TIME: 17,
        GOLDEN_MAX: 0,
        INTEL_MAX: 0,
      });

      const BOMB_PROFILES = {
        1: { magnitude: 1, radius: 100, wallRadius: 90, fuse: 2.1, knockback: 470, color: '#ff6b6b' },
        1.5: { magnitude: 1.5, radius: 132, wallRadius: 120, fuse: 2.55, knockback: 610, color: '#ff9f43' },
        2: { magnitude: 2, radius: 174, wallRadius: 158, fuse: 3.05, knockback: 760, color: '#9b5de5' },
      };

      state.shields = {
        blue: { charge: 0, until: 0, hits: 0 },
        red: { charge: 0, until: 0, hits: 0 },
      };
      state.wordLocks = { blue: 0, red: 0 };
      // Legacy event timers are disabled. The controlled event director below
      // is the only system allowed to trigger major match events.
      state.intelTimer = Infinity;
      state.worldEventTimer = Infinity;
      state.internalBombTimer = Infinity;
      state.activeEventUntil = 0;
      state.activeEventName = '';

      for (const tree of trees) {
        tree.treasureUntil = 0;
        tree.treasureClaimed = false;
      }

      SUPPLY_PADS.intel = [
        { x: 210, y: 95 }, { x: 790, y: 95 }, { x: 500, y: 625 }
      ];
      SUPPLY_PADS.golden = [
        { x: 500, y: 155 }, { x: 350, y: 590 }, { x: 650, y: 590 }
      ];
      supplyPadCursor.intel = 0;
      supplyPadCursor.golden = 0;

      const stageEl = document.querySelector('#stage');
      const intelCardEl = document.createElement('div');
      intelCardEl.id = 'intelCard';
      Object.assign(intelCardEl.style, {
        position: 'absolute',
        top: '74px',
        left: '50%',
        transform: 'translateX(-50%) translateY(-8px)',
        width: 'min(340px, 58%)',
        padding: '11px 14px',
        borderRadius: '10px',
        background: '#fff8d8f2',
        border: '2px solid #d7a928',
        boxShadow: '0 8px 22px #0007',
        color: '#2b2412',
        fontWeight: '800',
        fontSize: '13px',
        textAlign: 'center',
        zIndex: '80',
        opacity: '0',
        pointerEvents: 'none',
        transition: 'opacity .18s ease, transform .18s ease',
      });
      stageEl.appendChild(intelCardEl);
      let intelCardHideTimer = null;

      function randomBetween(min, max) {
        return min + Math.random() * (max - min);
      }

      function bombProfile(magnitude = 1) {
        const key = magnitude >= 1.75 ? 2 : magnitude >= 1.25 ? 1.5 : 1;
        return BOMB_PROFILES[key];
      }

      function randomBombMagnitude() {
        const roll = Math.random();
        return roll < 0.58 ? 1 : roll < 0.90 ? 1.5 : 2;
      }

      function showIntelCard(team, text) {
        if (!player || player.team !== team) return;
        intelCardEl.innerHTML = `<div style="font-size:10px;letter-spacing:1px;margin-bottom:4px;color:#8a6b12">INTEL CARD</div>${text}`;
        intelCardEl.style.opacity = '1';
        intelCardEl.style.transform = 'translateX(-50%) translateY(0)';
        clearTimeout(intelCardHideTimer);
        intelCardHideTimer = setTimeout(() => {
          intelCardEl.style.opacity = '0';
          intelCardEl.style.transform = 'translateX(-50%) translateY(-8px)';
        }, CONFIG.INTEL_CARD_TIME * 1000);
      }

      function makeIntelClue(team) {
        const word = getTeamWord(team);
        const progress = getProgress(team);
        const vowels = [...word].filter(char => 'AEIOU'.includes(char)).length;
        const correct = progress.reduce((sum, char, index) =>
          sum + ((char === word[index] || char === '*') ? 1 : 0), 0);
        const index = Math.floor(Math.random() * word.length);
        const letter = word[index];
        const unique = [...new Set(word)];
        const picked = unique[Math.floor(Math.random() * unique.length)];
        const positions = [...word].map((char, i) => char === picked ? i + 1 : null).filter(Boolean);
        const options = [
          `The word begins with <b>${word[0]}</b>.`,
          `The word ends with <b>${word[word.length - 1]}</b>.`,
          `This is a <b>computing / problem-solving term</b>.`,
          `The word contains <b>${vowels} vowel${vowels === 1 ? '' : 's'}</b>.`,
          `Slot <b>${index + 1}</b> contains <b>${letter}</b>.`,
          `<b>${correct}</b> letter${correct === 1 ? ' is' : 's are'} currently in the correct position.`,
          `Letter <b>${picked}</b> belongs in slot${positions.length > 1 ? 's' : ''} <b>${positions.join(', ')}</b>.`,
          `The word has <b>${word.length}</b> letters.`,
        ];
        return options[Math.floor(Math.random() * options.length)];
      }

      function activateIntel(actor, item) {
        if (!actor || !item || actor.role !== 'OPERATOR') return false;
        if (isTeamJammed(actor.team)) {
          if (actor.isPlayer) msg('Intel network jammed. The card cannot be read yet.');
          return false;
        }
        const clue = makeIntelClue(actor.team);
        removeItem(item);
        showIntelCard(actor.team, clue);
        msg(`${actor.team.toUpperCase()} OPERATOR RECOVERED INTEL.`);
        return true;
      }

      function missingBotWalls(team) {
        return blueprints.filter(bp =>
          bp.team === team && !bp.doorCandidate &&
          !walls.some(w => w.team === bp.team && w.x === bp.x && w.y === bp.y)
        );
      }

      function fortressComplete(team) {
        return missingBotWalls(team).length === 0;
      }

      function shieldActive(team) {
        const shield = state.shields[team];
        return shield.hits > 0 && shield.until > simTime;
      }

      function bankShieldBrick(actor) {
        if (!actor.inv || actor.inv.type !== 'wall' || !fortressComplete(actor.team)) return false;
        if (!insideRect(actor, BASES[actor.team])) return false;

        actor.inv = null;
        const shield = state.shields[actor.team];
        shield.charge += 1;
        actor.target = null;
        actor.targetCommit = 0;
        actor.thinkTimer = 0;

        if (shield.charge >= CONFIG.SHIELD_BRICK_COST) {
          shield.charge = 0;
          shield.hits = 1;
          shield.until = simTime + CONFIG.SHIELD_DURATION;
          msg(`${actor.team.toUpperCase()} WORD SHIELD ACTIVATED!`);
        } else if (actor.isPlayer) {
          msg(`Shield charged: ${shield.charge}/${CONFIG.SHIELD_BRICK_COST} bricks.`);
        }
        return true;
      }

      function dismantleWall(actor) {
        if (!actor.isPlayer || actor.role !== 'BUILDER' || actor.inv) return false;
        let closest = null;
        let closestDistance = 48;
        for (const wall of walls) {
          if (wall.team !== actor.team) continue;
          const d = Math.hypot(actor.x - (wall.x + wall.w / 2), actor.y - (wall.y + wall.h / 2));
          if (d < closestDistance) {
            closestDistance = d;
            closest = wall;
          }
        }
        if (!closest) return false;
        walls.splice(walls.indexOf(closest), 1);
        actor.inv = { type: 'wall', char: null, ignited: false, timer: 0 };
        msg('Wall dismantled. Carry it to another perimeter slot.');
        return true;
      }

      function createItemAt(type, x, y, options = {}) {
        const item = {
          type,
          x: clamp(x, 24, CONFIG.W - 24),
          y: clamp(y, 92, CONFIG.H - 24),
          r: type === 'letter' || type === 'golden' ? CONFIG.ITEM_RADIUS_LETTER : CONFIG.ITEM_RADIUS_OTHER,
          ignited: Boolean(options.ignited),
          timer: options.timer || 0,
          droppedBy: options.droppedBy || null,
          dropTime: options.dropTime || 0,
          hiddenByTree: options.hiddenByTree ?? null,
          revealed: options.revealed ?? true,
          revealTime: options.revealTime || 0,
          expiresAt: options.expiresAt || 0,
          magnitude: options.magnitude || 1,
          pickupLockedUntil: options.pickupLockedUntil || 0,
          char: options.char || null,
          scatteredUntil: options.scatteredUntil || 0,
          flowCritical: Boolean(options.flowCritical),
          flowTeam: options.flowTeam || null,
          bornAt: options.bornAt ?? simTime,
        };
        const profile = bombProfile(item.magnitude);
        if (type === 'bomb') item.r = CONFIG.ITEM_RADIUS_OTHER + (profile.magnitude - 1) * 6;
        items.push(item);
        return item;
      }

      function activateTreasureTree() {
        const candidates = trees.filter(tree => tree.treasureUntil <= simTime);
        if (!candidates.length) return false;
        const tree = candidates[Math.floor(Math.random() * candidates.length)];
        tree.treasureUntil = simTime + CONFIG.TREASURE_TREE_TIME;
        tree.treasureClaimed = false;
        msg('TREASURE TREE ACTIVATED — search the glowing canopy!');
        return true;
      }

      function openTreasureTree(tree, discoverer) {
        if (tree.treasureClaimed || tree.treasureUntil <= simTime) return;
        tree.treasureClaimed = true;
        tree.treasureUntil = 0;

        const rewards = ['letter', 'letter'];
        const rareRoll = Math.random();
        rewards.push(rareRoll < 0.20 ? 'golden' : rareRoll < 0.50 ? 'intel' : rareRoll < 0.75 ? 'wall' : 'bomb');

        rewards.forEach((type, index) => {
          const angle = (Math.PI * 2 * index) / rewards.length + Math.random() * 0.4;
          const radius = tree.r + 30;
          const x = tree.x + Math.cos(angle) * radius;
          const y = tree.y + Math.sin(angle) * radius;
          if (type === 'letter') {
            const needed = getNeededLetters();
            const char = needed.length ? needed[Math.floor(Math.random() * needed.length)] : letterPool[Math.floor(Math.random() * letterPool.length)];
            createItemAt('letter', x, y, { char, revealTime: simTime });
          } else if (type === 'bomb') {
            createItemAt('bomb', x, y, { magnitude: Math.random() < 0.75 ? 1.5 : 2 });
          } else if (type === 'intel') {
            createItemAt('intel', x, y, { expiresAt: simTime + CONFIG.INTEL_LIFETIME });
          } else {
            createItemAt(type, x, y);
          }
        });

        msg(`${discoverer.team.toUpperCase()} OPENED THE TREASURE TREE!`);
      }

      function spawnInternalBomb(team, magnitude = null) {
        const base = BASES[team];
        const mag = magnitude || (Math.random() < 0.75 ? 1 : 1.5);
        const profile = bombProfile(mag);
        let point = { x: base.x + base.w / 2, y: base.y + base.h / 2 - 42 };
        for (let attempt = 0; attempt < 25; attempt++) {
          const candidate = {
            x: base.x + 38 + Math.random() * (base.w - 76),
            y: base.y + 35 + Math.random() * (base.h - 70),
          };
          if (!walls.some(w => hitRect({ ...candidate, r: CONFIG.ITEM_RADIUS_OTHER }, w))) {
            point = candidate;
            break;
          }
        }
        createItemAt('bomb', point.x, point.y, {
          magnitude: mag,
          ignited: true,
          timer: profile.fuse + 0.65,
          pickupLockedUntil: 0,
        });
        msg(`INTERNAL ${mag}× BOMB DETECTED IN ${team.toUpperCase()} BASE!`);
      }

      function triggerWorldEvent() {
        if (state.activeEventUntil > simTime) return;
        const events = ['internal', 'mega', 'treasure', 'golden', 'bricks', 'intel'];
        const event = events[Math.floor(Math.random() * events.length)];
        state.activeEventUntil = simTime + CONFIG.WORLD_EVENT_ACTIVE_TIME;
        state.activeEventName = event;

        if (event === 'internal') {
          spawnInternalBomb(Math.random() < 0.5 ? 'blue' : 'red');
        } else if (event === 'mega') {
          const location = chooseOpenSpawn('bomb', CONFIG.ITEM_RADIUS_OTHER + 6);
          createItemAt('bomb', location.x, location.y, { magnitude: 2 });
          msg('MEGA BOMB 2× HAS LANDED IN THE FIELD!');
        } else if (event === 'treasure') {
          activateTreasureTree();
        } else if (event === 'golden') {
          if (!items.some(item => item.type === 'golden')) {
            const location = chooseOpenSpawn('golden', CONFIG.ITEM_RADIUS_LETTER);
            createItemAt('golden', location.x, location.y);
            msg('GOLDEN LETTER WILDCARD HAS APPEARED!');
          }
        } else if (event === 'bricks') {
          for (let i = 0; i < 2; i++) {
            const location = chooseOpenSpawn('wall', CONFIG.ITEM_RADIUS_OTHER);
            createItemAt('wall', location.x, location.y);
          }
          msg('DOUBLE BRICK SUPPLY DROP!');
        } else {
          const location = chooseOpenSpawn('intel', CONFIG.ITEM_RADIUS_OTHER);
          createItemAt('intel', location.x, location.y, { expiresAt: simTime + CONFIG.INTEL_LIFETIME });
          msg('TIMED INTEL CARD HAS APPEARED!');
        }
      }

      function scatterBombedToken(char, magnitude) {
        const isGolden = char === '*';
        const hideChance = magnitude >= 2 ? 0.42 : magnitude >= 1.5 ? 0.26 : 0.12;
        if (Math.random() < hideChance && trees.length) {
          const tree = trees[Math.floor(Math.random() * trees.length)];
          const angle = Math.random() * Math.PI * 2;
          const radius = Math.random() * Math.max(8, tree.r * 0.32);
          return createItemAt(isGolden ? 'golden' : 'letter',
            tree.x + Math.cos(angle) * radius,
            tree.y + Math.sin(angle) * radius,
            {
              char: isGolden ? null : char,
              hiddenByTree: tree.id,
              revealed: false,
              scatteredUntil: simTime + 0.7,
            }
          );
        }
        const landing = chooseLetterScatterPosition();
        return createItemAt(isGolden ? 'golden' : 'letter', landing.x, landing.y, {
          char: isGolden ? null : char,
          revealTime: simTime,
          scatteredUntil: simTime + 0.7,
        });
      }

      // Existing bombs are upgraded into the tier system.
      for (const item of items) {
        if (item.type === 'bomb') {
          item.magnitude = item.magnitude || randomBombMagnitude();
          item.r = CONFIG.ITEM_RADIUS_OTHER + (item.magnitude - 1) * 6;
        }
      }

      const baseSpawn = spawn;
      spawn = function enhancedSpawn(type, forceNeeded = false, magnitude = null) {
        const before = items.length;
        baseSpawn(type, forceNeeded);
        const item = items[items.length - 1];
        if (!item || items.length === before) return item;

        if (item.type === 'bomb') {
          item.magnitude = magnitude || randomBombMagnitude();
          item.r = CONFIG.ITEM_RADIUS_OTHER + (item.magnitude - 1) * 6;
        } else if (item.type === 'intel') {
          item.expiresAt = simTime + CONFIG.INTEL_LIFETIME;
        }
        return item;
      };

      const baseIsWordComplete = isWordComplete;
      isWordComplete = function wildcardWordComplete(team) {
        const word = getTeamWord(team);
        return getProgress(team).every((char, index) => char === word[index] || char === '*');
      };

      const baseCorrectSlotCount = correctSlotCount;
      correctSlotCount = function wildcardCorrectSlotCount(team) {
        const word = getTeamWord(team);
        return getProgress(team).reduce((count, char, index) =>
          count + ((char === word[index] || char === '*') ? 1 : 0), 0);
      };

      getMissingLetters = function wildcardMissingLetters(team) {
        const word = getTeamWord(team);
        const progress = getProgress(team);
        const remaining = [];
        for (let index = 0; index < word.length; index++) {
          if (progress[index] === '*' || progress[index] === word[index]) continue;
          remaining.push(word[index]);
        }
        for (const placed of progress) {
          if (!placed || placed === '*') continue;
          const correctIndex = word.indexOf(placed);
          if (correctIndex >= 0 && progress[correctIndex] !== placed && progress[correctIndex] !== '*') {
            const index = remaining.indexOf(placed);
            if (index >= 0) remaining.splice(index, 1);
          }
        }
        return remaining;
      };

      nearestDesiredSlot = function wildcardDesiredSlot(actor, team, char) {
        const word = getTeamWord(team);
        const progress = getProgress(team);
        if (char === '*') {
          return nearestSlot(actor, team, index => progress[index] !== word[index] && progress[index] !== '*');
        }
        return nearestSlot(actor, team, index => word[index] === char && progress[index] !== char && progress[index] !== '*');
      };

      nearestMisplacedSlot = function wildcardMisplacedSlot(actor, team) {
        const word = getTeamWord(team);
        const progress = getProgress(team);
        return nearestSlot(actor, team, index => Boolean(progress[index]) && progress[index] !== '*' && progress[index] !== word[index]);
      };

      const basePickup = pickup;
      pickup = function enhancedPickup(actor, item) {
        if (!item || (actor.inv && !globalThis.isInstantPowerupItem?.(item)) || !isItemVisible(item)) return false;

        if (item.type === 'intel') {
          if (actor.role !== 'OPERATOR') {
            if (actor.isPlayer) msg('Only Operators can read Intel Cards.');
            return false;
          }
          return activateIntel(actor, item);
        }

        if (item.type === 'golden') {
          if (actor.role !== 'OPERATOR') {
            if (actor.isPlayer) msg('Only Operators can carry the Golden Letter.');
            return false;
          }
          actor.inv = { type: 'letter', char: '*', golden: true, ignited: false, timer: 0 };
          clearReservation(actor);
          removeItem(item);
          if (actor.isPlayer) msg('Golden Letter collected — place it in any slot.');
          return true;
        }

        const magnitude = item.magnitude || 1;
        const result = basePickup(actor, item);
        if (result && actor.inv?.type === 'bomb') actor.inv.magnitude = magnitude;
        return result;
      };

      const baseArmOrDrop = armOrDrop;
      armOrDrop = function enhancedArmOrDrop(actor) {
        if (!actor.inv) return;

        if (actor.inv.type === 'letter' && actor.inv.char === '*') {
          createItemAt('golden',
            actor.x + Math.cos(simTime * 10) * CONFIG.DROP_ITEM_OFFSET,
            actor.y + Math.sin(simTime * 10) * CONFIG.DROP_ITEM_OFFSET,
            { droppedBy: actor, dropTime: simTime }
          );
          actor.inv = null;
          return;
        }

        if (actor.inv.type !== 'bomb') {
          baseArmOrDrop(actor);
          return;
        }

        const carried = actor.inv;
        const profile = bombProfile(carried.magnitude || 1);
        if (actor.role === 'BOMBER') {
          createItemAt('bomb', actor.x, actor.y, {
            magnitude: profile.magnitude,
            ignited: true,
            timer: profile.fuse,
            pickupLockedUntil: simTime + CONFIG.BOMB_DEFENDER_LOCK,
            droppedBy: actor,
            dropTime: simTime,
          });
          msg(`${actor.team.toUpperCase()} SABOTEUR ARMED A ${profile.magnitude}× BOMB!`);
        } else if (actor.role === 'DEFENDER') {
          createItemAt('bomb', actor.x, actor.y, {
            magnitude: profile.magnitude,
            ignited: true,
            timer: Math.max(0.6, carried.timer || profile.fuse),
            droppedBy: actor,
            dropTime: simTime,
          });
          if (actor.isPlayer) msg('Armed bomb thrown away!');
        }
        actor.inv = null;
      };

      const baseTakeSlottedLetter = takeSlottedLetter;
      takeSlottedLetter = function enhancedTakeSlottedLetter(actor, requestedIndex = null) {
        const result = baseTakeSlottedLetter(actor, requestedIndex);
        if (result && actor.inv?.char === '*') actor.inv.golden = true;
        return result;
      };

      const baseAction = action;
      action = function enhancedAction(actor) {
        if (state.over || !actor) return;

        if (actor.inv?.type === 'jammer') {
          armOrDrop(actor);
          return;
        }

        if (actor.role === 'RAIDER') {
          if (actor.inv?.stolen) {
            dropStolenLetter(actor);
            return;
          }
          if (!actor.inv && takeEnemySlottedLetter(actor)) return;
        }

        if (actor.role === 'BUILDER') {
          if (actor.inv?.type === 'wall' && fortressComplete(actor.team) && insideRect(actor, BASES[actor.team])) {
            const activeBuildSlot = nearestBuildSlot(actor, actor.team, true);
            if (!activeBuildSlot || activeBuildSlot.distance > CONFIG.REPAIR_RANGE) {
              if (bankShieldBrick(actor)) return;
            }
          }
          if (!actor.inv && dismantleWall(actor)) return;
        }

        baseAction(actor);
      };

      const baseChoose = choose;
      choose = function enhancedChoose(bot) {
        if (bot.role === 'OPERATOR' && !bot.inv) {
          const specialItems = items
            .filter(item =>
              !isReservedByOther(bot, item) &&
              (
                item.type === 'golden' ||
                (
                  item.type === 'intel' &&
                  !CONFIG.CLEAN_BUILD &&
                  !isTeamJammed(bot.team) &&
                  (!item.expiresAt || item.expiresAt > simTime)
                )
              )
            )
            .sort((a, b) => dist(bot, a) - dist(bot, b));

          const target = specialItems[0] || null;
          if (target) {
            bot.mode = target.type === 'golden' ? 'FETCH_GOLDEN' : 'FETCH_INTEL';
            bot.targetItem = target;
            reserveItem(bot, target);
            bot.target = { x: target.x, y: target.y };
            return;
          }
        }

        if (bot.role === 'BUILDER' && fortressComplete(bot.team)) {
          const base = BASES[bot.team];
          if (bot.inv?.type === 'wall') {
            clearReservation(bot);
            bot.mode = 'CHARGE_SHIELD';
            bot.buildTarget = null;
            bot.target = { x: base.x + base.w / 2, y: base.y + base.h / 2 };
            return;
          }
          if (!bot.inv) {
            const wallItem = nearest(bot, item =>
              item.type === 'wall' && !isRecentlyDropped(bot, item) && !isReservedByOther(bot, item)
            );
            if (wallItem) {
              bot.mode = 'FETCH_SHIELD_BRICK';
              bot.targetItem = wallItem;
              reserveItem(bot, wallItem);
              bot.target = { x: wallItem.x, y: wallItem.y };
              return;
            }
          }
        }

        baseChoose(bot);
      };

      const baseUpdateBot = updateBot;
      updateBot = function enhancedUpdateBot(bot, dt) {
        baseUpdateBot(bot, dt);
        if (bot.role === 'BUILDER' && bot.inv?.type === 'wall' && fortressComplete(bot.team) && insideRect(bot, BASES[bot.team])) {
          bankShieldBrick(bot);
        }
      };

      explode = function tieredExplosion(bomb) {
        let magnitude = bomb.magnitude || 0;
        if (!magnitude && ACTORS) {
          const carrier = ACTORS.find(actor => actor.inv?.type === 'bomb' && Math.hypot(actor.x - bomb.x, actor.y - bomb.y) < 2);
          magnitude = carrier?.inv?.magnitude || 1;
        }
        const profile = bombProfile(magnitude || 1);
        explosions.push({
          x: bomb.x,
          y: bomb.y,
          r: 0,
          a: 1,
          maxR: profile.radius,
          growRate: CONFIG.EXPLOSION_GROW_RATE * (0.9 + profile.magnitude * 0.18),
        });

        for (let index = walls.length - 1; index >= 0; index--) {
          const wall = walls[index];
          if (wall.indestructible) continue;
          const wallCenterX = wall.x + wall.w / 2;
          const wallCenterY = wall.y + wall.h / 2;
          if (Math.hypot(bomb.x - wallCenterX, bomb.y - wallCenterY) < profile.wallRadius) {
            walls.splice(index, 1);
          }
        }

        for (const team of ['blue', 'red']) {
          const progress = getProgress(team);
          const affected = [];
          for (let index = 0; index < progress.length; index++) {
            if (!progress[index]) continue;
            const coords = getSlotCoords(team, index);
            if (Math.hypot(coords.x - bomb.x, coords.y - bomb.y) < profile.radius) {
              affected.push({ char: progress[index], index });
            }
          }

          if (affected.length && shieldActive(team)) {
            const shield = state.shields[team];
            shield.hits = 0;
            shield.until = 0;
            msg(`${team.toUpperCase()} WORD SHIELD ABSORBED A ${profile.magnitude}× BLAST!`);
            continue;
          }

          for (const entry of affected) {
            progress[entry.index] = null;
            scatterBombedToken(entry.char, profile.magnitude);
          }
          if (affected.length) {
            state.wordLocks[team] = 0;
            msg(`${affected.length} ${team} letter${affected.length === 1 ? '' : 's'} blasted into the field by a ${profile.magnitude}× bomb!`);
          }
        }

        if (ACTORS) {
          for (const actor of ACTORS) {
            const distance = Math.hypot(actor.x - bomb.x, actor.y - bomb.y);
            if (distance >= profile.radius) continue;
            if (actor.inv) armOrDrop(actor);
            const falloff = 1 - distance / profile.radius;
            const dx = actor.x - bomb.x;
            const dy = actor.y - bomb.y;
            const length = Math.hypot(dx, dy) || 1;
            const force = profile.knockback * falloff;
            actor.vx = clamp(actor.vx + (dx / length) * force, -CONFIG.MAX_KNOCKBACK_SPEED, CONFIG.MAX_KNOCKBACK_SPEED);
            actor.vy = clamp(actor.vy + (dy / length) * force, -CONFIG.MAX_KNOCKBACK_SPEED, CONFIG.MAX_KNOCKBACK_SPEED);
            actor.stunTimer = Math.max(actor.stunTimer, CONFIG.BOMB_STUN_TIME * profile.magnitude);
            if (actor.isPlayer) msg(`Hit by a ${profile.magnitude}× explosion!`);
          }
        }
      };

      winner = function lockInWinner() {
        for (const team of ['blue', 'red']) {
          if (isWordComplete(team)) {
            if (state.wordLocks[team] <= 0) {
              state.wordLocks[team] = CONFIG.WORD_LOCK_TIME;
              msg(`${team.toUpperCase()} WORD COMPLETE — PROTECT IT FOR ${CONFIG.WORD_LOCK_TIME} SECONDS!`);
            }
          } else {
            state.wordLocks[team] = 0;
          }
        }
      };

      const baseRevealHiddenLetters = revealHiddenLetters;
      revealHiddenLetters = function enhancedRevealHiddenLetters() {
        baseRevealHiddenLetters();
        if (!ACTORS) return;
        for (const item of items) {
          if (item.type !== 'golden' || item.hiddenByTree == null || item.revealed) continue;
          const tree = hiddenTreeForItem(item);
          if (!tree) { item.revealed = true; continue; }
          const discoverer = ACTORS.find(actor => Math.hypot(actor.x - tree.x, actor.y - tree.y) < tree.r + actor.r + CONFIG.TREE_REVEAL_PAD);
          if (discoverer) {
            item.revealed = true;
            item.revealTime = simTime;
            if (discoverer.isPlayer) msg('You found the Golden Letter beneath a tree!');
          }
        }

        for (const tree of trees) {
          if (tree.treasureUntil <= simTime || tree.treasureClaimed) continue;
          const discoverer = ACTORS.find(actor => Math.hypot(actor.x - tree.x, actor.y - tree.y) < tree.r + actor.r + CONFIG.TREE_REVEAL_PAD);
          if (discoverer) openTreasureTree(tree, discoverer);
        }
      };

      const baseTick = tick;
      tick = function featureTick(dt) {
        baseTick(dt);
        updateActorTreeCover();
        if (state.over) return;

        for (const team of ['blue', 'red']) {
          const shield = state.shields[team];
          if (shield.until <= simTime) shield.hits = 0;

          if (state.wordLocks[team] > 0) {
            if (!isWordComplete(team)) {
              state.wordLocks[team] = 0;
            } else {
              state.wordLocks[team] = Math.max(0, state.wordLocks[team] - dt);
              if (state.wordLocks[team] <= 0 && isWordComplete(team)) {
                end(`${team.toUpperCase()} LOCKED THE WORD ${getTeamWord(team)}!`);
                return;
              }
            }
          }
        }

        for (let index = items.length - 1; index >= 0; index--) {
          const item = items[index];
          if (item.expiresAt && item.expiresAt <= simTime) removeItem(item);
        }

        for (const tree of trees) {
          if (tree.treasureUntil && tree.treasureUntil <= simTime) {
            tree.treasureUntil = 0;
            tree.treasureClaimed = false;
          }
        }

        state.intelTimer -= dt;
        if (state.intelTimer <= 0) {
          if (!items.some(item => item.type === 'intel')) {
            const location = chooseOpenSpawn('intel', CONFIG.ITEM_RADIUS_OTHER);
            createItemAt('intel', location.x, location.y, { expiresAt: simTime + CONFIG.INTEL_LIFETIME });
            msg('A TIMED INTEL CARD HAS APPEARED!');
          }
          state.intelTimer = randomBetween(CONFIG.INTEL_SPAWN_MIN, CONFIG.INTEL_SPAWN_MAX);
        }

        state.internalBombTimer -= dt;
        if (state.internalBombTimer <= 0) {
          spawnInternalBomb(Math.random() < 0.5 ? 'blue' : 'red');
          state.internalBombTimer = randomBetween(42, 58);
        }

        state.worldEventTimer -= dt;
        if (state.worldEventTimer <= 0) {
          triggerWorldEvent();
          state.worldEventTimer = randomBetween(CONFIG.WORLD_EVENT_MIN, CONFIG.WORLD_EVENT_MAX);
        }
      };

      function drawFieldPickupBeacon(item, color, label, radiusPad = 10) {
        const pulse = 0.5 + 0.5 * Math.sin(simTime * 4.2 + item.x * 0.01);
        ctx.save();
        ctx.beginPath();
        ctx.arc(item.x, item.y, item.r + radiusPad + pulse * 3, 0, Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.68 + pulse * 0.22;
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.font = '900 9px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(20,22,26,0.9)';
        ctx.strokeText(label, item.x, item.y - item.r - radiusPad - 7);
        ctx.fillStyle = '#fff';
        ctx.fillText(label, item.x, item.y - item.r - radiusPad - 7);
        ctx.restore();
      }

      drawItems = function enhancedDrawItems() {
        for (const item of items) {
          if (item.type === 'letter') {
            if (!isItemVisible(item)) continue;
            const justRevealed = item.revealTime && simTime - item.revealTime < 0.8;
            if (justRevealed) {
              const progress = (simTime - item.revealTime) / 0.8;
              ctx.beginPath();
              ctx.arc(item.x, item.y, 18 + progress * 20, 0, Math.PI * 2);
              ctx.strokeStyle = `rgba(255,245,160,${1 - progress})`;
              ctx.lineWidth = 4;
              ctx.stroke();
            }
            const pulse = (item.scatteredUntil || 0) > simTime
              ? 1 + 0.16 * Math.sin((item.scatteredUntil - simTime) * 24)
              : 1;
            ctx.save();
            ctx.translate(item.x, item.y);
            ctx.scale(pulse, pulse);
            ctx.translate(-item.x, -item.y);
            ctx.fillStyle = '#f4d06f';
            ctx.fillRect(item.x - 12, item.y - 12, 24, 24);
            ctx.strokeStyle = '#332914';
            ctx.lineWidth = 2;
            ctx.strokeRect(item.x - 12, item.y - 12, 24, 24);
            ctx.fillStyle = '#332914';
            ctx.font = 'bold 20px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(item.char, item.x, item.y + 1);
            ctx.restore();
            continue;
          }

          if (item.type === 'golden') {
            if (!isItemVisible(item)) continue;
            const pulse = 1 + Math.sin(simTime * 6) * 0.08;
            ctx.save();
            ctx.translate(item.x, item.y);
            ctx.scale(pulse, pulse);
            ctx.translate(-item.x, -item.y);
            ctx.beginPath();
            ctx.arc(item.x, item.y, 17, 0, Math.PI * 2);
            ctx.fillStyle = '#ffd700';
            ctx.shadowColor = '#fff2a8';
            ctx.shadowBlur = 16;
            ctx.fill();
            ctx.shadowBlur = 0;
            ctx.strokeStyle = '#6b5200';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.fillStyle = '#5b4300';
            ctx.font = 'bold 21px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('★', item.x, item.y + 1);
            ctx.restore();
            continue;
          }

          if (item.type === 'intel') {
            drawFieldPickupBeacon(item, '#ffd54a', 'CLUE', 12);
            const timeLeft = Math.max(0, item.expiresAt - simTime);
            const pulse = 1 + Math.sin(simTime * 5) * 0.05;
            ctx.save();
            ctx.translate(item.x, item.y);
            ctx.rotate(Math.sin(simTime * 2.2 + item.x) * 0.06);
            ctx.scale(pulse, pulse);
            ctx.fillStyle = '#fff7cf';
            ctx.strokeStyle = '#b68a11';
            ctx.lineWidth = 2;
            ctx.fillRect(-16, -13, 32, 26);
            ctx.strokeRect(-16, -13, 32, 26);
            ctx.fillStyle = '#7a5a0c';
            ctx.font = 'bold 16px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('?', 0, 0);
            ctx.restore();
            ctx.fillStyle = '#5f4a0c';
            ctx.font = 'bold 9px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(`${Math.ceil(timeLeft)}s`, item.x, item.y + 24);
            continue;
          }

          if (item.type === 'health') {
            drawFieldPickupBeacon(item, '#53e07d', 'HEAL', 10);
            const pulse = 1 + Math.sin(simTime * 5) * 0.06;
            ctx.save();
            ctx.translate(item.x, item.y);
            ctx.scale(pulse, pulse);
            ctx.fillStyle = '#43c86b';
            ctx.strokeStyle = '#173d23';
            ctx.lineWidth = 2;
            ctx.fillRect(-11, -11, 22, 22);
            ctx.strokeRect(-11, -11, 22, 22);
            ctx.fillStyle = '#fff';
            ctx.fillRect(-3, -8, 6, 16);
            ctx.fillRect(-8, -3, 16, 6);
            ctx.restore();
            continue;
          }

          if (item.type === 'gun') {
            drawFieldPickupBeacon(item, '#5ca8ff', 'RIFLE', 10);
            ctx.save();
            ctx.translate(item.x, item.y);
            ctx.fillStyle = '#3486d9';
            ctx.strokeStyle = '#102b45';
            ctx.lineWidth = 2;
            ctx.fillRect(-13, -9, 26, 18);
            ctx.strokeRect(-13, -9, 26, 18);
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 12px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('R', 0, 0);
            ctx.restore();
            continue;
          }

          if (item.type === 'bomb') {
            drawFieldPickupBeacon(item, '#ff6b6b', 'BOMB', 11);
            const profile = bombProfile(item.magnitude || 1);
            const flashing = item.ignited && Math.floor(simTime * 1000 / 110) % 2 === 0;
            ctx.beginPath();
            ctx.arc(item.x, item.y, item.r, 0, Math.PI * 2);
            ctx.fillStyle = flashing ? '#fff' : profile.color;
            ctx.fill();
            ctx.strokeStyle = '#111';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.fillStyle = flashing ? '#111' : '#fff';
            ctx.font = 'bold 10px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(`${profile.magnitude}×`, item.x, item.y + (item.ignited ? 0 : 1));
            if (item.ignited) {
              const fuseRatio = clamp(item.timer / profile.fuse, 0, 1);
              const dangerPulse = 1 + Math.sin(simTime * 18) * 0.12;

              ctx.beginPath();
              ctx.arc(
                item.x,
                item.y,
                (item.r + 9 + (1 - fuseRatio) * 8) * dangerPulse,
                0,
                Math.PI * 2
              );
              ctx.strokeStyle = item.timer <= 0.9 ? '#ffffff' : profile.color;
              ctx.lineWidth = item.timer <= 0.9 ? 4 : 3;
              ctx.stroke();

              ctx.fillStyle = '#fff';
              ctx.font = 'bold 10px sans-serif';
              ctx.fillText(item.timer.toFixed(1), item.x, item.y - item.r - 10);

              if (item.timer <= 0.9) {
                ctx.fillStyle = '#fff';
                ctx.font = '900 8px sans-serif';
                ctx.fillText('DANGER', item.x, item.y + item.r + 13);
              }
            }
            if ((item.pickupLockedUntil || 0) > simTime) {
              const remaining = (item.pickupLockedUntil - simTime) / CONFIG.BOMB_DEFENDER_LOCK;
              ctx.beginPath();
              ctx.arc(item.x, item.y, item.r + 7 + remaining * 4, 0, Math.PI * 2);
              ctx.strokeStyle = '#ffd166cc';
              ctx.lineWidth = 3;
              ctx.stroke();
            }
            continue;
          }

          if (item.type === 'speed') {
            drawFieldPickupBeacon(item, '#5cff7a', 'SPEED', 10);
          } else if (item.type === 'wall') {
            drawFieldPickupBeacon(item, '#b6c0cf', 'BRICK', 8);
          }
          ctx.beginPath();
          ctx.arc(item.x, item.y, item.r, 0, Math.PI * 2);
          ctx.fillStyle = item.type === 'wall' ? '#8892a3'
            : item.type === 'speed' ? '#28c943'
              : item.type === 'jammer' ? '#9b5de5' : '#ff4a4a';
          ctx.fill();
          ctx.strokeStyle = '#111';
          ctx.stroke();
          ctx.fillStyle = '#fff';
          ctx.font = '14px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.font = '900 10px sans-serif';
          ctx.fillText(item.type === 'wall' ? 'W' : 'S', item.x, item.y);
        }
      };

      const baseDrawBases = drawBases;
      drawBases = function enhancedDrawBases() {
        baseDrawBases();
        for (const team of ['blue', 'red']) {
          const base = BASES[team];
          const shield = state.shields[team];
          const layout = getSlotLayout(team);
          if (shieldActive(team)) {
            ctx.save();
            ctx.beginPath();
            ctx.ellipse(base.x + base.w / 2, layout.y, base.w * 0.43, 44, 0, 0, Math.PI * 2);
            ctx.strokeStyle = '#53d8fb';
            ctx.lineWidth = 5;
            ctx.shadowColor = '#53d8fb';
            ctx.shadowBlur = 14;
            ctx.stroke();
            ctx.restore();
          }

          if (shield.charge > 0 || shieldActive(team)) {
            ctx.fillStyle = '#d9f7ff';
            ctx.font = 'bold 10px sans-serif';
            ctx.textAlign = 'center';
            const text = shieldActive(team)
              ? `SHIELD ${Math.max(0, shield.until - simTime).toFixed(1)}s`
              : `SHIELD ${shield.charge}/${CONFIG.SHIELD_BRICK_COST}`;
            ctx.fillText(text, base.x + base.w / 2, base.y + base.h - 13);
          }

          if (state.wordLocks[team] > 0) {
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 13px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(`LOCKING ${state.wordLocks[team].toFixed(1)}s`, base.x + base.w / 2, base.y + 37);
          }
        }
      };

      const baseDrawPhysicalSlots = drawPhysicalSlots;
      drawPhysicalSlots = function enhancedDrawPhysicalSlots() {
        baseDrawPhysicalSlots();
        for (const team of ['blue', 'red']) {
          const progress = getProgress(team);
          for (let index = 0; index < progress.length; index++) {
            if (progress[index] !== '*') continue;
            const coords = getSlotCoords(team, index);
            ctx.save();
            ctx.fillStyle = '#ffd700';
            ctx.strokeStyle = '#725700';
            ctx.lineWidth = 2;
            ctx.fillRect(coords.x - coords.size / 2 + 2, coords.y - coords.size / 2 + 2, coords.size - 4, coords.size - 4);
            ctx.strokeRect(coords.x - coords.size / 2 + 2, coords.y - coords.size / 2 + 2, coords.size - 4, coords.size - 4);
            ctx.fillStyle = '#5b4300';
            ctx.font = `bold ${Math.max(12, coords.size * 0.62)}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('★', coords.x, coords.y + 1);
            ctx.restore();
          }
        }
      };

      const baseDrawTreeCanopies = drawTreeCanopies;
      drawTreeCanopies = function enhancedDrawTreeCanopies() {
        baseDrawTreeCanopies();
        for (const tree of trees) {
          if (tree.treasureUntil <= simTime || tree.treasureClaimed) continue;
          const pulse = 0.6 + 0.4 * Math.sin(simTime * 5);
          ctx.save();
          ctx.beginPath();
          ctx.arc(tree.x, tree.y - 5, tree.r + 11 + pulse * 4, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(255,215,0,${0.55 + pulse * 0.35})`;
          ctx.lineWidth = 5;
          ctx.shadowColor = '#ffd700';
          ctx.shadowBlur = 18;
          ctx.stroke();
          ctx.shadowBlur = 0;
          ctx.fillStyle = '#fff1a8';
          ctx.font = 'bold 12px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('TREASURE', tree.x, tree.y - tree.r - 22);
          ctx.restore();
        }
      };

      const baseDrawActors = drawActors;
      drawActors = function enhancedDrawActors(alpha = 1) {
        baseDrawActors(alpha);
        if (!ACTORS) return;
        for (const actor of ACTORS) {
          if (actor.inv?.type !== 'bomb') continue;
          const x = actor.prevX + (actor.x - actor.prevX) * alpha;
          const y = actor.prevY + (actor.y - actor.prevY) * alpha;
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 8px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText(`${actor.inv.magnitude || 1}×`, x, y - 24);
        }
      };

      const featureDrawActors = drawActors;
      drawActors = function stealthAwareDrawActors(alpha = 1) {
        if (!ACTORS) return;

        const fullRoster = ACTORS;
        ACTORS = fullRoster.filter(actor => actorVisibleToPlayer(actor));

        try {
          featureDrawActors(alpha);
        } finally {
          ACTORS = fullRoster;
        }

        if (player?.coverTreeId != null) {
          const x = player.prevX + (player.x - player.prevX) * alpha;
          const y = player.prevY + (player.y - player.prevY) * alpha;
          ctx.save();
          ctx.beginPath();
          ctx.arc(x, y, player.r + 7, 0, Math.PI * 2);
          ctx.strokeStyle = '#b7ef9a';
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 4]);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = '#ecffe3';
          ctx.font = 'bold 9px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('HIDDEN', x, y - 27);
          ctx.restore();
        }
      };
