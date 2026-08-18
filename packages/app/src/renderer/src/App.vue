<script setup lang="ts">
import { onBeforeUnmount, onMounted } from "vue";
import { api } from "./api.js";
import { createStore } from "./store.js";
import TopBar from "./components/TopBar.vue";
import FileTree from "./components/FileTree.vue";
import DiffPane from "./components/DiffPane.vue";
import "./theme.css";

const store = createStore(api);
onMounted(async () => {
  await store.loadRepos();
  await store.restoreLastReview();
});

const POLL_MS = 30_000;
let refreshing = false;
async function refreshOnce(): Promise<void> {
  if (refreshing || !store.view) return;
  refreshing = true;
  try {
    await store.refresh();
  } finally {
    refreshing = false;
  }
}
const timer = setInterval(() => void refreshOnce(), POLL_MS);
const onFocus = (): void => { void refreshOnce(); };
window.addEventListener("focus", onFocus);
onBeforeUnmount(() => {
  clearInterval(timer);
  window.removeEventListener("focus", onFocus);
});
</script>

<template>
  <div class="app">
    <TopBar :store="store" />
    <div v-if="store.error" class="error-banner">{{ store.error }}</div>
    <main class="body">
      <p v-if="store.busy && !store.view" class="empty working">
        <span class="spinner" />Opening pull request…
      </p>
      <p v-else-if="!store.view" class="empty">Pick a repository, then a pull request.</p>
      <template v-else>
        <FileTree :store="store" class="tree" />
        <DiffPane :store="store" class="diff" />
      </template>
    </main>
  </div>
</template>

<style scoped>
.app { display: grid; grid-template-rows: 50px 1fr; height: 100vh; }
.error-banner { background: rgba(248,81,73,.12); color: var(--red); padding: 8px 14px; font-size: 12px; border-bottom: 1px solid var(--border); }
.empty { color: var(--faint); padding: 2rem; }
.working { display: flex; align-items: center; gap: 10px; }
.spinner {
  width: 14px; height: 14px; border-radius: 50%;
  border: 2px solid var(--border); border-top-color: var(--faint);
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }
.body { display: grid; grid-template-columns: 264px 1fr; min-height: 0; }
.tree { border-right: 1px solid var(--border); overflow: hidden auto; }
.diff { min-width: 0; overflow: hidden; }
</style>
