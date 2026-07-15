'use strict';

      function getSlotLayout(team) {
        const base = BASES[team];
        const word = team === 'blue' ? CONFIG.BLUE_WORD : CONFIG.RED_WORD;
        const available = Math.max(1, base.w - CONFIG.SLOT_SIDE_PADDING * 2);
        const gap = CONFIG.SLOT_GAP;
        const fitted = (available - gap * Math.max(0, word.length - 1)) / word.length;
        const size = clamp(Math.min(CONFIG.SLOT_SIZE, fitted), CONFIG.SLOT_MIN_SIZE, CONFIG.SLOT_SIZE);
        const totalW = word.length * size + gap * Math.max(0, word.length - 1);
        return { size, gap, startX: base.x + (base.w - totalW) / 2 + size / 2, y: base.y + base.h / 2 };
      }
      function getSlotCoords(team, index) {
        const l = getSlotLayout(team);
        return { x: l.startX + index * (l.size + l.gap), y: l.y, size: l.size };
      }

      function nearest(actor, pred) {
        let best = null, bestDist = Infinity;
        for (const it of items) {
          if (!pred(it)) continue;
          const d = dist(actor, it);
          if (d < bestDist) { bestDist = d; best = it; }
        }
        return best;
      }

      // Player pickups are always explicit. Pressing Space or the mobile
      // action button selects the nearby item the character is facing.
      // Merely touching a letter never collects it.
      function preferredActionItem(actor, pred, range = null) {
        const candidates = [];

        for (const item of items) {
          if (!pred(item)) continue;
          const distance = dist(actor, item);
          const letterAssist =
            actor.isPlayer && item.type === 'letter'
              ? (CONFIG.LETTER_PICKUP_ASSIST || 0)
              : 0;
          const limit = range ??
            (actor.r + item.r + CONFIG.PICKUP_RANGE_PAD + letterAssist);
          if (distance > limit) continue;

          let facingDot = 0;
          if (actor.isPlayer && distance > 0.001) {
            facingDot =
              ((item.x - actor.x) / distance) * (actor.facingX || 0) +
              ((item.y - actor.y) / distance) * (actor.facingY || 0);
          }

          candidates.push({ item, distance, facingDot });
        }

        if (!candidates.length) return null;
        if (!actor.isPlayer) {
          return candidates.sort((a, b) => a.distance - b.distance)[0].item;
        }

        // Prefer an item in front when several pickups overlap. This avoids
        // selecting an unwanted tile simply because the player brushed it.
        const forward = candidates.filter(entry => entry.facingDot >= 0.18);
        const pool = forward.length ? forward : candidates;
        pool.sort((a, b) =>
          (a.distance - a.facingDot * 18) -
          (b.distance - b.facingDot * 18)
        );
        return pool[0].item;
      }
      function isRecentlyDropped(actor, item) { return item.droppedBy === actor && (simTime - item.dropTime) < CONFIG.DROP_REJECT_GRACE; }
      function isReservedByOther(actor, item) { const owner = itemReservations.get(item); return owner && owner !== actor; }
      function reserveItem(actor, item) { if (actor.reservedItem && actor.reservedItem !== item) itemReservations.delete(actor.reservedItem); actor.reservedItem = item || null; if (item) itemReservations.set(item, actor); }
      function clearReservation(actor) { if (actor.reservedItem) itemReservations.delete(actor.reservedItem); actor.reservedItem = null; }
      function removeItem(it) { itemReservations.delete(it); const i = items.indexOf(it); if (i >= 0) items.splice(i, 1); }

      function isInstantPowerupItem(item) {
        return Boolean(item && (item.type === 'health' || item.type === 'speed'));
      }

      globalThis.isInstantPowerupItem = isInstantPowerupItem;

      // STRICT ROLE VALIDATION ON PICKUP
      function pickup(actor, it) {
        if (!it || (actor.inv && !isInstantPowerupItem(it)) || !isItemVisible(it)) return false;

        if (it.type === 'letter' && !['OPERATOR', 'COLLECTOR'].includes(actor.role)) {
          if (actor.isPlayer) msg(`Rejected: Only Operators handle letters. You are a ${actor.role}.`);
          return false;
        }
        if (it.type === 'wall' && actor.role !== 'BUILDER') {
          if (actor.isPlayer) msg(`Rejected: Only Builders construct walls.`);
          return false;
        }
        if (it.type === 'bomb') {
          if (it.ignited && actor.role !== 'DEFENDER') {
            if (actor.isPlayer) msg("Run! Only Defenders (Bomb Squad) can touch armed bombs!");
            return false;
          }
          if (!it.ignited && actor.role !== 'BOMBER') {
            if (actor.isPlayer) msg("Only Bombers deploy bombs.");
            return false;
          }

          if (it.ignited && actor.role === 'DEFENDER') {
            if (isTeamJammed(actor.team)) {
              if (actor.isPlayer) msg('Your bomb squad is jammed!');
              return false;
            }
            if ((it.pickupLockedUntil || 0) > simTime) {
              if (actor.isPlayer) msg('The bomb is locking into place—stand back!');
              return false;
            }
          }
        }

        if (it.type === 'jammer' && actor.role !== 'BOMBER') {
          if (actor.isPlayer) msg('Only Bombers can use signal jammers.');
          return false;
        }

        if (it.type === 'speed') {
          actor.boost = CONFIG.BOOST_DURATION; clearReservation(actor); removeItem(it);
          if (actor.isPlayer) msg('Speed boost active! (⚡)');
          return true;
        }

        actor.inv = { type: it.type, char: it.char || null, ignited: it.ignited, timer: it.timer };
        clearReservation(actor); removeItem(it);

        if (actor.role === 'DEFENDER' && actor.inv.ignited) {
          actor.inv.timer += 0.65;
          if (actor.isPlayer) msg("Bomb secured — move now, the fuse is still live!");
        } else if (actor.isPlayer) {
          msg('Picked up ' + (it.type === 'letter' ? it.char : it.type) + '.');
        }
        return true;
      }

      function armOrDrop(actor) {
        if (!actor.inv) return;
        const it = actor.inv;

        if (it.type === 'bomb') {
          if (actor.role === 'BOMBER') {
            items.push({
              type: 'bomb',
              x: actor.x, y: actor.y,
              r: CONFIG.ITEM_RADIUS_OTHER,
              ignited: true,
              timer: CONFIG.BOMB_FUSE,
              pickupLockedUntil: simTime + CONFIG.BOMB_DEFENDER_LOCK,
              droppedBy: actor,
              dropTime: simTime
            });
            if (actor.isPlayer) msg("BOMB ARMED! Defenders cannot lift it immediately.");
          } else if (actor.role === 'DEFENDER') {
            items.push({ type: 'bomb', x: actor.x, y: actor.y, r: CONFIG.ITEM_RADIUS_OTHER, ignited: true, timer: it.timer, droppedBy: actor, dropTime: simTime });
            if (actor.isPlayer) msg("Armed bomb thrown away!");
          }
        } else if (it.type === 'jammer') {
          if (!activateJammer(actor)) {
            items.push({
              type: 'jammer',
              x: clamp(actor.x + CONFIG.DROP_ITEM_OFFSET, 20, CONFIG.W - 20),
              y: clamp(actor.y, 20, CONFIG.H - 20),
              r: CONFIG.ITEM_RADIUS_OTHER,
              ignited: false, timer: 0,
              droppedBy: actor, dropTime: simTime,
              hiddenByTree: null, revealed: true, revealTime: 0
            });
            actor.inv = null;
          }
          return;
        } else {
          items.push({
            type: it.type, char: it.char || null,
            x: clamp(actor.x + Math.cos(simTime * 10) * CONFIG.DROP_ITEM_OFFSET, 20, CONFIG.W - 20),
            y: clamp(actor.y + Math.sin(simTime * 10) * CONFIG.DROP_ITEM_OFFSET, 20, CONFIG.H - 20),
            r: it.type === 'letter' ? CONFIG.ITEM_RADIUS_LETTER : CONFIG.ITEM_RADIUS_OTHER,
            ignited: false, timer: 0, droppedBy: actor, dropTime: simTime,
            hiddenByTree: null, revealed: true, revealTime: 0,
          });
        }
        actor.inv = null;
      }

      function deposit(actor) {
        if (!actor.inv || actor.inv.type !== 'letter') return false;

        const team = actor.team;
        const progress = getProgress(team);
        let slot = null;

        if (!actor.isPlayer && Number.isInteger(actor.targetSlotIndex)) {
          slot = { ...getSlotCoords(team, actor.targetSlotIndex), index: actor.targetSlotIndex };
        } else {
          slot = slotFromHorizontalPosition(actor, team);
        }

        const canReachSlot = actor.isPlayer ? Boolean(slot) : Boolean(slot && dist(actor, slot) <= CONFIG.DEPOSIT_RANGE);
        if (!canReachSlot) {
          if (actor.isPlayer && insideRect(actor, BASES[team])) {
            msg('Move left or right beside the slot row, then press Space. Your letter stays in your cargo.');
          }
          return false;
        }

        const carried = actor.inv.char;
        const displaced = progress[slot.index];
        progress[slot.index] = carried;
        actor.targetSlotIndex = null;
        addSlotEffect(team, slot.index, '#28c943');

        if (displaced) {
          actor.inv.char = displaced;
          if (actor.isPlayer) msg(`Swapped '${carried}' with '${displaced}' in slot ${slot.index + 1}.`);
        } else {
          actor.inv = null;
          if (actor.isPlayer) msg(`Placed '${carried}' in slot ${slot.index + 1}.`);
        }
        return true;
      }

      function takeSlottedLetter(actor, requestedIndex = null) {
        if (actor.inv || !['OPERATOR', 'COLLECTOR'].includes(actor.role)) return false;

        const progress = getProgress(actor.team);
        let slot = null;

        if (Number.isInteger(requestedIndex) && progress[requestedIndex]) {
          slot = { ...getSlotCoords(actor.team, requestedIndex), index: requestedIndex };
        } else {
          const selected = slotFromHorizontalPosition(actor, actor.team);
          if (selected && progress[selected.index]) slot = selected;
        }

        const canReachSlot = actor.isPlayer ? Boolean(slot) : Boolean(slot && dist(actor, slot) <= CONFIG.DEPOSIT_RANGE);
        if (!canReachSlot) return false;

        const char = progress[slot.index];
        progress[slot.index] = null;
        actor.inv = { type: 'letter', char, ignited: false, timer: 0 };
        actor.targetSlotIndex = null;
        addSlotEffect(actor.team, slot.index, '#53d8fb');
        if (actor.isPlayer) msg(`Picked '${char}' up from slot ${slot.index + 1}.`);
        return true;
      }

      function repair(actor) {
        if (!actor.inv || actor.inv.type !== 'wall') return false;

        let target = null;
        if (!actor.isPlayer && actor.buildTarget) {
          const bp = actor.buildTarget;
          const stillMissing = !walls.some(w => w.team === bp.team && w.x === bp.x && w.y === bp.y);
          if (stillMissing) {
            target = {
              ...bp,
              centerX: bp.x + bp.w / 2,
              centerY: bp.y + bp.h / 2,
              distance: Math.hypot(actor.x - (bp.x + bp.w / 2), actor.y - (bp.y + bp.h / 2))
            };
          }
        }
        if (!target) target = nearestBuildSlot(actor, actor.team, true);
        if (!target || target.distance > CONFIG.REPAIR_RANGE) return false;

        const newWall = {
          x: target.x,
          y: target.y,
          w: target.w,
          h: target.h,
          team: target.team,
          builtByGuardian: true,
          builtAt: simTime,
        };
        walls.push(newWall);
        actor.inv = null;
        actor.buildTarget = null;
        actor.target = null;
        actor.targetItem = null;
        actor.targetCommit = 0;
        actor.thinkTimer = 0;
        actor.detour = 0;
        actor.stuck = 0;
        actor.steerX = 0;
        actor.steerY = 0;

        // A bot used to walk into the blueprint centre and then construct the
        // wall around itself. Resolve any overlap immediately so movement remains free.
        resolveActorsAfterWallPlacement(newWall);

        slotEffects.push({ x: target.centerX, y: target.centerY, color: '#28c943', time: CONFIG.SLOT_EFFECT_TIME, world: true });
        if (actor.isPlayer) msg(target.doorCandidate ? 'Door slot closed. The entrance is now your choice.' : 'Wall placed.');
        return true;
      }

      function action(actor) {
        if (state.over || !actor) return;

        if (actor.inv) {
          if (actor.inv.type === 'letter') {
            if (deposit(actor)) return;
            if (actor.isPlayer && insideRect(actor, BASES[actor.team])) return;
            armOrDrop(actor);
            return;
          }

          if (actor.inv.type === 'wall') {
            if (repair(actor)) return;
            if (actor.isPlayer && nearOwnFortress(actor)) {
              msg('Move beside a faint perimeter marker. The wall stays in your cargo.');
              return;
            }
            armOrDrop(actor);
            return;
          }

          if (actor.inv.type === 'bomb') armOrDrop(actor);
          return;
        }

        let validPred;
        if (['OPERATOR', 'COLLECTOR'].includes(actor.role)) validPred = i =>
          ((i.type === 'letter' || i.type === 'intel' || i.type === 'golden') &&
            isItemVisible(i)) ||
          i.type === 'speed';
        else if (actor.role === 'BUILDER') validPred = i => i.type === 'wall' || i.type === 'speed';
        else if (actor.role === 'RAIDER') validPred = i => i.type === 'speed';
        else if (actor.role === 'BOMBER') validPred = i =>
          (i.type === 'bomb' && !i.ignited) || i.type === 'jammer' || i.type === 'speed';
        else if (actor.role === 'DEFENDER') validPred = i =>
          (i.type === 'bomb' && i.ignited) || i.type === 'speed';

        // A loose field item always wins over removing a letter from the word row.
        // This fixes the case where a Runner stood near the grid and Space kept
        // selecting a slotted letter instead of the tile highlighted on the ground.
        const it = validPred
          ? preferredActionItem(actor, item => validPred(item))
          : null;
        if (it && pickup(actor, it)) return;

        if (['OPERATOR', 'COLLECTOR'].includes(actor.role) &&
          takeSlottedLetter(actor)) return;

        if (actor.isPlayer && ['OPERATOR', 'COLLECTOR'].includes(actor.role)) {
          const tree = trees.find(t =>
            dist(actor, t) < t.r + actor.r + CONFIG.TREE_REVEAL_PAD
          );
          if (tree) {
            msg('Search around the tree canopy—some letters are hidden beneath it.');
          }
        }
      }

      function accelerateTowards(actor, desiredVX, desiredVY, dt) {
        const dvx = desiredVX - actor.vx, dvy = desiredVY - actor.vy;
        const dmag = Math.hypot(dvx, dvy);
        if (dmag < 1e-4) { actor.vx = desiredVX; actor.vy = desiredVY; return; }

        const speeding =
          (desiredVX * desiredVX + desiredVY * desiredVY) >
          (actor.vx * actor.vx + actor.vy * actor.vy);
        const mobileAnalog = Boolean(
          actor.isPlayer &&
          globalThis.__wordWarsTouchUI === true &&
          typeof mobileInput !== 'undefined' &&
          mobileInput.active
        );
        const mobileMultiplier = mobileAnalog
          ? (speeding
              ? (CONFIG.MOBILE_ACCEL_MULTIPLIER || 1)
              : (CONFIG.MOBILE_DECEL_MULTIPLIER || 1))
          : 1;
        const rate = (speeding ? CONFIG.ACCEL : CONFIG.DECEL) * mobileMultiplier;
        const step = Math.min(1, (rate * dt) / dmag);
        actor.vx += dvx * step;
        actor.vy += dvy * step;
      }
      function stepAxis(actor, axis, delta) {
        if (delta === 0) return;
        const prev = actor[axis]; actor[axis] += delta;
        if (walls.some(w => hitRect(actor, w))) { actor[axis] = prev; if (axis === 'x') actor.vx = 0; else actor.vy = 0; }
      }
      function moveActor(actor, dt) {
        const speed = Math.hypot(actor.vx, actor.vy);
        if (speed < 0.01) return;
        const maxStepDist = CONFIG.WALL_SIZE * CONFIG.MAX_STEP_FRACTION;
        const steps = Math.max(1, Math.ceil((speed * dt) / maxStepDist)), stepDt = dt / steps;
        for (let s = 0; s < steps; s++) { stepAxis(actor, 'x', actor.vx * stepDt); stepAxis(actor, 'y', actor.vy * stepDt); }
        actor.x = clamp(actor.x, actor.r, CONFIG.W - actor.r); actor.y = clamp(actor.y, actor.r, CONFIG.H - actor.r);
      }
      function separationVector(actor, roster) {
        let sx = 0, sy = 0;
        for (const o of roster) {
          if (o === actor) continue;
          if (o.team !== actor.team && o.coverTreeId != null && actor.coverTreeId !== o.coverTreeId) continue;
          const dx = actor.x - o.x, dy = actor.y - o.y, d = Math.hypot(dx, dy), minD = actor.r + o.r + CONFIG.SEPARATION_PAD;
          if (d > 0 && d < minD) { const push = (minD - d) / minD; sx += (dx / d) * push; sy += (dy / d) * push; }
        }
        return { x: sx * CONFIG.SEPARATION_STRENGTH, y: sy * CONFIG.SEPARATION_STRENGTH };
      }
      function steerAroundWalls(actor, dirx, diry, dt) {
        if (actor.avoidTimer > 0) actor.avoidTimer = Math.max(0, actor.avoidTimer - dt);
        if (dirx === 0 && diry === 0) return { x: 0, y: 0 };

        const look = actor.r + CONFIG.WALL_LOOKAHEAD;
        const blocked = (x, y) => walls.some(w => hitRect({ x, y, r: actor.r }, w));
        const directBlocked = blocked(actor.x + dirx * look, actor.y + diry * look);

        if (!directBlocked && actor.avoidTimer <= 0) return { x: 0, y: 0 };

        const perpX = -diry, perpY = dirx;
        const probeSide = sign => {
          const tx = dirx + perpX * sign * 0.95;
          const ty = diry + perpY * sign * 0.95;
          const len = Math.hypot(tx, ty) || 1;
          return !blocked(actor.x + (tx / len) * look, actor.y + (ty / len) * look);
        };

        if (actor.avoidTimer <= 0) {
          const preferredOpen = probeSide(actor.avoidSide);
          const otherOpen = probeSide(-actor.avoidSide);
          if (!preferredOpen && otherOpen) actor.avoidSide *= -1;
          actor.avoidTimer = CONFIG.WALL_AVOID_HOLD_TIME;
        }

        return { x: perpX * actor.avoidSide, y: perpY * actor.avoidSide };
      }

      function driveActor(actor, dirx, diry, dt, isBot) {
        const boosted = actor.boost > 0;
        const teamBalance = isBot && player
          ? (actor.team === player.team
              ? (CONFIG.BOT_ALLY_SPEED_MULTIPLIER || 1)
              : (CONFIG.BOT_ENEMY_SPEED_MULTIPLIER || 1))
          : 1;
        const botMultiplier = isBot
          ? botSpeed * CONFIG.BOT_BASE_SPEED_MULTIPLIER * teamBalance
          : 1;
        const speedMag = actor.maxSpeed *
          (boosted ? CONFIG.BOOST_MULTIPLIER : 1) *
          botMultiplier;
        let desiredVX = dirx * speedMag, desiredVY = diry * speedMag;
        if (actor.stunTimer > 0) { desiredVX = 0; desiredVY = 0; }
        accelerateTowards(actor, desiredVX, desiredVY, dt); moveActor(actor, dt);
      }
      function decayTimers(actor, dt) {
        if (actor.boost > 0) actor.boost = Math.max(0, actor.boost - dt);
        if (actor.stunTimer > 0) actor.stunTimer = Math.max(0, actor.stunTimer - dt);
        if (actor.interceptCooldown > 0) {
          actor.interceptCooldown = Math.max(0, actor.interceptCooldown - dt);
        }
        if (actor.interceptFlash > 0) {
          actor.interceptFlash = Math.max(0, actor.interceptFlash - dt);
        }
      }

      const GAME_CONTROL_CODES = new Set([
        'KeyW', 'KeyA', 'KeyS', 'KeyD',
        'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
        'Space',
      ]);

      function isInteractiveControlTarget(target) {
        if (!(target instanceof Element)) return false;
        return Boolean(
          target.closest('button, input, textarea, select, a, [contenteditable="true"]')
        );
      }

      function gameplayInputEnabled() {
        if (!player || state.over) return false;

        const blockingOverlay = [
          '#modeScreen',
          '#roleScreen',
          '#instructionScreen',
          '#roundScreen',
          '#multiplayerLobbyScreen',
        ].some(selector => {
          const element = document.querySelector(selector);
          return element && !element.classList.contains('hidden');
        });

        return !blockingOverlay;
      }

      addEventListener('keydown', e => {
        if (isInteractiveControlTarget(e.target)) return;

        // Arrow keys and Space normally scroll the browser. While the game is
        // active they belong entirely to movement and actions.
        if (GAME_CONTROL_CODES.has(e.code)) {
          e.preventDefault();
        }

        if (!gameplayInputEnabled()) return;

        keys[e.key.toLowerCase()] = true;
        if (e.code === 'Space') {
          const context = typeof getContextTarget === 'function'
            ? getContextTarget()
            : null;
          const disarmAction = Boolean(
            context?.kind === 'item' &&
            context.item?.type === 'bomb'
          );
          globalThis.setInnerSentryFireHeld?.(!disarmAction);
          if (!e.repeat && !spaceHeld) action(player);
          spaceHeld = true;
        }
      }, { passive: false });

      addEventListener('keyup', e => {
        if (isInteractiveControlTarget(e.target)) return;
        if (GAME_CONTROL_CODES.has(e.code)) e.preventDefault();

        keys[e.key.toLowerCase()] = false;
        if (e.code === 'Space') {
          spaceHeld = false;
          globalThis.setInnerSentryFireHeld?.(false);
        }
      }, { passive: false });
      addEventListener('blur', () => {
        for (const key of Object.keys(keys)) keys[key] = false;
        spaceHeld = false;
        globalThis.setInnerSentryFireHeld?.(false);
        if (player) {
          player.inputX = 0;
          player.inputY = 0;
        }
      });
