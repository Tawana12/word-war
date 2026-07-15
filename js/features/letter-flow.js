'use strict';

      // ================================================================
      // LETTER FLOW DIRECTOR
      // The match must never become unwinnable because the last copy of a
      // letter is hidden, carried by the enemy or locked in the enemy word.
      // ================================================================
      state.letterFlow = {
        timer: 0,
        shortageSince: {
          blue: new Map(),
          red: new Map(),
        },
        lastNoticeAt: -999,
      };

      function teamHasRecoverableRaider(team) {
        return (ACTORS || []).some(actor =>
          actor.team === team &&
          isRunnerRole(actor) &&
          (
            actor.alive !== false ||
            actor.respawnTimer > 0 ||
            actor.lives > 0
          )
        );
      }

      function accessibleLetterCounts(team) {
        const chars = [];

        // A visible loose letter is immediately contestable. Hidden letters
        // remain bonus discoveries but are not allowed to be the only copy.
        for (const item of items) {
          if (item.type === 'letter' && isItemVisible(item)) {
            chars.push(item.char);
          }
        }

        // Letters already held by this team are still considered recoverable.
        for (const actor of ACTORS || []) {
          if (actor.team !== team || actor.alive === false) continue;
          if (actor.inv?.type === 'letter' && actor.inv.char) {
            chars.push(actor.inv.char);
          }
        }

        return countCharacters(chars);
      }

      function enemyControlsCharacter(team, char) {
        const enemy = otherTeam(team);

        if (getProgress(enemy).includes(char)) return true;

        return (ACTORS || []).some(actor =>
          actor.team === enemy &&
          actor.alive !== false &&
          actor.inv?.type === 'letter' &&
          actor.inv.char === char
        );
      }

      function spawnFlowLetter(team, char) {
        const point = chooseOpenSpawn(
          'letter',
          CONFIG.ITEM_RADIUS_LETTER
        );

        const item = createItemAt('letter', point.x, point.y, {
          char,
          revealed: true,
          revealTime: simTime,
          flowCritical: true,
          flowTeam: team,
          bornAt: simTime,
        });

        item.hiddenByTree = null;
        item.revealed = true;
        return item;
      }

      function maintainTeamLetterAccess(team, budget) {
        const missing = getMissingLetters(team);
        const demand = countCharacters(missing);
        const accessible = accessibleLetterCounts(team);
        const shortageMap = state.letterFlow.shortageSince[team];
        const noRaider = !teamHasRecoverableRaider(team);

        for (const [char, neededCount] of demand.entries()) {
          const availableCount = accessible.get(char) || 0;

          if (availableCount >= neededCount) {
            shortageMap.delete(char);
            continue;
          }

          if (!shortageMap.has(char)) {
            shortageMap.set(char, simTime);
          }

          const shortageAge = simTime - shortageMap.get(char);
          const grace = noRaider && enemyControlsCharacter(team, char)
            ? CONFIG.LETTER_RESCUE_NO_RAIDER_GRACE
            : CONFIG.LETTER_RESCUE_GRACE;

          if (shortageAge < grace || budget.remaining <= 0) continue;

          const copiesToRelease = Math.min(
            neededCount - availableCount,
            budget.remaining
          );

          for (let copy = 0; copy < copiesToRelease; copy++) {
            spawnFlowLetter(team, char);
            budget.remaining -= 1;
            accessible.set(char, (accessible.get(char) || 0) + 1);
          }

          shortageMap.set(char, simTime);

          if (
            noRaider &&
            enemyControlsCharacter(team, char) &&
            simTime - state.letterFlow.lastNoticeAt > 7
          ) {
            msg(
              `${team.toUpperCase()} LETTER RELAY released ${char} — ` +
              `the match cannot be locked by a lost Runner.`
            );
            state.letterFlow.lastNoticeAt = simTime;
          }
        }

        // Forget shortages for letters no longer required.
        for (const char of [...shortageMap.keys()]) {
          if (!demand.has(char)) shortageMap.delete(char);
        }
      }

      function maintainLetterPopulation(budget) {
        let looseCount = items.filter(item => item.type === 'letter').length;

        while (
          looseCount < CONFIG.LETTER_FIELD_MIN &&
          budget.remaining > 0
        ) {
          spawn('letter', false, {
            char: chooseBackgroundLetter(),
            forceVisible: Math.random() < 0.72,
          });
          looseCount += 1;
          budget.remaining -= 1;
        }

        if (
          looseCount < CONFIG.LETTER_FIELD_TARGET &&
          budget.remaining > 0 &&
          Math.random() < 0.72
        ) {
          spawn('letter', false, {
            char: chooseBackgroundLetter(),
            forceVisible: Math.random() < 0.62,
          });
          budget.remaining -= 1;
        }

        enforceItemCaps();
      }

      function updateLetterFlowDirector(dt) {
        state.letterFlow.timer -= dt;
        if (state.letterFlow.timer > 0) return;

        const budget = { remaining: 4 };

        maintainTeamLetterAccess('blue', budget);
        maintainTeamLetterAccess('red', budget);
        maintainLetterPopulation(budget);

        state.letterFlow.timer = CONFIG.LETTER_FLOW_CHECK;
      }

      const letterFlowTickBase = tick;
      tick = function letterFlowTick(dt) {
        letterFlowTickBase(dt);
        if (state.over || !player || globalThis.isSoloFieldRunActive?.()) return;
        updateLetterFlowDirector(dt);
      };

      window.__wordWarsDebug = {
        forceMazeStep() {
          mazeTimer = 0;
        },
        snapshot() {
          return {
            simTime,
            mazePhase,
            activeMazeIndex,
            mazeTimer,
            mazeConflicts: countMazeWallConflicts(),
            letters: items
              .filter(item => item.type === 'letter')
              .map(item => ({
                char: item.char,
                visible: isItemVisible(item),
                critical: Boolean(item.flowCritical),
                forTeam: item.flowTeam || null,
              })),
            missing: {
              blue: getMissingLetters('blue'),
              red: getMissingLetters('red'),
            },
            actors: (ACTORS || []).map(actor => ({
              role: actor.role,
              team: actor.team,
              alive: actor.alive !== false,
              x: Math.round(actor.x),
              y: Math.round(actor.y),
              speed: Math.round(Math.hypot(actor.vx, actor.vy)),
              mode: actor.mode,
              noProgress: Number((actor.noProgressTime || 0).toFixed(2)),
              pathLength: actor.navPath?.length || 0,
              pathIndex: actor.navPathIndex || 0,
            })),
          };
        },
      };
