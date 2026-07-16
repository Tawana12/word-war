'use strict';

(() => {
  const adapter = globalThis.multiplayerAdapter;
  const panel = document.querySelector('#webLivePanel');
  const nicknameInput = document.querySelector('#webNicknameInput');
  const nicknameSave = document.querySelector('#webNicknameSave');
  const nicknameHint = document.querySelector('#webNicknameHint');
  const matchBoard = document.querySelector('#matchPlayersBoard');
  const matchPlayersList = document.querySelector('#matchPlayersList');

  if (!adapter?.isWebMode?.()) return;

  let currentRoom = null;
  let leaderboardEntries = [];

  panel?.classList.remove('hidden');
  if (nicknameInput) nicknameInput.value = displayName(adapter.getNickname?.());

  function displayName(value) {
    return String(value || '').replace(/_/g, ' ').trim();
  }

  function setValidation(message = '') {
    const hasError = Boolean(message);
    nicknameInput?.setAttribute('aria-invalid', hasError ? 'true' : 'false');
    panel?.classList.toggle('has-error', hasError);
    if (nicknameHint) {
      nicknameHint.textContent = message || 'Shown in the lobby and above your character.';
    }
  }

  function saveNickname({ focusOnError = false } = {}) {
    if (!nicknameInput) return Boolean(adapter.getNickname?.());
    const raw = nicknameInput.value.trim();
    if (!raw) {
      setValidation('Enter a name before joining multiplayer.');
      if (focusOnError) nicknameInput.focus();
      return false;
    }

    const saved = adapter.setNickname?.(raw) || '';
    if (!saved) {
      setValidation('Use letters, numbers, spaces, _ or -.');
      if (focusOnError) nicknameInput.focus();
      return false;
    }

    nicknameInput.value = displayName(saved);
    setValidation('');
    nicknameInput.blur();
    return true;
  }

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

    const scores = new Map(
      leaderboardEntries
        .filter(entry => entry?.userId)
        .map(entry => [entry.userId, Math.max(0, Number(entry.karma) || 0)])
    );

    const ranked = players
      .map(player => ({
        ...player,
        karma: scores.get(player.userId) || 0,
      }))
      .sort((a, b) => b.karma - a.karma || displayName(a.username).localeCompare(displayName(b.username)));

    const fragment = document.createDocumentFragment();
    for (const player of ranked) {
      const row = document.createElement('li');
      const name = document.createElement('span');
      const score = document.createElement('span');
      name.className = 'match-player-name';
      score.className = 'match-player-score';
      name.textContent = displayName(player.username) || 'Player';
      score.textContent = `${player.karma} KARMA`;
      row.append(name, score);
      fragment.appendChild(row);
    }
    matchPlayersList.replaceChildren(fragment);
    matchBoard.classList.remove('hidden');
  }

  globalThis.ensureWebMultiplayerNickname = () => saveNickname({ focusOnError: true });

  nicknameSave?.addEventListener('click', () => saveNickname({ focusOnError: true }));
  nicknameInput?.addEventListener('input', () => setValidation(''));
  nicknameInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') saveNickname({ focusOnError: true });
  });
  nicknameInput?.addEventListener('change', () => {
    if (nicknameInput.value.trim()) saveNickname();
  });

  adapter.onRoom?.((room, identity) => {
    currentRoom = room || null;
    if (nicknameInput && document.activeElement !== nicknameInput && identity?.username) {
      nicknameInput.value = displayName(identity.username);
    }
    panel?.classList.toggle('is-connected', Boolean(room));
    renderMatchPlayersBoard();
  });

  adapter.onEvent?.((event) => {
    if (event?.type !== 'leaderboard') return;
    leaderboardEntries = Array.isArray(event.entries) ? event.entries : [];
    renderMatchPlayersBoard();
  });

  adapter.onConnection?.((connected) => {
    panel?.classList.toggle('is-connected', Boolean(connected));
  });

  new MutationObserver(renderMatchPlayersBoard).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class'],
  });
})();
