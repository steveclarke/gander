import { onBeforeUnmount } from "vue";
import type { Store } from "../store.js";

const POLL_MS = 30_000;
const HEALTH_MS = 15_000;

/**
 * Keeps what is on screen honest without the reviewer asking: the open review is re-read
 * on a slow poll, the service is pinged on a faster one, and coming back to the window
 * refreshes everything at once.
 */
export function useBackgroundRefresh(store: Store, hasLoadedView: () => boolean): void {
  // One refresh at a time. The poll and the focus handler both fire on a window the
  // reviewer just came back to, and the second one would read a half-written view.
  let refreshing = false;

  async function refreshOnce(): Promise<void> {
    if (refreshing || !hasLoadedView()) return;
    refreshing = true;
    try { await store.refresh(); } finally { refreshing = false; }
  }

  const poll = setInterval(() => void refreshOnce(), POLL_MS);
  const health = setInterval(() => void store.checkService(), HEALTH_MS);

  function onFocus(): void {
    void store.checkService();
    void refreshOnce();
    // A pull request opened elsewhere — a browser, an agent, `gh pr create` — is the
    // usual reason the reviewer comes back to the window at all.
    void store.refreshPrs();
  }

  window.addEventListener("focus", onFocus);

  onBeforeUnmount(() => {
    clearInterval(poll);
    clearInterval(health);
    window.removeEventListener("focus", onFocus);
  });
}
