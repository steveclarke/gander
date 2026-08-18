<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { api } from "./api.js";
import { createStore } from "./store.js";
import TopBar from "./components/TopBar.vue";
import FileTree from "./components/FileTree.vue";
import DiffPane from "./components/DiffPane.vue";
import QuestionCapture from "./components/QuestionCapture.vue";
import QuestionsDrawer from "./components/QuestionsDrawer.vue";
import StatusBar from "./components/StatusBar.vue";
import { X } from "lucide-vue-next";
import "./theme.css";

const store = createStore(api);
onMounted(async () => {
  await store.checkService();
  await store.loadRepos();
  await store.restoreLastReview();
});

const capturing = ref(false);
const drawerOpen = ref(false);
const treeVisible = ref(true);
const questionCount = computed(() => store.view?.questions.length ?? 0);

// `n` captures a question, from anywhere that isn't a text field — Monaco is read-only,
// so the diff itself never swallows the key.
function onKey(e: KeyboardEvent): void {
  const target = e.target as HTMLElement | null;
  const typing = target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable === true;
  if (typing) return;
  if (e.key === "b" && (e.metaKey || e.ctrlKey)) {
    // Same shortcut VS Code uses for its side bar.
    e.preventDefault();
    treeVisible.value = !treeVisible.value;
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === "n" && store.view) {
    e.preventDefault();
    capturing.value = true;
  }
}
window.addEventListener("keydown", onKey);

const POLL_MS = 30_000;
let refreshing = false;
async function refreshOnce(): Promise<void> {
  await store.checkService();
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
  window.removeEventListener("keydown", onKey);
});
</script>

<template>
  <div class="app">
    <TopBar :store="store" :questions="questionCount" @toggle-questions="drawerOpen = !drawerOpen" />
    <div v-if="store.error" class="error-banner">
      <span>{{ store.error }}</span>
      <button aria-label="Dismiss" title="Dismiss" @click="store.dismissError()"><X :size="14" /></button>
    </div>
    <main class="body">
      <p v-if="store.busy && !store.view" class="empty working">
        <span class="spinner" />Opening pull request…
      </p>
      <p v-else-if="!store.view" class="empty">Pick a repository, then a pull request.</p>
      <template v-else>
        <FileTree v-if="treeVisible" :store="store" class="tree" />
        <DiffPane :store="store" class="diff" />
        <QuestionsDrawer v-if="drawerOpen" :store="store" class="drawer" @close="drawerOpen = false" />
      </template>
    </main>
    <StatusBar :store="store" :tree-visible="treeVisible" @toggle-tree="treeVisible = !treeVisible" />
    <QuestionCapture :store="store" :open="capturing" @close="capturing = false" />
  </div>
</template>

<style scoped>
.app { display: grid; grid-template-rows: 50px 1fr auto; height: 100vh; }
.error-banner { display: flex; align-items: center; gap: 10px; background: rgba(248,81,73,.12); color: var(--red); padding: 8px 14px; font-size: 12px; border-bottom: 1px solid var(--border); }
.error-banner span { flex: 1; }
.error-banner button { background: none; border: none; color: inherit; cursor: pointer; display: flex; flex: none; }
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
.body:has(.drawer) { grid-template-columns: 264px 1fr 320px; }
/* Hiding the tree gives its width back to the diff rather than leaving a gap. */
.body:not(:has(.tree)) { grid-template-columns: 1fr; }
.body:not(:has(.tree)):has(.drawer) { grid-template-columns: 1fr 320px; }
.tree { border-right: 1px solid var(--border); overflow: hidden auto; }
.diff { min-width: 0; overflow: hidden; }
</style>
