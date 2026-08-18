<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { PanelLeft } from "lucide-vue-next";
import type { Store } from "../store.js";

const props = defineProps<{ store: Store; treeVisible: boolean }>();
defineEmits<{ toggleTree: [] }>();

// Re-read on a timer so "3 minutes ago" does not sit frozen at "just now".
const now = ref(Date.now());
const tick = setInterval(() => { now.value = Date.now(); }, 15_000);
onBeforeUnmount(() => clearInterval(tick));

const lastFetch = computed(() => {
  const at = props.store.lastFetchAt;
  if (at === null) return "not yet fetched";
  const seconds = Math.max(0, Math.round((now.value - Date.parse(at)) / 1000));
  if (seconds < 45) return "fetched just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `fetched ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return `fetched ${hours} h ago`;
});
</script>

<template>
  <footer class="status">
    <button
      class="toggle"
      :aria-pressed="treeVisible"
      :title="treeVisible ? 'Hide the file tree' : 'Show the file tree'"
      aria-label="Toggle the file tree"
      @click="$emit('toggleTree')"
    >
      <PanelLeft :size="14" />
    </button>

    <span class="service" :class="{ down: !store.serviceReachable }">
      <span class="dot" />
      {{ store.serviceReachable ? "Service connected" : "Service unreachable" }}
    </span>

    <span v-if="store.view" class="sep">·</span>
    <span v-if="store.view" class="fetch">{{ lastFetch }}</span>

    <span class="spacer" />
    <span v-if="store.busy" class="working">Working…</span>
  </footer>
</template>

<style scoped>
.status { display: flex; align-items: center; gap: 8px; height: 24px; padding: 0 10px; background: var(--panel-background); border-top: 1px solid var(--workbench-border); font-size: 11px; color: var(--faint-foreground); flex: none; }
.toggle { display: flex; align-items: center; background: none; border: none; color: var(--faint-foreground); cursor: pointer; padding: 0 2px; }
.toggle:hover, .toggle[aria-pressed="true"] { color: var(--workbench-foreground); }
.service { display: flex; align-items: center; gap: 5px; }
.dot { width: 6px; height: 6px; border-radius: 50%; background: var(--success); flex: none; }
.service.down { color: var(--danger); }
.service.down .dot { background: var(--danger); }
.spacer { flex: 1; }
.working { color: var(--muted-foreground); }
</style>
