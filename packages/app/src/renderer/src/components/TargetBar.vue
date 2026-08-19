<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { ChevronDown, FolderGit2, FolderOpen, FolderPlus, GitBranch, Trash2 } from "@lucide/vue";
import type { Store } from "../store.js";

const props = defineProps<{ store: Store; integratedTitleBar: boolean }>();
const emit = defineEmits<{
  selectRepo: [repoId: string];
  selectWorktree: [path: string];
  openFolder: [];
  locateRepo: [repoId: string];
  removeRepo: [repoId: string];
}>();

const open = ref(false);
const root = ref<HTMLElement | null>(null);
const selectedRepo = computed(() => props.store.repos.find((repo) => repo.repoId === props.store.targetRepoId) ?? null);
const selectedWorktree = computed(() => props.store.worktrees.find((worktree) => worktree.path === props.store.targetWorktreePath) ?? null);
const repoName = computed(() => selectedRepo.value?.repoId.split("/").at(-1) ?? "Open repository");
const worktreeName = computed(() => selectedWorktree.value?.branch
  ?? selectedWorktree.value?.path.split("/").at(-1)
  ?? null);

function close(): void { open.value = false; }
function chooseRepo(repoId: string): void { emit("selectRepo", repoId); close(); }
function chooseWorktree(path: string): void { emit("selectWorktree", path); close(); }
function openFolder(): void { emit("openFolder"); close(); }
function locateRepo(repoId: string): void { emit("locateRepo", repoId); close(); }
function removeRepo(repoId: string): void { emit("removeRepo", repoId); close(); }
function onPointerDown(event: PointerEvent): void {
  if (open.value && event.target instanceof Node && !root.value?.contains(event.target)) close();
}
function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape" && open.value) close();
}
onMounted(() => {
  document.addEventListener("pointerdown", onPointerDown);
  document.addEventListener("keydown", onKeydown);
});
onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onPointerDown);
  document.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <header ref="root" class="target-bar" :class="{ draggable: integratedTitleBar }">
    <div v-if="integratedTitleBar" class="traffic-space" aria-hidden="true" />
    <button
      class="target-trigger"
      type="button"
      :aria-expanded="open"
      aria-controls="target-picker"
      @click="open = !open"
    >
      <FolderGit2 :size="15" />
      <strong>{{ repoName }}</strong>
      <template v-if="worktreeName">
        <span class="separator">/</span>
        <GitBranch :size="14" />
        <span class="worktree-name">{{ worktreeName }}</span>
      </template>
      <ChevronDown :size="14" class="chevron" />
    </button>
    <span v-if="store.busy" class="target-status" role="status">Working…</span>
    <div class="drag-fill" />

    <div v-if="open" id="target-picker" class="target-picker">
      <section aria-labelledby="repositories-heading">
        <h2 id="repositories-heading">Repositories</h2>
        <button
          v-for="repo in store.repos"
          :key="repo.repoId"
          class="picker-row"
          :class="{ selected: repo.repoId === store.targetRepoId }"
          type="button"
          :aria-current="repo.repoId === store.targetRepoId ? 'true' : undefined"
          @click="chooseRepo(repo.repoId)"
        >
          <FolderGit2 :size="15" />
          <span>{{ repo.repoId.split('/').at(-1) }}</span>
          <small>{{ repo.repoId }}</small>
        </button>
      </section>

      <section v-if="store.targetRepoId" aria-labelledby="worktrees-heading">
        <h2 id="worktrees-heading">Worktrees</h2>
        <button
          v-for="worktree in store.worktrees"
          :key="worktree.path"
          class="picker-row worktree-row"
          :class="{ selected: worktree.path === store.targetWorktreePath }"
          type="button"
          :aria-current="worktree.path === store.targetWorktreePath ? 'true' : undefined"
          @click="chooseWorktree(worktree.path)"
        >
          <GitBranch :size="15" />
          <span>{{ worktree.branch ?? worktree.headSha.slice(0, 8) }}</span>
          <small>{{ worktree.path }}</small>
        </button>
        <p v-if="store.worktrees.length === 0" class="picker-empty">No local worktrees are known for this repository.</p>
      </section>

      <button class="open-folder" type="button" @click="openFolder">
        <FolderPlus :size="16" />
        Open repository folder…
      </button>
      <template v-if="selectedRepo">
        <button class="repository-action" type="button" @click="locateRepo(selectedRepo.repoId)">
          <FolderOpen :size="16" />
          Locate this repository…
        </button>
        <button class="repository-action danger" type="button" @click="removeRepo(selectedRepo.repoId)">
          <Trash2 :size="16" />
          Remove this repository
        </button>
      </template>
    </div>
  </header>
</template>

<style scoped>
.target-bar { position: relative; z-index: 20; height: 38px; display: flex; align-items: stretch; background: var(--panel-background); border-bottom: 1px solid var(--workbench-border); }
.target-bar.draggable, .drag-fill { -webkit-app-region: drag; }
.traffic-space { width: 78px; flex: none; }
.target-trigger { -webkit-app-region: no-drag; min-width: 180px; max-width: 520px; display: flex; align-items: center; gap: 7px; padding: 0 12px; border: 0; border-right: 1px solid var(--workbench-border); background: var(--input-background); color: var(--muted-foreground); font: inherit; cursor: pointer; }
.target-trigger:hover, .target-trigger[aria-expanded="true"] { background: var(--hover-background); color: var(--workbench-foreground); }
.target-trigger strong { min-width: 0; overflow: hidden; color: var(--workbench-foreground); font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
.separator { color: var(--faint-foreground); }
.worktree-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chevron { flex: none; margin-left: 2px; }
.target-status { -webkit-app-region: no-drag; align-self: center; margin-left: 10px; color: var(--faint-foreground); font: 10px var(--mono); }
.drag-fill { min-width: 40px; flex: 1; }
.target-trigger:focus-visible, .picker-row:focus-visible, .open-folder:focus-visible, .repository-action:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.target-picker { -webkit-app-region: no-drag; position: absolute; inset-block-start: 37px; inset-inline-start: var(--target-picker-offset, 0); width: min(420px, calc(100vw - 24px)); max-height: min(620px, calc(100vh - 72px)); overflow: auto; padding: 8px 0; border: 1px solid var(--workbench-border); border-radius: 0 0 var(--radius-lg) var(--radius-lg); background: var(--elevated-background); box-shadow: 0 14px 34px rgba(0, 0, 0, .36); }
.draggable .target-picker { --target-picker-offset: 78px; }
.target-picker section + section { margin-top: 7px; padding-top: 7px; border-top: 1px solid var(--workbench-border); }
.target-picker h2 { margin: 0; padding: 5px 12px 4px; color: var(--faint-foreground); font-size: 10px; font-weight: 700; letter-spacing: .55px; text-transform: uppercase; }
.picker-row, .open-folder, .repository-action { width: 100%; display: grid; grid-template-columns: 17px minmax(90px, auto) minmax(0, 1fr); align-items: center; gap: 8px; min-height: 30px; padding: 5px 12px; border: 0; background: none; color: var(--muted-foreground); text-align: left; font: inherit; cursor: pointer; }
.picker-row.selected { background: var(--selection-background); color: var(--workbench-foreground); }
.picker-row:hover, .open-folder:hover, .repository-action:hover { background: var(--hover-background); color: var(--workbench-foreground); }
.picker-row small { overflow: hidden; color: var(--faint-foreground); font: 10px var(--mono); text-overflow: ellipsis; white-space: nowrap; }
.picker-row span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.picker-row.selected span { color: var(--workbench-foreground); font-weight: 650; }
.picker-empty { margin: 4px 12px 8px 37px; color: var(--faint-foreground); font-size: 11px; }
.open-folder { grid-template-columns: 17px 1fr; margin-top: 7px; padding-block: 7px; border-top: 1px solid var(--workbench-border); color: var(--accent); }
.repository-action { grid-template-columns: 17px 1fr; }
.repository-action.danger { color: var(--danger); }
</style>
