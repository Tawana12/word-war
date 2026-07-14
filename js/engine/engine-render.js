'use strict';

      function explode(bomb) {
        explosions.push({ x: bomb.x, y: bomb.y, r: 0, a: 1 });

        for (let i = walls.length - 1; i >= 0; i--) {
          const w = walls[i];
          if (Math.hypot(bomb.x - (w.x + 15), bomb.y - (w.y + 15)) < CONFIG.BOMB_WALL_RADIUS) { walls.splice(i, 1); }
        }

        ['blue', 'red'].forEach(team => {
          const progress = getProgress(team);
          const scattered = [];

          for (let i = 0; i < progress.length; i++) {
            if (!progress[i]) continue;
            const coords = getSlotCoords(team, i);
            if (dist(coords, bomb) < CONFIG.BOMB_BLAST_RADIUS) {
              scattered.push({ char: progress[i], index: i, coords });
              progress[i] = null;
            }
          }

          for (const entry of scattered) {
            const landing = chooseLetterScatterPosition();
            items.push({
              type: 'letter',
              char: entry.char,
              x: landing.x,
              y: landing.y,
              r: CONFIG.ITEM_RADIUS_LETTER,
              ignited: false,
              timer: 0,
              droppedBy: null,
              dropTime: 0,
              hiddenByTree: null,
              revealed: true,
              revealTime: simTime,
              scatteredUntil: simTime + 0.65
            });
          }

          if (scattered.length) {
            msg(`${scattered.length} ${team} letter${scattered.length === 1 ? '' : 's'} blasted back into the field!`);
          }
        });

        for (const a of ACTORS) {
          const d = dist(a, bomb);
          if (d >= CONFIG.BOMB_BLAST_RADIUS) continue;
          if (a.inv) armOrDrop(a);
          const falloff = 1 - d / CONFIG.BOMB_BLAST_RADIUS, dx = a.x - bomb.x, dy = a.y - bomb.y, len = Math.hypot(dx, dy) || 1, force = CONFIG.BOMB_KNOCKBACK_SPEED * falloff;
          a.vx = clamp(a.vx + (dx / len) * force, -CONFIG.MAX_KNOCKBACK_SPEED, CONFIG.MAX_KNOCKBACK_SPEED);
          a.vy = clamp(a.vy + (dy / len) * force, -CONFIG.MAX_KNOCKBACK_SPEED, CONFIG.MAX_KNOCKBACK_SPEED);
          a.stunTimer = Math.max(a.stunTimer, CONFIG.BOMB_STUN_TIME);
          if (a.isPlayer) msg('Knocked back by explosion!');
        }
      }

      function hud() {
        // Cargo is represented physically above the actor, so no large HUD cargo panel is needed.
      }

      function end(text) { state.over = true; msg(text); }
      function winner() {
        if (isWordComplete('blue')) {
          end(`TEAM BLUE COMPLETED ${CONFIG.BLUE_WORD}!`);
        } else if (isWordComplete('red')) {
          end(`TEAM RED COMPLETED ${CONFIG.RED_WORD}!`);
        }
      }

      function tick(dt) {
        if (state.over) return;
        simTime += dt;
        if (ACTORS) {
          for (const actor of ACTORS) {
            actor.prevX = actor.x;
            actor.prevY = actor.y;
          }
        }

        state.spawnTimer -= dt;
        if (state.spawnTimer <= 0) {
          const countOf = t => items.filter(i => i.type === t && !i.ignited).length;
          const lettersCount = countOf('letter'), needed = getNeededLetters();

          const boardHasNeeded = needed.some(char => items.some(i => i.type === 'letter' && i.char === char));
          if (!boardHasNeeded && needed.length > 0) {
            if (lettersCount >= CONFIG.MAX_LETTERS) {
              removeSafestLooseLetter();
            }
            spawn('letter', true, { forceVisible: true });
          } else if (lettersCount < CONFIG.MAX_LETTERS) { spawn('letter', false); }

          if (countOf('wall') < CONFIG.MAX_WALLS_ITEM) spawn('wall');
          if (countOf('bomb') < CONFIG.MAX_BOMBS) spawn('bomb');
          if (countOf('speed') < CONFIG.MAX_SPEED_BOOSTS && Math.random() < 0.25) spawn('speed');

          state.spawnTimer = CONFIG.ITEM_SPAWN_INTERVAL;
        }

        let keyboardX = 0;
        let keyboardY = 0;
        if (keys.w || keys.arrowup) keyboardY--;
        if (keys.s || keys.arrowdown) keyboardY++;
        if (keys.a || keys.arrowleft) keyboardX--;
        if (keys.d || keys.arrowright) keyboardX++;

        const keyboardLength = Math.hypot(keyboardX, keyboardY);
        if (keyboardLength) {
          keyboardX /= keyboardLength;
          keyboardY /= keyboardLength;
        }

        // The analog stick keeps its magnitude so small movements produce
        // slow, precise steps. Keyboard input remains full speed.
        const usingAnalog = mobileInput.active;
        let ix = usingAnalog ? mobileInput.x : keyboardX;
        let iy = usingAnalog ? mobileInput.y : keyboardY;
        let rawLength = Math.hypot(ix, iy);

        if (rawLength > 1) {
          ix /= rawLength;
          iy /= rawLength;
          rawLength = 1;
        }

        const inputRate = rawLength
          ? (usingAnalog
              ? CONFIG.MOBILE_INPUT_SMOOTH_RATE
              : CONFIG.PLAYER_INPUT_SMOOTH_RATE)
          : (usingAnalog
              ? CONFIG.MOBILE_RELEASE_SMOOTH_RATE
              : CONFIG.PLAYER_RELEASE_SMOOTH_RATE);
        const inputBlend = 1 - Math.exp(-inputRate * dt);

        player.inputX += (ix - player.inputX) * inputBlend;
        player.inputY += (iy - player.inputY) * inputBlend;

        let smoothLength = Math.hypot(player.inputX, player.inputY);
        if (smoothLength > 1) {
          player.inputX /= smoothLength;
          player.inputY /= smoothLength;
          smoothLength = 1;
        } else if (smoothLength < CONFIG.PLAYER_INPUT_DEADZONE) {
          player.inputX = 0;
          player.inputY = 0;
          smoothLength = 0;
        }

        if (smoothLength > 0.08) {
          const facingBlend = 1 - Math.exp(-10 * dt);
          const faceX = player.inputX / smoothLength;
          const faceY = player.inputY / smoothLength;
          player.facingX += (faceX - player.facingX) * facingBlend;
          player.facingY += (faceY - player.facingY) * facingBlend;
          const facingLength = Math.hypot(player.facingX, player.facingY) || 1;
          player.facingX /= facingLength;
          player.facingY /= facingLength;
        }

        decayTimers(player, dt);
        driveActor(player, player.inputX, player.inputY, dt, false);

        revealHiddenLetters();
        for (const b of bots) updateBot(b, dt);

        for (let i = slotEffects.length - 1; i >= 0; i--) {
          slotEffects[i].time -= dt;
          if (slotEffects[i].time <= 0) slotEffects.splice(i, 1);
        }

        for (const a of ACTORS) {
          if (a.inv && a.inv.type === 'bomb' && a.inv.ignited) {
            a.inv.timer -= dt;
            if (a.inv.timer <= 0) { explode({ x: a.x, y: a.y }); a.inv = null; }
          }
        }

        const toExplode = [];
        for (const it of items) { if (it.type === 'bomb' && it.ignited) { it.timer -= dt; if (it.timer <= 0) toExplode.push(it); } }
        for (const bomb of toExplode) { explode(bomb); removeItem(bomb); }

        for (let i = explosions.length - 1; i >= 0; i--) {
          const e = explosions[i];
          e.r += (e.growRate || CONFIG.EXPLOSION_GROW_RATE) * dt;
          e.a -= CONFIG.EXPLOSION_FADE_RATE * dt;
          if (e.a <= 0 || e.r >= (e.maxR || CONFIG.BOMB_BLAST_RADIUS)) explosions.splice(i, 1);
        }

        hud(); winner();
      }

      function drawPhysicalSlots() {
        ['blue', 'red'].forEach(team => {
          const progress = state[team];
          const selectedPlayerSlot = player && player.team === team
            ? slotFromHorizontalPosition(player, team)
            : null;

          for (let i = 0; i < getTeamWord(team).length; i++) {
            const coords = getSlotCoords(team, i);
            const s = coords.size;
            const x = coords.x - s / 2;
            const y = coords.y - s / 2;
            const fontSize = Math.max(11, Math.floor(s * .58));
            const isFilled = Boolean(progress[i]);
            const isSelected = Boolean(
              selectedPlayerSlot && selectedPlayerSlot.index === i &&
              player && ['OPERATOR', 'COLLECTOR'].includes(player.role) &&
              (player.inv?.type === 'letter' || (!player.inv && isFilled))
            );

            ctx.beginPath();
            ctx.rect(x, y, s, s);
            ctx.fillStyle = isFilled ? '#fff' : '#181a20';
            ctx.fill();

            if (isSelected) {
              const color = player.inv?.type === 'letter' ? '#28c943' : '#53d8fb';
              ctx.strokeStyle = color;
              ctx.lineWidth = 4;
              ctx.shadowColor = color;
              ctx.shadowBlur = 12;
            } else {
              ctx.strokeStyle = team === 'blue' ? '#2176ff66' : '#ff3b3b66';
              ctx.lineWidth = 2;
              ctx.shadowBlur = 0;
            }
            ctx.stroke();
            ctx.shadowBlur = 0;

            if (isFilled) {
              ctx.fillStyle = '#111';
              ctx.font = `bold ${fontSize}px sans-serif`;
              ctx.textAlign = 'center';
              ctx.textBaseline = 'middle';
              ctx.fillText(progress[i], coords.x, coords.y + 1);
            }

            if (isSelected) {
              ctx.fillStyle = '#fff';
              ctx.font = 'bold 9px sans-serif';
              ctx.textAlign = 'center';
              ctx.fillText('SPACE', coords.x, y - 7);
            }
          }
        });

        for (const effect of slotEffects) {
          if (effect.world) continue;
          const coords = getSlotCoords(effect.team, effect.index);
          const progress = 1 - effect.time / CONFIG.SLOT_EFFECT_TIME;
          ctx.beginPath();
          ctx.arc(coords.x, coords.y, coords.size * (0.65 + progress), 0, Math.PI * 2);
          ctx.strokeStyle = effect.color + Math.floor(255 * (1 - progress)).toString(16).padStart(2, '0');
          ctx.lineWidth = 3;
          ctx.stroke();
        }
      }

      function drawBases() {
        for (const [team, base] of Object.entries(BASES)) {
          ctx.fillStyle = base.c + '15';
          ctx.fillRect(base.x, base.y, base.w, base.h);
          ctx.strokeStyle = base.c;
          ctx.lineWidth = 4;
          ctx.strokeRect(base.x, base.y, base.w, base.h);

          if (isTeamJammed(team)) {
            ctx.save();
            ctx.strokeStyle = '#b86bff';
            ctx.lineWidth = 5;
            ctx.setLineDash([9, 6]);
            ctx.strokeRect(base.x + 5, base.y + 5, base.w - 10, base.h - 10);
            ctx.setLineDash([]);
            ctx.fillStyle = '#b86bff';
            ctx.font = 'bold 12px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('BOMB SQUAD JAMMED', base.x + base.w / 2, base.y + 20);
            ctx.restore();
          }
        }
      }

      function drawBlueprints() {
        if (!player || player.role !== 'BUILDER' || player.inv?.type !== 'wall') return;

        const active = nearestBuildSlot(player, player.team, true);
        for (const bp of blueprints) {
          if (bp.team !== player.team) continue;
          if (walls.some(w => w.team === bp.team && w.x === bp.x && w.y === bp.y)) continue;

          const cx = bp.x + bp.w / 2;
          const cy = bp.y + bp.h / 2;
          const distance = Math.hypot(player.x - cx, player.y - cy);
          if (distance > 145 && (!active || active.x !== bp.x || active.y !== bp.y)) continue;

          const isActive = active && active.x === bp.x && active.y === bp.y && active.distance <= CONFIG.REPAIR_RANGE;
          ctx.strokeStyle = isActive ? '#28c943' : (bp.doorCandidate ? '#f4d06f55' : '#8ea8c855');
          ctx.lineWidth = isActive ? 4 : 2;
          if (isActive) {
            ctx.fillStyle = '#28c9432e';
            ctx.fillRect(bp.x + 2, bp.y + 2, bp.w - 4, bp.h - 4);
            ctx.shadowColor = '#28c943';
            ctx.shadowBlur = 10;
          }
          ctx.setLineDash(isActive ? [] : [4, 5]);
          ctx.strokeRect(bp.x + 2, bp.y + 2, bp.w - 4, bp.h - 4);
          ctx.setLineDash([]);
          ctx.shadowBlur = 0;
        }
      }

      function drawWalls() {
        for (const w of walls) {
          if (w.team === 'neutral') {
            ctx.fillStyle = '#6f716d';
            ctx.fillRect(w.x, w.y, w.w, w.h);
            ctx.strokeStyle = '#343631';
            ctx.lineWidth = 2;
            ctx.strokeRect(w.x, w.y, w.w, w.h);

            ctx.strokeStyle = '#92958e66';
            ctx.lineWidth = 1;
            if (w.w > w.h) {
              for (let x = w.x + 22; x < w.x + w.w; x += 28) {
                ctx.beginPath();
                ctx.moveTo(x, w.y + 2);
                ctx.lineTo(x, w.y + w.h - 2);
                ctx.stroke();
              }
            } else {
              for (let y = w.y + 22; y < w.y + w.h; y += 28) {
                ctx.beginPath();
                ctx.moveTo(w.x + 2, y);
                ctx.lineTo(w.x + w.w - 2, y);
                ctx.stroke();
              }
            }
            continue;
          }

          ctx.fillStyle = w.team === 'blue' ? '#124ebd' : '#bd1818';
          ctx.fillRect(w.x, w.y, w.w, w.h);
          ctx.strokeStyle = '#111';
          ctx.lineWidth = 2;
          ctx.strokeRect(w.x, w.y, w.w, w.h);
        }
      }

      function drawSupplyPads() {
        const drawPad = (point, color, icon, square = false) => {
          ctx.save();
          ctx.globalAlpha = 0.24;
          ctx.strokeStyle = color;
          ctx.fillStyle = color + '18';
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 6]);
          if (square) {
            ctx.fillRect(point.x - 21, point.y - 21, 42, 42);
            ctx.strokeRect(point.x - 21, point.y - 21, 42, 42);
          } else {
            ctx.beginPath();
            ctx.arc(point.x, point.y, 23, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
          }
          ctx.setLineDash([]);
          ctx.globalAlpha = 0.48;
          ctx.fillStyle = '#fff';
          ctx.font = '12px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(icon, point.x, point.y);
          ctx.restore();
        };

        for (const point of SUPPLY_PADS.speed) drawPad(point, '#28c943', 'S');
        for (const point of SUPPLY_PADS.bomb) drawPad(point, '#ff4a4a', 'B');
        for (const point of SUPPLY_PADS.wall) drawPad(point, '#8892a3', 'W', true);
      }

      function drawItems() {
        for (const it of items) {
          if (it.type === 'letter') {
            if (!isItemVisible(it)) continue;
            const justRevealed = it.revealTime && simTime - it.revealTime < 0.8;
            if (justRevealed) {
              const p = (simTime - it.revealTime) / 0.8;
              ctx.beginPath();
              ctx.arc(it.x, it.y, 18 + p * 20, 0, Math.PI * 2);
              ctx.strokeStyle = `rgba(255,245,160,${1 - p})`;
              ctx.lineWidth = 4;
              ctx.stroke();
            }
            const scatterPulse = (it.scatteredUntil || 0) > simTime
              ? 1 + 0.16 * Math.sin((it.scatteredUntil - simTime) * 24)
              : 1;
            ctx.save();
            ctx.translate(it.x, it.y);
            ctx.scale(scatterPulse, scatterPulse);
            ctx.translate(-it.x, -it.y);
            ctx.fillStyle = '#f4d06f';
            ctx.fillRect(it.x - 14, it.y - 14, 28, 28);
            ctx.strokeStyle = '#332914';
            ctx.lineWidth = 2;
            ctx.strokeRect(it.x - 14, it.y - 14, 28, 28);
            ctx.fillStyle = '#332914';
            ctx.font = 'bold 17px sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(it.char, it.x, it.y + 1);
            ctx.restore();
            continue;
          }
          ctx.beginPath();
          ctx.arc(it.x, it.y, it.r, 0, Math.PI * 2);
          ctx.fillStyle = it.type === 'wall' ? '#8892a3'
            : it.type === 'speed' ? '#28c943'
              : it.type === 'jammer' ? '#9b5de5'
                : (it.ignited && Math.floor(simTime * 1000 / 110) % 2 === 0)
                  ? '#fff' : '#ff4a4a';
          ctx.fill();
          ctx.strokeStyle = '#111';
          ctx.stroke();
          ctx.fillStyle = '#fff';
          ctx.font = '14px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(
            it.type === 'wall' ? '🧱'
              : it.type === 'speed' ? '⚡'
                : it.type === 'jammer' ? '📡'
                  : it.ignited ? '' : '💣',
            it.x,
            it.y
          );

          if (it.type === 'bomb' && it.ignited &&
            (it.pickupLockedUntil || 0) > simTime) {
            const remaining =
              (it.pickupLockedUntil - simTime) / CONFIG.BOMB_DEFENDER_LOCK;
            ctx.beginPath();
            ctx.arc(it.x, it.y, it.r + 7 + remaining * 4, 0, Math.PI * 2);
            ctx.strokeStyle = '#ffd166cc';
            ctx.lineWidth = 3;
            ctx.stroke();
          }
        }
      }

      function drawTreeTrunks() {
        for (const tree of trees) {
          ctx.fillStyle = '#6e4827';
          ctx.fillRect(tree.x - 6, tree.y + tree.r * 0.18, 12, tree.r * 0.62);
          ctx.fillStyle = '#51351e';
          ctx.fillRect(tree.x - 2, tree.y + tree.r * 0.2, 4, tree.r * 0.58);
        }
      }

      function drawTreeCanopies() {
        for (const tree of trees) {
          const playerInside = player && dist(player, tree) < tree.r + player.r;
          const sway = Math.sin(simTime * 1.1 + tree.sway) * 1.5;
          ctx.save();
          ctx.globalAlpha = playerInside ? 0.42 : 0.92;
          ctx.fillStyle = '#386f39';
          ctx.beginPath();
          ctx.arc(tree.x - tree.r * 0.28 + sway, tree.y, tree.r * 0.67, 0, Math.PI * 2);
          ctx.arc(tree.x + tree.r * 0.27 + sway, tree.y + 2, tree.r * 0.70, 0, Math.PI * 2);
          ctx.arc(tree.x + sway, tree.y - tree.r * 0.25, tree.r * 0.76, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#4f8c45';
          ctx.beginPath();
          ctx.arc(tree.x - tree.r * 0.18 + sway, tree.y - tree.r * 0.22, tree.r * 0.44, 0, Math.PI * 2);
          ctx.arc(tree.x + tree.r * 0.24 + sway, tree.y - tree.r * 0.16, tree.r * 0.38, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }

      function drawWorldEffects() {
        for (const effect of slotEffects) {
          if (!effect.world) continue;
          const progress = 1 - effect.time / CONFIG.SLOT_EFFECT_TIME;
          ctx.beginPath();
          ctx.arc(effect.x, effect.y, 18 + progress * 18, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(40,201,67,${1 - progress})`;
          ctx.lineWidth = 4;
          ctx.stroke();
        }
      }

      function drawExplosions() {
        for (const e of explosions) { ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2); ctx.fillStyle = `rgba(255,100,50,${Math.max(0, e.a)})`; ctx.fill(); }
      }

      function drawActors(alpha = 1) {
        if (!ACTORS) return;
        for (const a of ACTORS) {
          const rx = a.prevX + (a.x - a.prevX) * alpha;
          const ry = a.prevY + (a.y - a.prevY) * alpha;

          ctx.beginPath();
          ctx.arc(rx, ry, a.r, 0, Math.PI * 2);
          ctx.fillStyle = a.team === 'blue' ? (a.isPlayer ? '#2176ff' : '#699cf5') : '#ff3b3b';
          ctx.fill();
          if (a.boost > 0) { ctx.lineWidth = 5; ctx.strokeStyle = '#28c943aa'; ctx.stroke(); }
          ctx.lineWidth = 3;
          ctx.strokeStyle = a.interceptFlash > 0 ? '#ffb347' : '#111';
          ctx.stroke();

          if (a.inv) {
            ctx.fillStyle = a.inv.type === 'letter' ? '#f4d06f'
              : a.inv.type === 'wall' ? '#8892a3'
                : a.inv.type === 'jammer' ? '#9b5de5' : '#ff4a4a';
            ctx.fillRect(rx - 10, ry - 36, 20, 20);
            if (a.inv.ignited && Math.floor(simTime * 1000 / 110) % 2 === 0) ctx.fillStyle = '#fff';
            ctx.strokeStyle = '#111';
            ctx.strokeRect(rx - 10, ry - 36, 20, 20);
            ctx.fillStyle = a.inv.type === 'letter' ? '#111' : '#fff';
            ctx.font = 'bold 13px sans-serif';
            ctx.fillText(
              a.inv.type === 'letter' ? a.inv.char
                : a.inv.type === 'wall' ? 'W'
                  : 'B',
              rx,
              ry - 21
            );
          }
        }
      }

      function drawGameOverOverlay() {
        ctx.fillStyle = '#12151cab'; ctx.fillRect(0, 0, CONFIG.W, CONFIG.H); ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
        ctx.font = 'bold 42px sans-serif'; ctx.fillText('MATCH OVER', CONFIG.W / 2, CONFIG.H / 2 - 10);
        ctx.font = '20px sans-serif'; ctx.fillText(msgEl.textContent, CONFIG.W / 2, CONFIG.H / 2 + 28);
      }

      function draw(alpha = 1) {
        ctx.clearRect(0, 0, CONFIG.W, CONFIG.H); ctx.fillStyle = '#dcb37b'; ctx.fillRect(0, 0, CONFIG.W, CONFIG.H);
        drawBases(); drawPhysicalSlots(); drawBlueprints(); drawWalls(); drawSupplyPads();
        drawTreeTrunks(); drawItems(); drawExplosions(); drawActors(alpha); drawTreeCanopies(); drawWorldEffects();
        if (state.over && player) drawGameOverOverlay();
      }
