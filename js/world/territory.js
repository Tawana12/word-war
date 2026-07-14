'use strict';

// The centre line separates the two defensive territories.
// A Runner only becomes a legal shooting target after part of their body
// crosses onto the opposing team's half.
const TERRITORY_DIVIDER_X = CONFIG.W / 2;

function pointInTeamTerritory(x, team, inset = 0) {
  return team === 'blue'
    ? x <= TERRITORY_DIVIDER_X - inset
    : x >= TERRITORY_DIVIDER_X + inset;
}

function hasEnteredTeamTerritory(actor, team) {
  if (!actor) return false;
  const radius = Number.isFinite(actor.r) ? actor.r : 0;

  return team === 'blue'
    ? actor.x - radius < TERRITORY_DIVIDER_X
    : actor.x + radius > TERRITORY_DIVIDER_X;
}

function isTerritoryIntruder(actor, defendingTeam) {
  return Boolean(
    actor &&
    actor.alive !== false &&
    actor.team !== defendingTeam &&
    hasEnteredTeamTerritory(actor, defendingTeam)
  );
}

function actorTerritory(actor) {
  if (!actor) return null;
  if (actor.x < TERRITORY_DIVIDER_X) return 'blue';
  if (actor.x > TERRITORY_DIVIDER_X) return 'red';
  return 'line';
}

function drawTerritoryDivider() {
  ctx.save();

  // Very light team tint, kept subtle so letters and players remain dominant.
  ctx.fillStyle = 'rgba(33,118,255,0.025)';
  ctx.fillRect(0, 0, TERRITORY_DIVIDER_X, CONFIG.H);
  ctx.fillStyle = 'rgba(255,59,59,0.025)';
  ctx.fillRect(TERRITORY_DIVIDER_X, 0, CONFIG.W - TERRITORY_DIVIDER_X, CONFIG.H);

  ctx.beginPath();
  ctx.moveTo(TERRITORY_DIVIDER_X, 82);
  ctx.lineTo(TERRITORY_DIVIDER_X, CONFIG.H - 18);
  ctx.strokeStyle = 'rgba(255,255,255,0.98)';
  ctx.lineWidth = 4;
  ctx.shadowColor = 'rgba(0,0,0,0.58)';
  ctx.shadowBlur = 5;
  ctx.stroke();
  ctx.restore();
}

// Draw after the ground, walls and supply pads so the boundary remains
// visible, while keeping items and characters above it.
const territoryDrawSupplyPadsBase = drawSupplyPads;
drawSupplyPads = function territoryDrawSupplyPads() {
  territoryDrawSupplyPadsBase();
  drawTerritoryDivider();
};

window.__wordWarsTerritory = {
  dividerX: TERRITORY_DIVIDER_X,
  pointInTeamTerritory,
  hasEnteredTeamTerritory,
  isTerritoryIntruder,
  actorTerritory,
};
