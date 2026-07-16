'use strict';

(() => {
  const adapter = globalThis.multiplayerAdapter;
  const panel = document.querySelector('#webLivePanel');
  const nicknameInput = document.querySelector('#webNicknameInput');
  const nicknameSave = document.querySelector('#webNicknameSave');
  const leaderboardList = document.querySelector('#webLeaderboardList');

  if (!adapter?.isWebMode?.()) return;

  panel?.classList.remove('hidden');
  if (nicknameInput) nicknameInput.value = adapter.getNickname?.() || '';

  function saveNickname() {
    if (!nicknameInput) return;
    const saved = adapter.setNickname?.(nicknameInput.value);
    nicknameInput.value = saved || adapter.getNickname?.() || '';
    nicknameInput.blur();
  }

  nicknameSave?.addEventListener('click', saveNickname);
  nicknameInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') saveNickname();
  });
  nicknameInput?.addEventListener('change', saveNickname);

  function renderLeaderboard(entries) {
    if (!leaderboardList) return;
    leaderboardList.replaceChildren();
    const safeEntries = Array.isArray(entries) ? entries.slice(0, 5) : [];
    if (!safeEntries.length) {
      const empty = document.createElement('li');
      empty.textContent = 'No scores yet';
      leaderboardList.appendChild(empty);
      return;
    }

    for (const entry of safeEntries) {
      const row = document.createElement('li');
      const name = document.createElement('span');
      const score = document.createElement('strong');
      name.textContent = `${entry.rank || ''}. ${entry.username || 'Guest'}`;
      score.textContent = String(Math.max(0, Number(entry.karma) || 0));
      row.append(name, score);
      leaderboardList.appendChild(row);
    }
  }

  adapter.onEvent?.((event) => {
    if (event?.type === 'leaderboard') renderLeaderboard(event.entries);
  });

  adapter.onRoom?.((room, identity) => {
    if (nicknameInput && document.activeElement !== nicknameInput && identity?.username) {
      nicknameInput.value = identity.username;
    }
    panel?.classList.toggle('is-connected', Boolean(room));
  });

  adapter.onConnection?.((connected) => {
    panel?.classList.toggle('is-connected', Boolean(connected));
  });
})();
