'use strict';

      // ================================================================
      // CLARITY + PACING LAYER
      // Central permissions, contextual feedback, event director and
      // a persistent local-player beacon.
      // ================================================================
      const ROLE_RULES = {
        RUNNER: {
          job: 'Build and steal the word',
          summary: 'Letters · Intel · Golden · Health · Speed · Stealing',
          allowed: ['letter', 'intel', 'golden', 'health', 'speed'],
        },
        GUARDIAN: {
          job: 'Build and defend the fortress',
          summary: 'Bricks · Rifles · Armed bombs · Speed',
          allowed: ['wall', 'gun', 'armed-bomb', 'speed'],
        },
        SABOTEUR: {
          job: 'Breach and disrupt',
          summary: 'Bombs · Jammer · Speed',
          allowed: ['bomb', 'jammer', 'speed'],
        },

        // Legacy capability entries support the compatibility adapter.
        OPERATOR: {
          job: 'Arrange the word',
          summary: 'Letters · Intel · Golden Letter · Speed',
          allowed: ['letter', 'intel', 'golden', 'speed'],
        },
        COLLECTOR: {
          job: 'Arrange the word',
          summary: 'Letters · Speed',
          allowed: ['letter', 'speed'],
        },
        RAIDER: {
          job: 'Steal one enemy letter',
          summary: 'Health · Speed · Stealing',
          allowed: ['health', 'speed'],
        },
        BUILDER: {
          job: 'Build, repair and shield',
          summary: 'Bricks · Speed',
          allowed: ['wall', 'speed'],
        },
        DEFENDER: {
          job: 'Defuse bombs and shoot Runners',
          summary: 'Rifles · Armed bombs · Speed',
          allowed: ['gun', 'armed-bomb', 'speed'],
        },
        BOMBER: {
          job: 'Attack walls and word slots',
          summary: 'Bombs · Jammer · Speed',
          allowed: ['bomb', 'jammer', 'speed'],
        },
      };

      function permissionKey(item) {
        if (!item) return '';
        if (item.type === 'bomb') return item.ignited ? 'armed-bomb' : 'bomb';
        return item.type;
      }

      function canCollectItem(role, item) {
        const rule = ROLE_RULES[role];
        return Boolean(rule && rule.allowed.includes(permissionKey(item)));
      }

      function canActorCollectItem(actor, item) {
        if (!actor || !item || actor.inv) return false;
        if (!canCollectItem(actor.role, item)) return false;

        if (item.type === 'bomb' && item.ignited && isGuardianRole(actor)) {
          if (isTeamJammed(actor.team)) return false;
          if ((item.pickupLockedUntil || 0) > simTime) return false;
        }
        return true;
      }

      function getItemRoleLabel(item) {
        const key = permissionKey(item);
        if (key === 'letter' || key === 'intel' || key === 'golden' || key === 'health') return 'Runner only';
        if (key === 'wall' || key === 'gun' || key === 'armed-bomb') return 'Guardian only';
        if (key === 'bomb' || key === 'jammer') return 'Saboteur only';
        if (key === 'speed') return 'All roles';
        return 'Unavailable';
      }

      function getItemDisplayName(item) {
        if (!item) return 'item';
        if (item.type === 'letter') return `letter ${item.char || ''}`.trim();
        if (item.type === 'golden') return 'Golden Letter';
        if (item.type === 'intel') return 'Intel Card';
        if (item.type === 'wall') return 'brick';
        if (item.type === 'speed') return 'Speed Boost';
        if (item.type === 'jammer') return 'Signal Jammer';
        if (item.type === 'bomb') {
          const prefix = `${bombProfile(item.magnitude || 1).magnitude}×`;
          return item.ignited ? `${prefix} armed bomb` : `${prefix} bomb`;
        }
        return item.type;
      }

      function updateRoleStrip(role) {
        const rule = ROLE_RULES[role];
        if (!rule || !roleStripEl) return;
        roleStripEl.innerHTML =
          `<strong>${role} — ${rule.job}</strong>${rule.summary}<br>` +
          `<span style="color:#8f9aaa">Move WASD / Arrows · Space = Role Action</span>`;
      }

      const permissionsPickup = pickup;
      pickup = function centralizedPermissionPickup(actor, item) {
        if (!item || actor.inv || !isItemVisible(item)) return false;
        if (!canActorCollectItem(actor, item)) {
          if (actor.isPlayer) {
            msg(`${getItemDisplayName(item)}: ${getItemRoleLabel(item)}.`);
          }
          return false;
        }
        return permissionsPickup(actor, item);
      };

      function nearestContextItem(actor, range = null) {
        const allowed = preferredActionItem(
          actor,
          item => isItemVisible(item) && canActorCollectItem(actor, item),
          range
        );
        if (allowed) return allowed;

        return preferredActionItem(
          actor,
          item => isItemVisible(item),
          range
        );
      }

      function getContextTarget() {
        if (!player) return null;

        if (isRunnerRole(player)) {
          if (player.inv?.stolen) {
            return {
              kind: 'status',
              allowed: insideRect(player, BASES[player.team]),
              text: insideRect(player, BASES[player.team])
                ? `Space: deliver stolen ${player.inv.char === '*' ? '★' : player.inv.char}`
                : `Return stolen ${player.inv.char === '*' ? '★' : player.inv.char} to your base`,
            };
          }

          if (!player.inv) {
            const enemyTeam = otherTeam(player.team);
            const slot = enemyLetterSlot(player, enemyTeam);
            if (slot && dist(player, slot) <= CONFIG.DEPOSIT_RANGE + 18) {
              const char = getProgress(enemyTeam)[slot.index];
              return {
                kind: 'slot',
                slot,
                team: enemyTeam,
                allowed: true,
                text: `Space: steal ${char === '*' ? '★' : char}`,
              };
            }
          }
        }

        if (isGuardianRole(player) && !player.inv) {
          const nearbyRaider = (ACTORS || [])
            .filter(actor =>
              isRunnerRole(actor) &&
              actor.team !== player.team &&
              isRaiderThreatToTeam(actor, player.team) &&
              actorsCanSee(player, actor)
            )
            .sort((a, b) => dist(player, a) - dist(player, b))[0];

          if (nearbyRaider && dist(player, nearbyRaider) < 165) {
            const carried = nearbyRaider.inv?.stolen
              ? (nearbyRaider.inv.char === '*'
                  ? 'Golden Letter'
                  : `letter ${nearbyRaider.inv.char}`)
              : '';

            return {
              kind: 'raider',
              actor: nearbyRaider,
              allowed: true,
              text: carried
                ? `Space: shoot Runner carrying ${carried}`
                : 'Contact only shoves · Space shoots',
            };
          }
        }

        if (isGuardianRole(player) && !player.inv) {
          let nearestWall = null;
          let wallDistance = 52;
          for (const wall of walls) {
            if (wall.team !== player.team) continue;
            const point = { x: wall.x + wall.w / 2, y: wall.y + wall.h / 2 };
            const distance = dist(player, point);
            if (distance < wallDistance) {
              wallDistance = distance;
              nearestWall = wall;
            }
          }
          if (nearestWall) {
            return {
              kind: 'wall',
              wall: nearestWall,
              allowed: true,
              text: 'Space: dismantle and reposition wall',
            };
          }
        }

        if (player.inv?.type === 'letter' && insideRect(player, BASES[player.team])) {
          const slot = slotFromHorizontalPosition(player, player.team);
          if (slot) {
            return {
              kind: 'slot',
              slot,
              team: player.team,
              allowed: true,
              text: `Space: place ${player.inv.char === '*' ? '★' : player.inv.char} in slot ${slot.index + 1}`,
            };
          }
        }

        const item = nearestContextItem(player);
        if (!item) {
          if (player.coverTreeId != null) {
            return { kind: 'status', allowed: true, text: 'Hidden: enemies outside this tree cannot see you' };
          }
          return null;
        }

        const allowed = canActorCollectItem(player, item);
        let blockedText = `${getItemDisplayName(item)} — ${getItemRoleLabel(item)}`;

        if (item.type === 'bomb' && item.ignited && isGuardianRole(player)) {
          if (isTeamJammed(player.team)) {
            blockedText = 'Bomb squad jammed';
          } else if ((item.pickupLockedUntil || 0) > simTime) {
            blockedText = `Bomb locking in ${Math.max(0, item.pickupLockedUntil - simTime).toFixed(1)}s`;
          }
        }

        return {
          kind: 'item',
          item,
          allowed,
          text: player.inv
            ? `Carrying ${getItemDisplayName(player.inv)}`
            : allowed
              ? `Space: pick up ${getItemDisplayName(item)}`
              : blockedText,
        };
      }

      function updateContextHint() {
        if (!contextHintEl) return;
        const target = getContextTarget();
        contextHintEl.classList.remove('allowed', 'blocked');

        if (!target) {
          contextHintEl.textContent = player
            ? `${player.role}: ${ROLE_RULES[player.role]?.job || 'Play your role'}`
            : 'Choose a role to begin.';
          return;
        }

        contextHintEl.textContent = target.text;
        contextHintEl.classList.add(target.allowed ? 'allowed' : 'blocked');
      }

      function drawContextHighlight() {
        const target = getContextTarget();
        if (!target || target.kind === 'status') return;

        ctx.save();
        ctx.strokeStyle = target.allowed ? '#65e681' : '#d16d6d';
        ctx.lineWidth = 3;
        ctx.setLineDash([6, 4]);

        if (target.kind === 'item') {
          ctx.beginPath();
          ctx.arc(target.item.x, target.item.y, target.item.r + 8, 0, Math.PI * 2);
          ctx.stroke();
        } else if (target.kind === 'slot') {
          const slot = target.slot;
          ctx.strokeRect(
            slot.x - slot.size / 2 - 4,
            slot.y - slot.size / 2 - 4,
            slot.size + 8,
            slot.size + 8
          );
        } else if (target.kind === 'wall') {
          const wall = target.wall;
          ctx.strokeRect(wall.x - 4, wall.y - 4, wall.w + 8, wall.h + 8);
        } else if (target.kind === 'raider') {
          const raider = target.actor;
          ctx.beginPath();
          ctx.arc(raider.x, raider.y, raider.r + 10, 0, Math.PI * 2);
          ctx.strokeStyle = '#ffb347';
          ctx.stroke();
        }

        ctx.restore();
      }

      function drawPlayerBeacon(alpha = 1) {
        if (!player || player.alive === false) return;

        const x = player.prevX + (player.x - player.prevX) * alpha;
        const y = player.prevY + (player.y - player.prevY) * alpha;
        const pulse = 0.5 + 0.5 * Math.sin(simTime * 7);
        const innerRadius = Math.max(5, player.r - 4 + pulse * 0.8);

        ctx.save();

        // Keep the local-player marker entirely inside the character body.
        // This leaves the space above the actor clear for carried letters/items.
        ctx.beginPath();
        ctx.arc(x, y, innerRadius, 0, Math.PI * 2);
        ctx.strokeStyle = player.coverTreeId != null
          ? 'rgba(194, 255, 206, 0.95)'
          : 'rgba(255, 255, 255, 0.95)';
        ctx.lineWidth = 2.4;
        ctx.setLineDash([3, 2]);
        ctx.lineDashOffset = -simTime * 12;
        ctx.stroke();
        ctx.setLineDash([]);

        // Small centre sparkle makes the player readable without covering role hats.
        ctx.beginPath();
        ctx.arc(x, y, 2.2 + pulse * 0.7, 0, Math.PI * 2);
        ctx.fillStyle = player.coverTreeId != null ? '#bfffc9' : '#ffffff';
        ctx.fill();

        ctx.restore();
      }

      // Make defenders choose the most urgent bomb: shortest fuse first,
      // then distance to the word row. Builders stop hoarding bricks while
      // an active shield already protects the base.
      function defenderEngagementTarget(defender, raider) {
        if (!defender || !raider) {
          return defender
            ? { x: defender.x, y: defender.y }
            : null;
        }

        const distance = dist(defender, raider);
        const profile = typeof weaponProfile === 'function'
          ? weaponProfile(defender)
          : { range: 255 };

        const shotIsClear =
          typeof clearShotLine === 'function' &&
          clearShotLine(defender, raider);

        // Move closer when the shot is blocked or the Raider is outside
        // comfortable weapon range.
        if (!shotIsClear || distance > profile.range * 0.88) {
          return { x: raider.x, y: raider.y };
        }

        // Back away when a Raider reaches contact distance.
        if (distance < 105) {
          const dx = defender.x - raider.x;
          const dy = defender.y - raider.y;
          const length = Math.hypot(dx, dy) || 1;

          return {
            x: clamp(
              defender.x + (dx / length) * 78,
              defender.r,
              CONFIG.W - defender.r
            ),
            y: clamp(
              defender.y + (dy / length) * 78,
              defender.r + 82,
              CONFIG.H - defender.r
            ),
          };
        }

        // Hold position and let the combat system aim/fire.
        return { x: defender.x, y: defender.y };
      }

      const clarityChooseBase = choose;
      choose = function clarityChoose(bot) {
        if (bot.role === 'BUILDER' && fortressComplete(bot.team) && shieldActive(bot.team)) {
          clearReservation(bot);
          if (bot.inv?.type === 'wall') armOrDrop(bot);
          const base = BASES[bot.team];
          const phase = simTime * 0.48 + bot.patrolPhase;
          bot.mode = 'SHIELD_PATROL';
          bot.target = {
            x: base.x + base.w / 2 + Math.cos(phase) * 72,
            y: base.y + base.h / 2 + Math.sin(phase) * 52,
          };
          return;
        }

        if (bot.role === 'DEFENDER' && !bot.inv) {
          const base = BASES[bot.team];
          const layout = getSlotLayout(bot.team);

          const raiderThreats = (ACTORS || [])
            .filter(actor =>
              isRunnerRole(actor) &&
              actor.team !== bot.team &&
              isRaiderThreatToTeam(actor, bot.team) &&
              actorsCanSee(bot, actor)
            )
            .sort((a, b) => {
              const aLoot = a.inv?.stolen && a.inv.stolenFrom === bot.team ? 0 : 1;
              const bLoot = b.inv?.stolen && b.inv.stolenFrom === bot.team ? 0 : 1;
              return (aLoot - bLoot) || (dist(bot, a) - dist(bot, b));
            });

          const visibleRaider = raiderThreats[0] || null;
          const raiderHasLoot = Boolean(
            visibleRaider?.inv?.stolen &&
            visibleRaider.inv.stolenFrom === bot.team
          );

          const bombCandidates = isTeamJammed(bot.team)
            ? []
            : items
                .filter(item =>
                  item.type === 'bomb' &&
                  item.ignited &&
                  (item.pickupLockedUntil || 0) <= simTime &&
                  !isReservedByOther(bot, item) &&
                  Math.hypot(
                    item.x - (base.x + base.w / 2),
                    item.y - (base.y + base.h / 2)
                  ) < 300
                )
                .sort((a, b) => {
                  const aSlotDistance = Math.abs(a.y - layout.y);
                  const bSlotDistance = Math.abs(b.y - layout.y);
                  return (a.timer * 100 + aSlotDistance) -
                    (b.timer * 100 + bSlotDistance);
                });

          const mostUrgentBomb = bombCandidates[0] || null;
          const urgentBomb = Boolean(
            mostUrgentBomb &&
            (
              mostUrgentBomb.timer <= 2.15 ||
              Math.abs(mostUrgentBomb.y - layout.y) < 72
            )
          );

          // A nearly exploding bomb still wins. Otherwise, a Runner escaping
          // with a stolen letter becomes the Defender's immediate priority.
          if (urgentBomb) {
            bot.interceptTarget = null;
            bot.mode = 'DISARM';
            bot.targetItem = mostUrgentBomb;
            reserveItem(bot, mostUrgentBomb);
            bot.target = { x: mostUrgentBomb.x, y: mostUrgentBomb.y };
            return;
          }

          if (visibleRaider && (raiderHasLoot || dist(bot, visibleRaider) < 285)) {
            clearReservation(bot);
            bot.mode = 'INTERCEPT_RAIDER';
            bot.interceptTarget = visibleRaider;
            bot.targetItem = null;
            bot.target = defenderEngagementTarget(bot, visibleRaider);
            return;
          }

          if (mostUrgentBomb) {
            bot.interceptTarget = null;
            bot.mode = 'DISARM';
            bot.targetItem = mostUrgentBomb;
            reserveItem(bot, mostUrgentBomb);
            bot.target = { x: mostUrgentBomb.x, y: mostUrgentBomb.y };
            return;
          }

          if (visibleRaider) {
            clearReservation(bot);
            bot.mode = 'INTERCEPT_RAIDER';
            bot.interceptTarget = visibleRaider;
            bot.targetItem = null;
            bot.target = defenderEngagementTarget(bot, visibleRaider);
            return;
          }
        }

        bot.interceptTarget = null;

        if (bot.role === 'DEFENDER' && bot.guardianDuty === 'SENTINEL' && !bot.inv) {
          const base = BASES[bot.team];
          const side = bot.team === 'blue' ? 1 : -1;
          const phase = simTime * 0.56 + bot.patrolPhase;
          bot.mode = 'SENTRY_PATROL';
          bot.target = {
            x: base.x + base.w / 2 + side * 72,
            y: base.y + base.h / 2 + Math.sin(phase) * 64,
          };
          return;
        }

        clarityChooseBase(bot);
      };

      const defenderAwareUpdateBotBase = updateBot;
      updateBot = function defenderAwareUpdateBot(bot, dt) {
        if (bot.role === 'DEFENDER' && !bot.guardianZoneManaged) {
          bot.defenderAlertTimer = Math.max(
            0,
            (bot.defenderAlertTimer || 0) - dt
          );

          if (!bot.inv && bot.defenderAlertTimer <= 0) {
            bot.defenderAlertTimer = CONFIG.DEFENDER_ALERT_SCAN_INTERVAL;

            const raider = (ACTORS || [])
              .filter(actor =>
                isRunnerRole(actor) &&
                actor.team !== bot.team &&
                isRaiderThreatToTeam(actor, bot.team) &&
                actorsCanSee(bot, actor)
              )
              .sort((a, b) => {
                const aLoot =
                  a.inv?.stolen && a.inv.stolenFrom === bot.team ? 0 : 1;
                const bLoot =
                  b.inv?.stolen && b.inv.stolenFrom === bot.team ? 0 : 1;
                return (aLoot - bLoot) || (dist(bot, a) - dist(bot, b));
              })[0];

            if (raider) {
              const carryingLoot = Boolean(
                raider.inv?.stolen &&
                raider.inv.stolenFrom === bot.team
              );

              // Interrupt ordinary patrols immediately. Do not abandon a bomb
              // that is already close to exploding.
              const currentBomb = bot.targetItem &&
                bot.targetItem.type === 'bomb' &&
                bot.targetItem.ignited
                ? bot.targetItem
                : null;

              const currentBombUrgent = Boolean(
                currentBomb && currentBomb.timer <= 1.85
              );

              if (!currentBombUrgent &&
                (carryingLoot || bot.mode !== 'INTERCEPT_RAIDER')) {
                clearReservation(bot);
                bot.mode = 'INTERCEPT_RAIDER';
                bot.interceptTarget = raider;
                bot.targetItem = null;
                bot.target = defenderEngagementTarget(bot, raider);
                bot.targetCommit = 0.22;
                bot.thinkTimer = 0.08;
              }
            }
          }

          if (bot.mode === 'INTERCEPT_RAIDER' && bot.interceptTarget) {
            const raider = bot.interceptTarget;

            if (isRaiderThreatToTeam(raider, bot.team) &&
              actorsCanSee(bot, raider)) {
              bot.target = defenderEngagementTarget(bot, raider);
              bot.targetCommit = Math.max(bot.targetCommit, 0.18);
            } else {
              bot.interceptTarget = null;
              bot.target = null;
              bot.targetCommit = 0;
              bot.thinkTimer = 0;
            }
          }
        }

        defenderAwareUpdateBotBase(bot, dt);
      };

      // ================================================================
      // BOT ANTI-STALL LAYER
      // Bots can intentionally wait, but they should never remain frozen
      // because of a stale item, unreachable target, reservation or wall wedge.
      // ================================================================
      function clearBotIntent(bot, keepInventory = true) {
        clearReservation(bot);
        bot.target = null;
        bot.targetItem = null;
        bot.targetSlotIndex = null;
        bot.buildTarget = null;
        bot.plantTarget = null;
        bot.plantMode = null;
        bot.interceptTarget = null;
        bot.detour = 0;
        bot.detourTarget = null;
        bot.targetCommit = 0;
        bot.thinkTimer = 0;
        bot.stuck = 0;
        bot.steerX = 0;
        bot.steerY = 0;
        bot.arrivalFailTime = 0;
        bot.noProgressTime = 0;

        if (!keepInventory) bot.inv = null;
      }

      function botTargetItemStillValid(bot) {
        const item = bot.targetItem;
        if (!item) return true;
        if (!items.includes(item)) return false;
        if (!isItemVisible(item)) return false;
        if (bot.failedItem === item && bot.failedItemUntil > simTime) return false;

        // Use the same permission rules as the human player.
        if (typeof canActorCollectItem === 'function' &&
          !canActorCollectItem(bot, item)) {
          return false;
        }

        return true;
      }

      function chooseBotRecoveryPoint(bot) {
        const distances = [78, 112, 146];
        const baseAngle =
          Math.atan2(bot.y - CONFIG.H / 2, bot.x - CONFIG.W / 2) +
          bot.avoidSide * Math.PI / 2;

        for (const distance of distances) {
          for (let step = 0; step < 10; step++) {
            const angle =
              baseAngle +
              bot.avoidSide * (step * Math.PI / 5) +
              Math.random() * 0.18;

            const point = {
              x: clamp(
                bot.x + Math.cos(angle) * distance,
                bot.r + 8,
                CONFIG.W - bot.r - 8
              ),
              y: clamp(
                bot.y + Math.sin(angle) * distance,
                bot.r + 92,
                CONFIG.H - bot.r - 12
              ),
            };

            const probe = { x: point.x, y: point.y, r: bot.r + 3 };
            if (walls.some(wall => hitRect(probe, wall))) continue;

            return point;
          }
        }

        const base = BASES[bot.team];
        return {
          x: base.x + base.w / 2,
          y: base.y + base.h / 2,
        };
      }

      function recoverBot(bot, reason = 'stalled') {
        clearBotIntent(bot, true);

        const point = chooseBotRecoveryPoint(bot);
        bot.mode = 'RECOVER';
        bot.target = point;
        bot.targetCommit = CONFIG.BOT_RECOVERY_TIME;
        bot.thinkTimer = CONFIG.BOT_RECOVERY_TIME * 0.72;
        bot.recoverUntil = simTime + CONFIG.BOT_RECOVERY_TIME;
        bot.recoveryCount += 1;
        bot.avoidSide *= -1;

        const dx = point.x - bot.x;
        const dy = point.y - bot.y;
        const length = Math.hypot(dx, dy) || 1;

        // A small initial nudge breaks overlap with walls or other actors.
        bot.vx = (dx / length) * Math.min(130, bot.maxSpeed * 0.45);
        bot.vy = (dy / length) * Math.min(130, bot.maxSpeed * 0.45);

        bot.progressX = bot.x;
        bot.progressY = bot.y;
        bot.progressTimer = CONFIG.BOT_PROGRESS_SAMPLE;
        bot.lastRecoveryReason = reason;
      }

      function idlePatrolTarget(bot) {
        const base = BASES[bot.team];
        const enemy = BASES[otherTeam(bot.team)];
        const phase = simTime * 0.62 + bot.patrolPhase;

        if (bot.role === 'BUILDER') {
          return {
            x: base.x + base.w / 2 + Math.cos(phase) * 82,
            y: base.y + base.h / 2 + Math.sin(phase) * 58,
          };
        }

        if (bot.role === 'RAIDER') {
          const outsideX = bot.team === 'blue'
            ? enemy.x - 58
            : enemy.x + enemy.w + 58;

          return {
            x: outsideX + Math.cos(phase) * 24,
            y: enemy.y + enemy.h / 2 + Math.sin(phase) * 104,
          };
        }

        return {
          x: 500 + Math.cos(phase) * 190,
          y: 350 + Math.sin(phase) * 155,
        };
      }

      // Replace visually frozen "wait at one exact pixel" states with restrained
      // patrol motion. Their logic remains the same; only the idle presentation changes.
      const antiStallChooseBase = choose;
      choose = function antiStallChoose(bot) {
        antiStallChooseBase(bot);

        if (['WAIT', 'SCOUT_BOUNDARY', 'WAIT_FOR_BREACH'].includes(bot.mode)) {
          bot.target = idlePatrolTarget(bot);
        }
      };

      const antiStallUpdateBotBase = updateBot;
      updateBot = function antiStallUpdateBot(bot, dt) {
        // Repair invalid numeric state instead of letting one NaN freeze the actor.
        const numericValues = [bot.x, bot.y, bot.vx, bot.vy];
        if (numericValues.some(value => !Number.isFinite(value))) {
          const base = BASES[bot.team];
          bot.x = base.x + base.w / 2;
          bot.y = base.y + base.h / 2;
          bot.prevX = bot.x;
          bot.prevY = bot.y;
          bot.vx = 0;
          bot.vy = 0;
          clearBotIntent(bot, true);
        }

        if (bot.failedItemUntil <= simTime) {
          bot.failedItem = null;
        }

        if (!botTargetItemStillValid(bot)) {
          bot.failedItem = bot.targetItem;
          bot.failedItemUntil = simTime + CONFIG.BOT_FAILED_ITEM_COOLDOWN;
          clearBotIntent(bot, true);
        }

        antiStallUpdateBotBase(bot, dt);

        if (state.over) return;

        // A bot may reach an item but fail to collect it because the item became
        // locked, jammed or otherwise invalid after the route was selected.
        if (!bot.inv && bot.targetItem && items.includes(bot.targetItem)) {
          const pickupDistance =
            bot.r + bot.targetItem.r + CONFIG.PICKUP_RANGE_PAD + 5;

          if (dist(bot, bot.targetItem) <= pickupDistance) {
            bot.arrivalFailTime += dt;

            if (bot.arrivalFailTime >= CONFIG.BOT_ARRIVAL_FAIL_TIME) {
              bot.failedItem = bot.targetItem;
              bot.failedItemUntil =
                simTime + CONFIG.BOT_FAILED_ITEM_COOLDOWN;
              clearBotIntent(bot, true);
            }
          } else {
            bot.arrivalFailTime = 0;
          }
        } else {
          bot.arrivalFailTime = 0;
        }

        bot.progressTimer -= dt;
        if (bot.progressTimer > 0) return;
        bot.progressTimer = CONFIG.BOT_PROGRESS_SAMPLE;

        const moved = Math.hypot(
          bot.x - bot.progressX,
          bot.y - bot.progressY
        );
        bot.progressX = bot.x;
        bot.progressY = bot.y;

        const targetDistance = bot.target ? dist(bot, bot.target) : 0;
        const expectsMovement =
          Boolean(bot.target) &&
          targetDistance > 22 &&
          bot.stunTimer <= 0 &&
          simTime >= bot.recoverUntil;

        if (expectsMovement && moved < 2.1) {
          bot.noProgressTime += CONFIG.BOT_PROGRESS_SAMPLE;
        } else {
          bot.noProgressTime = Math.max(
            0,
            bot.noProgressTime - CONFIG.BOT_PROGRESS_SAMPLE * 1.4
          );
        }

        if (bot.noProgressTime >= CONFIG.BOT_HARD_STALL_TIME) {
          recoverBot(bot, 'hard stall');
          return;
        }

        // A softer reset catches stale modes and reservations before they become
        // a visible full stop.
        if (bot.noProgressTime >= CONFIG.BOT_SOFT_STALL_TIME) {
          clearReservation(bot);
          bot.targetCommit = 0;
          bot.thinkTimer = 0;
          bot.detour = 0;
          bot.avoidSide *= -1;
        }
      };

      function armedBombNear(x, y, minimumDistance = 76) {
        return items.some(item =>
          item.type === 'bomb' &&
          item.ignited &&
          Math.hypot(item.x - x, item.y - y) < minimumDistance
        );
      }

      chooseBomberPlantPoint = function spacedBomberPlantPoint(actor, enemyTeam) {
        const base = BASES[enemyTeam];
        const gaps = getOpenBoundaryGaps(enemyTeam);
        const occupied = getProgress(enemyTeam)
          .map((char, index) => char ? index : null)
          .filter(index => index != null);

        if (gaps.length && occupied.length) {
          const slotCandidates = occupied
            .map(index => ({ ...getSlotCoords(enemyTeam, index), index }))
            .filter(slot => !armedBombNear(slot.x, slot.y - 45))
            .sort((a, b) => dist(actor, a) - dist(actor, b));

          if (slotCandidates.length) {
            const slot = slotCandidates[0];
            return { x: slot.x, y: slot.y - 45, mode: 'SLOT_ATTACK' };
          }
        }

        const wallCandidates = walls
          .filter(wall => wall.team === enemyTeam)
          .map(wall => ({ wall, point: pointOutsideWall(wall, base) }))
          .filter(entry => !armedBombNear(entry.point.x, entry.point.y))
          .sort((a, b) => dist(actor, a.point) - dist(actor, b.point));

        if (wallCandidates.length) {
          return { ...wallCandidates[0].point, mode: 'WALL_ATTACK' };
        }

        return {
          x: base.x + base.w / 2,
          y: base.y + base.h / 2 - 45,
          mode: 'SLOT_ATTACK',
        };
      };

      Object.assign(CONFIG, {
        DIRECTOR_EVENT_MIN: 38,
        DIRECTOR_EVENT_MAX: 52,
        INTERNAL_BOMB_MIN_GAP: 60,
      });

      state.eventDirector = {
        nextAt: Infinity,
        activeType: '',
        activeUntil: 0,
        lastInternalAt: -999,
      };

      function countFieldItems(type, predicate = () => true) {
        return items.filter(item => item.type === type && predicate(item)).length;
      }

      function enforceItemCaps() {
        while (
          items.filter(item => item.type === 'letter').length >
          CONFIG.MAX_LETTERS
        ) {
          if (!removeSafestLooseLetter()) break;
        }

        const caps = [
          ['wall', CONFIG.MAX_WALLS_ITEM, () => true],
          ['speed', CONFIG.MAX_SPEED_BOOSTS, () => true],
          ['jammer', CONFIG.MAX_JAMMERS, () => true],
          ['intel', CONFIG.INTEL_MAX, () => true],
          ['golden', CONFIG.GOLDEN_MAX, () => true],
          ['bomb', CONFIG.MAX_BOMBS, item => !item.ignited],
        ];

        for (const [type, cap, predicate] of caps) {
          const matches = items.filter(
            item => item.type === type && predicate(item)
          );
          while (matches.length > cap) {
            const extra = matches.pop();
            if (extra) removeItem(extra);
          }
        }
      }

      function armedBombCountInBase(team) {
        const base = BASES[team];
        return items.filter(item =>
          item.type === 'bomb' && item.ignited && insideRect(item, base)
        ).length;
      }

      function chooseDirectorEvent() {
        const options = [];

        if (simTime - state.eventDirector.lastInternalAt >= CONFIG.INTERNAL_BOMB_MIN_GAP) {
          const validTeams = ['blue', 'red'].filter(team => armedBombCountInBase(team) < 2);
          if (validTeams.length) options.push({ type: 'internal', weight: 2, teams: validTeams });
        }

        if (!items.some(item => item.type === 'bomb' && !item.ignited && (item.magnitude || 1) >= 2)) {
          options.push({ type: 'mega', weight: 1 });
        }
        if (!trees.some(tree => tree.treasureUntil > simTime && !tree.treasureClaimed)) {
          options.push({ type: 'treasure', weight: 2 });
        }
        if (!items.some(item => item.type === 'golden')) {
          options.push({ type: 'golden', weight: 1 });
        }
        if (!items.some(item => item.type === 'intel')) {
          options.push({ type: 'intel', weight: 2 });
        }
        if (countFieldItems('wall') <= 2) {
          options.push({ type: 'bricks', weight: 1 });
        }

        if (!options.length) return null;
        const total = options.reduce((sum, option) => sum + option.weight, 0);
        let roll = Math.random() * total;
        for (const option of options) {
          roll -= option.weight;
          if (roll <= 0) return option;
        }
        return options[options.length - 1];
      }

      function triggerDirectedEvent(option) {
        if (!option) return false;
        const director = state.eventDirector;
        director.activeType = option.type;

        if (option.type === 'internal') {
          const team = option.teams[Math.floor(Math.random() * option.teams.length)];
          spawnInternalBomb(team);
          director.lastInternalAt = simTime;
          director.activeUntil = simTime + 13;
        } else if (option.type === 'mega') {
          const location = chooseOpenSpawn('bomb', CONFIG.ITEM_RADIUS_OTHER + 6);
          createItemAt('bomb', location.x, location.y, { magnitude: 2 });
          msg('WORLD EVENT: A 2× MEGA BOMB HAS LANDED!');
          director.activeUntil = simTime + 14;
        } else if (option.type === 'treasure') {
          activateTreasureTree();
          director.activeUntil = simTime + CONFIG.TREASURE_TREE_TIME;
        } else if (option.type === 'golden') {
          const location = chooseOpenSpawn('golden', CONFIG.ITEM_RADIUS_LETTER);
          createItemAt('golden', location.x, location.y);
          msg('WORLD EVENT: GOLDEN LETTER!');
          director.activeUntil = simTime + 17;
        } else if (option.type === 'intel') {
          const location = chooseOpenSpawn('intel', CONFIG.ITEM_RADIUS_OTHER);
          createItemAt('intel', location.x, location.y, {
            expiresAt: simTime + CONFIG.INTEL_LIFETIME,
          });
          msg('WORLD EVENT: TIMED INTEL CARD!');
          director.activeUntil = simTime + CONFIG.INTEL_LIFETIME;
        } else if (option.type === 'bricks') {
          for (let index = 0; index < 2; index++) {
            if (countFieldItems('wall') >= CONFIG.MAX_WALLS_ITEM) break;
            const location = chooseOpenSpawn('wall', CONFIG.ITEM_RADIUS_OTHER);
            createItemAt('wall', location.x, location.y);
          }
          msg('WORLD EVENT: DOUBLE BRICK DROP!');
          director.activeUntil = simTime + 8;
        }

        director.nextAt = simTime +
          randomBetween(CONFIG.DIRECTOR_EVENT_MIN, CONFIG.DIRECTOR_EVENT_MAX);
        return true;
      }

      let clarityMaintenanceTimer = 0;
      const clarityTickBase = tick;
      tick = function clarityTick(dt) {
        clarityTickBase(dt);
        if (state.over || !player) return;

        resolveDefenderRaiderContacts();

        for (let index = interceptEffects.length - 1; index >= 0; index--) {
          interceptEffects[index].time -= dt;
          if (interceptEffects[index].time <= 0) {
            interceptEffects.splice(index, 1);
          }
        }

        clarityMaintenanceTimer -= dt;
        if (clarityMaintenanceTimer <= 0) {
          enforceItemCaps();
          updateContextHint();
          clarityMaintenanceTimer = 0.12;
        }

        const director = state.eventDirector;
        if (director.activeType && simTime >= director.activeUntil) {
          director.activeType = '';
        }

        if (!director.activeType && simTime >= director.nextAt) {
          const event = chooseDirectorEvent();
          if (!triggerDirectedEvent(event)) {
            director.nextAt = simTime + 8;
          }
        }
      };

      const clarityWorldEffectsBase = drawWorldEffects;
      drawWorldEffects = function clarityWorldEffects() {
        clarityWorldEffectsBase();

        for (const effect of interceptEffects) {
          const progress = 1 - effect.time / effect.maxTime;
          ctx.save();
          ctx.beginPath();
          ctx.arc(effect.x, effect.y, 17 + progress * 30, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(255,179,71,${1 - progress})`;
          ctx.lineWidth = 5 - progress * 2;
          ctx.stroke();
          ctx.restore();
        }

        if (state.over) {
          ctx.save();
          ctx.fillStyle = '#10131bdd';
          ctx.fillRect(250, 292, 500, 116);
          ctx.strokeStyle = '#ffffffaa';
          ctx.lineWidth = 2;
          ctx.strokeRect(250, 292, 500, 116);

          ctx.fillStyle = '#fff';
          ctx.font = '900 25px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('MATCH COMPLETE', 500, 328);

          ctx.fillStyle = '#cbd4e1';
          ctx.font = 'bold 12px sans-serif';
          ctx.fillText(
            msgEl.textContent || 'The match has ended.',
            500,
            368
          );
          ctx.restore();
        }

        drawContextHighlight();
        drawPlayerBeacon(1);
      };
