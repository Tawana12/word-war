'use strict';

// ================================================================
// DEVVIT MULTIPLAYER RUNTIME
// 15-second post lobby, automatic roles, host-authoritative simulation and
// bot takeover for every slot that is empty or temporarily disconnected.
// ================================================================
(() => {
  const lobbyScreen = document.querySelector('#multiplayerLobbyScreen');
  const lobbyBackBtn = document.querySelector('#multiplayerLobbyBackBtn');
  const countdownEl = document.querySelector('#multiplayerCountdown');
  const assignmentEl = document.querySelector('#multiplayerAssignment');
  const teamEl = document.querySelector('#multiplayerTeam');
  const playerCountEl = document.querySelector('#multiplayerPlayerCount');
  const slotListEl = document.querySelector('#multiplayerSlotList');
  const lobbyStatusEl = document.querySelector('#multiplayerLobbyStatus');
  const multiplayerPresenceEl = document.querySelector('#multiplayerPresence');

  const EMPTY_STATS = () => ({
    activeSeconds: 0,
    powerupsPicked: 0,
    usefulLettersPicked: 0,
    lettersPlaced: 0,
    correctLettersPlaced: 0,
    stolenLetters: 0,
    stolenDelivered: 0,
    cluesCollected: 0,
    shotsHit: 0,
    damageDealt: 0,
    eliminations: 0,
    carrierStops: 0,
    bombsDefused: 0,
    bricksPicked: 0,
    wallsBuilt: 0,
    rebuiltWalls: 0,
    blocks: 0,
    forcedDrops: 0,
    bombsPicked: 0,
    bombsPlanted: 0,
    wallsDestroyed: 0,
    lettersScattered: 0,
  });

  const runtime = {
    active: false,
    started: false,
    room: null,
    identity: null,
    assignment: null,
    isHost: false,
    lastRoomVersion: -1,
    remoteInputs: new Map(),
    actionSequence: 0,
    inputSequence: 0,
    lastSentInput: null,
    lastInputSentAt: 0,
    nextSnapshotAt: 0,
    nextWorldSnapshotAt: 0,
    nextWorldCheckAt: 0,
    lastWorldSignature: '',
    motionSequence: 0,
    worldSequence: 0,
    lastMotionSequence: -1,
    lastWorldSequence: -1,
    pendingMotionSnapshot: null,
    pendingWorldSnapshot: null,
    lastSnapshotReceivedAt: 0,
    smoothedSnapshotGapMs: 100,
    hasAuthoritativeSnapshot: false,
    hasFullWorldSnapshot: false,
    lastFullStateRequestAt: 0,
    lastForcedSnapshotAt: 0,
    roundAdvanceTimer: null,
    lobbyTimer: null,
    statsBySlot: Object.create(null),
    localInputHistory: [],
    latestAcknowledgedInputSequence: 0,
    latestAcknowledgedActionSequence: 0,
    localActionPredictionDeadline: 0,
    lastStopInputSequence: 0,
    lastMoveInputX: 0,
    lastMoveInputY: 0,
    releaseAnchorX: 0,
    releaseAnchorY: 0,
    releaseGuardUntil: 0,
    lastLocalAuthoritativeSimTime: -Infinity,
    hostActionSequenceBySlot: new Map(),
    nextBulletId: 1,
    nextHudRefreshAt: 0,
  };

  globalThis.multiplayerRuntime = runtime;
  globalThis.multiplayerRoomState = null;
  globalThis.multiplayerIdentity = null;

  function roleLabel(entry) {
    if (!entry) return 'Assigning…';
    if (entry.role === 'INNER_SENTRY' || entry.duty === 'SENTRY') return 'Inner Sentry';
    if (entry.role === 'OUTER_WARDEN' || entry.duty === 'WARDEN') return 'Outer Warden';
    if (entry.role === 'SABOTEUR') return 'Saboteur';
    return 'Runner';
  }

  function teamLabel(team) {
    return team === 'red' ? 'RED TEAM' : 'BLUE TEAM';
  }

  function lobbyMessage(text, error = false) {
    if (!lobbyStatusEl) return;
    lobbyStatusEl.textContent = text;
    lobbyStatusEl.classList.toggle('error', error);
  }

  function connectedHumanCount(room = runtime.room) {
    if (!room?.players) return 0;
    if (room.status === 'lobby') return room.players.length;
    return room.players.filter(entry => entry.connected !== false).length;
  }

  function multiplayerSlotCount() {
    const configured = globalThis.MULTIPLAYER_SLOT_LAYOUT?.length;
    return Number.isFinite(configured) && configured > 0 ? configured : 10;
  }

  function displayUsername(value, fallback = 'Player') {
    const clean = String(value || '').replace(/_/g, ' ').trim();
    return clean || fallback;
  }

  function refreshMultiplayerPresenceHud() {
    if (!multiplayerPresenceEl) return;
    if (!runtime.active || !runtime.started || !runtime.room) {
      multiplayerPresenceEl.classList.add('hidden');
      return;
    }

    const humans = connectedHumanCount(runtime.room);
    const bots = Math.max(0, multiplayerSlotCount() - humans);
    multiplayerPresenceEl.textContent = `${humans}P · ${bots}B`;
    multiplayerPresenceEl.classList.remove('hidden');
  }

  function renderLobby() {
    const room = runtime.room;
    const assignment = runtime.assignment;
    if (!room) return;

    const remaining = Math.max(0, Math.ceil((room.startsAt - Date.now()) / 1000));
    if (countdownEl) countdownEl.textContent = String(remaining);
    if (assignmentEl) {
      assignmentEl.textContent = assignment
        ? `${roleLabel(assignment)}`
        : 'Assigning role…';
    }
    if (teamEl) {
      teamEl.textContent = assignment
        ? `${teamLabel(assignment.team)} · ${displayUsername(runtime.identity?.username || assignment.username)}`
        : 'Waiting for role';
      teamEl.className = assignment?.team === 'red' ? 'team-red' : 'team-blue';
    }

    const humans = connectedHumanCount(room);
    const bots = Math.max(0, multiplayerSlotCount() - humans);
    if (playerCountEl) {
      playerCountEl.textContent =
        `${humans} player${humans === 1 ? '' : 's'} · ${bots} bot${bots === 1 ? '' : 's'}`;
    }

    if (slotListEl) {
      const joined = [...(room.players || [])]
        .sort((a, b) => a.joinedAt - b.joinedAt);
      slotListEl.replaceChildren();

      for (const entry of joined) {
        const row = document.createElement('div');
        const local = entry.userId === runtime.identity?.userId;
        row.className = `lobby-player-row ${entry.team}${local ? ' local' : ''}`;

        const identity = document.createElement('strong');
        identity.textContent = `${local ? 'YOU · ' : ''}${displayUsername(entry.username)}`;

        const detail = document.createElement('span');
        const takeover = room.status === 'playing' && entry.connected === false
          ? ' · BOT ACTIVE'
          : '';
        detail.textContent = `${roleLabel(entry)} · ${entry.team.toUpperCase()}${takeover}`;

        row.append(identity, detail);
        slotListEl.appendChild(row);
      }

      if (bots > 0) {
        const botRow = document.createElement('div');
        botRow.className = 'lobby-bot-summary';
        botRow.textContent = `+ ${bots} empty role${bots === 1 ? '' : 's'} filled by bots`;
        slotListEl.appendChild(botRow);
      }
    }

    if (room.status === 'lobby') {
      lobbyMessage(remaining > 0 ? 'Waiting for players…' : 'Starting match…');
    } else if (room.status === 'playing') {
      lobbyMessage(runtime.isHost ? 'Starting match…' : 'Connecting to match…');
    }
    refreshMultiplayerPresenceHud();
  }

  function startLobbyClock() {
    clearInterval(runtime.lobbyTimer);
    runtime.lobbyTimer = setInterval(renderLobby, 200);
  }

  function stopLobbyClock() {
    clearInterval(runtime.lobbyTimer);
    runtime.lobbyTimer = null;
  }

  async function joinMultiplayerLobby() {
    runtime.active = true;
    runtime.started = false;
    runtime.room = null;
    runtime.identity = null;
    runtime.assignment = null;
    runtime.remoteInputs.clear();
    runtime.actionSequence = 0;
    runtime.inputSequence = 0;
    runtime.latestAcknowledgedActionSequence = 0;
    runtime.localActionPredictionDeadline = 0;
    runtime.hostActionSequenceBySlot.clear();
    runtime.pendingMotionSnapshot = null;
    runtime.pendingWorldSnapshot = null;
    runtime.localInputHistory.length = 0;
    runtime.latestAcknowledgedInputSequence = 0;
    runtime.lastStopInputSequence = 0;
    runtime.lastLocalAuthoritativeSimTime = -Infinity;
    runtime.nextBulletId = 1;
    runtime.nextHudRefreshAt = 0;
    runtime.lastSnapshotReceivedAt = 0;
    runtime.smoothedSnapshotGapMs = 100;
    runtime.hasAuthoritativeSnapshot = false;
    runtime.hasFullWorldSnapshot = false;
    runtime.lastFullStateRequestAt = 0;
    runtime.lastForcedSnapshotAt = 0;
    runtime.statsBySlot = Object.create(null);
    lobbyScreen?.classList.remove('hidden');
    lobbyMessage('Connecting to the live lobby…');
    if (countdownEl) countdownEl.textContent = '15';
    startLobbyClock();

    try {
      const result = await multiplayerAdapter.connect();
      updateRoom(result.room, result.identity, result.assignment);
    } catch (error) {
      lobbyMessage(error instanceof Error ? error.message : 'Could not join multiplayer.', true);
    }
  }

  function leaveMultiplayerLobby() {
    stopLobbyClock();
    clearTimeout(runtime.roundAdvanceTimer);
    runtime.active = false;
    runtime.started = false;
    runtime.room = null;
    runtime.identity = null;
    runtime.assignment = null;
    runtime.isHost = false;
    globalThis.multiplayerRoomState = null;
    globalThis.multiplayerIdentity = null;
    multiplayerAdapter.disconnect();
    multiplayerPresenceEl?.classList.add('hidden');
    lobbyScreen?.classList.add('hidden');
    selectedSessionMode = null;
    globalThis.openModeSelection?.();
  }

  lobbyBackBtn?.addEventListener('click', leaveMultiplayerLobby);
  globalThis.joinMultiplayerLobby = joinMultiplayerLobby;
  globalThis.leaveMultiplayerLobby = leaveMultiplayerLobby;

  function updateRoom(room, identity = runtime.identity, assignment = runtime.assignment) {
    if (!room) return;
    const wasHost = runtime.isHost;
    const previousHostUserId = runtime.room?.hostUserId || null;
    runtime.room = room;
    runtime.identity = identity;
    runtime.assignment = assignment || room.players?.find(entry => entry.userId === identity?.userId) || null;
    runtime.isHost = Boolean(identity && room.hostUserId === identity.userId);
    runtime.lastRoomVersion = room.version ?? runtime.lastRoomVersion;
    globalThis.multiplayerRoomState = room;
    globalThis.multiplayerIdentity = identity;
    renderLobby();
    refreshMultiplayerPresenceHud();

    if (runtime.started) {
      refreshActorPresence();
      if (previousHostUserId && previousHostUserId !== room.hostUserId) {
        runtime.lastMotionSequence = -1;
        runtime.lastWorldSequence = -1;
        runtime.pendingMotionSnapshot = null;
        runtime.pendingWorldSnapshot = null;
        for (const actor of ACTORS || []) actor.netStateBuffer = [];
      }
      if (!wasHost && runtime.isHost) {
        runtime.motionSequence = 0;
        runtime.worldSequence = 0;
        msg('Host changed. You are keeping the match running.');
        runtime.nextSnapshotAt = simTime;
        runtime.nextWorldSnapshotAt = simTime;
        if (state.over && !state.demoMatch?.finished) scheduleNextRound();
      }
    }

    if (room.status === 'playing' && !runtime.started) {
      stopLobbyClock();
      globalThis.startMultiplayerGame?.(room, identity, runtime.assignment);
    }
  }

  multiplayerAdapter.onRoom(updateRoom);
  multiplayerAdapter.onError((error) => {
    if (!runtime.started) lobbyMessage(error.message, true);
    else msg(error.message);
  });

  function transportProfile() {
    const advertised = runtime.room?.transport || {};
    if (multiplayerAdapter.isWebMode?.()) {
      const debug = globalThis.__wordWarsNetDebug || {};
      const latency = Number(debug.latencyMs) || 80;
      const buffered = Number(debug.bufferedAmount) || 0;
      const congested = latency > 170 || buffered > 10 * 1024;

      // Maximum useful web rates: input can match a 60 Hz display, while motion
      // snapshots run at 50 Hz when the socket is healthy. Under congestion we
      // back off automatically instead of creating a stale packet queue.
      return {
        inputIntervalMs: congested ? 24 : 16,
        snapshotIntervalMs: congested ? 33 : 20,
        worldIntervalMs: Math.max(1100, advertised.worldIntervalMs || 1250),
      };
    }
    return {
      inputIntervalMs: advertised.inputIntervalMs || 70,
      snapshotIntervalMs: advertised.snapshotIntervalMs || 100,
      worldIntervalMs: advertised.worldIntervalMs || 700,
    };
  }

  function currentRawInput() {
    let x = 0;
    let y = 0;
    if (keys.w || keys.arrowup) y -= 1;
    if (keys.s || keys.arrowdown) y += 1;
    if (keys.a || keys.arrowleft) x -= 1;
    if (keys.d || keys.arrowright) x += 1;
    const keyboardLength = Math.hypot(x, y);
    if (keyboardLength) {
      x /= keyboardLength;
      y /= keyboardLength;
    }
    if (mobileInput.active) {
      x = mobileInput.x;
      y = mobileInput.y;
    }
    return { x, y };
  }

  function inputState() {
    const input = currentRawInput();
    return {
      type: 'player-input',
      slotId: runtime.assignment?.slotId || player?.multiplayerSlotId || '',
      x: Math.max(-1, Math.min(1, input.x)),
      y: Math.max(-1, Math.min(1, input.y)),
      facingX: player?.facingX || (player?.team === 'red' ? -1 : 1),
      facingY: player?.facingY || 0,
      actionHeld: Boolean(spaceHeld || globalThis.isInnerSentryFireHeld?.()),
      actionSequence: runtime.actionSequence,
      requestFullState: !runtime.isHost && !runtime.hasFullWorldSnapshot,
    };
  }

  function inputChanged(next, previous) {
    if (!previous) return true;
    return (
      Math.abs(next.x - previous.x) > 0.035 ||
      Math.abs(next.y - previous.y) > 0.035 ||
      Math.abs(next.facingX - previous.facingX) > 0.08 ||
      Math.abs(next.facingY - previous.facingY) > 0.08 ||
      next.actionHeld !== previous.actionHeld ||
      next.actionSequence !== previous.actionSequence ||
      next.requestFullState !== previous.requestFullState
    );
  }

  function sendLocalInput(now = performance.now()) {
    if (!runtime.active || !runtime.started || !player || runtime.isHost || document.hidden) return;
    const base = inputState();
    const previous = runtime.lastSentInput;
    const actionEdge = !previous ||
      base.actionSequence !== previous.actionSequence ||
      base.actionHeld !== previous.actionHeld;
    const elapsed = now - runtime.lastInputSentAt;
    const inputIntervalMs = transportProfile().inputIntervalMs;
    const bootstrapRequestDue = !runtime.hasFullWorldSnapshot &&
      elapsed > Math.max(180, inputIntervalMs * 2);
    const keepAliveDue = elapsed > 600;
    const movementChanged = inputChanged(base, previous);
    const previousMagnitude = previous ? Math.hypot(previous.x || 0, previous.y || 0) : 0;
    const nextMagnitude = Math.hypot(base.x, base.y);
    const movementEdge = !previous ||
      (previousMagnitude <= 0.05) !== (nextMagnitude <= 0.05) ||
      Math.abs(base.x - previous.x) > 0.16 ||
      Math.abs(base.y - previous.y) > 0.16;
    const edgeCanSend = movementEdge && elapsed >= 12;

    if (!actionEdge && !bootstrapRequestDue && !edgeCanSend) {
      if (elapsed < inputIntervalMs) return;
      if (!keepAliveDue && !movementChanged) return;
    }

    const next = {
      ...base,
      inputSequence: ++runtime.inputSequence,
      sentAt: Date.now(),
    };
    runtime.lastSentInput = next;
    runtime.lastInputSentAt = now;
    if (!runtime.isHost) {
      if (nextMagnitude > 0.05) {
        runtime.lastMoveInputX = next.x;
        runtime.lastMoveInputY = next.y;
      }
      if (nextMagnitude <= 0.05 && previousMagnitude > 0.05) {
        runtime.lastStopInputSequence = next.inputSequence;
        runtime.releaseAnchorX = player?.x || 0;
        runtime.releaseAnchorY = player?.y || 0;
        runtime.releaseGuardUntil = now + 650;
      }
      runtime.localInputHistory.push({
        inputSequence: next.inputSequence,
        x: next.x,
        y: next.y,
        sentAt: now,
      });
      if (runtime.localInputHistory.length > 120) runtime.localInputHistory.splice(0, 40);
    }
    multiplayerAdapter.sendInput(next);
  }

  // Mobile pointer-up must send the zero vector immediately. Waiting for the
  // next scheduled input frame lets the host continue the previous direction
  // and is the main cause of the apparent snap-back after releasing the stick.
  globalThis.flushMultiplayerInput = function flushMultiplayerInput() {
    if (!runtime.active || !runtime.started || runtime.isHost || !player) return;
    runtime.lastInputSentAt = -Infinity;
    sendLocalInput(performance.now());
  };

  function inputAnimationFrame(now) {
    sendLocalInput(now);
    requestAnimationFrame(inputAnimationFrame);
  }
  requestAnimationFrame(inputAnimationFrame);

  multiplayerAdapter.onInput((payload, envelope) => {
    if (!runtime.started || !payload || payload.type !== 'player-input') return;
    const sender = envelope.senderUserId;
    if (!sender || sender === runtime.identity?.userId) return;
    const roomPlayer = runtime.room?.players?.find(entry => entry.userId === sender);
    if (!roomPlayer || roomPlayer.slotId !== payload.slotId) return;
    const previousInput = runtime.remoteInputs.get(roomPlayer.slotId);
    const incomingSequence = Number(payload.inputSequence) || 0;
    const previousInputSequence = Number(previousInput?.inputSequence) || 0;
    if (incomingSequence && incomingSequence <= previousInputSequence) return;

    runtime.remoteInputs.set(roomPlayer.slotId, {
      ...payload,
      receivedAt: performance.now(),
      userId: sender,
    });

    if (runtime.isHost && payload.requestFullState) {
      const now = performance.now();
      if (now - runtime.lastForcedSnapshotAt >= 350) {
        runtime.lastForcedSnapshotAt = now;
        runtime.nextSnapshotAt = simTime;
        runtime.nextWorldSnapshotAt = simTime;
        multiplayerAdapter.sendSnapshot(buildWorldSnapshot());
      }
    }
  });

  function actorForSlot(slotId) {
    return (ACTORS || []).find(actor => actor.multiplayerSlotId === slotId) || null;
  }

  function runAsHumanControlledActor(actor, callback) {
    if (!actor || typeof callback !== 'function') return false;
    const wasPlayer = actor.isPlayer;
    const originalMsg = typeof msg === 'function' ? msg : null;
    actor.isPlayer = true;
    // Remote humans need player pickup/deposit ranges, but their messages must
    // not flash on the host player's HUD.
    if (!wasPlayer && originalMsg) msg = () => {};
    try {
      return callback();
    } finally {
      actor.isPlayer = wasPlayer;
      if (!wasPlayer && originalMsg) msg = originalMsg;
    }
  }

  function runAtReportedActionPose(actor, event, callback) {
    if (!actor || typeof callback !== 'function') return false;
    const originalX = actor.x;
    const originalY = actor.y;
    const reportedX = Number(event?.x);
    const reportedY = Number(event?.y);
    const distance = Number.isFinite(reportedX) && Number.isFinite(reportedY)
      ? Math.hypot(reportedX - originalX, reportedY - originalY)
      : Infinity;

    // The action packet often arrives before the next movement packet. Use the
    // client's reported pose only for the hit test, within a strict distance
    // cap, so a valid nearby pickup/drop is not rejected because the host is
    // one network frame behind.
    if (distance <= 110) {
      actor.x = clamp(reportedX, actor.r, CONFIG.W - actor.r);
      actor.y = clamp(reportedY, actor.r, CONFIG.H - actor.r);
    }
    try {
      return runAsHumanControlledActor(actor, callback);
    } finally {
      actor.x = originalX;
      actor.y = originalY;
    }
  }

  function refreshActorPresence() {
    if (!runtime.room || !ACTORS) return;
    const roomPlayers = new Map(runtime.room.players.map(entry => [entry.slotId, entry]));
    for (const actor of ACTORS) {
      const entry = roomPlayers.get(actor.multiplayerSlotId);
      if (!entry) {
        actor.multiplayerHuman = false;
        actor.multiplayerConnected = false;
        actor.multiplayerBot = true;
        continue;
      }
      actor.multiplayerHuman = true;
      actor.multiplayerConnected = entry.connected !== false;
      actor.multiplayerBot = false;
      actor.multiplayerUserId = entry.userId;
      actor.multiplayerUsername = entry.username;
    }
  }

  function driveRemoteHuman(actor, dt) {
    const input = runtime.remoteInputs.get(actor.multiplayerSlotId);
    const roomEntry = runtime.room?.players?.find(entry => entry.slotId === actor.multiplayerSlotId);
    const inputFresh = input && performance.now() - input.receivedAt < 3200;
    const connected = roomEntry?.connected !== false;

    if (!inputFresh || !connected) {
      actor.multiplayerConnected = false;
      updateBot(actor, dt);
      return;
    }

    actor.multiplayerConnected = true;
    decayTimers(actor, dt);
    const x = Number.isFinite(input.x) ? Math.max(-1, Math.min(1, input.x)) : 0;
    const y = Number.isFinite(input.y) ? Math.max(-1, Math.min(1, input.y)) : 0;
    const length = Math.hypot(x, y);
    if (length > 0.04) {
      actor.facingX = Number.isFinite(input.facingX) ? input.facingX : x / length;
      actor.facingY = Number.isFinite(input.facingY) ? input.facingY : y / length;
    }
    driveActor(actor, x, y, dt, false);
    actor.multiplayerProcessedInputSequence = Math.max(
      actor.multiplayerProcessedInputSequence || 0,
      Number(input.inputSequence) || 0
    );

    const previousSequence = actor.multiplayerActionSequence || 0;
    const pressed = input.actionSequence > previousSequence;
    actor.multiplayerActionSequence = Math.max(previousSequence, input.actionSequence || 0);

    if (isInnerSentry(actor) && input.actionHeld) {
      runAsHumanControlledActor(actor, () => {
        const target = typeof directionalDefenderTarget === 'function'
          ? directionalDefenderTarget(actor)
          : null;
        if (target) shootDefender(actor, false, target);
      });
    } else if (pressed) {
      runAsHumanControlledActor(actor, () => action(actor));
    }
  }

  function primitiveCopy(source, excluded = new Set()) {
    const result = {};
    if (!source || typeof source !== 'object') return result;
    for (const [key, value] of Object.entries(source)) {
      if (excluded.has(key) || typeof value === 'function' || value === undefined) continue;
      if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
        result[key] = value;
      } else if (Array.isArray(value) && value.every(item => item === null || ['string', 'number', 'boolean'].includes(typeof item))) {
        result[key] = [...value];
      }
    }
    return result;
  }

  function serializeInventory(inv) {
    if (!inv) return null;
    return primitiveCopy(inv, new Set(['owner', 'droppedBy', 'hiddenByTree']));
  }

  function serializeWorldActor(actor) {
    const fields = [
      'x', 'y', 'vx', 'vy', 'team', 'role', 'publicRole', 'guardianDuty',
      'maxSpeed', 'r', 'inputX', 'inputY', 'facingX', 'facingY', 'boost',
      'stunTimer', 'alive', 'maxHealth', 'health', 'lives', 'respawnTimer',
      'damageFlash', 'shootCooldown', 'weaponTier', 'gunAmmo', 'interceptFlash',
      'coverTreeId', 'mode', 'multiplayerSlotId', 'multiplayerUserId',
      'multiplayerUsername', 'multiplayerHuman', 'multiplayerConnected',
      'multiplayerBot', 'multiplayerActionSequence',
      'multiplayerProcessedInputSequence'
    ];
    const data = {};
    for (const field of fields) {
      const value = actor[field];
      if (value !== undefined && (value === null || ['string', 'number', 'boolean'].includes(typeof value))) {
        data[field] = value;
      }
    }
    data.inv = serializeInventory(actor.inv);
    data.ackInputSequence = actor.multiplayerProcessedInputSequence || 0;
    return data;
  }

  function serializeMotionActor(actor) {
    return {
      multiplayerSlotId: actor.multiplayerSlotId,
      team: actor.team,
      role: actor.role,
      guardianDuty: actor.guardianDuty ?? null,
      maxSpeed: actor.maxSpeed,
      r: actor.r,
      x: actor.x,
      y: actor.y,
      vx: actor.vx || 0,
      vy: actor.vy || 0,
      facingX: actor.facingX || 0,
      facingY: actor.facingY || 0,
      alive: actor.alive !== false,
      health: actor.health,
      lives: actor.lives,
      respawnTimer: actor.respawnTimer || 0,
      stunTimer: actor.stunTimer || 0,
      damageFlash: actor.damageFlash || 0,
      shootCooldown: actor.shootCooldown || 0,
      weaponTier: actor.weaponTier || 1,
      gunAmmo: actor.gunAmmo || 0,
      boost: actor.boost || 0,
      coverTreeId: actor.coverTreeId ?? null,
      mode: actor.mode,
      multiplayerActionSequence: actor.multiplayerActionSequence || 0,
      ackInputSequence: actor.multiplayerProcessedInputSequence || 0,
    };
  }

  function serializeItem(item) {
    const data = primitiveCopy(item, new Set(['owner', 'droppedBy', 'hiddenByTree']));
    if (item.owner?.multiplayerSlotId) data.ownerSlotId = item.owner.multiplayerSlotId;
    if (item.droppedBy?.multiplayerSlotId) data.droppedBySlotId = item.droppedBy.multiplayerSlotId;
    if (item.hiddenByTree?.id != null) data.hiddenByTreeId = item.hiddenByTree.id;
    return data;
  }

  function networkBulletId(bullet) {
    if (!bullet.__multiplayerBulletId) {
      bullet.__multiplayerBulletId = `b${runtime.nextBulletId++}`;
    }
    return bullet.__multiplayerBulletId;
  }

  function serializeBullet(bullet) {
    const data = primitiveCopy(bullet, new Set(['owner', '__multiplayerBulletId']));
    data.id = networkBulletId(bullet);
    if (bullet.owner?.multiplayerSlotId) data.ownerSlotId = bullet.owner.multiplayerSlotId;
    return data;
  }

  function compactSharedState() {
    return {
      blue: [...state.blue],
      red: [...state.red],
      seconds: state.seconds,
      over: state.over,
      spawnTimer: state.spawnTimer,
      jammedUntil: { ...state.jammedUntil },
      wordLocks: state.wordLocks ? { ...state.wordLocks } : null,
    };
  }

  function compactDemoMatch() {
    return state.demoMatch ? {
      roundIndex: state.demoMatch.roundIndex,
      score: { ...state.demoMatch.score },
      resolving: state.demoMatch.resolving,
      finished: state.demoMatch.finished,
    } : null;
  }

  function buildMotionSnapshot() {
    const sequence = ++runtime.motionSequence;
    return {
      type: 'motion-snapshot',
      sequence,
      roundIndex: state.demoMatch?.roundIndex || 0,
      simTime,
      seconds: state.seconds,
      actors: (ACTORS || []).map(serializeMotionActor),
      // Bullets need network correction, but not at the full actor rate.
      bullets: sequence % 2 === 0 && typeof bullets !== 'undefined'
        ? bullets.map(serializeBullet)
        : undefined,
      sentAt: Date.now(),
    };
  }

  function buildWorldSnapshot() {
    return {
      type: 'world-snapshot',
      sequence: ++runtime.worldSequence,
      fullWorld: true,
      roundIndex: state.demoMatch?.roundIndex || 0,
      simTime,
      blueWord: CONFIG.BLUE_WORD,
      redWord: CONFIG.RED_WORD,
      state: compactSharedState(),
      demoMatch: compactDemoMatch(),
      actors: (ACTORS || []).map(serializeWorldActor),
      bullets: typeof bullets !== 'undefined' ? bullets.map(serializeBullet) : [],
      explosions: explosions.map(effect => primitiveCopy(effect)),
      slotEffects: slotEffects.map(effect => primitiveCopy(effect)),
      interceptEffects: interceptEffects.map(effect => primitiveCopy(effect)),
      maze: {
        activeMazeIndex: typeof activeMazeIndex !== 'undefined' ? activeMazeIndex : 0,
        pendingMazeIndex: typeof pendingMazeIndex !== 'undefined' ? pendingMazeIndex : 0,
        mazePhase: typeof mazePhase !== 'undefined' ? mazePhase : 'ACTIVE',
        mazeTimer: typeof mazeTimer !== 'undefined' ? mazeTimer : 0,
      },
      hostUserId: runtime.room?.hostUserId || null,
      items: items.map(serializeItem),
      walls: walls.map(wall => primitiveCopy(wall)),
      statsBySlot: runtime.statsBySlot,
      sentAt: Date.now(),
    };
  }

  function restoreItem(data, actorsBySlot) {
    const item = { ...data };
    delete item.ownerSlotId;
    delete item.droppedBySlotId;
    delete item.hiddenByTreeId;
    item.owner = data.ownerSlotId ? actorsBySlot.get(data.ownerSlotId) || null : null;
    item.droppedBy = data.droppedBySlotId ? actorsBySlot.get(data.droppedBySlotId) || null : null;
    item.hiddenByTree = data.hiddenByTreeId != null
      ? trees.find(tree => tree.id === data.hiddenByTreeId) || null
      : null;
    return item;
  }

  function applySharedSnapshotState(snapshot, fullWorld = false) {
    const incomingSimTime = Number(snapshot.simTime);
    if (Number.isFinite(incomingSimTime)) {
      const drift = incomingSimTime - simTime;
      simTime = Math.abs(drift) > 1 ? incomingSimTime : simTime + drift * 0.16;
    }

    const incomingState = snapshot.state || {};
    if (Array.isArray(incomingState.blue)) state.blue = [...incomingState.blue];
    if (Array.isArray(incomingState.red)) state.red = [...incomingState.red];
    state.seconds = incomingState.seconds ?? state.seconds;
    if (incomingState.over !== undefined) state.over = Boolean(incomingState.over);
    state.spawnTimer = incomingState.spawnTimer ?? state.spawnTimer;
    if (incomingState.jammedUntil) state.jammedUntil = { ...incomingState.jammedUntil };
    if (incomingState.wordLocks && state.wordLocks) state.wordLocks = { ...incomingState.wordLocks };

    if (snapshot.demoMatch && state.demoMatch) {
      state.demoMatch.roundIndex = snapshot.demoMatch.roundIndex;
      state.demoMatch.score = { ...snapshot.demoMatch.score };
      state.demoMatch.resolving = snapshot.demoMatch.resolving;
      state.demoMatch.finished = snapshot.demoMatch.finished;
    }

    if (fullWorld && (CONFIG.BLUE_WORD !== snapshot.blueWord || CONFIG.RED_WORD !== snapshot.redWord)) {
      CONFIG.BLUE_WORD = snapshot.blueWord;
      CONFIG.RED_WORD = snapshot.redWord;
      refreshLetterPools();
      if (bsEl) bsEl.textContent = shuffle(CONFIG.BLUE_WORD);
      if (rsEl) rsEl.textContent = shuffle(CONFIG.RED_WORD);
    }
  }

  function acknowledgeLocalInput(sequence) {
    const acknowledged = Number(sequence) || 0;
    runtime.latestAcknowledgedInputSequence = Math.max(
      runtime.latestAcknowledgedInputSequence || 0,
      acknowledged
    );
    if (!acknowledged || runtime.localInputHistory.length === 0) return acknowledged;
    let removeCount = 0;
    while (
      removeCount < runtime.localInputHistory.length &&
      runtime.localInputHistory[removeCount].inputSequence <= acknowledged
    ) {
      removeCount += 1;
    }
    if (removeCount) runtime.localInputHistory.splice(0, removeCount);
    return acknowledged;
  }

  function pushActorNetworkState(actor, data, receivedAt, sequence) {
    const statePoint = {
      sequence,
      receivedAt,
      x: Number.isFinite(data.x) ? data.x : actor.x,
      y: Number.isFinite(data.y) ? data.y : actor.y,
      vx: Number.isFinite(data.vx) ? data.vx : 0,
      vy: Number.isFinite(data.vy) ? data.vy : 0,
      facingX: Number.isFinite(data.facingX) ? data.facingX : actor.facingX,
      facingY: Number.isFinite(data.facingY) ? data.facingY : actor.facingY,
    };
    if (!Array.isArray(actor.netStateBuffer)) actor.netStateBuffer = [];
    const lastState = actor.netStateBuffer[actor.netStateBuffer.length - 1];
    if (lastState && receivedAt <= lastState.receivedAt) return;
    actor.netStateBuffer.push(statePoint);
    if (actor.netStateBuffer.length > 6) actor.netStateBuffer.splice(0, actor.netStateBuffer.length - 6);
    actor.netTargetX = statePoint.x;
    actor.netTargetY = statePoint.y;
    actor.netTargetVx = statePoint.vx;
    actor.netTargetVy = statePoint.vy;
    actor.netSnapshotAt = receivedAt;
  }

  function ingestActorMotion(actor, data, receivedAt, sequence, isLocalActor, isNew = false, snapshotSimTime = -Infinity) {
    const networkX = Number.isFinite(data.x) ? data.x : actor.x;
    const networkY = Number.isFinite(data.y) ? data.y : actor.y;
    const networkVx = Number.isFinite(data.vx) ? data.vx : 0;
    const networkVy = Number.isFinite(data.vy) ? data.vy : 0;

    const deferLocalActionState = Boolean(
      isLocalActor &&
      runtime.actionSequence > (Number(data.multiplayerActionSequence) || 0) &&
      performance.now() < runtime.localActionPredictionDeadline
    );
    for (const field of [
      'alive', 'health', 'lives', 'respawnTimer', 'stunTimer', 'damageFlash',
      'shootCooldown', 'weaponTier', 'gunAmmo', 'boost', 'coverTreeId', 'mode',
      'multiplayerActionSequence'
    ]) {
      if (field === 'multiplayerActionSequence' && deferLocalActionState) continue;
      if (data[field] !== undefined) actor[field] = data[field];
    }
    if (data.inv !== undefined && !deferLocalActionState) {
      actor.inv = data.inv ? { ...data.inv } : null;
    }

    if (isLocalActor) {
      const acknowledged = acknowledgeLocalInput(
        data.ackInputSequence ?? data.multiplayerProcessedInputSequence
      );
      const authoritativeSimTime = Number(snapshotSimTime);
      if (
        Number.isFinite(authoritativeSimTime) &&
        authoritativeSimTime + 0.0001 < runtime.lastLocalAuthoritativeSimTime
      ) {
        return;
      }
      if (Number.isFinite(authoritativeSimTime)) {
        runtime.lastLocalAuthoritativeSimTime = authoritativeSimTime;
      }

      // The host snapshot is roughly one round trip behind local prediction.
      // Project forward while moving, but never use a pre-release snapshot to
      // drag the player backwards after the joystick has returned to zero.
      const rawRttMs = Number(globalThis.__wordWarsNetworkLatencyMs);
      const rttSeconds = Math.max(0.018, Math.min(0.18,
        Number.isFinite(rawRttMs) ? rawRttMs / 1000 : 0.07
      ));
      const rawInput = currentRawInput();
      const locallyMoving = Math.hypot(rawInput.x, rawInput.y) > 0.05;
      const latestSentSequence = Number(runtime.lastSentInput?.inputSequence) || 0;
      const pendingInputCount = Math.max(0, latestSentSequence - acknowledged);
      const awaitingStopAck = !locallyMoving &&
        runtime.lastStopInputSequence > 0 &&
        acknowledged < runtime.lastStopInputSequence;

      if (awaitingStopAck) {
        actor.netCorrectionX = 0;
        actor.netCorrectionY = 0;
        return;
      }

      const projectionSeconds = locallyMoving ? rttSeconds : 0;
      const predictedAuthoritativeX = networkX + networkVx * projectionSeconds;
      const predictedAuthoritativeY = networkY + networkVy * projectionSeconds;
      const errorX = predictedAuthoritativeX - actor.x;
      const errorY = predictedAuthoritativeY - actor.y;
      const distance = Math.hypot(errorX, errorY);
      if (globalThis.__wordWarsNetDebug) {
        globalThis.__wordWarsNetDebug.reconciliationError = distance;
      }

      // Do not fight the player's latest unacknowledged movement. This keeps
      // controls immediate even when a mobile frame or network packet is late.
      if (locallyMoving && pendingInputCount > 3 && distance < 150) {
        actor.netCorrectionX = 0;
        actor.netCorrectionY = 0;
        return;
      }

      const snapDistance = globalThis.__wordWarsTouchUI ? 340 : 300;
      if (isNew || distance > snapDistance) {
        actor.x = predictedAuthoritativeX;
        actor.y = predictedAuthoritativeY;
        actor.prevX = predictedAuthoritativeX;
        actor.prevY = predictedAuthoritativeY;
        actor.netCorrectionX = 0;
        actor.netCorrectionY = 0;
        actor.vx = networkVx;
        actor.vy = networkVy;
      } else if (!locallyMoving) {
        // A stop packet and its confirming snapshot can cross in flight. Reject
        // the familiar backward correction while the release guard is active.
        // This prevents the character moving forward, then visibly stepping
        // back when the joystick is released on the non-host device.
        const moveLength = Math.hypot(runtime.lastMoveInputX, runtime.lastMoveInputY);
        const moveX = moveLength > 0.05 ? runtime.lastMoveInputX / moveLength : 0;
        const moveY = moveLength > 0.05 ? runtime.lastMoveInputY / moveLength : 0;
        const correctionAlongLastMove = errorX * moveX + errorY * moveY;
        const releaseAgeProtected = performance.now() < runtime.releaseGuardUntil;
        const anchorDriftX = predictedAuthoritativeX - runtime.releaseAnchorX;
        const anchorDriftY = predictedAuthoritativeY - runtime.releaseAnchorY;
        const anchorDistance = Math.hypot(anchorDriftX, anchorDriftY);
        const looksLikePreReleaseState = correctionAlongLastMove < -0.5 && anchorDistance < 110;

        if (distance <= 3 || (releaseAgeProtected && looksLikePreReleaseState)) {
          actor.netCorrectionX = 0;
          actor.netCorrectionY = 0;
        } else if (distance > 135) {
          // Large divergence is still corrected so walls and collisions remain
          // authoritative, but normal release jitter is never visible.
          const maxReleaseCorrection = 18;
          const scale = Math.min(1, maxReleaseCorrection / Math.max(distance, 0.001));
          actor.netCorrectionX = errorX * scale;
          actor.netCorrectionY = errorY * scale;
        } else {
          actor.netCorrectionX = 0;
          actor.netCorrectionY = 0;
        }
      } else if (distance > 120) {
        actor.netCorrectionX = errorX * 0.26;
        actor.netCorrectionY = errorY * 0.26;
      } else if (distance > 62) {
        actor.netCorrectionX = errorX * 0.08;
        actor.netCorrectionY = errorY * 0.08;
      } else {
        actor.netCorrectionX = 0;
        actor.netCorrectionY = 0;
      }
      return;
    }

    pushActorNetworkState(actor, data, receivedAt, sequence);
    if (isNew || !Number.isFinite(actor.x) || !Number.isFinite(actor.y)) {
      actor.x = networkX;
      actor.y = networkY;
      actor.prevX = networkX;
      actor.prevY = networkY;
      actor.vx = networkVx;
      actor.vy = networkVy;
    }
  }

  function syncMotionBullets(snapshotBullets, actorsBySlot) {
    if (typeof bullets === 'undefined' || !Array.isArray(snapshotBullets)) return;
    const existing = new Map(bullets.map(bullet => [bullet.__multiplayerBulletId, bullet]));
    const next = [];
    for (const data of snapshotBullets) {
      let bullet = existing.get(data.id);
      if (!bullet) {
        bullet = {
          ...data,
          __multiplayerBulletId: data.id,
          prevX: data.x,
          prevY: data.y,
        };
      }
      bullet.prevX = Number.isFinite(bullet.x) ? bullet.x : data.x;
      bullet.prevY = Number.isFinite(bullet.y) ? bullet.y : data.y;
      Object.assign(bullet, data);
      bullet.__multiplayerBulletId = data.id;
      bullet.owner = data.ownerSlotId ? actorsBySlot.get(data.ownerSlotId) || null : null;
      delete bullet.id;
      delete bullet.ownerSlotId;
      next.push(bullet);
    }
    bullets.splice(0, bullets.length, ...next);
  }

  function updateSnapshotTiming(snapshot) {
    const receivedAt = Number.isFinite(snapshot.__receivedAt) ? snapshot.__receivedAt : performance.now();
    if (runtime.lastSnapshotReceivedAt > 0) {
      const observedGap = Math.max(8, Math.min(1000, receivedAt - runtime.lastSnapshotReceivedAt));
      runtime.smoothedSnapshotGapMs += (observedGap - runtime.smoothedSnapshotGapMs) * 0.18;
      if (globalThis.__wordWarsNetDebug) {
        globalThis.__wordWarsNetDebug.averageSnapshotGapMs = runtime.smoothedSnapshotGapMs;
      }
    }
    runtime.lastSnapshotReceivedAt = receivedAt;
    return receivedAt;
  }

  function applyMotionSnapshot(snapshot) {
    if (!Array.isArray(snapshot.actors) || snapshot.actors.length === 0) return;
    if ((snapshot.sequence ?? 0) <= runtime.lastMotionSequence) return;
    runtime.lastMotionSequence = snapshot.sequence ?? runtime.lastMotionSequence + 1;
    const receivedAt = updateSnapshotTiming(snapshot);
    applySharedSnapshotState(snapshot, false);
    if (Number.isFinite(snapshot.seconds)) state.seconds = snapshot.seconds;

    const actorsBySlot = new Map((ACTORS || []).map(actor => [actor.multiplayerSlotId, actor]));
    for (const data of snapshot.actors) {
      let actor = actorsBySlot.get(data.multiplayerSlotId);
      const isNew = !actor;
      if (!actor) {
        actor = createActor(data.x, data.y, data.team, data.role, data.maxSpeed, false);
        actor.multiplayerSlotId = data.multiplayerSlotId;
        actor.guardianDuty = data.guardianDuty ?? null;
        ACTORS.push(actor);
        actorsBySlot.set(data.multiplayerSlotId, actor);
      }
      const isLocalActor = data.multiplayerSlotId === runtime.assignment?.slotId;
      actor.isPlayer = isLocalActor;
      ingestActorMotion(actor, data, receivedAt, snapshot.sequence || 0, isLocalActor, isNew, snapshot.simTime);
    }

    player = actorsBySlot.get(runtime.assignment?.slotId) || player;
    bots = (ACTORS || []).filter(actor => actor.multiplayerBot);
    runtime.hasAuthoritativeSnapshot = true;
    if (Array.isArray(snapshot.bullets)) syncMotionBullets(snapshot.bullets, actorsBySlot);

    const now = performance.now();
    if (now >= runtime.nextHudRefreshAt) {
      runtime.nextHudRefreshAt = now + 220;
      if (timerEl) {
        timerEl.textContent = `${Math.floor(state.seconds / 60)}:${String(Math.max(0, state.seconds % 60)).padStart(2, '0')}`;
      }
    }
  }

  function applyWorldSnapshot(snapshot) {
    if (!Array.isArray(snapshot.actors) || snapshot.actors.length === 0) return;
    if ((snapshot.sequence ?? 0) <= runtime.lastWorldSequence) return;
    runtime.lastWorldSequence = snapshot.sequence ?? runtime.lastWorldSequence + 1;
    const receivedAt = updateSnapshotTiming(snapshot);

    const localSlotId = runtime.assignment?.slotId;
    const localActorPayload = snapshot.actors.find(data => data.multiplayerSlotId === localSlotId);
    const authoritativeActionSequence = Number(localActorPayload?.multiplayerActionSequence) || 0;
    const waitingForActionConfirmation =
      runtime.actionSequence > authoritativeActionSequence &&
      performance.now() < runtime.localActionPredictionDeadline;

    if (!waitingForActionConfirmation && authoritativeActionSequence > 0) {
      runtime.latestAcknowledgedActionSequence = Math.max(
        runtime.latestAcknowledgedActionSequence || 0,
        authoritativeActionSequence
      );
      if (authoritativeActionSequence >= runtime.actionSequence) {
        runtime.localActionPredictionDeadline = 0;
      }
    }

    const predictedBlue = waitingForActionConfirmation ? [...state.blue] : null;
    const predictedRed = waitingForActionConfirmation ? [...state.red] : null;
    applySharedSnapshotState(snapshot, true);
    if (waitingForActionConfirmation) {
      state.blue = predictedBlue;
      state.red = predictedRed;
    }

    const existingBySlot = new Map((ACTORS || []).map(actor => [actor.multiplayerSlotId, actor]));
    const nextActors = [];
    for (const data of snapshot.actors) {
      let actor = existingBySlot.get(data.multiplayerSlotId);
      const isNew = !actor;
      if (!actor) actor = createActor(data.x, data.y, data.team, data.role, data.maxSpeed, false);

      const isLocalActor = data.multiplayerSlotId === runtime.assignment?.slotId;
      const localMotion = isLocalActor ? {
        inputX: Number.isFinite(actor.inputX) ? actor.inputX : 0,
        inputY: Number.isFinite(actor.inputY) ? actor.inputY : 0,
        facingX: Number.isFinite(actor.facingX) ? actor.facingX : 1,
        facingY: Number.isFinite(actor.facingY) ? actor.facingY : 0,
        vx: Number.isFinite(actor.vx) ? actor.vx : 0,
        vy: Number.isFinite(actor.vy) ? actor.vy : 0,
      } : null;
      const predictedInventory = isLocalActor && waitingForActionConfirmation
        ? (actor.inv ? { ...actor.inv } : null)
        : null;

      const actorState = { ...data };
      delete actorState.x;
      delete actorState.y;
      delete actorState.vx;
      delete actorState.vy;
      delete actorState.inv;
      if (isLocalActor && waitingForActionConfirmation) {
        delete actorState.multiplayerActionSequence;
      }
      Object.assign(actor, actorState);
      actor.inv = isLocalActor && waitingForActionConfirmation
        ? predictedInventory
        : (data.inv ? { ...data.inv } : null);
      actor.isPlayer = isLocalActor;
      if (isLocalActor) Object.assign(actor, localMotion);
      ingestActorMotion(actor, data, receivedAt, snapshot.sequence || 0, isLocalActor, isNew, snapshot.simTime);
      nextActors.push(actor);
    }

    ACTORS = nextActors;
    player = nextActors.find(actor => actor.multiplayerSlotId === runtime.assignment?.slotId) || player;
    bots = nextActors.filter(actor => actor.multiplayerBot);
    runtime.hasAuthoritativeSnapshot = true;
    runtime.hasFullWorldSnapshot = true;
    const actorsBySlot = new Map(nextActors.map(actor => [actor.multiplayerSlotId, actor]));

    if (!waitingForActionConfirmation) {
      items.splice(0, items.length, ...(snapshot.items || []).map(data => restoreItem(data, actorsBySlot)));
      walls.splice(0, walls.length, ...(snapshot.walls || []).map(data => ({ ...data })));
      slotEffects.splice(0, slotEffects.length, ...(snapshot.slotEffects || []).map(data => ({ ...data })));
      interceptEffects.splice(0, interceptEffects.length, ...(snapshot.interceptEffects || []).map(data => ({ ...data })));
    }
    explosions.splice(0, explosions.length, ...(snapshot.explosions || []).map(data => ({ ...data })));
    syncMotionBullets(snapshot.bullets, actorsBySlot);

    const mazeChanged =
      (typeof activeMazeIndex !== 'undefined' && snapshot.maze?.activeMazeIndex !== activeMazeIndex) ||
      (typeof pendingMazeIndex !== 'undefined' && snapshot.maze?.pendingMazeIndex !== pendingMazeIndex) ||
      (typeof mazePhase !== 'undefined' && snapshot.maze?.mazePhase !== mazePhase);
    if (typeof activeMazeIndex !== 'undefined') activeMazeIndex = snapshot.maze?.activeMazeIndex ?? activeMazeIndex;
    if (typeof pendingMazeIndex !== 'undefined') pendingMazeIndex = snapshot.maze?.pendingMazeIndex ?? pendingMazeIndex;
    if (typeof mazePhase !== 'undefined') mazePhase = snapshot.maze?.mazePhase ?? mazePhase;
    if (typeof mazeTimer !== 'undefined') mazeTimer = snapshot.maze?.mazeTimer ?? mazeTimer;
    if (mazeChanged && typeof navigationGridCache !== 'undefined') navigationGridCache.clear();

    if (snapshot.statsBySlot) runtime.statsBySlot = snapshot.statsBySlot;
    if (timerEl) {
      timerEl.textContent = `${Math.floor(state.seconds / 60)}:${String(Math.max(0, state.seconds % 60)).padStart(2, '0')}`;
    }
    updateRoundHud?.();
    updateActorTreeCover?.();
    updateContextHint?.();
    hud?.();
    if (!state.over) {
      roundScreenEl?.classList.add('hidden');
      document.documentElement.classList.remove('round-ended');
    }
  }

  function applySnapshot(snapshot) {
    if (!runtime.active || runtime.isHost || !snapshot) return;
    if (!runtime.started) {
      queueSnapshot(snapshot);
      return;
    }
    if (snapshot.type === 'world-snapshot' || snapshot.fullWorld) {
      applyWorldSnapshot(snapshot);
    } else if (snapshot.type === 'motion-snapshot' || snapshot.type === 'game-snapshot') {
      applyMotionSnapshot(snapshot);
    }
  }

  function updateReplicaVisuals(dt) {
    simTime += dt;
    const now = performance.now();
    const jitter = Number(globalThis.__wordWarsNetDebug?.jitterMs) || 0;
    const adaptiveDelay = Math.max(24, Math.min(52, runtime.smoothedSnapshotGapMs * 0.92 + jitter * 0.35));
    const interpolationDelay = adaptiveDelay + (globalThis.__wordWarsTouchUI ? 2 : 0);
    const renderAt = now - interpolationDelay;

    for (const actor of ACTORS || []) {
      if (actor === player) continue;
      actor.prevX = actor.x;
      actor.prevY = actor.y;
      const states = actor.netStateBuffer;
      if (!Array.isArray(states) || states.length === 0) continue;

      while (states.length > 2 && states[1].receivedAt <= renderAt) states.shift();
      let x;
      let y;
      let vx;
      let vy;
      let facingX;
      let facingY;

      if (states.length >= 2 && renderAt <= states[1].receivedAt) {
        const a = states[0];
        const b = states[1];
        const span = Math.max(1, b.receivedAt - a.receivedAt);
        const t = Math.max(0, Math.min(1, (renderAt - a.receivedAt) / span));
        x = a.x + (b.x - a.x) * t;
        y = a.y + (b.y - a.y) * t;
        vx = a.vx + (b.vx - a.vx) * t;
        vy = a.vy + (b.vy - a.vy) * t;
        facingX = a.facingX + (b.facingX - a.facingX) * t;
        facingY = a.facingY + (b.facingY - a.facingY) * t;
      } else {
        const latest = states[states.length - 1];
        const extrapolation = Math.min(0.065, Math.max(0, (renderAt - latest.receivedAt) / 1000));
        x = latest.x + latest.vx * extrapolation;
        y = latest.y + latest.vy * extrapolation;
        vx = latest.vx;
        vy = latest.vy;
        facingX = latest.facingX;
        facingY = latest.facingY;
      }

      actor.x = Math.max(actor.r, Math.min(CONFIG.W - actor.r, x));
      actor.y = Math.max(actor.r, Math.min(CONFIG.H - actor.r, y));
      actor.vx = vx;
      actor.vy = vy;
      if (Number.isFinite(facingX)) actor.facingX = facingX;
      if (Number.isFinite(facingY)) actor.facingY = facingY;
    }

    if (typeof bullets !== 'undefined') {
      for (let index = bullets.length - 1; index >= 0; index -= 1) {
        const bullet = bullets[index];
        bullet.prevX = bullet.x;
        bullet.prevY = bullet.y;
        bullet.x += (bullet.vx || 0) * dt;
        bullet.y += (bullet.vy || 0) * dt;
        if (Number.isFinite(bullet.life)) {
          bullet.life -= dt;
          if (bullet.life <= 0) bullets.splice(index, 1);
        }
      }
    }

    for (let index = explosions.length - 1; index >= 0; index -= 1) {
      const effect = explosions[index];
      effect.r += (effect.growRate || CONFIG.EXPLOSION_GROW_RATE) * dt;
      effect.a -= CONFIG.EXPLOSION_FADE_RATE * dt;
      if (effect.a <= 0) explosions.splice(index, 1);
    }
    for (const effect of slotEffects) effect.time = Math.max(0, effect.time - dt);
    for (const effect of interceptEffects) effect.time = Math.max(0, effect.time - dt);
  }

  function queueSnapshot(snapshot) {
    if (!snapshot || !['motion-snapshot', 'world-snapshot', 'game-snapshot'].includes(snapshot.type)) return;
    snapshot.__receivedAt = performance.now();
    const isWorld = snapshot.type === 'world-snapshot' || snapshot.fullWorld === true;
    if (isWorld) {
      if (!runtime.pendingWorldSnapshot || (snapshot.sequence ?? 0) > (runtime.pendingWorldSnapshot.sequence ?? 0)) {
        runtime.pendingWorldSnapshot = snapshot;
      }
      return;
    }
    if (!runtime.pendingMotionSnapshot || (snapshot.sequence ?? 0) > (runtime.pendingMotionSnapshot.sequence ?? 0)) {
      if (runtime.pendingMotionSnapshot && globalThis.__wordWarsNetDebug) {
        globalThis.__wordWarsNetDebug.droppedMotionSnapshots += 1;
      }
      runtime.pendingMotionSnapshot = snapshot;
    }
  }

  multiplayerAdapter.onSnapshot((snapshot, envelope) => {
    if (envelope?.senderUserId === runtime.identity?.userId) return;
    queueSnapshot(snapshot);
  });

  function hashText(value) {
    const text = String(value ?? '');
    let hash = 0;
    for (let index = 0; index < text.length; index += 1) {
      hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
    }
    return hash;
  }

  function worldFingerprint() {
    let hash = (items.length * 131 + walls.length * 977) | 0;
    for (const item of items) {
      hash = Math.imul(hash ^ hashText(item.id ?? item.type), 16777619);
      hash ^= Math.round((item.x || 0) / 5) * 31;
      hash ^= Math.round((item.y || 0) / 5) * 131;
      hash ^= item.ignited ? 0x45d9f3b : 0;
      hash ^= Math.round((item.timer || 0) * 2);
    }
    for (const wall of walls) {
      hash = Math.imul(hash ^ hashText(wall.team), 16777619);
      hash ^= Math.round(wall.x || 0) * 17;
      hash ^= Math.round(wall.y || 0) * 37;
      hash ^= Math.round(wall.w || 0) * 67;
      hash ^= Math.round(wall.h || 0) * 97;
    }
    return hash | 0;
  }

  function sendSnapshotIfDue() {
    if (!runtime.active || !runtime.started || !runtime.isHost || state.paused) return;
    if (document.visibilityState !== 'visible') return;
    if (simTime < runtime.nextSnapshotAt) return;

    const transport = transportProfile();
    runtime.nextSnapshotAt = simTime + transport.snapshotIntervalMs / 1000;
    multiplayerAdapter.sendSnapshot(buildMotionSnapshot());

    let worldChanged = false;
    let currentFingerprint = runtime.lastWorldSignature;
    if (simTime >= runtime.nextWorldCheckAt) {
      runtime.nextWorldCheckAt = simTime + 0.45;
      currentFingerprint = worldFingerprint();
      worldChanged = currentFingerprint !== runtime.lastWorldSignature;
    }

    if (worldChanged || simTime >= runtime.nextWorldSnapshotAt || runtime.lastWorldSignature === '') {
      runtime.lastWorldSignature = currentFingerprint === '' ? worldFingerprint() : currentFingerprint;
      runtime.nextWorldSnapshotAt = simTime + transport.worldIntervalMs / 1000;
      multiplayerAdapter.sendSnapshot(buildWorldSnapshot());
    }
  }

  function statsFor(actor) {
    const slotId = actor?.multiplayerSlotId;
    if (!slotId) return null;
    if (!runtime.statsBySlot[slotId]) runtime.statsBySlot[slotId] = EMPTY_STATS();
    return runtime.statsBySlot[slotId];
  }

  function addStat(actor, key, amount = 1) {
    if (!runtime.active || !runtime.isHost) return;
    const stats = statsFor(actor);
    if (!stats || !(key in stats)) return;
    stats[key] += amount;
  }

  globalThis.getMultiplayerLocalStats = () => {
    const stats = runtime.statsBySlot[runtime.assignment?.slotId];
    return stats ? { ...stats } : null;
  };

  const pickupBase = pickup;
  pickup = function multiplayerPickup(actor, item) {
    const useful = actor?.multiplayerSlotId && item?.type === 'letter' && getMissingLetters(actor.team).includes(item.char);
    const type = item?.type;
    const armed = type === 'bomb' && item.ignited;
    const result = pickupBase(actor, item);
    if (result && actor?.multiplayerSlotId) {
      if (type === 'letter' && useful) addStat(actor, 'usefulLettersPicked');
      if (type === 'intel') addStat(actor, 'cluesCollected');
      if (type === 'wall') addStat(actor, 'bricksPicked');
      if (type === 'bomb' && !armed) addStat(actor, 'bombsPicked');
      if (type === 'bomb' && armed) addStat(actor, 'bombsDefused');
      if (['speed', 'health', 'gun', 'golden'].includes(type)) addStat(actor, 'powerupsPicked');
    }
    return result;
  };

  const depositBase = deposit;
  deposit = function multiplayerDeposit(actor) {
    const carried = actor?.inv?.type === 'letter' ? actor.inv.char : null;
    const slot = carried ? slotFromHorizontalPosition(actor, actor.team) : null;
    const correct = Boolean(slot && getTeamWord(actor.team)[slot.index] === carried);
    const result = depositBase(actor);
    if (result && actor?.multiplayerSlotId) {
      addStat(actor, 'lettersPlaced');
      if (correct) addStat(actor, 'correctLettersPlaced');
    }
    return result;
  };

  const repairBase = repair;
  repair = function multiplayerRepair(actor) {
    const result = repairBase(actor);
    if (result && actor?.multiplayerSlotId) {
      addStat(actor, 'wallsBuilt');
      if (simTime > 24) addStat(actor, 'rebuiltWalls');
    }
    return result;
  };

  const stealBase = takeEnemySlottedLetter;
  takeEnemySlottedLetter = function multiplayerSteal(actor, requestedIndex = null) {
    const result = stealBase(actor, requestedIndex);
    if (result && actor?.multiplayerSlotId) addStat(actor, 'stolenLetters');
    return result;
  };

  const deliverStolenBase = dropStolenLetter;
  dropStolenLetter = function multiplayerDeliverStolen(actor) {
    const wasStolen = Boolean(actor?.inv?.stolen);
    const result = deliverStolenBase(actor);
    if (result && wasStolen && actor?.multiplayerSlotId) {
      addStat(actor, 'stolenDelivered');
    }
    return result;
  };

  const armOrDropBase = armOrDrop;
  armOrDrop = function multiplayerArmOrDrop(actor) {
    const carriedBomb = Boolean(actor?.inv?.type === 'bomb' && !actor.inv.ignited);
    const armedBefore = carriedBomb
      ? items.filter(item => item.type === 'bomb' && item.ignited && item.droppedBy === actor).length
      : 0;
    const result = armOrDropBase(actor);
    if (carriedBomb && actor?.multiplayerSlotId) {
      const armedAfter = items.filter(
        item => item.type === 'bomb' && item.ignited && item.droppedBy === actor
      ).length;
      if (armedAfter > armedBefore) addStat(actor, 'bombsPlanted');
    }
    return result;
  };

  const interceptBase = performDefenderIntercept;
  performDefenderIntercept = function multiplayerIntercept(defender, intruder) {
    const carriedStolen = Boolean(intruder?.inv?.stolen);
    const result = interceptBase(defender, intruder);
    if (result && defender?.multiplayerSlotId) {
      addStat(defender, 'blocks');
      if (carriedStolen && !intruder?.inv?.stolen) addStat(defender, 'forcedDrops');
    }
    return result;
  };

  const explodeBase = explode;
  explode = function multiplayerExplosion(bomb) {
    const owner = bomb?.droppedBy || bomb?.owner || null;
    const enemyTeam = owner?.team ? otherTeam(owner.team) : null;
    const wallsBefore = owner?.multiplayerSlotId && enemyTeam
      ? walls.filter(wall => wall.team === enemyTeam).length
      : 0;
    const lettersBefore = owner?.multiplayerSlotId && enemyTeam
      ? getProgress(enemyTeam).filter(Boolean).length
      : 0;
    const result = explodeBase(bomb);
    if (owner?.multiplayerSlotId && enemyTeam) {
      const wallsAfter = walls.filter(wall => wall.team === enemyTeam).length;
      const lettersAfter = getProgress(enemyTeam).filter(Boolean).length;
      addStat(owner, 'wallsDestroyed', Math.max(0, wallsBefore - wallsAfter));
      addStat(owner, 'lettersScattered', Math.max(0, lettersBefore - lettersAfter));
    }
    return result;
  };

  const damageRaiderBase = damageRaider;
  damageRaider = function multiplayerDamageRaider(raider, damage, killer) {
    const before = Math.max(0, raider?.health || 0);
    const carrying = Boolean(raider?.inv?.stolen);
    const result = damageRaiderBase(raider, damage, killer);
    if (killer?.multiplayerSlotId && before > 0) {
      addStat(killer, 'shotsHit');
      addStat(killer, 'damageDealt', Math.min(before, Math.max(0, Math.round(damage || 0))));
      if (raider?.health <= 0) {
        addStat(killer, 'eliminations');
        if (carrying) addStat(killer, 'carrierStops');
      }
    }
    return result;
  };

  function localSentryFireRequested(actor) {
    return Boolean(
      actor &&
      typeof isInnerSentry === 'function' &&
      isInnerSentry(actor) &&
      globalThis.isInnerSentryFireHeld?.()
    );
  }

  function markPredictedBullet(actionSequence, startIndex = 0) {
    if (typeof bullets === 'undefined' || bullets.length <= startIndex) return null;
    const bullet = bullets[bullets.length - 1];
    bullet.__predictedActionSequence = actionSequence || 0;
    bullet.__predictedLocal = true;
    if (!bullet.__multiplayerBulletId) {
      bullet.__multiplayerBulletId = `pred-${runtime.identity?.userId || 'local'}-${actionSequence || Date.now()}`;
    }
    return bullet;
  }

  function predictLocalSentryShot(actionSequence = 0) {
    if (!player || !localSentryFireRequested(player)) return false;
    const nearbyDutyBomb = typeof nearestDutyBomb === 'function'
      ? nearestDutyBomb(
          player,
          player.r + CONFIG.ITEM_RADIUS_OTHER + CONFIG.PICKUP_RANGE_PAD + 8
        )
      : null;
    if (nearbyDutyBomb) return false;
    const target = typeof directionalDefenderTarget === 'function'
      ? directionalDefenderTarget(player)
      : null;
    if (!target) return false;
    const before = typeof bullets !== 'undefined' ? bullets.length : 0;
    const fired = shootDefender(player, false, target);
    if (fired) markPredictedBullet(actionSequence, before);
    return fired;
  }

  function sendImmediatePlayerAction(actor, actionSequence, actionKind) {
    multiplayerAdapter.sendAction({
      type: 'player-action',
      actionKind,
      actionSequence,
      inputSequence: runtime.inputSequence,
      slotId: runtime.assignment?.slotId || actor?.multiplayerSlotId || '',
      x: actor?.x || 0,
      y: actor?.y || 0,
      facingX: actor?.facingX || 0,
      facingY: actor?.facingY || 0,
      sentAt: Date.now(),
    });
  }

  const actionBase = action;
  action = function multiplayerAction(actor) {
    if (runtime.active && runtime.started && actor === player) {
      const actionSequence = ++runtime.actionSequence;
      const fireAction = localSentryFireRequested(actor);
      runtime.lastSentInput = null;
      sendLocalInput(performance.now());

      if (!runtime.isHost) {
        // Discrete actions bypass the regular input cadence. They are sent as a
        // tiny reliable event and predicted immediately on the local device.
        sendImmediatePlayerAction(actor, actionSequence, fireAction ? 'fire' : 'interact');

        if (fireAction) {
          return predictLocalSentryShot(actionSequence);
        }

        // Pickups, drops, deposits and builds are safe to predict visually.
        // The host remains authoritative and confirms or corrects them with an
        // immediate world snapshot.
        runtime.localActionPredictionDeadline = performance.now() + 900;
        return actionBase(actor);
      }
    }
    return actionBase(actor);
  };

  function predictLocalHeldFire(dt) {
    if (!player || runtime.isHost) return;
    player.shootCooldown = Math.max(0, (player.shootCooldown || 0) - Math.max(0, dt || 0));
    if (!localSentryFireRequested(player) || player.shootCooldown > 0) return;
    predictLocalSentryShot(0);
  }

  function predictLocalMovement(dt) {
    if (!player || state.over || state.paused || player.alive === false) return;
    
    // EXTRAPOLATION ORIGIN FIX: Update previous coordinates so the client renderer 
    // does not stretch and "ghost" the player sprite over huge distances.
    player.prevX = player.x;
    player.prevY = player.y;

    const raw = currentRawInput();
    let x = raw.x;
    let y = raw.y;
    let length = Math.hypot(x, y);
    if (length > 1) {
      x /= length;
      y /= length;
      length = 1;
    }

    const rate = length
      ? (CONFIG.MOBILE_INPUT_SMOOTH_RATE || CONFIG.PLAYER_INPUT_SMOOTH_RATE)
      : (CONFIG.MOBILE_RELEASE_SMOOTH_RATE || CONFIG.PLAYER_RELEASE_SMOOTH_RATE);
    const blend = 1 - Math.exp(-rate * dt);
    player.inputX += (x - player.inputX) * blend;
    player.inputY += (y - player.inputY) * blend;

    const smoothLength = Math.hypot(player.inputX, player.inputY);
    if (smoothLength > 0.05) {
      const facingBlend = 1 - Math.exp(-12 * dt);
      const faceX = player.inputX / smoothLength;
      const faceY = player.inputY / smoothLength;
      player.facingX += (faceX - player.facingX) * facingBlend;
      player.facingY += (faceY - player.facingY) * facingBlend;
    }
    
    // driveActor already performs velocity integration and collision-safe movement.
    driveActor(player, player.inputX, player.inputY, dt, false);

    // Reconcile toward the host with a short exponential correction. Unlike the
    // old fixed 0.025 blend, this converges quickly without delaying local input.
    const correctionX = Number.isFinite(player.netCorrectionX) ? player.netCorrectionX : 0;
    const correctionY = Number.isFinite(player.netCorrectionY) ? player.netCorrectionY : 0;
    const correctionDistance = Math.hypot(correctionX, correctionY);
    if (correctionDistance > 0.02) {
      const moving = Math.hypot(x, y) > 0.05;
      const correctionRate = moving ? 2.4 : 8.5;
      const correctionBlend = 1 - Math.exp(-correctionRate * Math.min(dt, 0.05));
      let appliedX = correctionX * correctionBlend;
      let appliedY = correctionY * correctionBlend;
      const appliedLength = Math.hypot(appliedX, appliedY);
      const maxCorrectionPerTick = moving ? 2.6 : 4.8;
      if (appliedLength > maxCorrectionPerTick) {
        appliedX = appliedX / appliedLength * maxCorrectionPerTick;
        appliedY = appliedY / appliedLength * maxCorrectionPerTick;
      }
      player.x += appliedX;
      player.y += appliedY;
      player.netCorrectionX = correctionX - appliedX;
      player.netCorrectionY = correctionY - appliedY;
    }

    player.x = Math.max(player.r, Math.min(CONFIG.W - player.r, player.x));
    player.y = Math.max(player.r, Math.min(CONFIG.H - player.r, player.y));
  }

  const tickBase = tick;
  tick = function multiplayerTick(dt) {
    if (!runtime.active || !runtime.started) return tickBase(dt);
    
    // Apply at most the newest world and motion packet. Stale movement is
    // deliberately dropped so a temporary mobile frame stall cannot create lag.
    let appliedWorldSimTime = -Infinity;
    if (runtime.pendingWorldSnapshot) {
      const snapshot = runtime.pendingWorldSnapshot;
      runtime.pendingWorldSnapshot = null;
      appliedWorldSimTime = Number(snapshot.simTime) || -Infinity;
      applySnapshot(snapshot);
    }
    if (runtime.pendingMotionSnapshot) {
      const snapshot = runtime.pendingMotionSnapshot;
      runtime.pendingMotionSnapshot = null;
      // A world packet already carries actor motion. Skip a same-frame motion
      // packet unless it is meaningfully newer, avoiding a periodic mobile hitch.
      if ((Number(snapshot.simTime) || 0) > appliedWorldSimTime + 0.012) {
        applySnapshot(snapshot);
      }
    }
    
    if (!runtime.isHost) {
      if (!runtime.hasAuthoritativeSnapshot) {
        const result = tickBase(dt);
        globalThis.updateMobileControlsState?.(dt);
        return result;
      }

      predictLocalMovement(dt);
      predictLocalHeldFire(dt);
      updateReplicaVisuals(dt);

      globalThis.updateMobileControlsState?.(dt);
      return;
    }

    for (const actor of ACTORS || []) {
      if (actor === player || actor.multiplayerBot) continue;
      if (actor.multiplayerHuman) driveRemoteHuman(actor, dt);
    }
    const result = tickBase(dt);
    sendSnapshotIfDue();
    return result;
  };

  function scheduleNextRound() {
    clearTimeout(runtime.roundAdvanceTimer);
    if (!runtime.isHost || state.demoMatch?.finished) return;
    runtime.roundAdvanceTimer = setTimeout(() => {
      if (!runtime.active || !runtime.isHost || !state.over) return;
      const nextIndex = (state.demoMatch?.roundIndex || 0) + 1;
      startDemoRound(nextIndex, { changeRole: false, multiplayerAuto: true });
    }, 3600);
  }

  const startDemoRoundBase = startDemoRound;
  startDemoRound = function multiplayerStartDemoRound(index = 0, options = {}) {
    const multiplayerOptions = runtime.active
      ? { ...options, changeRole: false }
      : options;
    const result = startDemoRoundBase(index, multiplayerOptions);
    if (runtime.active) {
      for (const slot of globalThis.MULTIPLAYER_SLOT_LAYOUT || []) {
        runtime.statsBySlot[slot.id] = EMPTY_STATS();
      }
      if (resultButtonEl) {
        resultButtonEl.disabled = true;
        resultButtonEl.textContent = 'NEXT ROUND STARTING…';
      }
      if (runtime.isHost && runtime.started) {
        multiplayerAdapter.sendEvent({ type: 'round-start', index });
        runtime.nextSnapshotAt = simTime;
        runtime.nextWorldSnapshotAt = simTime;
        sendSnapshotIfDue();
      }
    }
    return result;
  };

  const finishDemoRoundBase = finishDemoRound;
  finishDemoRound = function multiplayerFinishDemoRound(winnerTeam, reason = '') {
    const wasResolving = Boolean(state.demoMatch?.resolving || state.demoMatch?.finished);
    const result = finishDemoRoundBase(winnerTeam, reason);
    if (runtime.active && !wasResolving) {
      if (resultButtonEl) {
        resultButtonEl.disabled = !state.demoMatch?.finished;
        resultButtonEl.textContent = state.demoMatch?.finished
          ? 'RETURN TO MENU'
          : 'NEXT ROUND STARTING…';
      }
      nextRolePreviewEl?.classList.add('hidden');
      if (runtime.isHost) {
        runtime.nextSnapshotAt = simTime;
        runtime.nextWorldSnapshotAt = simTime;
        sendSnapshotIfDue();
        multiplayerAdapter.sendEvent({
          type: 'round-finished',
          winnerTeam,
          reason,
          roundIndex: state.demoMatch?.roundIndex || 0,
          statsBySlot: runtime.statsBySlot,
        });
        if (state.demoMatch?.finished) {
          setTimeout(() => multiplayerAdapter.finish(), 600);
        } else {
          scheduleNextRound();
        }
      }
    }
    return result;
  };

  function applyAuthoritativeShotEvent(event) {
    if (!event?.bullet || typeof bullets === 'undefined') return;
    const actorsBySlot = new Map((ACTORS || []).map(actor => [actor.multiplayerSlotId, actor]));
    const data = event.bullet;
    let bullet = null;

    if (event.originUserId === runtime.identity?.userId && event.actionSequence) {
      bullet = bullets.find(candidate =>
        candidate.__predictedActionSequence === event.actionSequence
      ) || null;
    }
    if (!bullet && data.id) {
      bullet = bullets.find(candidate => candidate.__multiplayerBulletId === data.id) || null;
    }
    if (!bullet) {
      bullet = {
        ...data,
        prevX: data.x,
        prevY: data.y,
      };
      bullets.push(bullet);
    }

    Object.assign(bullet, data);
    bullet.__multiplayerBulletId = data.id || bullet.__multiplayerBulletId;
    bullet.__predictedLocal = false;
    delete bullet.__predictedActionSequence;
    bullet.owner = data.ownerSlotId ? actorsBySlot.get(data.ownerSlotId) || null : null;
    delete bullet.id;
    delete bullet.ownerSlotId;
  }

  function processRemotePlayerAction(event, envelope) {
    if (!runtime.isHost || event.type !== 'player-action') return false;
    const senderUserId = envelope.senderUserId;
    const roomEntry = runtime.room?.players?.find(entry => entry.userId === senderUserId);
    if (!roomEntry || roomEntry.slotId !== event.slotId) return true;
    const actor = actorForSlot(roomEntry.slotId);
    if (!actor || actor.alive === false) return true;

    const actionSequence = Number(event.actionSequence) || 0;
    const previousSequence = Math.max(
      Number(actor.multiplayerActionSequence) || 0,
      Number(runtime.hostActionSequenceBySlot.get(roomEntry.slotId)) || 0
    );
    if (!actionSequence || actionSequence <= previousSequence) return true;

    runtime.hostActionSequenceBySlot.set(roomEntry.slotId, actionSequence);
    actor.multiplayerActionSequence = actionSequence;
    actor.multiplayerProcessedInputSequence = Math.max(
      actor.multiplayerProcessedInputSequence || 0,
      Number(event.inputSequence) || 0
    );
    if (Number.isFinite(event.facingX)) actor.facingX = event.facingX;
    if (Number.isFinite(event.facingY)) actor.facingY = event.facingY;

    const cachedInput = runtime.remoteInputs.get(roomEntry.slotId);
    if (cachedInput) {
      cachedInput.actionSequence = Math.max(
        Number(cachedInput.actionSequence) || 0,
        actionSequence
      );
    }

    let success = false;
    if (event.actionKind === 'fire') {
      const before = typeof bullets !== 'undefined' ? bullets.length : 0;
      success = Boolean(runAtReportedActionPose(actor, event, () => {
        const target = typeof directionalDefenderTarget === 'function'
          ? directionalDefenderTarget(actor)
          : null;
        return target ? shootDefender(actor, false, target) : false;
      }));
      if (success && bullets.length > before) {
        const bullet = bullets[bullets.length - 1];
        multiplayerAdapter.sendEvent({
          type: 'authoritative-shot',
          originUserId: senderUserId,
          slotId: roomEntry.slotId,
          actionSequence,
          bullet: serializeBullet(bullet),
          sentAt: Date.now(),
        });
      }
      multiplayerAdapter.sendSnapshot(buildMotionSnapshot());
      runtime.nextSnapshotAt = simTime + transportProfile().snapshotIntervalMs / 1000;
    } else {
      const beforeToken = `${actor.inv?.type || ''}:${actor.inv?.char || ''}:${items.length}:${walls.length}:${state.blue.join('')}:${state.red.join('')}`;
      runAtReportedActionPose(actor, event, () => action(actor));
      const afterToken = `${actor.inv?.type || ''}:${actor.inv?.char || ''}:${items.length}:${walls.length}:${state.blue.join('')}:${state.red.join('')}`;
      success = beforeToken !== afterToken;
      runtime.lastWorldSignature = worldFingerprint();
      runtime.nextWorldSnapshotAt = simTime + transportProfile().worldIntervalMs / 1000;
      multiplayerAdapter.sendSnapshot(buildWorldSnapshot());
    }

    multiplayerAdapter.sendEvent({
      type: 'action-ack',
      originUserId: senderUserId,
      slotId: roomEntry.slotId,
      actionSequence,
      success,
      actionKind: event.actionKind,
      clientSentAt: event.sentAt || 0,
      hostSentAt: Date.now(),
    });
    return true;
  }

  multiplayerAdapter.onEvent((event, envelope) => {
    if (!runtime.active || !event) return;
    if (envelope.senderUserId === runtime.identity?.userId) return;

    if (processRemotePlayerAction(event, envelope)) return;

    if (event.type === 'authoritative-shot' && !runtime.isHost) {
      applyAuthoritativeShotEvent(event);
      return;
    }

    if (event.type === 'action-ack' && event.originUserId === runtime.identity?.userId) {
      if (globalThis.__wordWarsNetDebug && event.clientSentAt) {
        globalThis.__wordWarsNetDebug.actionLatencyMs = Math.max(0, Date.now() - event.clientSentAt);
      }
      return;
    }

    if (event.type === 'round-finished' && !runtime.isHost) {
      if (event.statsBySlot && typeof event.statsBySlot === 'object') {
        runtime.statsBySlot = event.statsBySlot;
      }
      finishDemoRound(event.winnerTeam || null, event.reason || 'Round complete.');
    } else if (event.type === 'round-start' && !runtime.isHost) {
      startDemoRound(event.index || 0, { changeRole: false, multiplayerRemote: true });
    }
  });

  globalThis.endMultiplayerRuntime = function endMultiplayerRuntime({ disconnect = true } = {}) {
    clearTimeout(runtime.roundAdvanceTimer);
    stopLobbyClock();
    runtime.active = false;
    runtime.started = false;
    runtime.room = null;
    runtime.identity = null;
    runtime.assignment = null;
    runtime.isHost = false;
    runtime.remoteInputs.clear();
    runtime.actionSequence = 0;
    runtime.inputSequence = 0;
    runtime.latestAcknowledgedActionSequence = 0;
    runtime.localActionPredictionDeadline = 0;
    runtime.hostActionSequenceBySlot.clear();
    runtime.pendingMotionSnapshot = null;
    runtime.pendingWorldSnapshot = null;
    runtime.localInputHistory.length = 0;
    runtime.latestAcknowledgedInputSequence = 0;
    runtime.lastStopInputSequence = 0;
    runtime.lastLocalAuthoritativeSimTime = -Infinity;
    runtime.nextBulletId = 1;
    runtime.nextHudRefreshAt = 0;
    runtime.lastSnapshotReceivedAt = 0;
    runtime.smoothedSnapshotGapMs = 100;
    runtime.hasAuthoritativeSnapshot = false;
    runtime.hasFullWorldSnapshot = false;
    runtime.lastFullStateRequestAt = 0;
    runtime.lastForcedSnapshotAt = 0;
    runtime.statsBySlot = Object.create(null);
    globalThis.multiplayerRoomState = null;
    globalThis.multiplayerIdentity = null;
    multiplayerPresenceEl?.classList.add('hidden');
    if (disconnect) multiplayerAdapter.disconnect();
  };

  const multiplayerLabelWidthCache = new Map();

  function compactUsername(value, limit = 18) {
    const name = displayUsername(value);
    return name.length > limit ? `${name.slice(0, limit - 1)}…` : name;
  }

  function drawMultiplayerHumanLabels(alpha = 1) {
    if (!runtime.active || !runtime.started || !ACTORS) return;

    for (const actor of ACTORS) {
      if (!actor.multiplayerHuman || actor.alive === false) continue;
      if (typeof actorVisibleToPlayer === 'function' && !actorVisibleToPlayer(actor)) continue;

      const x = actor.prevX + (actor.x - actor.prevX) * alpha;
      const y = actor.prevY + (actor.y - actor.prevY) * alpha;
      const local = actor === player;
      const connected = actor.multiplayerConnected !== false;
      const username = compactUsername(actor.multiplayerUsername);
      const label = local
        ? `YOU · ${username}`
        : `${username}${connected ? '' : ' · BOT'}`;

      ctx.save();
      
      // DIAGNOSTIC VISUALIZATION:
      // If enabled, draw a tiny green dot where the host authoritatively predicts the player is.
      // This visualizes the physical drag difference between network target and local prediction.
      if (globalThis.__debugMultiplayer === true && Number.isFinite(actor.netTargetX)) {
        ctx.fillStyle = 'rgba(0, 255, 0, 0.7)';
        ctx.beginPath();
        ctx.arc(actor.netTargetX, actor.netTargetY, 4, 0, Math.PI * 2);
        ctx.fill();
      }

      if (!local && connected) {
        ctx.beginPath();
        ctx.arc(x, y, actor.r + 5, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,.78)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      ctx.font = '800 8px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      let width = multiplayerLabelWidthCache.get(label);
      if (!width) {
        width = Math.ceil(ctx.measureText(label).width) + 10;
        multiplayerLabelWidthCache.set(label, width);
        if (multiplayerLabelWidthCache.size > 40) {
          multiplayerLabelWidthCache.delete(multiplayerLabelWidthCache.keys().next().value);
        }
      }
      const labelY = actor.inv ? y - 55 : y - actor.r - 18;
      ctx.fillStyle = connected ? 'rgba(18,22,27,.88)' : 'rgba(45,46,48,.82)';
      ctx.fillRect(x - width / 2, labelY - 7, width, 14);
      ctx.strokeStyle = local
        ? '#f1ca5c'
        : actor.team === 'red'
          ? '#ff8585'
          : '#84baff';
      ctx.lineWidth = 1;
      ctx.strokeRect(x - width / 2, labelY - 7, width, 14);
      ctx.fillStyle = connected ? '#fff' : '#c4c7ca';
      ctx.fillText(label, x, labelY + .5);
      ctx.restore();
    }
  }

  const multiplayerDrawActorsBase = drawActors;
  drawActors = function multiplayerHumanDrawActors(alpha = 1) {
    multiplayerDrawActorsBase(alpha);
    drawMultiplayerHumanLabels(alpha);
  };

  globalThis.beginMultiplayerRuntime = function beginMultiplayerRuntime(room, identity, assignment) {
    runtime.active = true;
    runtime.started = true;
    runtime.room = room;
    runtime.identity = identity;
    runtime.assignment = assignment;
    runtime.isHost = room.hostUserId === identity.userId;
    runtime.remoteInputs.clear();
    runtime.actionSequence = 0;
    runtime.inputSequence = 0;
    runtime.latestAcknowledgedActionSequence = 0;
    runtime.localActionPredictionDeadline = 0;
    runtime.hostActionSequenceBySlot.clear();
    runtime.motionSequence = 0;
    runtime.worldSequence = 0;
    runtime.lastMotionSequence = -1;
    runtime.lastWorldSequence = -1;
    runtime.localInputHistory.length = 0;
    runtime.latestAcknowledgedInputSequence = 0;
    runtime.lastStopInputSequence = 0;
    runtime.lastLocalAuthoritativeSimTime = -Infinity;
    runtime.nextBulletId = 1;
    runtime.nextHudRefreshAt = 0;
    runtime.lastSnapshotReceivedAt = 0;
    runtime.smoothedSnapshotGapMs = transportProfile().snapshotIntervalMs;
    runtime.hasAuthoritativeSnapshot = runtime.isHost;
    runtime.hasFullWorldSnapshot = runtime.isHost;
    runtime.lastFullStateRequestAt = 0;
    runtime.lastForcedSnapshotAt = 0;
    runtime.nextSnapshotAt = simTime;
    runtime.nextWorldSnapshotAt = simTime;
    runtime.nextWorldCheckAt = simTime;
    runtime.lastWorldSignature = '';
    runtime.statsBySlot = Object.create(null);
    for (const slot of globalThis.MULTIPLAYER_SLOT_LAYOUT || []) {
      runtime.statsBySlot[slot.id] = EMPTY_STATS();
    }
    lobbyScreen?.classList.add('hidden');
    refreshActorPresence();
    refreshMultiplayerPresenceHud();
    globalThis.updateMobileControlsState?.(0);
    globalThis.refreshMobileLayout?.();
    draw?.(1);

    if (!runtime.isHost) {
      const bufferedWorld = runtime.pendingWorldSnapshot;
      const bufferedMotion = runtime.pendingMotionSnapshot;
      runtime.pendingWorldSnapshot = null;
      runtime.pendingMotionSnapshot = null;
      if (bufferedWorld) queueMicrotask(() => queueSnapshot(bufferedWorld));
      if (bufferedMotion) queueMicrotask(() => queueSnapshot(bufferedMotion));
    }

    runtime.lastSentInput = null;
    runtime.lastInputSentAt = -Infinity;
    sendLocalInput(performance.now());

    msg(runtime.isHost
      ? 'You are hosting. Empty and disconnected roles are controlled by bots.'
      : `Connected to ${displayUsername(room.players.find(entry => entry.userId === room.hostUserId)?.username, 'host')}.`);
  };
})();