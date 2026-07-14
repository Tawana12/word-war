'use strict';

/**
 * Multiplayer transport contract.
 *
 * The Canvas game does not know whether updates come from Devvit, WebSocket,
 * WebRTC or a test harness. Implement this adapter and keep network code out of
 * gameplay systems.
 */
class MultiplayerAdapter {
  isAvailable() {
    return false;
  }

  async connect(_options) {
    throw new Error('Multiplayer transport is not configured.');
  }

  sendInput(_input) {
    // Send compact player intent, not the entire rendered actor object.
  }

  sendAction(_action) {
    // Examples: pickup, place-letter, fire, plant-bomb.
  }

  onSnapshot(_listener) {
    return () => {};
  }

  onEvent(_listener) {
    return () => {};
  }

  disconnect() {}
}

/**
 * Replace the methods below with Devvit realtime/channel calls.
 * Keep the same public contract so the game session code does not change.
 */
class DevvitMultiplayerAdapter extends MultiplayerAdapter {
  constructor() {
    super();
    this.connected = false;
  }

  isAvailable() {
    return false;
  }
}

const multiplayerAdapter = new DevvitMultiplayerAdapter();
