'use strict';

const instructionScreenEl = document.querySelector('#instructionScreen');
const instructionRoleEl = document.querySelector('#instructionRole');
const instructionJobEl = document.querySelector('#instructionJob');
const instructionControlsEl = document.querySelector('#instructionControls');
const instructionCanvas = document.querySelector('#tutorialCanvas');
const instructionCtx = instructionCanvas?.getContext('2d');

const INSTRUCTION_COPY = {
  RUNNER: {
    name: 'Runner',
    job: 'Pick a tile, carry it home and place it in the correct slot. Cross the white line for contested letters.',
  },
  SENTRY: {
    name: 'Inner Sentry',
    job: 'Stay inside the grid. Point with movement and hold Fire or Space when an enemy Runner enters your territory.',
  },
  WARDEN: {
    name: 'Outer Warden',
    job: 'Collect bricks, rebuild missing wall sections and stop enemies at the perimeter.',
  },
  SABOTEUR: {
    name: 'Saboteur',
    job: 'Carry a bomb to the enemy wall, plant it and open a route for your Runners.',
  },
};

let instructionSelection = { role: 'RUNNER', duty: null };
let instructionAnimationId = null;
let instructionStartedAt = performance.now();

function instructionKey(role, duty) {
  if (role === 'GUARDIAN') return duty === 'WARDEN' ? 'WARDEN' : 'SENTRY';
  return role;
}

function openInstructionScreen(role, duty = null) {
  instructionSelection = { role, duty };
  const copy = INSTRUCTION_COPY[instructionKey(role, duty)] || INSTRUCTION_COPY.RUNNER;
  if (instructionRoleEl) instructionRoleEl.textContent = copy.name;
  if (instructionJobEl) instructionJobEl.textContent = copy.job;
  if (instructionControlsEl) {
    const key = instructionKey(role, duty);
    if (key === 'SENTRY') {
      instructionControlsEl.textContent = touchUI
        ? 'Point with the joystick · hold FIRE to keep shooting · tap near a bomb to disarm'
        : 'Point with WASD or arrows · hold Space to keep shooting · tap Space near a bomb to disarm';
    } else {
      instructionControlsEl.textContent = touchUI
        ? 'Left thumb moves · the right button names the exact action or tile'
        : 'Move with WASD or arrows · press Space on the highlighted target';
    }
  }

  roleScreen?.classList.add('hidden');
  instructionScreenEl?.classList.remove('hidden');
  instructionStartedAt = performance.now();
  startInstructionAnimation();
}

function closeInstructionScreen() {
  instructionScreenEl?.classList.add('hidden');
  stopInstructionAnimation();
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function ease(value) {
  const v = clamp01(value);
  return v * v * (3 - 2 * v);
}

function cyclePhase(t, offset = 0, duration = 4.8) {
  return (((t + offset) % duration) + duration) % duration / duration;
}

function drawMiniActor(ctx, x, y, body, hat, facing = 1) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, 11, 0, Math.PI * 2);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.strokeStyle = '#12161c';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = hat;
  ctx.beginPath();
  ctx.arc(x, y - 10, 7, Math.PI, Math.PI * 2);
  ctx.lineTo(x + 7, y - 7);
  ctx.lineTo(x - 7, y - 7);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + facing * 7, y);
  ctx.lineTo(x + facing * 12, y);
  ctx.stroke();
  ctx.restore();
}

function drawTile(ctx, x, y, char = 'A', selected = false) {
  ctx.save();
  ctx.fillStyle = '#f5d46f';
  ctx.strokeStyle = selected ? '#fff' : '#5b471e';
  ctx.lineWidth = selected ? 3 : 1.5;
  ctx.fillRect(x - 9, y - 9, 18, 18);
  ctx.strokeRect(x - 9, y - 9, 18, 18);
  ctx.fillStyle = '#17191e';
  ctx.font = '900 11px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(char, x, y + 1);
  ctx.restore();
}

function drawPanel(ctx, panel, title, action, selected) {
  ctx.save();
  ctx.fillStyle = selected ? 'rgba(255,255,255,.12)' : 'rgba(21,25,31,.84)';
  ctx.strokeStyle = selected ? '#fff' : 'rgba(255,255,255,.22)';
  ctx.lineWidth = selected ? 3 : 1.5;
  ctx.fillRect(panel.x, panel.y, panel.w, panel.h);
  ctx.strokeRect(panel.x, panel.y, panel.w, panel.h);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#fff';
  ctx.font = '900 11px sans-serif';
  ctx.fillText(title, panel.x + 10, panel.y + 18);
  ctx.fillStyle = '#aeb7c3';
  ctx.font = '800 8px sans-serif';
  ctx.fillText(action, panel.x + 10, panel.y + panel.h - 9);

  if (selected) {
    ctx.fillStyle = '#f1ca5c';
    ctx.font = '900 7px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText('YOUR ROLE', panel.x + panel.w - 9, panel.y + 17);
  }
  ctx.restore();
}

function drawRunnerDemo(ctx, panel, t) {
  const phase = cyclePhase(t, 0);
  const startX = panel.x + 25;
  const tileX = panel.x + 96;
  const homeX = panel.x + panel.w - 34;
  const y = panel.y + 88;

  ctx.strokeStyle = 'rgba(255,255,255,.45)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(panel.x + panel.w * .52, panel.y + 35);
  ctx.lineTo(panel.x + panel.w * .52, panel.y + panel.h - 30);
  ctx.stroke();

  for (let i = 0; i < 3; i++) {
    ctx.strokeStyle = '#2f7df4';
    ctx.strokeRect(homeX - 28 + i * 20, y - 10, 17, 17);
  }

  let actorX = startX;
  let carrying = false;
  let placed = false;

  if (phase < .28) {
    actorX = startX + ease(phase / .28) * (tileX - startX - 14);
  } else if (phase < .40) {
    actorX = tileX - 14;
    carrying = true;
  } else if (phase < .78) {
    actorX = tileX - 14 + ease((phase - .40) / .38) * (homeX - tileX + 4);
    carrying = true;
  } else {
    actorX = homeX - 10;
    placed = true;
  }

  if (!carrying && !placed) drawTile(ctx, tileX, y, 'K', true);
  drawMiniActor(ctx, actorX, y, '#2f7df4', '#f2cf66', 1);
  if (carrying) drawTile(ctx, actorX, y - 22, 'K', false);
  if (placed) drawTile(ctx, homeX + 12, y - 1, 'K', false);

  ctx.fillStyle = '#dfe5ec';
  ctx.font = '800 8px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(placed ? 'PLACE' : carrying ? 'CARRY' : 'PICK', panel.x + panel.w / 2, panel.y + 133);
}

function drawSentryDemo(ctx, panel, t) {
  const phase = cyclePhase(t, .8);
  const lineX = panel.x + panel.w * .58;
  const y = panel.y + 86;
  const intruderStart = panel.x + panel.w - 25;
  const intruderEnd = lineX - 24;
  const intruderX = intruderStart - ease(Math.min(1, phase / .58)) * (intruderStart - intruderEnd);

  ctx.fillStyle = 'rgba(47,125,244,.10)';
  ctx.fillRect(panel.x + 6, panel.y + 30, lineX - panel.x - 6, panel.h - 56);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(lineX, panel.y + 34);
  ctx.lineTo(lineX, panel.y + panel.h - 27);
  ctx.stroke();

  const sentryX = panel.x + 34;
  drawMiniActor(ctx, sentryX, y, '#2f7df4', '#c8d2df', 1);
  drawMiniActor(ctx, intruderX, y, '#ec4d4d', '#f2cf66', -1);

  const crossed = intruderX < lineX + 5;
  if (crossed) {
    const shotPhase = clamp01((phase - .48) / .20);
    const bulletX = sentryX + 15 + shotPhase * Math.max(0, intruderX - sentryX - 25);
    ctx.beginPath();
    ctx.arc(bulletX, y, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#fff2a8';
    ctx.fill();
  }

  ctx.fillStyle = crossed ? '#f1ca5c' : '#dfe5ec';
  ctx.font = '800 8px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(crossed ? 'INTRUDER → SHOOT' : 'SAFE ACROSS LINE', panel.x + panel.w / 2, panel.y + 133);
}

function drawWardenDemo(ctx, panel, t) {
  const phase = cyclePhase(t, 1.6);
  const y = panel.y + 88;
  const brickX = panel.x + 30;
  const gapX = panel.x + panel.w - 42;

  ctx.fillStyle = '#765a38';
  ctx.fillRect(gapX - 39, y - 22, 22, 22);
  ctx.fillRect(gapX + 17, y - 22, 22, 22);
  ctx.strokeStyle = 'rgba(255,255,255,.45)';
  ctx.setLineDash([4, 3]);
  ctx.strokeRect(gapX - 11, y - 22, 22, 22);
  ctx.setLineDash([]);

  let actorX = brickX;
  let carrying = false;
  let built = false;
  if (phase < .22) {
    actorX = brickX;
  } else if (phase < .68) {
    actorX = brickX + ease((phase - .22) / .46) * (gapX - brickX - 15);
    carrying = true;
  } else {
    actorX = gapX - 15;
    built = true;
  }

  if (!carrying && !built) {
    ctx.fillStyle = '#8a693f';
    ctx.fillRect(brickX - 8, y - 8, 16, 16);
  }
  drawMiniActor(ctx, actorX, y, '#2f7df4', '#f0c84b', 1);
  if (carrying) {
    ctx.fillStyle = '#8a693f';
    ctx.fillRect(actorX - 7, y - 25, 14, 14);
  }
  if (built) {
    ctx.fillStyle = '#8a693f';
    ctx.fillRect(gapX - 11, y - 22, 22, 22);
  }

  ctx.fillStyle = '#dfe5ec';
  ctx.font = '800 8px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(built ? 'WALL RESTORED' : carrying ? 'CARRY BRICK' : 'PICK BRICK', panel.x + panel.w / 2, panel.y + 133);
}

function drawSaboteurDemo(ctx, panel, t) {
  const phase = cyclePhase(t, 2.4);
  const y = panel.y + 88;
  const startX = panel.x + 28;
  const wallX = panel.x + panel.w - 34;
  const plantX = wallX - 30;

  const exploded = phase > .82;
  if (!exploded) {
    ctx.fillStyle = '#765a38';
    ctx.fillRect(wallX - 10, y - 25, 20, 50);
  }

  let actorX = startX;
  let carrying = true;
  let planted = false;
  if (phase < .52) {
    actorX = startX + ease(phase / .52) * (plantX - startX);
  } else {
    actorX = plantX;
    carrying = false;
    planted = true;
  }

  drawMiniActor(ctx, actorX, y, '#ec4d4d', '#25272d', 1);
  const bombX = carrying ? actorX : plantX + 15;
  const bombY = carrying ? y - 23 : y + 5;
  if (!exploded) {
    ctx.beginPath();
    ctx.arc(bombX, bombY, 7, 0, Math.PI * 2);
    ctx.fillStyle = planted && Math.sin(t * 12) > 0 ? '#ffb347' : '#292c32';
    ctx.fill();
    ctx.strokeStyle = '#111';
    ctx.stroke();
  }

  if (exploded) {
    const blast = 12 + clamp01((phase - .82) / .18) * 27;
    ctx.beginPath();
    ctx.arc(plantX + 15, y + 4, blast, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,171,71,.28)';
    ctx.fill();
    ctx.strokeStyle = '#ffb347';
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  ctx.fillStyle = exploded ? '#f1ca5c' : '#dfe5ec';
  ctx.font = '800 8px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(exploded ? 'WALL OPEN' : planted ? 'BOMB PLANTED' : 'CARRY BOMB', panel.x + panel.w / 2, panel.y + 133);
}

function drawInstructionFrame(now) {
  if (!instructionCtx || instructionScreenEl?.classList.contains('hidden')) {
    instructionAnimationId = null;
    return;
  }

  const width = instructionCanvas.width;
  const height = instructionCanvas.height;
  const t = (now - instructionStartedAt) / 1000;
  const selected = instructionKey(instructionSelection.role, instructionSelection.duty);

  instructionCtx.clearRect(0, 0, width, height);
  instructionCtx.fillStyle = '#d5ad73';
  instructionCtx.fillRect(0, 0, width, height);

  instructionCtx.fillStyle = '#171b21';
  instructionCtx.fillRect(0, 0, width, 34);
  instructionCtx.fillStyle = '#fff';
  instructionCtx.font = '900 11px sans-serif';
  instructionCtx.textAlign = 'center';
  instructionCtx.fillText('PICK TILES  →  ARRANGE THE MESSAGE  →  WIN 3 ROUNDS', width / 2, 22);

  const gap = 8;
  const margin = 8;
  const panelWidth = (width - margin * 2 - gap * 3) / 4;
  const panels = Array.from({ length: 4 }, (_, index) => ({
    x: margin + index * (panelWidth + gap),
    y: 42,
    w: panelWidth,
    h: height - 50,
  }));

  const roles = ['RUNNER', 'SENTRY', 'WARDEN', 'SABOTEUR'];
  const labels = [
    ['RUNNER', 'PICK + PLACE'],
    ['SENTRY', 'SHOOT INTRUDERS'],
    ['WARDEN', 'REBUILD WALLS'],
    ['SABOTEUR', 'PLANT BOMBS'],
  ];

  panels.forEach((panel, index) => {
    drawPanel(
      instructionCtx,
      panel,
      labels[index][0],
      labels[index][1],
      selected === roles[index]
    );
  });

  drawRunnerDemo(instructionCtx, panels[0], t);
  drawSentryDemo(instructionCtx, panels[1], t);
  drawWardenDemo(instructionCtx, panels[2], t);
  drawSaboteurDemo(instructionCtx, panels[3], t);

  instructionAnimationId = requestAnimationFrame(drawInstructionFrame);
}

function startInstructionAnimation() {
  if (instructionAnimationId !== null) return;
  instructionAnimationId = requestAnimationFrame(drawInstructionFrame);
}

function stopInstructionAnimation() {
  if (instructionAnimationId !== null) cancelAnimationFrame(instructionAnimationId);
  instructionAnimationId = null;
}

window.__wordWarsInstructions = {
  open: openInstructionScreen,
  close: closeInstructionScreen,
  selection: () => ({ ...instructionSelection }),
};
