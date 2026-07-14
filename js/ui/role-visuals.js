'use strict';

// ================================================================
// ROLE HATS
// The body remains fully team-coloured. A small hat identifies the role:
//   Runner   -> yellow cap
//   Inner Sentry -> steel helmet
//   Outer Warden -> yellow hardhat
//   Saboteur -> dark fuse beanie
// No chest plates, satchels or floating role badges are drawn.
// ================================================================

function drawRunnerHat(actor, x, y) {
  const direction = actor.vx < -8 ? -1 : 1;
  const topY = y - actor.r + 1;

  ctx.fillStyle = '#f4d06f';
  ctx.strokeStyle = '#17140b';
  ctx.lineWidth = 1.7;

  // Cap crown.
  ctx.beginPath();
  ctx.arc(x, topY + 2, 8, Math.PI, Math.PI * 2);
  ctx.lineTo(x + 8, topY + 4);
  ctx.lineTo(x - 8, topY + 4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Directional brim.
  ctx.beginPath();
  ctx.moveTo(x + direction * 3, topY + 4);
  ctx.lineTo(x + direction * 12, topY + 5);
  ctx.lineTo(x + direction * 11, topY + 8);
  ctx.lineTo(x + direction * 2, topY + 7);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawSentryHat(actor, x, y) {
  const topY = y - actor.r;

  ctx.fillStyle = '#c8d2df';
  ctx.strokeStyle = '#202a35';
  ctx.lineWidth = 1.8;

  // Rounded military helmet.
  ctx.beginPath();
  ctx.arc(x, topY + 4, 9.5, Math.PI, Math.PI * 2);
  ctx.lineTo(x + 9.5, topY + 7);
  ctx.lineTo(x - 9.5, topY + 7);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#5d6b7b';
  ctx.fillRect(x - 9, topY + 4, 18, 3);
}

function drawWardenHat(actor, x, y) {
  const topY = y - actor.r;

  ctx.fillStyle = '#f0c84b';
  ctx.strokeStyle = '#30270c';
  ctx.lineWidth = 1.8;

  // Construction hardhat.
  ctx.beginPath();
  ctx.arc(x, topY + 4, 9, Math.PI, Math.PI * 2);
  ctx.lineTo(x + 9, topY + 6);
  ctx.lineTo(x - 9, topY + 6);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x, topY - 4);
  ctx.lineTo(x, topY + 5);
  ctx.moveTo(x - 12, topY + 6);
  ctx.lineTo(x + 12, topY + 6);
  ctx.stroke();
}

function drawGuardianHat(actor, x, y) {
  if (typeof isInnerSentry === 'function' && isInnerSentry(actor)) {
    drawSentryHat(actor, x, y);
    return;
  }
  drawWardenHat(actor, x, y);
}

function drawSaboteurHat(actor, x, y) {
  const topY = y - actor.r;

  ctx.fillStyle = '#25272d';
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 1.8;

  // Compact dark beanie.
  ctx.beginPath();
  ctx.arc(x, topY + 4, 8.5, Math.PI, Math.PI * 2);
  ctx.lineTo(x + 8.5, topY + 7);
  ctx.lineTo(x - 8.5, topY + 7);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // Orange band keeps it readable on both teams.
  ctx.fillStyle = '#f3a83b';
  ctx.fillRect(x - 8, topY + 4, 16, 3);

  // Tiny fuse tuft.
  ctx.strokeStyle = '#f3a83b';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + 4, topY - 2);
  ctx.quadraticCurveTo(x + 10, topY - 7, x + 7, topY - 11);
  ctx.stroke();
}

function drawRoleHats(alpha = 1) {
  if (!ACTORS) return;

  for (const actor of ACTORS) {
    if (actor.alive === false) continue;

    const x = actor.prevX + (actor.x - actor.prevX) * alpha;
    const y = actor.prevY + (actor.y - actor.prevY) * alpha;
    const role = publicRoleOf(actor);

    ctx.save();
    if (role === 'RUNNER') drawRunnerHat(actor, x, y);
    if (role === 'GUARDIAN') drawGuardianHat(actor, x, y);
    if (role === 'SABOTEUR') drawSaboteurHat(actor, x, y);
    ctx.restore();
  }
}

function drawLocalPlayerHighlight(alpha = 1) {
  if (!player || player.alive === false) return;

  const x = player.prevX + (player.x - player.prevX) * alpha;
  const y = player.prevY + (player.y - player.prevY) * alpha;
  const pulse = 1 + Math.sin(simTime * 5.2) * 0.08;

  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, (player.r + 8) * pulse, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 226, 84, 0.13)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 226, 84, 0.96)';
  ctx.lineWidth = 3;
  ctx.shadowColor = '#ffe254';
  ctx.shadowBlur = 10;
  ctx.stroke();
  ctx.restore();
}

const roleVisualDrawActorsBase = drawActors;
drawActors = function roleVisualDrawActors(alpha = 1) {
  drawLocalPlayerHighlight(alpha);
  roleVisualDrawActorsBase(alpha);
  drawRoleHats(alpha);
};
