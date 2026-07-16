'use strict';

(() => {
  const adapter = globalThis.multiplayerAdapter;
  const panel = document.querySelector('#webLivePanel');
  const nicknameInput = document.querySelector('#webNicknameInput');
  const nicknameSave = document.querySelector('#webNicknameSave');
  const nicknameHint = document.querySelector('#webNicknameHint');

  if (!adapter?.isWebMode?.()) return;

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
    if (nicknameInput && document.activeElement !== nicknameInput && identity?.username) {
      nicknameInput.value = displayName(identity.username);
    }
    panel?.classList.toggle('is-connected', Boolean(room));
  });

  adapter.onConnection?.((connected) => {
    panel?.classList.toggle('is-connected', Boolean(connected));
  });
})();
