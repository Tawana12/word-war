'use strict';

function getWordWarsNetDebug() {
  if (!globalThis.__wordWarsNetDebug) {
    globalThis.__wordWarsNetDebug = {
      fps: 0,
      inputsSent: 0,
      motionSnapshotsSent: 0,
      worldSnapshotsSent: 0,
      motionSnapshotsReceived: 0,
      worldSnapshotsReceived: 0,
      droppedMotionSnapshots: 0,
      reconnectCount: 0,
      bufferedAmount: 0,
      averagePacketSize: 0,
      averageSnapshotGapMs: 0,
      reconciliationError: 0,
      latencyMs: 80,
      jitterMs: 0,
      actionLatencyMs: 0,
      actionsSent: 0,
      actionsReceived: 0,
      lastPacketSize: 0,
      _packetSamples: 0,
    };
  }
  return globalThis.__wordWarsNetDebug;
}

// Universal bridge. Inside Reddit/Devvit it keeps using the parent iframe
// bridge. On a normal Vercel page it connects directly to the lightweight
// Cloudflare realtime room server.
class MultiplayerAdapter {
  constructor() {
    this.webMode = window.parent === window;
    this.available = true;
    this.connected = false;
    this.connecting = false;
    this.room = null;
    this.identity = null;
    this.assignment = null;

    this.connectionListeners = new Set();
    this.roomListeners = new Set();
    this.snapshotListeners = new Set();
    this.eventListeners = new Set();
    this.inputListeners = new Set();
    this.errorListeners = new Set();

    this.pendingConnect = null;
    this.pendingConnectResolve = null;
    this.pendingConnectReject = null;

    this.socket = null;
    this.manualClose = false;
    this.shouldReconnect = false;
    this.reconnectTimer = null;
    this.reconnectAttempt = 0;
    this.heartbeatTimer = null;
    this.pingSequence = 0;
    this.pendingPings = new Map();
    this.latencyMs = 80;
    this.jitterMs = 0;
    this.pendingLatest = { input: null, motion: null, world: null };
    this.pendingCriticalActions = [];
    this.flushQueued = false;
    this.flushTimer = null;

    this.clientId = this.readOrCreateClientId();
    this.sessionId = this.createSessionId();
    this.nickname = this.readOrCreateNickname();

    if (!this.webMode) {
      this.available = window.parent !== window;
      window.addEventListener('message', (event) => this.handleParentMessage(event));
    }
  }

  isAvailable() {
    return this.available;
  }

  isWebMode() {
    return this.webMode;
  }

  getNickname() {
    return this.nickname;
  }

  setNickname(value) {
    const clean = this.cleanNickname(value);
    if (!clean) return this.nickname;
    this.nickname = clean;
    try {
      localStorage.setItem('wordWarsNickname', clean);
    } catch {
      // Private browsing can disable storage. The current tab still works.
    }
    if (this.webMode && this.socket?.readyState === WebSocket.OPEN) {
      this.sendRaw({ type: 'nickname', nickname: clean });
    }
    return clean;
  }

  async connect() {
    if (!this.available) {
      throw new Error('Multiplayer is unavailable in this browser.');
    }
    if (this.connected && this.room) {
      return {
        room: this.room,
        identity: this.identity,
        assignment: this.assignment,
      };
    }
    if (this.pendingConnect) return this.pendingConnect;

    this.connecting = true;
    this.pendingConnect = new Promise((resolve, reject) => {
      this.pendingConnectResolve = resolve;
      this.pendingConnectReject = reject;
    });

    if (this.webMode) {
      this.shouldReconnect = true;
      this.manualClose = false;
      this.openWebSocket();
    } else {
      this.post('multiplayer-join');
    }
    return this.pendingConnect;
  }

  sendInput(input) {
    if (!this.connected) return;
    if (!this.webMode) {
      this.post('multiplayer-relay', { kind: 'input', payload: input });
      return;
    }
    this.pendingLatest.input = input;
    this.scheduleLatestFlush();
  }

  sendSnapshot(snapshot) {
    if (!this.connected) return;
    if (!this.webMode) {
      this.post('multiplayer-relay', { kind: 'snapshot', payload: snapshot });
      return;
    }

    const isWorld = snapshot?.type === 'world-snapshot' || snapshot?.fullWorld === true;
    if (isWorld) {
      this.pendingLatest.world = snapshot;
    } else {
      if (this.pendingLatest.motion) getWordWarsNetDebug().droppedMotionSnapshots += 1;
      this.pendingLatest.motion = snapshot;
    }
    this.scheduleLatestFlush();
  }

  sendAction(action) {
    if (!this.connected) return;
    if (!this.webMode) {
      this.post('multiplayer-relay', { kind: 'event', payload: action });
      return;
    }

    // Interaction edges must not wait behind a movement snapshot. Send them
    // immediately while the socket is healthy; otherwise preserve them in a
    // small reliable queue and flush before input or snapshots.
    if (
      this.socket?.readyState === WebSocket.OPEN &&
      this.socket.bufferedAmount < 8 * 1024 &&
      this.pendingCriticalActions.length === 0
    ) {
      this.sendRaw({ type: 'relay', kind: 'event', payload: action });
      return;
    }

    this.pendingCriticalActions.push(action);
    if (this.pendingCriticalActions.length > 32) {
      // Button presses are rare. This cap only protects against a broken UI
      // repeatedly firing events while disconnected.
      this.pendingCriticalActions.splice(0, this.pendingCriticalActions.length - 32);
    }
    this.scheduleLatestFlush();
  }

  sendEvent(event) {
    this.sendAction(event);
  }

  finish() {
    if (!this.connected) return;
    if (!this.webMode) {
      this.post('multiplayer-finish');
      return;
    }
    this.sendRaw({ type: 'finish' });
  }

  onConnection(listener) {
    this.connectionListeners.add(listener);
    return () => this.connectionListeners.delete(listener);
  }

  onRoom(listener) {
    this.roomListeners.add(listener);
    if (this.room) listener(this.room, this.identity, this.assignment);
    return () => this.roomListeners.delete(listener);
  }

  onSnapshot(listener) {
    this.snapshotListeners.add(listener);
    return () => this.snapshotListeners.delete(listener);
  }

  onEvent(listener) {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onInput(listener) {
    this.inputListeners.add(listener);
    return () => this.inputListeners.delete(listener);
  }

  onError(listener) {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  disconnect() {
    if (!this.webMode) {
      if (this.connected || this.connecting) this.post('multiplayer-leave');
      this.resetConnectionState();
      return;
    }

    this.shouldReconnect = false;
    this.manualClose = true;
    this.stopHeartbeat();
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.flushTimer);
    this.reconnectTimer = null;
    this.flushTimer = null;
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.sendRaw({ type: 'leave' });
    }
    try {
      this.socket?.close(1000, 'left match');
    } catch {
      // Ignore a socket already being torn down.
    }
    this.socket = null;
    this.resetConnectionState();

    // A deliberate leave must start a brand-new 15-second lobby next time.
    // Unexpected WebSocket reconnects do not call disconnect(), so they keep
    // the same session ID and return to the same live match.
    this.sessionId = this.createSessionId();
  }

  post(type, extra = {}) {
    window.parent.postMessage({ source: 'word-wars', type, ...extra }, '*');
  }

  emitError(message) {
    const error = new Error(message || 'Multiplayer error.');
    if (this.pendingConnectReject) this.pendingConnectReject(error);
    this.pendingConnect = null;
    this.pendingConnectResolve = null;
    this.pendingConnectReject = null;
    this.connecting = false;
    for (const listener of this.errorListeners) listener(error);
  }

  emitConnection(connected) {
    this.connected = connected;
    for (const listener of this.connectionListeners) listener(connected);
  }

  resetConnectionState() {
    this.connected = false;
    this.connecting = false;
    this.room = null;
    this.identity = null;
    this.assignment = null;
    this.pendingConnect = null;
    this.pendingConnectResolve = null;
    this.pendingConnectReject = null;
    this.pendingLatest.input = null;
    this.pendingLatest.motion = null;
    this.pendingLatest.world = null;
    this.pendingCriticalActions.length = 0;
    clearTimeout(this.flushTimer);
    this.flushTimer = null;
    for (const listener of this.connectionListeners) listener(false);
  }

  createSessionId() {
    return crypto.randomUUID?.() ||
      `session-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  }

  readOrCreateClientId() {
    try {
      const saved = localStorage.getItem('wordWarsClientId');
      if (saved) return saved;
      const id = crypto.randomUUID?.() || `guest-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem('wordWarsClientId', id);
      return id;
    } catch {
      return crypto.randomUUID?.() || `guest-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    }
  }

  cleanNickname(value) {
    return String(value || '')
      .replace(/[^a-zA-Z0-9_ -]/g, '')
      .trim()
      .replace(/\s+/g, '_')
      .slice(0, 16);
  }

  randomNickname() {
    const first = ['Swift', 'Quiet', 'Bold', 'Lucky', 'Rapid', 'Clever', 'Bright', 'Wild', 'Calm', 'Sharp'];
    const second = ['Falcon', 'Otter', 'Lion', 'Panda', 'Fox', 'Raven', 'Cobra', 'Wolf', 'Gecko', 'Moth'];
    return `${first[Math.floor(Math.random() * first.length)]}${second[Math.floor(Math.random() * second.length)]}${Math.floor(10 + Math.random() * 90)}`;
  }

  readOrCreateNickname() {
    try {
      const saved = this.cleanNickname(localStorage.getItem('wordWarsNickname'));
      if (saved) return saved;
      const generated = this.randomNickname();
      localStorage.setItem('wordWarsNickname', generated);
      return generated;
    } catch {
      return this.randomNickname();
    }
  }

  webConfig() {
    const config = globalThis.WORD_WARS_WEB_CONFIG || {};
    const query = new URLSearchParams(location.search);
    return {
      partykitHost: query.get('server') || config.partykitHost || '',
      partykitRoom: query.get('lobby') || config.partykitRoom || 'word-wars-global',
    };
  }

  webSocketUrl() {
    const { partykitHost, partykitRoom } = this.webConfig();
    if (!partykitHost || partykitHost.includes('REPLACE_WITH')) {
      throw new Error('Set your realtime host in js/net/web-config.js before using multiplayer.');
    }
    const host = partykitHost.replace(/^https?:\/\//, '').replace(/^wss?:\/\//, '').replace(/\/$/, '');
    const protocol = host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'ws' : 'wss';
    const params = new URLSearchParams({
      clientId: this.clientId,
      sessionId: this.sessionId,
      nickname: this.nickname,
    });
    return `${protocol}://${host}/parties/main/${encodeURIComponent(partykitRoom)}?${params}`;
  }

  openWebSocket() {
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;

    let url;
    try {
      url = this.webSocketUrl();
    } catch (error) {
      this.emitError(error instanceof Error ? error.message : 'Multiplayer server is not configured.');
      return;
    }

    try {
      this.socket = new WebSocket(url);
    } catch (error) {
      this.emitError(error instanceof Error ? error.message : 'Could not open multiplayer connection.');
      return;
    }

    this.socket.addEventListener('open', () => {
      this.reconnectAttempt = 0;
      this.sendRaw({
        type: 'hello',
        clientId: this.clientId,
        sessionId: this.sessionId,
        nickname: this.nickname,
      });
      this.startHeartbeat();
    });

    this.socket.addEventListener('message', (event) => {
      let data;
      try {
        data = JSON.parse(String(event.data));
      } catch {
        return;
      }
      getWordWarsNetDebug().lastPacketSize = String(event.data).length;
      this.handleWebMessage(data);
    });

    this.socket.addEventListener('close', () => {
      this.stopHeartbeat();
      this.socket = null;
      if (this.connected) this.emitConnection(false);
      this.connected = false;

      if (this.manualClose || !this.shouldReconnect) return;
      getWordWarsNetDebug().reconnectCount += 1;
      const delay = Math.min(5000, 350 * Math.pow(1.7, this.reconnectAttempt++));
      this.reconnectTimer = setTimeout(() => this.openWebSocket(), delay);
    });

    this.socket.addEventListener('error', () => {
      if (!this.connected && this.connecting && this.reconnectAttempt === 0) {
        for (const listener of this.errorListeners) {
          listener(new Error('Could not reach the multiplayer server. Retrying…'));
        }
      }
    });
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.sendPing();
    this.heartbeatTimer = setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.sendRaw({ type: 'heartbeat', at: Date.now() });
        this.sendPing();
      }
    }, 3000);
  }

  sendPing() {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    const pingId = ++this.pingSequence;
    this.pendingPings.set(pingId, performance.now());
    while (this.pendingPings.size > 8) {
      const oldest = this.pendingPings.keys().next().value;
      this.pendingPings.delete(oldest);
    }
    this.sendRaw({ type: 'ping', pingId });
  }

  stopHeartbeat() {
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    this.pendingPings.clear();
  }

  sendRaw(message) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    try {
      const serialized = JSON.stringify(message);
      this.socket.send(serialized);
      const debug = getWordWarsNetDebug();
      const size = serialized.length;
      debug.lastPacketSize = size;
      debug._packetSamples += 1;
      debug.averagePacketSize += (size - debug.averagePacketSize) / Math.min(120, debug._packetSamples);
      debug.bufferedAmount = this.socket.bufferedAmount;
      if (message?.kind === 'input') debug.inputsSent += 1;
      if (message?.kind === 'event') debug.actionsSent += 1;
      if (message?.kind === 'snapshot') {
        if (message.payload?.type === 'world-snapshot' || message.payload?.fullWorld) {
          debug.worldSnapshotsSent += 1;
        } else {
          debug.motionSnapshotsSent += 1;
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  scheduleLatestFlush(delayMs = 0) {
    if (this.flushQueued || this.flushTimer) return;
    if (delayMs > 0) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        this.scheduleLatestFlush();
      }, delayMs);
      return;
    }
    this.flushQueued = true;
    queueMicrotask(() => {
      this.flushQueued = false;
      this.flushLatest();
    });
  }

  flushLatest() {
    if (this.socket?.readyState !== WebSocket.OPEN) return;

    const debug = getWordWarsNetDebug();
    debug.bufferedAmount = this.socket.bufferedAmount;

    // Never build a long browser-side WebSocket queue. Keep only the latest
    // movement and retry once per rendered frame while the socket drains.
    if (this.socket.bufferedAmount > 24 * 1024) {
      this.scheduleLatestFlush(12);
      return;
    }

    // Discrete interactions are highest priority and are never replaced by a
    // newer event. Flush a small bounded batch before movement traffic.
    let criticalSent = 0;
    while (
      this.pendingCriticalActions.length > 0 &&
      this.socket.bufferedAmount < 14 * 1024 &&
      criticalSent < 4
    ) {
      const action = this.pendingCriticalActions.shift();
      if (!this.sendRaw({ type: 'relay', kind: 'event', payload: action })) {
        this.pendingCriticalActions.unshift(action);
        break;
      }
      criticalSent += 1;
    }

    if (this.pendingCriticalActions.length > 0 && this.socket.bufferedAmount > 16 * 1024) {
      this.scheduleLatestFlush(8);
      return;
    }

    // Inputs are next so direction changes are not blocked behind a larger
    // state packet.
    const input = this.pendingLatest.input;
    this.pendingLatest.input = null;
    if (input) this.sendRaw({ type: 'relay', kind: 'input', payload: input });

    if (this.socket.bufferedAmount > 16 * 1024) {
      this.scheduleLatestFlush(12);
      return;
    }

    const motion = this.pendingLatest.motion;
    this.pendingLatest.motion = null;
    if (motion) this.sendRaw({ type: 'relay', kind: 'snapshot', payload: motion });

    // World snapshots are larger and lower priority.
    if (this.socket.bufferedAmount < 10 * 1024) {
      const world = this.pendingLatest.world;
      this.pendingLatest.world = null;
      if (world) this.sendRaw({ type: 'relay', kind: 'snapshot', payload: world });
    }

    if (
      this.pendingCriticalActions.length > 0 ||
      this.pendingLatest.input ||
      this.pendingLatest.motion ||
      this.pendingLatest.world
    ) {
      this.scheduleLatestFlush(8);
    }
  }

  acceptRoom(room, identity = this.identity, assignment = null) {
    if (!room) return;
    this.room = room;
    this.identity = identity || this.identity;
    this.assignment = assignment || room.players?.find(
      (entry) => entry.userId === this.identity?.userId
    ) || this.assignment;

    for (const listener of this.roomListeners) {
      listener(this.room, this.identity, this.assignment);
    }
  }

  handleWebMessage(data) {
    if (!data || typeof data !== 'object') return;

    if (data.type === 'pong') {
      const pingId = Number(data.pingId) || 0;
      const startedAt = this.pendingPings.get(pingId);
      if (Number.isFinite(startedAt)) {
        this.pendingPings.delete(pingId);
        const measured = Math.max(1, Math.min(1000, performance.now() - startedAt));
        const previous = this.latencyMs;
        this.latencyMs += (measured - this.latencyMs) * 0.22;
        this.jitterMs += (Math.abs(measured - previous) - this.jitterMs) * 0.18;
        const debug = getWordWarsNetDebug();
        debug.latencyMs = this.latencyMs;
        debug.jitterMs = this.jitterMs;
        globalThis.__wordWarsNetworkLatencyMs = this.latencyMs;
      }
      return;
    }

    if (data.type === 'welcome') {
      this.acceptRoom(data.room, data.identity, data.assignment);
      this.connecting = false;
      this.emitConnection(true);
      if (this.pendingConnectResolve) {
        this.pendingConnectResolve({
          room: this.room,
          identity: this.identity,
          assignment: this.assignment,
        });
      }
      this.pendingConnect = null;
      this.pendingConnectResolve = null;
      this.pendingConnectReject = null;
      if (Array.isArray(data.leaderboard)) {
        this.dispatchEvent({ type: 'leaderboard', entries: data.leaderboard }, data);
      }
      return;
    }

    if (data.type === 'error') {
      this.emitError(data.message || 'Multiplayer connection failed.');
      return;
    }

    if (data.type === 'leaderboard') {
      this.dispatchEvent({ type: 'leaderboard', entries: data.entries || [] }, data);
      return;
    }

    if (data.source !== 'word-wars-server') return;
    if (data.kind === 'room') {
      this.acceptRoom(data.payload, this.identity, null);
      return;
    }
    if (data.kind === 'snapshot') {
      const debug = getWordWarsNetDebug();
      if (data.payload?.type === 'world-snapshot' || data.payload?.fullWorld) {
        debug.worldSnapshotsReceived += 1;
      } else {
        debug.motionSnapshotsReceived += 1;
      }
      for (const listener of this.snapshotListeners) listener(data.payload, data);
      return;
    }
    if (data.kind === 'input') {
      for (const listener of this.inputListeners) listener(data.payload, data);
      return;
    }
    if (data.kind === 'event') {
      getWordWarsNetDebug().actionsReceived += 1;
      this.dispatchEvent(data.payload, data);
    }
  }

  dispatchEvent(payload, envelope) {
    for (const listener of this.eventListeners) listener(payload, envelope);
  }

  handleParentMessage(event) {
    if (event.source !== window.parent) return;
    const data = event.data;
    if (!data || data.source !== 'word-wars-parent') return;

    if (data.type === 'multiplayer-capabilities') {
      this.available = Boolean(data.available);
      return;
    }

    if (data.type === 'multiplayer-connection') {
      this.emitConnection(Boolean(data.connected));
      return;
    }

    if (data.type === 'multiplayer-error') {
      this.emitError(data.message || 'Multiplayer connection failed.');
      return;
    }

    if (data.type === 'multiplayer-room') {
      this.acceptRoom(data.room, data.identity, data.assignment);
      this.connected = true;
      this.connecting = false;
      for (const listener of this.connectionListeners) listener(true);
      if (this.pendingConnectResolve) {
        this.pendingConnectResolve({
          room: this.room,
          identity: this.identity,
          assignment: this.assignment,
        });
      }
      this.pendingConnect = null;
      this.pendingConnectResolve = null;
      this.pendingConnectReject = null;
      return;
    }

    if (data.type !== 'multiplayer-realtime') return;
    const envelope = data.message;
    if (!envelope || envelope.source !== 'word-wars-server') return;

    if (envelope.kind === 'room') {
      this.acceptRoom(envelope.payload, this.identity, null);
      return;
    }
    if (envelope.kind === 'snapshot') {
      for (const listener of this.snapshotListeners) listener(envelope.payload, envelope);
      return;
    }
    if (envelope.kind === 'input') {
      for (const listener of this.inputListeners) listener(envelope.payload, envelope);
      return;
    }
    if (envelope.kind === 'event') {
      getWordWarsNetDebug().actionsReceived += 1;
      this.dispatchEvent(envelope.payload, envelope);
    }
  }
}

class DevvitMultiplayerAdapter extends MultiplayerAdapter {}

const multiplayerAdapter = new DevvitMultiplayerAdapter();
globalThis.multiplayerAdapter = multiplayerAdapter;
