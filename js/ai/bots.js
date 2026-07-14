'use strict';

      // ==========================================
      // STRICT ROLE AI
      // ==========================================
      function choose(bot) {
        const word = bot.team === 'blue' ? CONFIG.BLUE_WORD : CONFIG.RED_WORD;
        const progress = state[bot.team];
        const base = BASES[bot.team];
        const enemyBase = BASES[bot.team === 'blue' ? 'red' : 'blue'];
        bot.targetItem = null;

        if (bot.role === 'DEFENDER') {
          clearReservation(bot);
          if (bot.inv) {
            bot.mode = 'REMOVE_BOMB';
            bot.target = {
              x: bot.team === 'blue' ? 470 : 530,
              y: 620
            };
            return;
          }

          const cx = base.x + base.w / 2;
          const cy = base.y + base.h / 2;
          const threatenedBomb = isTeamJammed(bot.team) ? null : nearest(bot, i =>
            i.type === 'bomb' && i.ignited &&
            (i.pickupLockedUntil || 0) <= simTime &&
            Math.hypot(i.x - cx, i.y - cy) < 285 &&
            !isReservedByOther(bot, i)
          );

          if (threatenedBomb) {
            bot.mode = 'DISARM';
            bot.targetItem = threatenedBomb;
            reserveItem(bot, threatenedBomb);
            bot.target = { x: threatenedBomb.x, y: threatenedBomb.y };
          } else {
            bot.mode = 'PATROL';
            const phase = simTime * 0.72 + bot.patrolPhase;
            bot.target = {
              x: cx + Math.cos(phase) * 72,
              y: cy + Math.sin(phase) * 52
            };
          }
          return;
        }

        if (bot.role === 'BUILDER') {
          const missingWalls = blueprints
            .filter(bp => bp.team === bot.team)
            .filter(bp => !bp.doorCandidate)
            .filter(bp => !walls.some(w => w.team === bp.team && w.x === bp.x && w.y === bp.y));

          if (bot.inv) {
            clearReservation(bot);
            const wallTarget = missingWalls
              .sort((a, b) => Math.hypot(bot.x - (a.x + 15), bot.y - (a.y + 15)) - Math.hypot(bot.x - (b.x + 15), bot.y - (b.y + 15)))[0];
            if (wallTarget) {
              bot.mode = 'REPAIR';
              bot.buildTarget = wallTarget;
              bot.target = buildApproachPoint(bot, wallTarget);
            } else {
              bot.buildTarget = null;
              bot.mode = 'RETURN';
              bot.target = { x: base.x + base.w / 2, y: base.y + base.h / 2 };
            }
            return;
          }

          if (!missingWalls.length) {
            bot.buildTarget = null;
            clearReservation(bot);
            bot.mode = 'PATROL';
            const phase = simTime * 0.55 + bot.patrolPhase;
            bot.target = {
              x: base.x + base.w / 2 + Math.cos(phase) * 58,
              y: base.y + base.h / 2 + Math.sin(phase) * 45
            };
            return;
          }

          bot.buildTarget = null;
          const wallItem = nearest(bot, i =>
            i.type === 'wall' && !isRecentlyDropped(bot, i) && !isReservedByOther(bot, i)
          );
          if (wallItem) {
            bot.mode = 'FETCH_WALL';
            bot.targetItem = wallItem;
            reserveItem(bot, wallItem);
            bot.target = { x: wallItem.x, y: wallItem.y };
          } else {
            clearReservation(bot);
            bot.mode = 'WAIT';
            bot.target = { x: base.x + base.w / 2, y: base.y + base.h / 2 };
          }
          return;
        }

        if (bot.role === 'OPERATOR' || bot.role === 'COLLECTOR') {
          if (bot.inv) {
            clearReservation(bot);
            const slot = nearestDesiredSlot(bot, bot.team, bot.inv.char);
            if (slot) {
              bot.mode = 'DEPOSIT';
              bot.targetSlotIndex = slot.index;
              bot.target = slot;
            } else {
              bot.mode = 'DROP_UNUSED';
              bot.targetSlotIndex = null;
              bot.target = { x: 500, y: bot.team === 'blue' ? 250 : 430 };
            }
            return;
          }

          // Correct a badly arranged row before collecting more letters.
          const misplaced = nearestMisplacedSlot(bot, bot.team);
          if (misplaced) {
            clearReservation(bot);
            bot.mode = 'REARRANGE';
            bot.targetSlotIndex = misplaced.index;
            bot.target = misplaced;
            return;
          }

          bot.targetSlotIndex = null;
          const missingLetters = getMissingLetters(bot.team);
          const usefulLetter = nearest(bot, item =>
            item.type === 'letter' && isItemVisible(item) &&
            missingLetters.includes(item.char) &&
            !isRecentlyDropped(bot, item) &&
            !isReservedByOther(bot, item)
          );

          if (usefulLetter) {
            bot.mode = 'FETCH_LETTER';
            bot.targetItem = usefulLetter;
            reserveItem(bot, usefulLetter);
            bot.target = { x: usefulLetter.x, y: usefulLetter.y };
          } else {
            clearReservation(bot);
            bot.mode = 'SEARCH_TREES';
            const tree = trees[bot.treeSearchIndex % trees.length];
            bot.target = { x: tree.x, y: tree.y };
            if (dist(bot, tree) < tree.r * 0.55) {
              bot.treeSearchIndex = (bot.treeSearchIndex + 1) % trees.length;
              bot.targetCommit = 0;
            }
          }
          return;
        }

        if (bot.role === 'RAIDER') {
          const enemyTeam = otherTeam(bot.team);
          const enemyBase = BASES[enemyTeam];
          bot.targetItem = null;
          clearReservation(bot);

          if (bot.inv?.stolen) {
            if (insideRect(bot, BASES[bot.team])) {
              bot.mode = 'DELIVER_STOLEN';
              bot.target = {
                x: BASES[bot.team].x + BASES[bot.team].w / 2,
                y: BASES[bot.team].y + BASES[bot.team].h / 2
              };
              return;
            }

            const homeGap = nearestOpenBoundaryGap(bot.team, bot);
            if (homeGap) {
              bot.mode = 'RETURN_THROUGH_GAP';
              bot.target = { x: homeGap.x, y: homeGap.y };
            } else {
              bot.mode = 'RETURN_WITH_LOOT';
              bot.target = {
                x: BASES[bot.team].x + BASES[bot.team].w / 2,
                y: BASES[bot.team].y + BASES[bot.team].h / 2
              };
            }
            return;
          }

          const slot = enemyLetterSlot(bot, enemyTeam);
          if (!slot) {
            bot.raidSlotIndex = null;
            const gap = nearestOpenBoundaryGap(enemyTeam, bot);
            bot.mode = 'SCOUT_BOUNDARY';
            bot.target = gap
              ? { x: gap.x, y: gap.y }
              : {
                x: bot.team === 'blue' ? enemyBase.x - 42 : enemyBase.x + enemyBase.w + 42,
                y: enemyBase.y + enemyBase.h / 2
              };
            return;
          }

          bot.raidSlotIndex = slot.index;
          bot.raidTargetTeam = enemyTeam;

          if (insideRect(bot, enemyBase)) {
            bot.mode = 'STEAL_LETTER';
            bot.target = slot;
            return;
          }

          const gap = nearestOpenBoundaryGap(enemyTeam, bot);
          if (gap) {
            bot.mode = 'RAID_THROUGH_GAP';
            bot.target = { x: gap.x, y: gap.y };
          } else {
            bot.mode = 'WAIT_FOR_BREACH';
            bot.target = {
              x: bot.team === 'blue' ? enemyBase.x - 42 : enemyBase.x + enemyBase.w + 42,
              y: slot.y
            };
          }
          return;
        }

        if (bot.role === 'BOMBER') {
          const enemyTeam = otherTeam(bot.team);
          const enemyBase = BASES[enemyTeam];

          if (bot.inv) {
            clearReservation(bot);

            if (bot.inv.type === 'jammer') {
              if (insideRect(bot, enemyBase)) {
                bot.mode = 'ACTIVATE_JAMMER';
                bot.target = {
                  x: enemyBase.x + enemyBase.w / 2,
                  y: enemyBase.y + enemyBase.h / 2
                };
                return;
              }

              const gap = nearestOpenBoundaryGap(enemyTeam, bot);
              bot.mode = gap ? 'JAMMER_THROUGH_GAP' : 'WAIT_FOR_BREACH';
              bot.target = gap
                ? { x: gap.x, y: gap.y }
                : {
                  x: bot.team === 'blue' ? enemyBase.x - 42 : enemyBase.x + enemyBase.w + 42,
                  y: enemyBase.y + enemyBase.h / 2
                };
              return;
            }

            if (bot.inv.type === 'bomb') {
              if (!bot.plantTarget) {
                bot.plantTarget = chooseBomberPlantPoint(bot, enemyTeam);
                bot.plantMode = bot.plantTarget.mode;
              }

              const targetInsideBase = insideRect(bot.plantTarget, enemyBase);
              if (targetInsideBase && !insideRect(bot, enemyBase)) {
                const gap = nearestOpenBoundaryGap(enemyTeam, bot);
                if (gap) {
                  bot.mode = 'BOMB_THROUGH_GAP';
                  bot.target = { x: gap.x, y: gap.y };
                  return;
                }
              }

              bot.mode = bot.plantMode || 'PLANT_BOMB';
              bot.target = {
                x: bot.plantTarget.x,
                y: bot.plantTarget.y
              };
              return;
            }
          }

          bot.plantTarget = null;
          bot.plantMode = null;

          const bomb = nearest(bot, item =>
            item.type === 'bomb' && !item.ignited &&
            !isRecentlyDropped(bot, item) && !isReservedByOther(bot, item)
          );
          const jammer = isTeamJammed(enemyTeam) ? null : nearest(bot, item =>
            item.type === 'jammer' &&
            !isRecentlyDropped(bot, item) && !isReservedByOther(bot, item)
          );

          const useJammer = jammer &&
            (!bomb || dist(bot, jammer) < dist(bot, bomb) * 0.68);
          const targetItem = useJammer ? jammer : bomb;

          if (targetItem) {
            bot.mode = useJammer ? 'FETCH_JAMMER' : 'FETCH_BOMB';
            bot.targetItem = targetItem;
            reserveItem(bot, targetItem);
            bot.target = { x: targetItem.x, y: targetItem.y };
          } else {
            clearReservation(bot);
            bot.mode = 'BOMBER_PATROL';
            const phase = simTime * 0.48 + bot.patrolPhase;
            bot.target = {
              x: 500 + Math.cos(phase) * 170,
              y: 350 + Math.sin(phase) * 150
            };
          }
          return;
        }
      }

      // ================================================================
      // GRID NAVIGATION
      // Simple wall steering worked in open space but failed around maze lanes.
      // Bots now calculate short A* routes and steer between safe waypoints.
      // ================================================================
      const NAV = {
        cell: 28,
        top: 82,
        refreshInterval: 0.30,
      };

      let navigationWallSignature = '';
      let navigationWallCheckAt = 0;
      const navigationGridCache = new Map();

      function currentWallSignature() {
        return walls.map(wall =>
          `${Math.round(wall.x)},${Math.round(wall.y)},${Math.round(wall.w)},${Math.round(wall.h)}`
        ).join('|');
      }

      function refreshNavigationRevision() {
        if (simTime < navigationWallCheckAt) return;
        navigationWallCheckAt = simTime + NAV.refreshInterval;
        const signature = currentWallSignature();
        if (signature === navigationWallSignature) return;
        navigationWallSignature = signature;
        mazeRevision += 1;
        navigationGridCache.clear();
        clearBotNavigationPaths();
      }

      function navDimensions() {
        return {
          cols: Math.ceil(CONFIG.W / NAV.cell),
          rows: Math.ceil((CONFIG.H - NAV.top) / NAV.cell),
        };
      }

      function navCellCenter(col, row) {
        return {
          x: clamp(col * NAV.cell + NAV.cell / 2, 8, CONFIG.W - 8),
          y: clamp(NAV.top + row * NAV.cell + NAV.cell / 2, NAV.top + 4, CONFIG.H - 8),
        };
      }

      function navCellFromPoint(point) {
        const { cols, rows } = navDimensions();
        return {
          col: clamp(Math.floor(point.x / NAV.cell), 0, cols - 1),
          row: clamp(Math.floor((point.y - NAV.top) / NAV.cell), 0, rows - 1),
        };
      }

      function navigationGrid(radius) {
        const radiusBucket = Math.ceil(radius + 3);
        const key = `${mazeRevision}:${radiusBucket}`;
        const cached = navigationGridCache.get(key);
        if (cached) return cached;

        const { cols, rows } = navDimensions();
        const blocked = new Uint8Array(cols * rows);

        for (let row = 0; row < rows; row++) {
          for (let col = 0; col < cols; col++) {
            const point = navCellCenter(col, row);
            const probe = { x: point.x, y: point.y, r: radiusBucket };
            if (walls.some(wall => hitRect(probe, wall))) {
              blocked[row * cols + col] = 1;
            }
          }
        }

        const grid = { cols, rows, blocked };
        navigationGridCache.set(key, grid);
        return grid;
      }

      function nearestOpenNavCell(cell, grid) {
        const index = cell.row * grid.cols + cell.col;
        if (!grid.blocked[index]) return cell;

        for (let radius = 1; radius <= 6; radius++) {
          let best = null;
          let bestDistance = Infinity;

          for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
              if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
              const col = cell.col + dx;
              const row = cell.row + dy;
              if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) continue;
              if (grid.blocked[row * grid.cols + col]) continue;
              const distance = dx * dx + dy * dy;
              if (distance < bestDistance) {
                bestDistance = distance;
                best = { col, row };
              }
            }
          }

          if (best) return best;
        }

        return null;
      }

      class NavMinHeap {
        constructor() { this.data = []; }
        push(node) {
          this.data.push(node);
          let index = this.data.length - 1;
          while (index > 0) {
            const parent = Math.floor((index - 1) / 2);
            if (this.data[parent].f <= node.f) break;
            this.data[index] = this.data[parent];
            index = parent;
          }
          this.data[index] = node;
        }
        pop() {
          if (!this.data.length) return null;
          const root = this.data[0];
          const last = this.data.pop();
          if (this.data.length && last) {
            let index = 0;
            while (true) {
              const left = index * 2 + 1;
              const right = left + 1;
              if (left >= this.data.length) break;
              let child = left;
              if (right < this.data.length && this.data[right].f < this.data[left].f) {
                child = right;
              }
              if (this.data[child].f >= last.f) break;
              this.data[index] = this.data[child];
              index = child;
            }
            this.data[index] = last;
          }
          return root;
        }
        get length() { return this.data.length; }
      }

      function lineClearForActor(from, to, radius) {
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const length = Math.hypot(dx, dy);
        if (length < 1) return true;
        const steps = Math.max(2, Math.ceil(length / 12));

        for (let step = 1; step <= steps; step++) {
          const t = step / steps;
          const probe = {
            x: from.x + dx * t,
            y: from.y + dy * t,
            r: radius + 2,
          };
          if (walls.some(wall => hitRect(probe, wall))) return false;
        }
        return true;
      }

      function buildNavigationPath(bot, goal) {
        const grid = navigationGrid(bot.r);
        let start = nearestOpenNavCell(navCellFromPoint(bot), grid);
        let end = nearestOpenNavCell(navCellFromPoint(goal), grid);
        if (!start || !end) return [];

        const startIndex = start.row * grid.cols + start.col;
        const endIndex = end.row * grid.cols + end.col;
        if (startIndex === endIndex) return [goal];

        const total = grid.cols * grid.rows;
        const gScore = new Float64Array(total);
        const cameFrom = new Int32Array(total);
        const closed = new Uint8Array(total);
        gScore.fill(Infinity);
        cameFrom.fill(-1);

        const heuristic = (col, row) => {
          const dx = Math.abs(col - end.col);
          const dy = Math.abs(row - end.row);
          return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
        };

        const open = new NavMinHeap();
        gScore[startIndex] = 0;
        open.push({ index: startIndex, col: start.col, row: start.row, f: heuristic(start.col, start.row) });

        const directions = [
          [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
          [1, 1, Math.SQRT2], [1, -1, Math.SQRT2],
          [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
        ];

        let found = false;
        while (open.length) {
          const current = open.pop();
          if (!current || closed[current.index]) continue;
          closed[current.index] = 1;
          if (current.index === endIndex) {
            found = true;
            break;
          }

          for (const [dx, dy, cost] of directions) {
            const col = current.col + dx;
            const row = current.row + dy;
            if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) continue;
            const nextIndex = row * grid.cols + col;
            if (grid.blocked[nextIndex] || closed[nextIndex]) continue;

            if (dx !== 0 && dy !== 0) {
              const sideA = current.row * grid.cols + col;
              const sideB = row * grid.cols + current.col;
              if (grid.blocked[sideA] || grid.blocked[sideB]) continue;
            }

            const nextG = gScore[current.index] + cost;
            if (nextG >= gScore[nextIndex]) continue;
            cameFrom[nextIndex] = current.index;
            gScore[nextIndex] = nextG;
            open.push({
              index: nextIndex,
              col,
              row,
              f: nextG + heuristic(col, row),
            });
          }
        }

        if (!found) return [];

        const reversed = [];
        let cursor = endIndex;
        while (cursor !== startIndex && cursor >= 0) {
          const col = cursor % grid.cols;
          const row = Math.floor(cursor / grid.cols);
          reversed.push(navCellCenter(col, row));
          cursor = cameFrom[cursor];
        }
        reversed.reverse();
        reversed.push({ x: goal.x, y: goal.y });

        // Remove unnecessary grid corners when there is a clear straight segment.
        const simplified = [];
        let anchorPoint = { x: bot.x, y: bot.y };
        let index = 0;
        while (index < reversed.length) {
          let farthest = index;
          for (let candidate = index; candidate < reversed.length; candidate++) {
            if (!lineClearForActor(anchorPoint, reversed[candidate], bot.r)) break;
            farthest = candidate;
          }
          simplified.push(reversed[farthest]);
          anchorPoint = reversed[farthest];
          index = farthest + 1;
        }

        return simplified;
      }

      function navigationWaypoint(bot, goal) {
        refreshNavigationRevision();

        if (lineClearForActor(bot, goal, bot.r)) {
          bot.navPath = [];
          bot.navPathIndex = 0;
          bot.navGoalX = goal.x;
          bot.navGoalY = goal.y;
          bot.navRevision = mazeRevision;
          return goal;
        }

        const goalChanged = Math.hypot(
          goal.x - (bot.navGoalX ?? goal.x),
          goal.y - (bot.navGoalY ?? goal.y)
        ) > 34;

        const needsPath =
          !bot.navPath?.length ||
          bot.navPathIndex >= bot.navPath.length ||
          bot.navRevision !== mazeRevision ||
          goalChanged ||
          simTime >= (bot.navRepathAt || 0);

        if (needsPath) {
          bot.navPath = buildNavigationPath(bot, goal);
          bot.navPathIndex = 0;
          bot.navGoalX = goal.x;
          bot.navGoalY = goal.y;
          bot.navRevision = mazeRevision;
          bot.navRepathAt = simTime + 0.42 + Math.random() * 0.16;
        }

        if (!bot.navPath?.length) return goal;

        while (bot.navPathIndex < bot.navPath.length - 1 &&
          dist(bot, bot.navPath[bot.navPathIndex]) < 20) {
          bot.navPathIndex += 1;
        }

        const current = bot.navPath[bot.navPathIndex] || goal;
        const next = bot.navPath[bot.navPathIndex + 1];

        // Aim gently into the next path segment once it is visible. This
        // rounds navigation corners without allowing bots to cut through walls.
        if (next) {
          const cornerDistance = dist(bot, current);
          if (cornerDistance < CONFIG.BOT_CORNER_LOOKAHEAD &&
            lineClearForActor(bot, next, bot.r)) {
            const turnAmount = clamp(
              1 - cornerDistance / CONFIG.BOT_CORNER_LOOKAHEAD,
              0,
              1
            );
            return {
              x: current.x + (next.x - current.x) * turnAmount,
              y: current.y + (next.y - current.y) * turnAmount,
            };
          }
        }

        return current;
      }

      function updateBot(bot, dt) {
        decayTimers(bot, dt);
        bot.thinkTimer -= dt;
        bot.targetCommit = Math.max(0, bot.targetCommit - dt);

        const reservationLost = bot.reservedItem && !items.includes(bot.reservedItem);
        if (reservationLost) clearReservation(bot);

        if (bot.thinkTimer <= 0 || !bot.target || reservationLost || bot.targetCommit <= 0) {
          choose(bot);
          bot.thinkTimer = CONFIG.BOT_THINK_INTERVAL;
          bot.targetCommit = CONFIG.BOT_TARGET_COMMIT_TIME;
        }

        if (!bot.target) {
          bot.navPath = [];
          bot.navPathIndex = 0;
          driveActor(bot, 0, 0, dt, true);
          return;
        }

        const strategicGoal = { x: bot.target.x, y: bot.target.y };
        const movementTarget = navigationWaypoint(bot, strategicGoal);
        const dx = movementTarget.x - bot.x;
        const dy = movementTarget.y - bot.y;
        const d = Math.hypot(dx, dy);

        if (d > CONFIG.BOT_STOP_RADIUS) {
          let dirx = dx / d;
          let diry = dy / d;
          const avoid = steerAroundWalls(bot, dirx, diry, dt);
          const sep = separationVector(bot, ACTORS);

          let rawX = dirx + avoid.x * 1.10 + sep.x;
          let rawY = diry + avoid.y * 1.10 + sep.y;
          const rawLen = Math.hypot(rawX, rawY) || 1;
          rawX /= rawLen;
          rawY /= rawLen;

          const blend = 1 - Math.exp(-CONFIG.BOT_STEER_SMOOTH_RATE * dt);
          bot.steerX += (rawX - bot.steerX) * blend;
          bot.steerY += (rawY - bot.steerY) * blend;
          const steerLen = Math.hypot(bot.steerX, bot.steerY) || 1;
          bot.steerX /= steerLen;
          bot.steerY /= steerLen;

          const arrival = clamp((d - CONFIG.BOT_STOP_RADIUS) / CONFIG.BOT_ARRIVAL_SLOW_RADIUS, 0.10, 1);
          driveActor(bot, bot.steerX * arrival, bot.steerY * arrival, dt, true);

          const moved = Math.hypot(bot.x - bot.lastX, bot.y - bot.lastY);
          const expected = Math.hypot(bot.vx, bot.vy) * dt;
          bot.stuck = expected > 1.5 && moved < expected * 0.12 ? bot.stuck + dt : Math.max(0, bot.stuck - dt * 2);


          bot.lastX = bot.x;
          bot.lastY = bot.y;
        } else {
          driveActor(bot, 0, 0, dt, true);
          bot.steerX *= Math.exp(-12 * dt);
          bot.steerY *= Math.exp(-12 * dt);
        }

        const actionD = Math.hypot(
          strategicGoal.x - bot.x,
          strategicGoal.y - bot.y
        );

        if (bot.role === 'RAIDER' && bot.mode === 'RAID_THROUGH_GAP' &&
          Number.isInteger(bot.raidSlotIndex) && actionD < CONFIG.BOT_STOP_RADIUS + 8) {
          bot.mode = 'STEAL_LETTER';
          bot.target = {
            ...getSlotCoords(otherTeam(bot.team), bot.raidSlotIndex),
            index: bot.raidSlotIndex
          };
          bot.targetCommit = CONFIG.BOT_TARGET_COMMIT_TIME;
          return;
        }

        if (bot.role === 'RAIDER' && bot.mode === 'RETURN_THROUGH_GAP' &&
          actionD < CONFIG.BOT_STOP_RADIUS + 8) {
          const ownBase = BASES[bot.team];
          bot.mode = 'DELIVER_STOLEN';
          bot.target = {
            x: ownBase.x + ownBase.w / 2,
            y: ownBase.y + ownBase.h / 2
          };
          bot.targetCommit = CONFIG.BOT_TARGET_COMMIT_TIME;
          return;
        }

        if (bot.role === 'RAIDER' && !bot.inv &&
          bot.mode === 'STEAL_LETTER' &&
          Number.isInteger(bot.raidSlotIndex) && actionD < 18) {
          takeEnemySlottedLetter(bot, bot.raidSlotIndex);
          bot.target = null;
          bot.targetCommit = 0;
          return;
        }

        if (bot.role === 'RAIDER' && bot.inv?.stolen &&
          insideRect(bot, BASES[bot.team])) {
          dropStolenLetter(bot);
          bot.target = null;
          bot.targetCommit = 0;
          return;
        }

        if (bot.role === 'BOMBER' &&
          ['BOMB_THROUGH_GAP', 'JAMMER_THROUGH_GAP'].includes(bot.mode) &&
          actionD < CONFIG.BOT_STOP_RADIUS + 8) {
          const enemyTeam = otherTeam(bot.team);
          if (bot.inv?.type === 'bomb') {
            if (!bot.plantTarget) bot.plantTarget = chooseBomberPlantPoint(bot, enemyTeam);
            bot.mode = bot.plantTarget.mode || 'PLANT_BOMB';
            bot.target = { x: bot.plantTarget.x, y: bot.plantTarget.y };
          } else {
            const base = BASES[enemyTeam];
            bot.mode = 'ACTIVATE_JAMMER';
            bot.target = {
              x: base.x + base.w / 2,
              y: base.y + base.h / 2
            };
          }
          bot.targetCommit = CONFIG.BOT_TARGET_COMMIT_TIME;
          return;
        }

        if (bot.role === 'BOMBER' && bot.inv?.type === 'bomb' &&
          bot.plantTarget && dist(bot, bot.plantTarget) < 19) {
          armOrDrop(bot);
          bot.plantTarget = null;
          bot.plantMode = null;
          bot.target = null;
          bot.targetCommit = 0;
          return;
        }

        if (bot.inv?.type === 'letter' && !bot.inv.stolen && actionD < 14) {
          if (!deposit(bot)) armOrDrop(bot);
          bot.target = null;
          bot.targetCommit = 0;
          return;
        }

        if (bot.inv?.type === 'wall' && bot.buildTarget) {
          const centre = {
            x: bot.buildTarget.x + bot.buildTarget.w / 2,
            y: bot.buildTarget.y + bot.buildTarget.h / 2
          };
          const closeEnoughToBuild = dist(bot, centre) <= CONFIG.REPAIR_RANGE;
          const reachedApproach = actionD <= CONFIG.BOT_STOP_RADIUS + 5;
          if (closeEnoughToBuild && reachedApproach) {
            if (!repair(bot)) {
              bot.buildTarget = null;
              bot.target = null;
              bot.targetCommit = 0;
            }
            return;
          }
        }

        if (bot.inv?.type === 'jammer' && bot.role === 'BOMBER' &&
          insideRect(bot, BASES[otherTeam(bot.team)])) {
          activateJammer(bot);
          bot.target = null;
          bot.targetCommit = 0;
          return;
        }

        if (bot.inv?.type === 'bomb') {
          if (bot.role === 'BOMBER' && !bot.plantTarget &&
            insideRect(bot, BASES[otherTeam(bot.team)])) {
            armOrDrop(bot);
            bot.target = null;
            bot.targetCommit = 0;
            return;
          }
          if (bot.role === 'DEFENDER') {
            const ownBase = BASES[bot.team];
            const cx = ownBase.x + ownBase.w / 2;
            const cy = ownBase.y + ownBase.h / 2;
            if (Math.hypot(bot.x - cx, bot.y - cy) > 240) {
              armOrDrop(bot);
              bot.target = null;
              bot.targetCommit = 0;
              return;
            }
          }
        }

        if (!bot.inv && bot.mode === 'REARRANGE' && Number.isInteger(bot.targetSlotIndex) && actionD < 14) {
          takeSlottedLetter(bot, bot.targetSlotIndex);
          bot.target = null;
          bot.targetCommit = 0;
          return;
        }

        if (!bot.inv && bot.targetItem && items.includes(bot.targetItem) && isItemVisible(bot.targetItem) &&
          dist(bot, bot.targetItem) < bot.r + bot.targetItem.r + CONFIG.PICKUP_RANGE_PAD) {
          pickup(bot, bot.targetItem);
          clearReservation(bot);
          bot.targetItem = null;
          bot.target = null;
          bot.targetCommit = 0;
          return;
        }

        if (!bot.inv && !bot.targetItem) {
          const boost = nearest(bot, i => i.type === 'speed' && dist(bot, i) < 42);
          if (boost) pickup(bot, boost);
        }
      }
