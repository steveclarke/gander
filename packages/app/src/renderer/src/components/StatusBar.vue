<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import { PanelLeft } from "@lucide/vue";
import type { Store } from "../store.js";
import ZoomControl from "./ZoomControl.vue";

const props = defineProps<{
  store: Store;
  treeVisible: boolean;
  isDevelopment: boolean;
  worktreeLabel: string | null;
  zoomLevel: number;
}>();
defineEmits<{
  toggleTree: [];
  changeZoom: [level: number];
  openZoomSettings: [];
  changeServer: [repoId: string];
}>();

const repoId = computed(() => props.store.currentRepoId ?? props.store.targetRepoId);
// Says where this repository's notes go, so a server chosen without asking is still visible,
// and warns — without moving anything — when that server stops claiming the repository.
const destination = computed(() => {
  const name = props.store.serviceStatus.serverName;
  if (!name || repoId.value === null) return name ? `${name} · ` : "";
  return `Notes save to ${name} · `;
});
// The warning replaces the routine label rather than joining it, so it is never the part
// the status bar truncates.
const label = computed(() => props.store.serviceStatus.claimLost
  ? `${props.store.serviceStatus.serverName} no longer covers this repository · notes still save there`
  : `${destination.value}${serviceLabel.value}`);

const developmentLabel = computed(() => props.worktreeLabel
  ? `Development build · ${props.worktreeLabel}`
  : "Development build");

const serviceLabel = computed(() => {
  const status = props.store.serviceStatus;
  if (status.state === "connected") return `Service connected · ${status.serviceVersion}`;
  if (status.state === "newer") return `Service ${status.serviceVersion} is newer · app supports ${status.supportedVersion}`;
  if (status.state === "incompatible") return `Service ${status.serviceVersion} is too old · update to ${status.supportedVersion}`;
  return props.store.view ? "Service unreachable · showing cached review" : "Service unreachable";
});
const serviceTitle = computed(() => {
  const status = props.store.serviceStatus;
  return status.state === "unreachable" || status.state === "incompatible"
    ? status.reason
    : props.store.serviceStatus.claimLost
      ? `${props.store.serviceStatus.serverName} says it no longer covers this repository. Notes keep saving there until you change it.`
      : serviceLabel.value;
});

// Re-read on a timer so "3 minutes ago" does not sit frozen at "just now".
const now = ref(Date.now());
const tick = setInterval(() => { now.value = Date.now(); }, 15_000);
onBeforeUnmount(() => clearInterval(tick));

const lastFetch = computed(() => {
  const at = props.store.lastFetchAt;
  const verb = props.store.localView ? "updated" : "fetched";
  if (at === null) return props.store.localView ? "waiting for changes" : "not yet fetched";
  const seconds = Math.max(0, Math.round((now.value - Date.parse(at)) / 1000));
  if (seconds < 45) return `${verb} just now`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${verb} ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return `${verb} ${hours} h ago`;
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

    <span v-if="store.localView" class="service local-live">
      <span class="dot" />Local view · Live
    </span>
    <span
      v-else
      class="service"
      :class="{ down: store.serviceStatus.state === 'unreachable' || store.serviceStatus.state === 'incompatible', warning: store.serviceStatus.state === 'newer' || store.serviceStatus.claimLost }"
      :title="serviceTitle"
      role="status"
    >
      <span class="dot" />
      <span class="service-label">{{ label }}</span>
    </span>
    <button
      v-if="!store.localView && repoId !== null && store.serviceStatus.serverName"
      type="button"
      class="change-server"
      :aria-label="`Change where ${repoId} saves notes`"
      @click="$emit('changeServer', repoId)"
    >Change</button>

    <span v-if="store.view || store.localView" class="sep">·</span>
    <span v-if="store.view || store.localView" class="fetch">{{ lastFetch }}</span>
    <span
      v-if="store.githubViewedSync.pending > 0 || store.githubViewedSync.failed > 0"
      class="github-sync"
      :class="{ failed: store.githubViewedSync.failed > 0 }"
      :title="store.githubViewedSync.message ?? 'GitHub Viewed changes are syncing in the background'"
      role="status"
    >
      GitHub sync · {{ store.githubViewedSync.failed > 0 ? `${store.githubViewedSync.failed} failed` : `${store.githubViewedSync.pending} pending` }}
    </span>

    <span class="spacer" />
    <span v-if="store.busy" class="working">Working…</span>
    <span
      v-if="isDevelopment"
      class="development"
      :title="developmentLabel"
      :aria-label="developmentLabel"
    >
      <span class="development-kind">DEV</span>
      <span v-if="worktreeLabel" class="worktree-label">{{ `· ${worktreeLabel}` }}</span>
    </span>
    <ZoomControl
      :level="zoomLevel"
      @change="$emit('changeZoom', $event)"
      @open-settings="$emit('openZoomSettings')"
    />
  </footer>
</template>

<style scoped>
.status { display: flex; align-items: center; gap: 8px; height: 24px; padding: 0 10px; background: var(--panel-background); border-top: 1px solid var(--workbench-border); font-size: 11px; color: var(--faint-foreground); flex: none; }
.toggle { display: flex; align-items: center; background: none; border: none; color: var(--faint-foreground); cursor: pointer; padding: 0 2px; }
.toggle:hover, .toggle[aria-pressed="true"] { color: var(--workbench-foreground); }
.service { display: flex; align-items: center; gap: 5px; min-width: 0; max-width: min(50vw, 62ch); }
.service-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.change-server { flex: none; padding: 0 2px; border: 0; background: none; color: var(--accent); font: inherit; cursor: pointer; }
.change-server:hover { text-decoration: underline; }
.change-server:focus-visible { outline: 1px solid var(--accent); outline-offset: 1px; }
.dot { width: 6px; height: 6px; border-radius: 50%; background: var(--success); flex: none; }
.service.down { color: var(--danger); }
.service.down .dot { background: var(--danger); }
.local-live { color: var(--info); }
.local-live .dot { background: var(--info); }
.service.warning { color: var(--warning); }
.service.warning .dot { background: var(--warning); }
.spacer { flex: 1; }
.working { color: var(--muted-foreground); }
.github-sync { color: var(--muted-foreground); }
.github-sync.failed { color: var(--danger); }
.development { display: flex; align-items: center; gap: 4px; min-width: 0; max-width: 32ch; color: var(--warning); }
.development-kind { flex: none; font-weight: 700; letter-spacing: 0.06em; }
.worktree-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
