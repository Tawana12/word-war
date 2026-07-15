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
    lastSentInput: null,
    lastInputSentAt: 0,
    nextSnapshotAt: 0,
    snapshotSequence: 0,
    lastSnapshotSequence: -1,
    roundAdvanceTimer: null,
    lobbyTimer: null,
    statsBySlot: Object.create(null),
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

  function refreshMultiplayerPresenceHud() {
    if (!multiplayerPresenceEl) return;
    if (!runtime.active || !runtime.started || !runtime.room) {
      multiplayerPresenceEl.classList.add('hidden');
      return;
    }

    const humans = connectedHumanCount(runtime.room);
    const bots = Math.max(0, 10 - humans);
    multiplayerPresenceEl.textContent =
      `${humans} PLAYER${humans === 1 ? '' : 'S'} · ${bots} BOT${bots === 1 ? '' : 'S'}`;
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
        ? `${teamLabel(assignment.team)} · u/${runtime.identity?.username || assignment.username}`
        : 'Waiting for role';
      teamEl.className = assignment?.team === 'red' ? 'team-red' : 'team-blue';
    }

    const humans = connectedHumanCount(room);
    const bots = Math.max(0, 10 - humans);
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
        identity.textContent = `${local ? 'YOU · ' : ''}u/${entry.username}`;

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
    runtime.statsBySlot = Object.create(null);
    lobbyScreen?.classList.remove('hidden');
    lobbyMessage('Connecting to the Reddit lobby…');
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
      if (!wasHost && runtime.isHost) {
        msg('Host changed. You are keeping the match running.');
        runtime.nextSnapshotAt = simTime;
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

  function inputPayload() {
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
      sentAt: Date.now(),
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
      next.actionSequence !== previous.actionSequence
    );
  }

  function sendLocalInput(now = performance.now()) {
    if (!runtime.active || !runtime.started || runtime.isHost || !player) return;
    const next = inputPayload();
    const previous = runtime.lastSentInput;
    const actionEdge = !previous ||
      next.actionSequence !== previous.actionSequence ||
      next.actionHeld !== previous.actionHeld;
    const elapsed = now - runtime.lastInputSentAt;
    const keepAliveDue = elapsed > 240;

    // Inputs travel through a short authenticated endpoint before Realtime.
    // Limit movement packets to about 14 Hz, while actions still transmit
    // immediately so shooting and pickups remain responsive.
    if (!actionEdge && elapsed < 70) return;
    if (!actionEdge && !keepAliveDue && !inputChanged(next, previous)) return;

    runtime.lastSentInput = next;
    runtime.lastInputSentAt = now;
    multiplayerAdapter.sendInput(next);
  }

  function inputAnimationFrame(now) {
    sendLocalInput(now);
    requestAnimationFrame(inputAnimationFrame);
  }
  requestAnimationFrame(inputAnimationFrame);

  multiplayerAdapter.onInput((payload, envelope) => {
    if (!runtime.isHost || !runtime.started || !payload || payload.type !== 'player-input') return;
    const sender = envelope.senderUserId;
    if (!sender || sender === runtime.identity?.userId) return;
    const roomPlayer = runtime.room?.players?.find(entry => entry.userId === sender);
    if (!roomPlayer || roomPlayer.slotId !== payload.slotId) return;
    runtime.remoteInputs.set(roomPlayer.slotId, {
      ...payload,
      receivedAt: performance.now(),
      userId: sender,
    });
  });

  function actorForSlot(slotId) {
    return (ACTORS || []).find(actor => actor.multiplayerSlotId === slotId) || null;
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

    const previousSequence = actor.multiplayerActionSequence || 0;
    const pressed = input.actionSequence > previousSequence;
    actor.multiplayerActionSequence = Math.max(previousSequence, input.actionSequence || 0);

    if (isInnerSentry(actor) && input.actionHeld) {
      const target = typeof directionalDefenderTarget === 'function'
        ? directionalDefenderTarget(actor)
        : null;
      if (target) shootDefender(actor, false, target);
    } else if (pressed) {
      action(actor);
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

  function serializeActor(actor) {
    const fields = [
      'x', 'y', 'vx', 'vy', 'team', 'role', 'publicRole', 'guardianDuty',
      'maxSpeed', 'r', 'inputX', 'inputY', 'facingX', 'facingY', 'boost',
      'stunTimer', 'alive', 'maxHealth', 'health', 'lives', 'respawnTimer',
      'damageFlash', 'shootCooldown', 'weaponTier', 'gunAmmo', 'interceptFlash',
      'coverTreeId', 'mode', 'multiplayerSlotId', 'multiplayerUserId',
      'multiplayerUsername', 'multiplayerHuman', 'multiplayerConnected',
      'multiplayerBot', 'multiplayerActionSequence'
    ];
    const data = {};
    for (const field of fields) {
      const value = actor[field];
      if (value !== undefined && (value === null || ['string', 'number', 'boolean'].includes(typeof value))) {
        data[field] = value;
      }
    }
    data.inv = serializeInventory(actor.inv);
    return data;
  }

  function serializeItem(item) {
    const data = primitiveCopy(item, new Set(['owner', 'droppedBy', 'hiddenByTree']));
    if (item.owner?.multiplayerSlotId) data.ownerSlotId = item.owner.multiplayerSlotId;
    if (item.droppedBy?.multiplayerSlotId) data.droppedBySlotId = item.droppedBy.multiplayerSlotId;
    if (item.hiddenByTree?.id != null) data.hiddenByTreeId = item.hiddenByTree.id;
    return data;
  }

  function serializeBullet(bullet) {
    const data = primitiveCopy(bullet, new Set(['owner']));
    if (bullet.owner?.multiplayerSlotId) data.ownerSlotId = bullet.owner.multiplayerSlotId;
    return data;
  }

  function buildSnapshot() {
    return {
      type: 'game-snapshot',
      sequence: ++runtime.snapshotSequence,
      roundIndex: state.demoMatch?.roundIndex || 0,
      simTime,
      blueWord: CONFIG.BLUE_WORD,
      redWord: CONFIG.RED_WORD,
      state: {
        blue: [...state.blue],
        red: [...state.red],
        seconds: state.seconds,
        over: state.over,
        paused: false,
        spawnTimer: state.spawnTimer,
        jammedUntil: { ...state.jammedUntil },
        wordLocks: state.wordLocks ? { ...state.wordLocks } : null,
      },
      demoMatch: state.demoMatch ? {
        roundIndex: state.demoMatch.roundIndex,
        score: { ...state.demoMatch.score },
        resolving: state.demoMatch.resolving,
        finished: state.demoMatch.finished,
      } : null,
      actors: (ACTORS || []).map(serializeActor),
      items: items.map(serializeItem),
      walls: walls.map(wall => primitiveCopy(wall)),
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
      statsBySlot: runtime.statsBySlot,
      hostUserId: runtime.room?.hostUserId || null,
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

  function applySnapshot(snapshot) {
    if (!runtime.active || runtime.isHost || !snapshot || snapshot.type !== 'game-snapshot') return;
    if ((snapshot.sequence ?? 0) <= runtime.lastSnapshotSequence) return;
    runtime.lastSnapshotSequence = snapshot.sequence ?? runtime.lastSnapshotSequence + 1;

    if (CONFIG.BLUE_WORD !== snapshot.blueWord || CONFIG.RED_WORD !== snapshot.redWord) {
      CONFIG.BLUE_WORD = snapshot.blueWord;
      CONFIG.RED_WORD = snapshot.redWord;
      refreshLetterPools();
      if (bsEl) bsEl.textContent = shuffle(CONFIG.BLUE_WORD);
      if (rsEl) rsEl.textContent = shuffle(CONFIG.RED_WORD);
    }

    simTime = Number(snapshot.simTime) || simTime;
    state.blue = [...(snapshot.state?.blue || [])];
    state.red = [...(snapshot.state?.red || [])];
    state.seconds = snapshot.state?.seconds ?? state.seconds;
    state.over = Boolean(snapshot.state?.over);
    state.spawnTimer = snapshot.state?.spawnTimer ?? state.spawnTimer;
    if (snapshot.state?.jammedUntil) state.jammedUntil = { ...snapshot.state.jammedUntil };
    if (snapshot.state?.wordLocks && state.wordLocks) state.wordLocks = { ...snapshot.state.wordLocks };

    if (snapshot.demoMatch && state.demoMatch) {
      state.demoMatch.roundIndex = snapshot.demoMatch.roundIndex;
      state.demoMatch.score = { ...snapshot.demoMatch.score };
      state.demoMatch.resolving = snapshot.demoMatch.resolving;
      state.demoMatch.finished = snapshot.demoMatch.finished;
    }

    const existingBySlot = new Map((ACTORS || []).map(actor => [actor.multiplayerSlotId, actor]));
    const nextActors = [];
    for (const data of snapshot.actors || []) {
      let actor = existingBySlot.get(data.multiplayerSlotId);
      if (!actor) {
        actor = createActor(data.x, data.y, data.team, data.role, data.maxSpeed, false);
      }
      const oldX = actor.x;
      const oldY = actor.y;
      const isLocalActor = data.multiplayerSlotId === runtime.assignment?.slotId;
      const correctionDistance = Math.hypot((data.x || 0) - oldX, (data.y || 0) - oldY);
      Object.assign(actor, data);

      if (isLocalActor && correctionDistance < 95 && !state.over) {
        // Small corrections are blended so mobile movement does not jerk every
        // time an authoritative snapshot arrives. Large errors still snap.
        actor.x = oldX + (data.x - oldX) * 0.34;
        actor.y = oldY + (data.y - oldY) * 0.34;
      }
      actor.prevX = oldX;
      actor.prevY = oldY;
      actor.inv = data.inv ? { ...data.inv } : null;
      actor.isPlayer = isLocalActor;
      nextActors.push(actor);
    }

    ACTORS = nextActors;
    player = nextActors.find(actor => actor.multiplayerSlotId === runtime.assignment?.slotId) || player;
    bots = nextActors.filter(actor => actor.multiplayerBot);
    const actorsBySlot = new Map(nextActors.map(actor => [actor.multiplayerSlotId, actor]));

    items.splice(0, items.length, ...(snapshot.items || []).map(data => restoreItem(data, actorsBySlot)));
    walls.splice(0, walls.length, ...(snapshot.walls || []).map(data => ({ ...data })));
    explosions.splice(0, explosions.length, ...(snapshot.explosions || []).map(data => ({ ...data })));
    slotEffects.splice(0, slotEffects.length, ...(snapshot.slotEffects || []).map(data => ({ ...data })));
    interceptEffects.splice(0, interceptEffects.length, ...(snapshot.interceptEffects || []).map(data => ({ ...data })));
    if (typeof bullets !== 'undefined') {
      bullets.splice(0, bullets.length, ...(snapshot.bullets || []).map(data => {
        const bullet = { ...data };
        bullet.owner = data.ownerSlotId ? actorsBySlot.get(data.ownerSlotId) || null : null;
        delete bullet.ownerSlotId;
        return bullet;
      }));
    }

    if (typeof activeMazeIndex !== 'undefined') activeMazeIndex = snapshot.maze?.activeMazeIndex ?? activeMazeIndex;
    if (typeof pendingMazeIndex !== 'undefined') pendingMazeIndex = snapshot.maze?.pendingMazeIndex ?? pendingMazeIndex;
    if (typeof mazePhase !== 'undefined') mazePhase = snapshot.maze?.mazePhase ?? mazePhase;
    if (typeof mazeTimer !== 'undefined') mazeTimer = snapshot.maze?.mazeTimer ?? mazeTimer;
    if (typeof navigationGridCache !== 'undefined') navigationGridCache.clear();

    runtime.statsBySlot = snapshot.statsBySlot || runtime.statsBySlot;
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

  multiplayerAdapter.onSnapshot((snapshot) => applySnapshot(snapshot));

  function sendSnapshotIfDue() {
    if (!runtime.active || !runtime.started || !runtime.isHost || state.paused) return;
    if (simTime < runtime.nextSnapshotAt) return;
    runtime.nextSnapshotAt = simTime + 0.125;
    multiplayerAdapter.sendSnapshot(buildSnapshot());
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

  // Track role contributions for every human on the authoritative host. The
  // values are still capped and converted to small 1–4 Karma awards server-side.
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

  // Non-host clients send intent instead of mutating their local copy.
  const actionBase = action;
  action = function multiplayerAction(actor) {
    if (runtime.active && runtime.started && actor === player && !runtime.isHost) {
      runtime.actionSequence += 1;
      runtime.lastSentInput = null;
      sendLocalInput(performance.now());
      return;
    }
    return actionBase(actor);
  };

  function predictLocalMovement(dt) {
    if (!player || state.over || state.paused || player.alive === false) return;
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
    driveActor(player, player.inputX, player.inputY, dt, false);
  }

  const tickBase = tick;
  tick = function multiplayerTick(dt) {
    if (!runtime.active || !runtime.started) return tickBase(dt);
    if (!runtime.isHost) {
      // Predict only the local actor between authoritative snapshots. The host
      // still decides collisions, pickups, damage and the final position.
      predictLocalMovement(dt);
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

  multiplayerAdapter.onEvent((event, envelope) => {
    if (!runtime.active || !event || envelope.senderUserId === runtime.identity?.userId) return;
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
    runtime.statsBySlot = Object.create(null);
    globalThis.multiplayerRoomState = null;
    globalThis.multiplayerIdentity = null;
    multiplayerPresenceEl?.classList.add('hidden');
    if (disconnect) multiplayerAdapter.disconnect();
  };


  function compactUsername(value, limit = 18) {
    const name = String(value || 'Redditor');
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
        ? `YOU · u/${username}`
        : `u/${username}${connected ? '' : ' · BOT'}`;

      ctx.save();

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
      const width = Math.ceil(ctx.measureText(label).width) + 10;
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
    runtime.lastSnapshotSequence = -1;
    runtime.nextSnapshotAt = simTime;
    runtime.statsBySlot = Object.create(null);
    for (const slot of globalThis.MULTIPLAYER_SLOT_LAYOUT || []) {
      runtime.statsBySlot[slot.id] = EMPTY_STATS();
    }
    lobbyScreen?.classList.add('hidden');
    refreshActorPresence();
    refreshMultiplayerPresenceHud();
    msg(runtime.isHost
      ? 'You are hosting. Empty and disconnected roles are controlled by bots.'
      : `Connected to u/${room.players.find(entry => entry.userId === room.hostUserId)?.username || 'host'}.`);
  };
})();
