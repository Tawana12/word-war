'use strict';

// Universal bridge. Inside Reddit/Devvit it keeps using the parent iframe
// bridge. On a normal Vercel page it connects directly to the lightweight
// PartyKit room server in /realtime.
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
    this.pendingLatest = { input: null, snapshot: null };
    this.flushQueued = false;

    this.clientId = this.readOrCreateClientId();
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
    this.pendingLatest.snapshot = snapshot;
    this.scheduleLatestFlush();
  }

  sendAction(action) {
    if (!this.connected) return;
    if (!this.webMode) {
      this.post('multiplayer-relay', { kind: 'event', payload: action });
      return;
    }
    this.sendRaw({ type: 'relay', kind: 'event', payload: action });
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
    this.reconnectTimer = null;
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
    this.pendingLatest.snapshot = null;
    for (const listener of this.connectionListeners) listener(false);
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
      throw new Error('Set your PartyKit host in js/net/web-config.js before using multiplayer.');
    }
    const host = partykitHost.replace(/^https?:\/\//, '').replace(/^wss?:\/\//, '').replace(/\/$/, '');
    const protocol = host.startsWith('localhost') || host.startsWith('127.0.0.1') ? 'ws' : 'wss';
    const params = new URLSearchParams({
      clientId: this.clientId,
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
      this.handleWebMessage(data);
    });

    this.socket.addEventListener('close', () => {
      this.stopHeartbeat();
      this.socket = null;
      if (this.connected) this.emitConnection(false);
      this.connected = false;

      if (this.manualClose || !this.shouldReconnect) return;
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
    this.heartbeatTimer = setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.sendRaw({ type: 'heartbeat', at: Date.now() });
      }
    }, 5000);
  }

  stopHeartbeat() {
    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  sendRaw(message) {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    try {
      this.socket.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }

  scheduleLatestFlush() {
    if (this.flushQueued) return;
    this.flushQueued = true;
    queueMicrotask(() => {
      this.flushQueued = false;
      this.flushLatest();
    });
  }

  flushLatest() {
    if (this.socket?.readyState !== WebSocket.OPEN) return;

    // If a mobile browser briefly stalls, never replay the old movement queue.
    // Keep only the newest input and snapshot until the socket drains.
    if (this.socket.bufferedAmount > 256 * 1024) {
      setTimeout(() => this.scheduleLatestFlush(), 20);
      return;
    }

    const input = this.pendingLatest.input;
    const snapshot = this.pendingLatest.snapshot;
    this.pendingLatest.input = null;
    this.pendingLatest.snapshot = null;

    if (input) this.sendRaw({ type: 'relay', kind: 'input', payload: input });
    if (snapshot) this.sendRaw({ type: 'relay', kind: 'snapshot', payload: snapshot });
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
      for (const listener of this.snapshotListeners) listener(data.payload, data);
      return;
    }
    if (data.kind === 'input') {
      for (const listener of this.inputListeners) listener(data.payload, data);
      return;
    }
    if (data.kind === 'event') {
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
      this.dispatchEvent(envelope.payload, envelope);
    }
  }
}

class DevvitMultiplayerAdapter extends MultiplayerAdapter {}

const multiplayerAdapter = new DevvitMultiplayerAdapter();
globalThis.multiplayerAdapter = multiplayerAdapter;
