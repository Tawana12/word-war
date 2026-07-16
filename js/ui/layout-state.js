'use strict';

// Keeps responsive UI state independent from gameplay state. Older screens
// are shown/hidden by several systems, so observe the actual DOM rather than
// relying on one code path to remember every class.
(() => {
  const root = document.documentElement;
  const overlaySelector = '#stage > .overlay:not(.rotate-overlay)';
  let scheduled = false;

  function visibleOverlays() {
    return [...document.querySelectorAll(overlaySelector)].filter(element =>
      !element.classList.contains('hidden')
    );
  }

  function applyLayoutState() {
    scheduled = false;
    const overlays = visibleOverlays();
    const active = overlays.at(-1) || null;

    root.classList.toggle('ui-overlay-open', overlays.length > 0);
    root.dataset.activeScreen = active?.id || 'game';

    for (const overlay of document.querySelectorAll(overlaySelector)) {
      overlay.setAttribute(
        'aria-hidden',
        overlay === active ? 'false' : 'true'
      );
    }

    if (overlays.length > 0 && typeof resetJoystick === 'function') {
      resetJoystick();
    }
  }

  function scheduleLayoutState() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(applyLayoutState);
  }

  const observer = new MutationObserver(scheduleLayoutState);
  for (const overlay of document.querySelectorAll(overlaySelector)) {
    observer.observe(overlay, {
      attributes: true,
      attributeFilter: ['class'],
    });
  }

  window.addEventListener('resize', scheduleLayoutState, { passive: true });
  window.addEventListener('orientationchange', scheduleLayoutState, { passive: true });
  document.addEventListener('fullscreenchange', scheduleLayoutState);

  applyLayoutState();
})();
