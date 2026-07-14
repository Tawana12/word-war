'use strict';

      // ================================================================
      // FINAL SHIFTING-MAZE CONTROLLER
      // ACTIVE -> WARNING -> OPEN FIELD -> NEW CONFIGURATION
      // ================================================================
      function updateShiftingMaze(dt) {
        mazeTimer -= dt;
        if (mazeTimer > 0) return;

        if (mazePhase === 'ACTIVE') {
          pendingMazeIndex = chooseDifferentMazeIndex();
          mazeGhostWalls = instantiateMaze(pendingMazeIndex, true);
          mazePhase = 'WARNING';
          mazeTimer = 3.2;
          msg('The field is about to shift.');
          return;
        }

        if (mazePhase === 'WARNING') {
          removeFieldMazeWalls();
          clearBotNavigationPaths();
          navigationGridCache.clear();
          mazePhase = 'OPEN';
          mazeTimer = 2.6;
          msg('Open field. New walls incoming.');
          return;
        }

        applyMazeConfiguration(pendingMazeIndex);
        mazeGhostWalls = [];
        navigationGridCache.clear();
        mazePhase = 'ACTIVE';
        mazeTimer = 44 + Math.random() * 10;
        msg('The new field layout is live.');
      }

      const shiftingMazeTickBase = tick;
      tick = function shiftingMazeTick(dt) {
        shiftingMazeTickBase(dt);
        if (state.over || !player) return;
        updateShiftingMaze(dt);
        refreshNavigationRevision();
      };

      const shiftingMazeWorldEffectsBase = drawWorldEffects;
      drawWorldEffects = function shiftingMazeWorldEffects() {
        shiftingMazeWorldEffectsBase();

        if (mazePhase === 'WARNING') {
          ctx.save();
          for (const wall of mazeGhostWalls) {
            const pulse = 0.15 + (Math.sin(simTime * 8) + 1) * 0.09;
            ctx.fillStyle = `rgba(255,224,120,${pulse})`;
            ctx.strokeStyle = 'rgba(255,244,190,0.75)';
            ctx.setLineDash([7, 5]);
            ctx.fillRect(wall.x, wall.y, wall.w, wall.h);
            ctx.strokeRect(wall.x, wall.y, wall.w, wall.h);
          }
          ctx.setLineDash([]);
          ctx.fillStyle = '#17191fdd';
          ctx.fillRect(405, 78, 190, 28);
          ctx.fillStyle = '#ffe08a';
          ctx.font = '900 12px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(`FIELD SHIFT ${Math.ceil(mazeTimer)}`, 500, 92);
          ctx.restore();
        } else if (mazePhase === 'OPEN') {
          ctx.save();
          ctx.fillStyle = '#17191fdd';
          ctx.fillRect(420, 78, 160, 28);
          ctx.fillStyle = '#bff6cf';
          ctx.font = '900 12px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('FIELD OPEN', 500, 92);
          ctx.restore();
        }
      };
