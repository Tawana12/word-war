'use strict';

(() => {
  const adapter = globalThis.multiplayerAdapter;
  const panel = document.querySelector('#webLivePanel');
  const nicknameInput = document.querySelector('#webNicknameInput');
  const nicknameSave = document.querySelector('#webNicknameSave');
  const nicknameHint = document.querySelector('#webNicknameHint');
  const multiplayerButton = document.querySelector('#multiplayerModeBtn');
  const matchBoard = document.querySelector('#matchPlayersBoard');
  const matchPlayersList = document.querySelector('#matchPlayersList');

  if (!adapter?.isWebMode?.()) return;

  let currentRoom = null;

  function displayName(value) {
    return String(value || '').replace(/_/g, ' ').trim();
  }

  function savedName() {
    return displayName(adapter.getNickname?.());
  }

  function showNamePrompt(message = '') {
    panel?.classList.remove('hidden');
    panel?.classList.toggle('has-error', Boolean(message));
    if (nicknameHint) {
      nicknameHint.textContent = message || 'This name appears above your player and on the final score card.';
    }
    if (nicknameInput) {
      nicknameInput.value = savedName();
      requestAnimationFrame(() => nicknameInput.focus());
    }
  }

  function hideNamePrompt() {
    panel?.classList.add('hidden');
    panel?.classList.remove('has-error');
  }

  function saveNickname({ focusOnError = false } = {}) {
    if (!nicknameInput) return Boolean(savedName());
    const raw = nicknameInput.value.trim();
    if (!raw) {
      showNamePrompt('Enter your name before joining multiplayer.');
      if (focusOnError) nicknameInput.focus();
      return false;
    }

    const saved = adapter.setNickname?.(raw) || '';
    if (!saved) {
      showNamePrompt('Use letters, numbers, spaces, _ or -.');
      if (focusOnError) nicknameInput.focus();
      return false;
    }

    nicknameInput.value = displayName(saved);
    hideNamePrompt();
    return true;
  }

  // Ask for a name only when Multiplayer is selected. Capture phase prevents
  // the normal mode handler from opening the lobby before a valid name exists.
  multiplayerButton?.addEventListener('click', (event) => {
    if (savedName()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    showNamePrompt();
  }, true);

  globalThis.ensureWebMultiplayerNickname = () => saveNickname({ focusOnError: true });

  nicknameSave?.addEventListener('click', () => {
    if (!saveNickname({ focusOnError: true })) return;
    // After saving, the player clicks Multiplayer once more. This avoids
    // accidentally joining before they have seen and confirmed the name.
  });

  nicknameInput?.addEventListener('input', () => {
    panel?.classList.remove('has-error');
    if (nicknameHint) {
      nicknameHint.textContent = 'This name appears above your player and on the final score card.';
    }
  });

  nicknameInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') saveNickname({ focusOnError: true });
  });

  function realRoomPlayers() {
    const players = Array.isArray(currentRoom?.players) ? currentRoom.players : [];
    const unique = new Map();
    for (const player of players) {
      if (!player?.userId || player.connected === false) continue;
      unique.set(player.userId, player);
    }
    return [...unique.values()];
  }

  function renderMatchPlayersBoard() {
    if (!matchBoard || !matchPlayersList) return;

    const multiplayerFinal = Boolean(
      globalThis.multiplayerRuntime?.active &&
      globalThis.state?.demoMatch?.finished &&
      document.documentElement.classList.contains('round-ended')
    );
    const players = realRoomPlayers();

    if (!multiplayerFinal || players.length === 0) {
      matchBoard.classList.add('hidden');
      matchPlayersList.replaceChildren();
      return;
    }

    const localId = adapter.getIdentity?.()?.userId;
    const ordered = [...players].sort((a, b) => {
      if (a.userId === localId) return -1;
      if (b.userId === localId) return 1;
      return displayName(a.username).localeCompare(displayName(b.username));
    });

    const fragment = document.createDocumentFragment();
    for (const player of ordered) {
      const row = document.createElement('li');
      const name = document.createElement('span');
      const team = document.createElement('span');
      name.className = 'match-player-name';
      team.className = 'match-player-team';
      name.textContent = `${displayName(player.username) || 'Player'}${player.userId === localId ? ' · YOU' : ''}`;
      team.textContent = String(player.team || '').toUpperCase() || 'PLAYER';
      row.append(name, team);
      fragment.appendChild(row);
    }
    matchPlayersList.replaceChildren(fragment);
    matchBoard.classList.remove('hidden');
  }

  hideNamePrompt();

  adapter.onRoom?.((room, identity) => {
    currentRoom = room || null;
    if (nicknameInput && document.activeElement !== nicknameInput && identity?.username) {
      nicknameInput.value = displayName(identity.username);
    }
    renderMatchPlayersBoard();
  });

  new MutationObserver(renderMatchPlayersBoard).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  });
})();
