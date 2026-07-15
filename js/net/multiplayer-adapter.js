'use strict';

// Bridge between the canvas game (this iframe) and the Devvit React shell.
// The shell owns authenticated HTTP calls and the Realtime subscription; the
// game only sends compact commands and receives room/snapshot events.
class MultiplayerAdapter {
  constructor() {
    this.available = window.parent !== window;
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

    window.addEventListener('message', (event) => this.handleParentMessage(event));
  }

  isAvailable() {
    return this.available;
  }

  async connect() {
    if (!this.available) {
      throw new Error('Open Word Wars through the Devvit post to use multiplayer.');
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
    this.post('multiplayer-join');
    return this.pendingConnect;
  }

  sendInput(input) {
    if (!this.connected) return;
    this.post('multiplayer-relay', { kind: 'input', payload: input });
  }

  sendSnapshot(snapshot) {
    if (!this.connected) return;
    this.post('multiplayer-relay', { kind: 'snapshot', payload: snapshot });
  }

  sendAction(action) {
    if (!this.connected) return;
    this.post('multiplayer-relay', { kind: 'event', payload: action });
  }

  sendEvent(event) {
    this.sendAction(event);
  }

  finish() {
    if (!this.connected) return;
    this.post('multiplayer-finish');
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
    if (this.connected || this.connecting) this.post('multiplayer-leave');
    this.connected = false;
    this.connecting = false;
    this.room = null;
    this.identity = null;
    this.assignment = null;
    this.pendingConnect = null;
    this.pendingConnectResolve = null;
    this.pendingConnectReject = null;
    for (const listener of this.connectionListeners) listener(false);
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

  handleParentMessage(event) {
    if (event.source !== window.parent) return;
    const data = event.data;
    if (!data || data.source !== 'word-wars-parent') return;

    if (data.type === 'multiplayer-capabilities') {
      this.available = Boolean(data.available);
      return;
    }

    if (data.type === 'multiplayer-connection') {
      this.connected = Boolean(data.connected);
      for (const listener of this.connectionListeners) listener(this.connected);
      return;
    }

    if (data.type === 'multiplayer-error') {
      this.emitError(data.message || 'Multiplayer connection failed.');
      return;
    }

    if (data.type === 'multiplayer-room') {
      this.room = data.room;
      this.identity = data.identity;
      this.assignment = data.assignment;
      this.connected = true;
      this.connecting = false;
      for (const listener of this.roomListeners) {
        listener(this.room, this.identity, this.assignment);
      }
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
      this.room = envelope.payload;
      for (const listener of this.roomListeners) {
        listener(this.room, this.identity, this.assignment);
      }
      return;
    }
    if (envelope.kind === 'snapshot') {
      for (const listener of this.snapshotListeners) {
        listener(envelope.payload, envelope);
      }
      return;
    }
    if (envelope.kind === 'input') {
      for (const listener of this.inputListeners) {
        listener(envelope.payload, envelope);
      }
      return;
    }
    if (envelope.kind === 'event') {
      for (const listener of this.eventListeners) {
        listener(envelope.payload, envelope);
      }
    }
  }
}

class DevvitMultiplayerAdapter extends MultiplayerAdapter {}

const multiplayerAdapter = new DevvitMultiplayerAdapter();
globalThis.multiplayerAdapter = multiplayerAdapter;
