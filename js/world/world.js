'use strict';

      function buildFortress(base, team) {
        const s = CONFIG.WALL_SIZE;
        const segments = [];

        for (let x = base.x - s; x <= base.x + base.w; x += s) {
          segments.push({ x, y: base.y - s, w: s, h: s, team, edge: 'top' });
          segments.push({ x, y: base.y + base.h, w: s, h: s, team, edge: 'bottom' });
        }
        for (let y = base.y; y < base.y + base.h; y += s) {
          segments.push({ x: base.x - s, y, w: s, h: s, team, edge: 'left' });
          segments.push({ x: base.x + base.w, y, w: s, h: s, team, edge: 'right' });
        }

        for (const seg of segments) {
          const facesArena = (team === 'blue' && seg.edge === 'right') ||
            (team === 'red' && seg.edge === 'left');
          const doorCandidate = facesArena &&
            (seg.y === base.y + 60 || seg.y === base.y + 90);

          if (!blueprints.some(b => b.team === team && b.x === seg.x && b.y === seg.y)) {
            blueprints.push({ ...seg, doorCandidate });

            const isCorner =
              (seg.x === base.x - s || seg.x === base.x + base.w) &&
              (seg.y === base.y - s || seg.y === base.y + base.h);
            const isBack = (team === 'blue' && seg.edge === 'left') ||
              (team === 'red' && seg.edge === 'right');

            // The match begins with only a light rear defence. Every perimeter
            // position, including the possible doorway, remains a valid build slot.
            if (isBack || isCorner) walls.push({ ...seg });
          }
        }
      }
      buildFortress(BASES.blue, 'blue'); buildFortress(BASES.red, 'red');

      // ================================================================
      // SHIFTING FIELD MAZE
      // The veld alternates between open phases and several lane layouts.
      // A warning preview appears before walls vanish and a new maze arrives.
      // ================================================================
      const MAZE_CONFIGS = [
        [
          { x: 250, y: 190, w: 120, h: 14 },
          { x: 630, y: 190, w: 120, h: 14 },
          { x: 415, y: 135, w: 14, h: 118 },
          { x: 571, y: 135, w: 14, h: 118 },
          { x: 455, y: 326, w: 90, h: 14 },
          { x: 285, y: 430, w: 125, h: 14 },
          { x: 590, y: 430, w: 125, h: 14 },
          { x: 445, y: 480, w: 14, h: 105 },
          { x: 541, y: 480, w: 14, h: 105 },
        ],
        [
          { x: 270, y: 135, w: 14, h: 145 },
          { x: 330, y: 250, w: 145, h: 14 },
          { x: 455, y: 155, w: 14, h: 100 },
          { x: 531, y: 300, w: 14, h: 100 },
          { x: 525, y: 390, w: 150, h: 14 },
          { x: 716, y: 305, w: 14, h: 150 },
          { x: 300, y: 500, w: 145, h: 14 },
          { x: 565, y: 535, w: 145, h: 14 },
        ],
        [
          { x: 330, y: 180, w: 125, h: 14 },
          { x: 545, y: 180, w: 125, h: 14 },
          { x: 493, y: 120, w: 14, h: 115 },
          { x: 493, y: 300, w: 14, h: 95 },
          { x: 310, y: 430, w: 155, h: 14 },
          { x: 535, y: 430, w: 155, h: 14 },
          { x: 395, y: 490, w: 14, h: 100 },
          { x: 591, y: 490, w: 14, h: 100 },
        ],
        [
          { x: 260, y: 220, w: 115, h: 14 },
          { x: 625, y: 220, w: 115, h: 14 },
          { x: 365, y: 220, w: 14, h: 105 },
          { x: 621, y: 220, w: 14, h: 105 },
          { x: 420, y: 285, w: 160, h: 14 },
          { x: 340, y: 390, w: 14, h: 115 },
          { x: 646, y: 390, w: 14, h: 115 },
          { x: 350, y: 500, w: 120, h: 14 },
          { x: 530, y: 500, w: 120, h: 14 },
        ],
        [
          { x: 295, y: 145, w: 145, h: 14 },
          { x: 560, y: 145, w: 145, h: 14 },
          { x: 350, y: 205, w: 14, h: 120 },
          { x: 636, y: 205, w: 14, h: 120 },
          { x: 435, y: 245, w: 130, h: 14 },
          { x: 270, y: 410, w: 150, h: 14 },
          { x: 580, y: 410, w: 150, h: 14 },
          { x: 475, y: 410, w: 14, h: 145 },
          { x: 511, y: 410, w: 14, h: 145 },
        ],
        [
          { x: 245, y: 160, w: 14, h: 115 },
          { x: 741, y: 160, w: 14, h: 115 },
          { x: 315, y: 210, w: 130, h: 14 },
          { x: 555, y: 210, w: 130, h: 14 },
          { x: 430, y: 285, w: 14, h: 105 },
          { x: 556, y: 285, w: 14, h: 105 },
          { x: 360, y: 430, w: 110, h: 14 },
          { x: 530, y: 430, w: 110, h: 14 },
          { x: 285, y: 520, w: 14, h: 90 },
          { x: 701, y: 520, w: 14, h: 90 },
        ],
      ];

      let activeMazeIndex = 0;
      let pendingMazeIndex = 1;
      let mazePhase = 'ACTIVE';
      let mazeTimer = 44;
      let mazeGhostWalls = [];
      let mazeRevision = 1;

      const MAZE_BASE_CLEARANCE = CONFIG.WALL_SIZE + 18;
      const MAZE_WALL_CLEARANCE = 4;

      function rectanglesOverlap(a, b, clearance = 0) {
        return a.x < b.x + b.w + clearance &&
          a.x + a.w + clearance > b.x &&
          a.y < b.y + b.h + clearance &&
          a.y + a.h + clearance > b.y;
      }

      function mazeSafeZones() {
        return Object.values(BASES).map(base => ({
          x: base.x - MAZE_BASE_CLEARANCE,
          y: base.y - MAZE_BASE_CLEARANCE,
          w: base.w + MAZE_BASE_CLEARANCE * 2,
          h: base.h + MAZE_BASE_CLEARANCE * 2,
        }));
      }

      function mazeWallIsSafe(candidate, acceptedWalls = []) {
        if (mazeSafeZones().some(zone =>
          rectanglesOverlap(candidate, zone, 0)
        )) {
          return false;
        }

        // Reserve every fortress blueprint, not only currently constructed walls.
        // This prevents a future Builder wall from appearing inside a maze wall.
        if (blueprints.some(blueprint =>
          rectanglesOverlap(candidate, blueprint, MAZE_WALL_CLEARANCE)
        )) {
          return false;
        }

        if (walls.some(wall =>
          !wall.field &&
          rectanglesOverlap(candidate, wall, MAZE_WALL_CLEARANCE)
        )) {
          return false;
        }

        if (acceptedWalls.some(wall =>
          rectanglesOverlap(candidate, wall, 0)
        )) {
          return false;
        }

        return true;
      }

      function instantiateMaze(index, ghost = false) {
        const acceptedWalls = [];

        for (const rawWall of MAZE_CONFIGS[index]) {
          const candidate = {
            ...rawWall,
            team: 'neutral',
            field: true,
            ghost,
            indestructible: true,
          };

          if (mazeWallIsSafe(candidate, acceptedWalls)) {
            acceptedWalls.push(candidate);
          }
        }

        return acceptedWalls;
      }

      function nearestOpenPoint(origin, radius) {
        const directProbe = { x: origin.x, y: origin.y, r: radius };
        if (!walls.some(wall => hitRect(directProbe, wall))) {
          return { x: origin.x, y: origin.y };
        }

        for (let ring = 1; ring <= 14; ring++) {
          const distance = ring * 18;
          const samples = 12 + ring * 2;

          for (let sample = 0; sample < samples; sample++) {
            const angle = (sample / samples) * Math.PI * 2;
            const point = {
              x: clamp(
                origin.x + Math.cos(angle) * distance,
                radius + 4,
                CONFIG.W - radius - 4
              ),
              y: clamp(
                origin.y + Math.sin(angle) * distance,
                radius + 88,
                CONFIG.H - radius - 6
              ),
            };

            const probe = { x: point.x, y: point.y, r: radius + 2 };
            if (walls.some(wall => hitRect(probe, wall))) continue;
            return point;
          }
        }

        return { x: CONFIG.W / 2, y: CONFIG.H / 2 };
      }

      function countMazeWallConflicts() {
        const fieldWalls = walls.filter(wall => wall.field);
        const fixedWalls = walls.filter(wall => !wall.field);
        let conflicts = 0;

        for (let index = 0; index < fieldWalls.length; index++) {
          const wall = fieldWalls[index];

          if (fixedWalls.some(fixed =>
            rectanglesOverlap(wall, fixed, 0)
          )) {
            conflicts += 1;
          }

          for (let otherIndex = index + 1;
            otherIndex < fieldWalls.length;
            otherIndex++) {
            if (rectanglesOverlap(wall, fieldWalls[otherIndex], 0)) {
              conflicts += 1;
            }
          }
        }

        return conflicts;
      }

      function removeFieldMazeWalls() {
        for (let index = walls.length - 1; index >= 0; index--) {
          if (walls[index].field) walls.splice(index, 1);
        }
        mazeRevision += 1;
      }

      function clearBotNavigationPaths() {
        if (!ACTORS) return;
        for (const actor of ACTORS) {
          actor.navPath = [];
          actor.navPathIndex = 0;
          actor.navRevision = -1;
          actor.navRepathAt = 0;
          actor.targetCommit = 0;
          actor.thinkTimer = 0;
          actor.noProgressTime = 0;
        }
      }

      function relocateObjectsAfterMazeShift() {
        if (ACTORS) {
          for (const actor of ACTORS) {
            if (actor.alive === false) continue;

            const overlapsAnyWall = walls.some(wall =>
              hitRect(actor, wall)
            );

            if (!overlapsAnyWall) continue;

            const location = nearestOpenPoint(actor, actor.r);
            actor.x = location.x;
            actor.y = location.y;
            actor.prevX = location.x;
            actor.prevY = location.y;
            actor.vx = 0;
            actor.vy = 0;
          }
        }

        for (const item of items) {
          const probe = {
            x: item.x,
            y: item.y,
            r: item.r + 2,
          };

          if (!walls.some(wall => hitRect(probe, wall))) continue;

          const location = nearestOpenPoint(item, item.r + 2);
          item.x = location.x;
          item.y = location.y;
        }
      }

      function applyMazeConfiguration(index) {
        removeFieldMazeWalls();
        activeMazeIndex = index;
        walls.push(...instantiateMaze(index));
        mazeRevision += 1;
        relocateObjectsAfterMazeShift();
        clearBotNavigationPaths();
      }

      function chooseDifferentMazeIndex() {
        const choices = MAZE_CONFIGS.map((_, index) => index)
          .filter(index => index !== activeMazeIndex);
        return choices[Math.floor(Math.random() * choices.length)];
      }

      // Begin with one layout. Later shifts are handled by the final tick wrapper.
      walls.push(...instantiateMaze(activeMazeIndex));

      let targetLetterPool = [];
      const alphabetLetterPool = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'];
      let targetLetterSet = new Set();

      function refreshLetterPools() {
        targetLetterPool = [...(CONFIG.BLUE_WORD + CONFIG.RED_WORD)];
        targetLetterSet = new Set(targetLetterPool);
      }

      refreshLetterPools();

      function getTeamWord(team) {
        return team === 'blue' ? CONFIG.BLUE_WORD : CONFIG.RED_WORD;
      }

      function getProgress(team) {
        return state[team];
      }

      function otherTeam(team) {
        return team === 'blue' ? 'red' : 'blue';
      }

      function isTeamJammed(team) {
        return state.jammedUntil[team] > simTime;
      }

      function activateJammer(actor) {
        if (!actor.inv || actor.inv.type !== 'jammer') return false;

        const enemyTeam = otherTeam(actor.team);
        if (!insideRect(actor, BASES[enemyTeam])) {
          if (actor.isPlayer) msg('Take the jammer inside the enemy base before activating it.');
          return false;
        }

        state.jammedUntil[enemyTeam] = Math.max(
          state.jammedUntil[enemyTeam],
          simTime + CONFIG.JAMMER_DURATION
        );
        actor.inv = null;

        if (actor.isPlayer) {
          msg(`Enemy bomb squad jammed for ${CONFIG.JAMMER_DURATION.toFixed(1)} seconds.`);
        } else {
          msg(`${enemyTeam.toUpperCase()} defenders have been jammed!`);
        }
        return true;
      }

      function chooseLetterScatterPosition() {
        const radius = CONFIG.ITEM_RADIUS_LETTER;

        for (let attempt = 0; attempt < 70; attempt++) {
          const x = 125 + Math.random() * 750;
          const y = 100 + Math.random() * 520;
          if (isSpawnPositionClear(x, y, radius)) return { x, y };
        }

        for (let attempt = 0; attempt < 35; attempt++) {
          const x = 105 + Math.random() * 790;
          const y = 95 + Math.random() * 535;
          if (isSpawnPositionClear(x, y, radius, { ignoreItems: true })) return { x, y };
        }

        return {
          x: 500 + (Math.random() * 180 - 90),
          y: 295 + (Math.random() * 120 - 60)
        };
      }

      function filledSlotCount(team) {
        return getProgress(team).reduce((count, char) => count + (char ? 1 : 0), 0);
      }

      function correctSlotCount(team) {
        const word = getTeamWord(team);
        return getProgress(team).reduce(
          (count, char, index) => count + (char === word[index] ? 1 : 0), 0
        );
      }

      function isWordComplete(team) {
        return getProgress(team).map(char => char || '').join('') === getTeamWord(team);
      }

      function getMissingLetters(team) {
        const remaining = [...getTeamWord(team)];
        for (const placed of getProgress(team)) {
          if (!placed) continue;
          const index = remaining.indexOf(placed);
          if (index >= 0) remaining.splice(index, 1);
        }
        return remaining;
      }

      function getNeededLetters() {
        return [...getMissingLetters('blue'), ...getMissingLetters('red')];
      }

      function countCharacters(chars) {
        const counts = new Map();
        for (const char of chars) {
          counts.set(char, (counts.get(char) || 0) + 1);
        }
        return counts;
      }

      function combinedMissingDemand() {
        return countCharacters(getNeededLetters());
      }

      function randomAlphabetLetter() {
        return alphabetLetterPool[
          Math.floor(Math.random() * alphabetLetterPool.length)
        ];
      }

      function randomTargetLetter() {
        return targetLetterPool[
          Math.floor(Math.random() * targetLetterPool.length)
        ];
      }

      function chooseBackgroundLetter() {
        // Decoys keep the field from looking like a direct answer sheet.
        // Target letters remain common enough for the match to keep moving.
        return Math.random() < 0.48
          ? randomAlphabetLetter()
          : randomTargetLetter();
      }

      function removeSafestLooseLetter() {
        const looseLetters = items.filter(item => item.type === 'letter');
        if (!looseLetters.length) return false;

        const demand = combinedMissingDemand();
        const looseCounts = countCharacters(
          looseLetters.map(item => item.char)
        );

        const removable = looseLetters
          .map(item => {
            const neededCount = demand.get(item.char) || 0;
            const availableCount = looseCounts.get(item.char) || 0;
            const isDecoy = !targetLetterSet.has(item.char);
            const excess = availableCount > neededCount;

            return {
              item,
              score:
                (isDecoy ? 100 : 0) +
                (excess ? 40 : 0) +
                (item.flowCritical ? -80 : 0) +
                Math.min(20, (simTime - (item.bornAt || 0)) * 0.05),
            };
          })
          .filter(entry => {
            const neededCount = demand.get(entry.item.char) || 0;
            const availableCount = looseCounts.get(entry.item.char) || 0;
            return !entry.item.flowCritical ||
              availableCount > Math.max(1, neededCount);
          })
          .sort((a, b) => b.score - a.score);

        if (!removable.length) return false;
        removeItem(removable[0].item);
        return true;
      }

      function nearestSlot(actor, team, predicate = () => true) {
        const word = getTeamWord(team);
        let best = null;
        let bestDistance = Infinity;
        for (let index = 0; index < word.length; index++) {
          if (!predicate(index)) continue;
          const coords = getSlotCoords(team, index);
          const d = dist(actor, coords);
          if (d < bestDistance) {
            bestDistance = d;
            best = { ...coords, index };
          }
        }
        return best;
      }

      function nearestDesiredSlot(actor, team, char) {
        const word = getTeamWord(team);
        const progress = getProgress(team);
        return nearestSlot(actor, team, index =>
          word[index] === char && progress[index] !== char
        );
      }

      function nearestMisplacedSlot(actor, team) {
        const word = getTeamWord(team);
        const progress = getProgress(team);
        return nearestSlot(actor, team, index =>
          Boolean(progress[index]) && progress[index] !== word[index]
        );
      }

      function slotFromHorizontalPosition(actor, team) {
        const word = getTeamWord(team);
        const layout = getSlotLayout(team);
        if (!insideRect(actor, BASES[team])) return null;
        if (Math.abs(actor.y - layout.y) > CONFIG.SLOT_VERTICAL_RANGE) return null;

        const raw = Math.round((actor.x - layout.startX) / (layout.size + layout.gap));
        const index = clamp(raw, 0, word.length - 1);
        return { ...getSlotCoords(team, index), index };
      }

      function nearestBuildSlot(actor, team, includeDoor = true) {
        let best = null;
        let bestDistance = Infinity;
        for (const bp of blueprints) {
          if (bp.team !== team) continue;
          if (!includeDoor && bp.doorCandidate) continue;
          if (walls.some(w => w.team === bp.team && w.x === bp.x && w.y === bp.y)) continue;
          const candidate = { x: bp.x + bp.w / 2, y: bp.y + bp.h / 2 };
          const d = dist(actor, candidate);
          if (d < bestDistance) {
            bestDistance = d;
            best = { ...bp, centerX: candidate.x, centerY: candidate.y, distance: d };
          }
        }
        return best;
      }

      function nearOwnFortress(actor, padding = CONFIG.BUILD_HOLD_ZONE) {
        const base = BASES[actor.team];
        return actor.x > base.x - padding && actor.x < base.x + base.w + padding &&
          actor.y > base.y - padding && actor.y < base.y + base.h + padding;
      }

      function getOpenBoundaryGaps(team) {
        return blueprints
          .filter(bp => bp.team === team)
          .filter(bp => !walls.some(w =>
            w.team === bp.team && w.x === bp.x && w.y === bp.y
          ))
          .map(bp => ({
            ...bp,
            x: bp.x + bp.w / 2,
            y: bp.y + bp.h / 2
          }));
      }

      function nearestOpenBoundaryGap(team, actor) {
        const gaps = getOpenBoundaryGaps(team);
        if (!gaps.length) return null;
        return gaps.sort((a, b) => dist(actor, a) - dist(actor, b))[0];
      }

      function enemyLetterSlot(actor, enemyTeam) {
        const progress = getProgress(enemyTeam);
        return nearestSlot(actor, enemyTeam, index => Boolean(progress[index]));
      }

      function takeEnemySlottedLetter(actor, requestedIndex = null) {
        if (actor.role !== 'RAIDER' || actor.inv) return false;

        const enemyTeam = otherTeam(actor.team);
        const progress = getProgress(enemyTeam);
        let slot = null;

        if (Number.isInteger(requestedIndex) && progress[requestedIndex]) {
          slot = { ...getSlotCoords(enemyTeam, requestedIndex), index: requestedIndex };
        } else {
          const selected = slotFromHorizontalPosition(actor, enemyTeam);
          if (selected && progress[selected.index]) slot = selected;
        }

        if (!slot || dist(actor, slot) > CONFIG.DEPOSIT_RANGE) return false;

        const char = progress[slot.index];
        progress[slot.index] = null;
        actor.inv = {
          type: 'letter',
          char,
          golden: char === '*',
          stolen: true,
          stolenFrom: enemyTeam,
          ignited: false,
          timer: 0
        };
        actor.raidSlotIndex = null;
        state.wordLocks[enemyTeam] = 0;
        addSlotEffect(enemyTeam, slot.index, '#ff9f43');

        if (typeof beginTeamRaid === 'function') beginTeamRaid(actor);

        msg(
          `${actor.team.toUpperCase()} RUNNER STOLE ` +
          `${char === '*' ? 'THE GOLDEN LETTER' : `LETTER ${char}`} ` +
          `FROM ${enemyTeam.toUpperCase()}!`
        );
        return true;
      }

      function dropStolenLetter(actor) {
        if (!actor.inv?.stolen) return false;
        if (!insideRect(actor, BASES[actor.team])) {
          if (actor.isPlayer) msg('Return to your own base before releasing the stolen letter.');
          return false;
        }

        const stolen = actor.inv;
        if (stolen.char === '*') {
          createItemAt('golden', actor.x, actor.y - 28, {
            droppedBy: actor,
            dropTime: simTime
          });
        } else {
          createItemAt('letter', actor.x, actor.y - 28, {
            char: stolen.char,
            droppedBy: actor,
            dropTime: simTime,
            revealTime: simTime
          });
        }

        actor.inv = null;
        actor.target = null;
        actor.targetCommit = 0;
        actor.raidTargetTeam = null;

        if (typeof finishTeamRaid === 'function') {
          finishTeamRaid(actor, 8.5);
        }

        msg(`${actor.team.toUpperCase()} RAID COMPLETE — the next raid must wait.`);
        return true;
      }

      function pointOutsideWall(wall, base) {
        const wallX = wall.x + wall.w / 2;
        const wallY = wall.y + wall.h / 2;
        let dx = wallX - (base.x + base.w / 2);
        let dy = wallY - (base.y + base.h / 2);
        const length = Math.hypot(dx, dy) || 1;
        dx /= length;
        dy /= length;
        return {
          x: clamp(wallX + dx * 34, 30, CONFIG.W - 30),
          y: clamp(wallY + dy * 34, 95, CONFIG.H - 30)
        };
      }

      function chooseBomberPlantPoint(actor, enemyTeam) {
        const base = BASES[enemyTeam];
        const gaps = getOpenBoundaryGaps(enemyTeam);
        const occupied = getProgress(enemyTeam)
          .map((char, index) => char ? index : null)
          .filter(index => index != null);

        if (gaps.length && Math.random() < 0.62) {
          const index = occupied.length
            ? occupied[Math.floor(Math.random() * occupied.length)]
            : Math.floor(Math.random() * getTeamWord(enemyTeam).length);
          const slot = getSlotCoords(enemyTeam, index);
          return {
            x: slot.x,
            y: slot.y - 46,
            mode: 'SLOT_ATTACK'
          };
        }

        const enemyWalls = walls.filter(wall => wall.team === enemyTeam);
        if (enemyWalls.length) {
          enemyWalls.sort((a, b) => {
            const ap = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
            const bp = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
            return dist(actor, ap) - dist(actor, bp);
          });
          return {
            ...pointOutsideWall(enemyWalls[0], base),
            mode: 'WALL_ATTACK'
          };
        }

        return {
          x: base.x + base.w / 2,
          y: base.y + base.h / 2 - 45,
          mode: 'SLOT_ATTACK'
        };
      }

      function treeCoveringActor(actor) {
        return trees.find(tree =>
          Math.hypot(actor.x - tree.x, actor.y - tree.y) <
          tree.r * 0.72 + actor.r * 0.35
        ) || null;
      }

      function updateActorTreeCover() {
        if (!ACTORS) return;
        for (const actor of ACTORS) {
          const tree = treeCoveringActor(actor);
          actor.coverTreeId = tree ? tree.id : null;
        }
      }

      function actorVisibleToPlayer(actor) {
        if (!player || actor === player || actor.team === player.team) return true;
        if (actor.coverTreeId == null) return true;
        return player.coverTreeId === actor.coverTreeId;
      }

      function actorsCanSee(observer, target) {
        if (!observer || !target) return false;
        if (observer.team === target.team) return true;
        if (target.coverTreeId == null) return true;
        return observer.coverTreeId === target.coverTreeId;
      }

      function insideExpandedBase(actor, team, padding = CONFIG.DEFENDER_INTERCEPT_PADDING) {
        const base = BASES[team];
        return actor.x > base.x - padding &&
          actor.x < base.x + base.w + padding &&
          actor.y > base.y - padding &&
          actor.y < base.y + base.h + padding;
      }

      function isRaiderThreatToTeam(raider, team) {
        if (!raider || raider.alive === false ||
          !isRunnerRole(raider) || raider.team === team) return false;

        const carryingTeamLoot =
          raider.inv?.stolen && raider.inv.stolenFrom === team;

        return insideExpandedBase(
          raider,
          team,
          carryingTeamLoot
            ? CONFIG.DEFENDER_INTERCEPT_PADDING + CONFIG.DEFENDER_LOOT_CHASE_BONUS
            : CONFIG.DEFENDER_INTERCEPT_PADDING
        );
      }

      function dropRaiderLootOnIntercept(raider) {
        const loot = raider.inv;
        if (!loot) return '';

        let label = '';

        if (loot.type === 'letter' && loot.stolen) {
          if (loot.char === '*') {
            createItemAt('golden', raider.x, raider.y, {
              droppedBy: raider,
              dropTime: simTime,
            });
            label = 'Golden Letter';
          } else {
            createItemAt('letter', raider.x, raider.y, {
              char: loot.char,
              droppedBy: raider,
              dropTime: simTime,
              revealTime: simTime,
            });
            label = `letter ${loot.char}`;
          }
        } else if (loot.type === 'intel') {
          createItemAt('intel', raider.x, raider.y, {
            expiresAt: simTime + Math.max(6, CONFIG.INTEL_LIFETIME * 0.55),
            droppedBy: raider,
            dropTime: simTime,
          });
          label = 'Intel Card';
        } else {
          return '';
        }

        raider.inv = null;
        raider.raidSlotIndex = null;
        raider.raidTargetTeam = null;
        return label;
      }

      function performDefenderIntercept(defender, raider) {
        if (!defender || !raider) return false;
        if (!isGuardianRole(defender) ||
          typeof isOuterWarden !== 'function' ||
          !isOuterWarden(defender) ||
          !(isRunnerRole(raider) || isSaboteurRole(raider))) return false;
        if (defender.team === raider.team) return false;
        if (defender.interceptCooldown > 0 || raider.interceptCooldown > 0) return false;
        if (typeof isOuterWardenThreat !== 'function' ||
          !isOuterWardenThreat(raider, defender.team)) return false;
        if (!actorsCanSee(defender, raider)) return false;

        const contactDistance =
          defender.r + raider.r + CONFIG.DEFENDER_INTERCEPT_CONTACT_PAD;
        if (dist(defender, raider) > contactDistance) return false;

        const base = BASES[defender.team];
        const baseCenter = {
          x: base.x + base.w / 2,
          y: base.y + base.h / 2,
        };

        let dx = raider.x - baseCenter.x;
        let dy = raider.y - baseCenter.y;
        let length = Math.hypot(dx, dy);

        if (length < 0.001) {
          dx = raider.x - defender.x;
          dy = raider.y - defender.y;
          length = Math.hypot(dx, dy) || 1;
        }

        dx /= length;
        dy /= length;

        // Contact is only a physical shove. Stolen loot is dropped when
        // the Raider is downed or eliminated by Defender fire.
        raider.x = clamp(
          raider.x + dx * CONFIG.DEFENDER_INTERCEPT_STEP,
          raider.r,
          CONFIG.W - raider.r
        );
        raider.y = clamp(
          raider.y + dy * CONFIG.DEFENDER_INTERCEPT_STEP,
          raider.r,
          CONFIG.H - raider.r
        );
        raider.prevX = raider.x;
        raider.prevY = raider.y;
        raider.vx = dx * CONFIG.DEFENDER_INTERCEPT_PUSH;
        raider.vy = dy * CONFIG.DEFENDER_INTERCEPT_PUSH;
        raider.stunTimer = Math.max(
          raider.stunTimer,
          CONFIG.DEFENDER_INTERCEPT_STUN
        );
        raider.target = null;
        raider.targetItem = null;
        raider.targetCommit = 0;
        raider.thinkTimer = 0;
        raider.detour = 0;
        raider.stuck = 0;
        raider.interceptFlash = 0.42;

        defender.vx -= dx * 105;
        defender.vy -= dy * 105;
        defender.target = null;
        defender.targetCommit = 0;
        defender.thinkTimer = 0;
        defender.interceptTarget = null;
        defender.interceptFlash = 0.30;

        defender.interceptCooldown = CONFIG.DEFENDER_INTERCEPT_COOLDOWN;
        raider.interceptCooldown = CONFIG.DEFENDER_INTERCEPT_COOLDOWN;

        interceptEffects.push({
          x: raider.x,
          y: raider.y,
          time: 0.38,
          maxTime: 0.38,
        });

        if (defender.isPlayer) {
          msg('Warden contact — intruder shoved away from the perimeter.');
        } else if (raider.isPlayer) {
          msg('The Outer Warden shoved you away!');
        }

        return true;
      }

      function resolveDefenderRaiderContacts() {
        if (!ACTORS) return;

        const defenders = ACTORS.filter(actor =>
          isGuardianRole(actor) &&
          typeof isOuterWarden === 'function' &&
          isOuterWarden(actor)
        );
        const raiders = ACTORS.filter(actor =>
          isRunnerRole(actor) || isSaboteurRole(actor)
        );

        for (const defender of defenders) {
          for (const raider of raiders) {
            if (performDefenderIntercept(defender, raider)) break;
          }
        }
      }

      function addSlotEffect(team, index, color = '#28c943') {
        slotEffects.push({ team, index, color, time: CONFIG.SLOT_EFFECT_TIME });
      }

      function isItemVisible(item) {
        return item.hiddenByTree == null || item.revealed;
      }

      function hiddenTreeForItem(item) {
        return item.hiddenByTree == null ? null : trees.find(tree => tree.id === item.hiddenByTree) || null;
      }

      function revealHiddenLetters() {
        if (!ACTORS) return;
        for (const item of items) {
          if (item.type !== 'letter' || item.hiddenByTree == null || item.revealed) continue;
          const tree = hiddenTreeForItem(item);
          if (!tree) { item.revealed = true; continue; }
          const discoverer = ACTORS.find(actor => dist(actor, tree) < tree.r + actor.r + CONFIG.TREE_REVEAL_PAD);
          if (!discoverer) continue;
          item.revealed = true;
          item.revealTime = simTime;
          if (discoverer.isPlayer) msg(`You found a hidden '${item.char}' under a tree.`);
        }
      }

      function circleTouchesRect(x, y, radius, rect, padding = 0) {
        const testX = Math.max(rect.x - padding, Math.min(x, rect.x + rect.w + padding));
        const testY = Math.max(rect.y - padding, Math.min(y, rect.y + rect.h + padding));
        return (x - testX) ** 2 + (y - testY) ** 2 < radius ** 2;
      }

      function isSpawnPositionClear(x, y, radius, options = {}) {
        const { ignoreTrees = false, ignoreItems = false } = options;
        if (x < radius + 18 || x > CONFIG.W - radius - 18 ||
          y < radius + 85 || y > CONFIG.H - radius - 18) return false;

        for (const base of Object.values(BASES)) {
          if (circleTouchesRect(x, y, radius, base, CONFIG.SPAWN_BASE_GAP)) return false;
        }
        if (walls.some(w => circleTouchesRect(x, y, radius, w, 7))) return false;

        if (!ignoreTrees) {
          for (const tree of trees) {
            if (Math.hypot(x - tree.x, y - tree.y) < radius + tree.r + CONFIG.SPAWN_TREE_GAP) return false;
          }
        }

        if (!ignoreItems) {
          for (const item of items) {
            if (Math.hypot(x - item.x, y - item.y) < radius + item.r + CONFIG.SPAWN_ITEM_GAP) return false;
          }
        }
        return true;
      }

      function nearestItemDistance(x, y) {
        if (!items.length) return Infinity;
        let best = Infinity;
        for (const item of items) best = Math.min(best, Math.hypot(x - item.x, y - item.y));
        return best;
      }

      function chooseSupplyPad(type, radius) {
        const pads = SUPPLY_PADS[type];
        if (!pads?.length) return null;

        const start = supplyPadCursor[type] % pads.length;
        let fallback = null;
        let fallbackScore = -Infinity;

        for (let offset = 0; offset < pads.length; offset++) {
          const index = (start + offset) % pads.length;
          const pad = pads[index];
          for (let attempt = 0; attempt < 4; attempt++) {
            const angle = Math.random() * Math.PI * 2;
            const amount = Math.random() * CONFIG.SUPPLY_PAD_JITTER;
            const x = pad.x + Math.cos(angle) * amount;
            const y = pad.y + Math.sin(angle) * amount;
            const score = nearestItemDistance(x, y);

            if (score > fallbackScore) {
              fallbackScore = score;
              fallback = { x, y, padIndex: index };
            }
            if (isSpawnPositionClear(x, y, radius)) {
              supplyPadCursor[type] = index + 1;
              return { x, y };
            }
          }
        }

        // If every pad is busy, prefer the least crowded valid pad rather than
        // stacking the new power-up directly on another object.
        if (fallback && isSpawnPositionClear(fallback.x, fallback.y, radius, { ignoreItems: true })) {
          supplyPadCursor[type] = fallback.padIndex + 1;
          return { x: fallback.x, y: fallback.y };
        }
        return null;
      }

      function chooseOpenSpawn(type, radius) {
        const strategic = chooseSupplyPad(type, radius);
        if (strategic) return strategic;

        for (let attempt = 0; attempt < 45; attempt++) {
          const x = CONFIG.SPAWN_X_MIN + Math.random() * CONFIG.SPAWN_X_RANGE;
          const y = CONFIG.SPAWN_Y_MIN + Math.random() * CONFIG.SPAWN_Y_RANGE;
          if (isSpawnPositionClear(x, y, radius)) return { x, y };
        }

        // Last-resort centre position, still kept away from walls and trees when possible.
        return { x: 500 + (Math.random() * 80 - 40), y: 330 + (Math.random() * 80 - 40) };
      }

      function buildApproachPoint(actor, blueprint) {
        const margin = actor.r + 8;
        const cx = blueprint.x + blueprint.w / 2;
        const cy = blueprint.y + blueprint.h / 2;
        const candidates = [];

        // The first candidate is on the inside of the fortress, so bot builders
        // do not wall themselves outside. Other sides are safe fallbacks.
        if (blueprint.edge === 'top') candidates.push({ x: cx, y: blueprint.y + blueprint.h + margin });
        if (blueprint.edge === 'bottom') candidates.push({ x: cx, y: blueprint.y - margin });
        if (blueprint.edge === 'left') candidates.push({ x: blueprint.x + blueprint.w + margin, y: cy });
        if (blueprint.edge === 'right') candidates.push({ x: blueprint.x - margin, y: cy });

        candidates.push(
          { x: cx, y: blueprint.y - margin },
          { x: cx, y: blueprint.y + blueprint.h + margin },
          { x: blueprint.x - margin, y: cy },
          { x: blueprint.x + blueprint.w + margin, y: cy }
        );

        const unique = [];
        for (const point of candidates) {
          point.x = clamp(point.x, actor.r + 2, CONFIG.W - actor.r - 2);
          point.y = clamp(point.y, actor.r + 2, CONFIG.H - actor.r - 2);
          if (unique.some(p => Math.hypot(p.x - point.x, p.y - point.y) < 2)) continue;
          if (walls.some(w => hitRect({ x: point.x, y: point.y, r: actor.r + 2 }, w))) continue;
          unique.push(point);
        }

        unique.sort((a, b) => dist(actor, a) - dist(actor, b));
        return unique[0] || { x: cx, y: cy };
      }

      function pushActorOutsideWall(actor, wall) {
        if (!hitRect(actor, wall)) return false;

        const left = Math.abs(actor.x - wall.x);
        const right = Math.abs(wall.x + wall.w - actor.x);
        const top = Math.abs(actor.y - wall.y);
        const bottom = Math.abs(wall.y + wall.h - actor.y);
        const inside = actor.x >= wall.x && actor.x <= wall.x + wall.w &&
          actor.y >= wall.y && actor.y <= wall.y + wall.h;

        if (inside) {
          const minimum = Math.min(left, right, top, bottom);
          if (minimum === left) actor.x = wall.x - actor.r - 2;
          else if (minimum === right) actor.x = wall.x + wall.w + actor.r + 2;
          else if (minimum === top) actor.y = wall.y - actor.r - 2;
          else actor.y = wall.y + wall.h + actor.r + 2;
        } else {
          const nearestX = Math.max(wall.x, Math.min(actor.x, wall.x + wall.w));
          const nearestY = Math.max(wall.y, Math.min(actor.y, wall.y + wall.h));
          let dx = actor.x - nearestX;
          let dy = actor.y - nearestY;
          let length = Math.hypot(dx, dy);
          if (length < 0.001) { dx = 1; dy = 0; length = 1; }
          const overlap = actor.r - length + 2;
          actor.x += (dx / length) * overlap;
          actor.y += (dy / length) * overlap;
        }

        actor.x = clamp(actor.x, actor.r, CONFIG.W - actor.r);
        actor.y = clamp(actor.y, actor.r, CONFIG.H - actor.r);
        actor.vx = 0;
        actor.vy = 0;
        actor.prevX = actor.x;
        actor.prevY = actor.y;
        return true;
      }

      function resolveActorsAfterWallPlacement(newWall) {
        if (!ACTORS) return;
        for (const actor of ACTORS) {
          for (let pass = 0; pass < 4 && hitRect(actor, newWall); pass++) {
            pushActorOutsideWall(actor, newWall);
          }
        }
      }

      function chooseOpenSpawnInTerritory(team, type, radius) {
        const divider = CONFIG.W / 2;
        const edgePadding = 38;
        const minX = team === 'blue'
          ? Math.max(CONFIG.SPAWN_X_MIN, 95)
          : divider + edgePadding;
        const maxX = team === 'blue'
          ? divider - edgePadding
          : Math.min(CONFIG.SPAWN_X_MIN + CONFIG.SPAWN_X_RANGE, CONFIG.W - 95);
        const minY = Math.max(CONFIG.SPAWN_Y_MIN, 100);
        const maxY = Math.min(
          CONFIG.SPAWN_Y_MIN + CONFIG.SPAWN_Y_RANGE,
          CONFIG.H - 55
        );

        for (let attempt = 0; attempt < 90; attempt++) {
          const x = minX + Math.random() * Math.max(1, maxX - minX);
          const y = minY + Math.random() * Math.max(1, maxY - minY);
          if (isSpawnPositionClear(x, y, radius)) return { x, y };
        }

        // Keep the fallback on the requested side even on a crowded field.
        return {
          x: team === 'blue' ? divider - 80 : divider + 80,
          y: 145 + Math.random() * (CONFIG.H - 250),
        };
      }

      function spawn(type, forceNeeded = false, options = {}) {
        if (!type) {
          const r = Math.random();
          type = r < 0.60 ? 'letter'
            : r < 0.79 ? 'wall'
              : r < 0.93 ? 'bomb'
                : r < 0.985 ? 'speed' : 'jammer';
        }

        const itemRadius = type === 'letter' ? CONFIG.ITEM_RADIUS_LETTER : CONFIG.ITEM_RADIUS_OTHER;
        let x = 500;
        let y = 330;
        let hiddenByTree = null;
        let revealed = true;

        if (type === 'letter' &&
          !options.forceVisible &&
          trees.length &&
          Math.random() < CONFIG.TREE_HIDE_CHANCE) {
          const treeChoices = [...trees].sort(() => Math.random() - 0.5);
          const tree = treeChoices.find(candidate =>
            !items.some(item => item.hiddenByTree === candidate.id && !item.revealed)
          ) || treeChoices[0];
          const angle = Math.random() * Math.PI * 2;
          const radius = Math.random() * Math.max(8, tree.r * 0.34);
          x = tree.x + Math.cos(angle) * radius;
          y = tree.y + Math.sin(angle) * radius;
          hiddenByTree = tree.id;
          revealed = false;
        } else {
          const location = options.territory
            ? chooseOpenSpawnInTerritory(options.territory, type, itemRadius)
            : chooseOpenSpawn(type, itemRadius);
          x = location.x;
          y = location.y;
        }

        const it = {
          type, x, y,
          r: itemRadius,
          ignited: false, timer: 0, droppedBy: null, dropTime: 0,
          hiddenByTree, revealed, revealTime: 0
        };

        if (type === 'letter') {
          const needed = getNeededLetters();

          if (options.char) {
            it.char = options.char;
          } else if ((forceNeeded || Math.random() < 0.58) && needed.length > 0) {
            it.char = needed[Math.floor(Math.random() * needed.length)];
          } else {
            it.char = chooseBackgroundLetter();
          }

          it.flowCritical = Boolean(options.flowCritical);
          it.flowTeam = options.flowTeam || null;
          it.crossTerritoryFor = options.crossTerritoryFor || null;
          it.bornAt = simTime;
        }
        items.push(it);
      }

      function crossTerritoryCharacters(word, opposingWord, count = 3) {
        const unique = [...new Set(word)];
        const preferred = unique.filter(char => !opposingWord.includes(char));
        const ordered = [...preferred, ...unique.filter(char => !preferred.includes(char))];
        if (ordered.length <= count) return ordered;

        const picked = [];
        for (let index = 0; index < count; index++) {
          const position = Math.round(
            index * (ordered.length - 1) / Math.max(1, count - 1)
          );
          if (!picked.includes(ordered[position])) picked.push(ordered[position]);
        }
        for (const char of ordered) {
          if (picked.length >= count) break;
          if (!picked.includes(char)) picked.push(char);
        }
        return picked;
      }

      function seedRoundLetters() {
        refreshLetterPools();

        const crossTerritoryLetters = [
          ...crossTerritoryCharacters(CONFIG.BLUE_WORD, CONFIG.RED_WORD)
            .map(char => ({ char, territory: 'red', forTeam: 'blue' })),
          ...crossTerritoryCharacters(CONFIG.RED_WORD, CONFIG.BLUE_WORD)
            .map(char => ({ char, territory: 'blue', forTeam: 'red' })),
        ];

        for (const entry of crossTerritoryLetters) {
          spawn('letter', false, {
            char: entry.char,
            forceVisible: true,
            territory: entry.territory,
            crossTerritoryFor: entry.forTeam,
          });
        }

        const reservedLetters = new Set(
          crossTerritoryLetters.map(entry => entry.char)
        );
        const openingLetters = [...new Set(targetLetterPool)]
          .filter(char => !reservedLetters.has(char));

        while (
          openingLetters.length + crossTerritoryLetters.length <
          CONFIG.LETTER_FIELD_TARGET
        ) {
          openingLetters.push(randomAlphabetLetter());
        }

        for (const char of openingLetters) {
          spawn('letter', false, { char, forceVisible: true });
        }
        for (let index = 0; index < 3; index++) spawn('wall');
        spawn('bomb');
        spawn('bomb');
        spawn('speed');
      }

      seedRoundLetters();

      if (slider && speedValEl) {
        slider.value = String(botSpeed);
        speedValEl.textContent = botSpeed.toFixed(2).replace(/0$/, '') + 'x';

        slider.oninput = e => {
          botSpeed = +e.target.value;
          speedValEl.textContent = botSpeed.toFixed(1) + 'x';
        };

        // Keep the tuning control mouse/touch only.
        slider.addEventListener('keydown', e => {
          const blockedKeys = [
            'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
            'Home', 'End', 'PageUp', 'PageDown'
          ];
          if (blockedKeys.includes(e.key)) {
            e.preventDefault();
            e.stopPropagation();
          }
        });

        slider.addEventListener('pointerup', () => slider.blur());
        slider.addEventListener('change', () => slider.blur());
      }
