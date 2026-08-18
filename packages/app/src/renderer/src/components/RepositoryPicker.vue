<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { Check, FolderGit2, LockKeyhole, Search as SearchIcon, X } from "lucide-vue-next";
import type { GithubRepository } from "../api.js";
import type { Store } from "../store.js";

const props = defineProps<{ open: boolean; store: Store }>();
const emit = defineEmits<{ close: [] }>();

const dialog = ref<HTMLDialogElement | null>(null);
const searchInput = ref<HTMLInputElement | null>(null);
const urlInput = ref<HTMLInputElement | null>(null);
const activeTab = ref<"github" | "url">("github");
const query = ref("");
const url = ref("");
const actionError = ref<string | null>(null);

const registeredIds = computed(() => new Set(props.store.repos.map((repo) => repo.repoId)));
const filteredRepos = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase();
  if (needle === "") return props.store.githubRepos;
  return props.store.githubRepos.filter((repo) => repo.repoId.toLocaleLowerCase().includes(needle));
});

watch(() => props.open, async (open) => {
  if (!open) {
    if (dialog.value?.open) dialog.value.close();
    return;
  }
  activeTab.value = "github";
  query.value = "";
  url.value = "";
  actionError.value = null;
  await nextTick();
  dialog.value?.showModal();
  await props.store.loadGithubRepos();
  await nextTick();
  searchInput.value?.focus();
});

function close(): void {
  dialog.value?.close();
}

function onClosed(): void {
  emit("close");
}

function onBackdropClick(event: MouseEvent): void {
  if (event.target === dialog.value) close();
}

async function showTab(tab: "github" | "url"): Promise<void> {
  activeTab.value = tab;
  actionError.value = null;
  await nextTick();
  (tab === "github" ? searchInput.value : urlInput.value)?.focus();
}

async function choose(repo: GithubRepository): Promise<void> {
  actionError.value = null;
  if (registeredIds.value.has(repo.repoId)) await props.store.selectRepo(repo.repoId);
  else await props.store.addRepo(repo.url);
  if (props.store.error) {
    actionError.value = props.store.error;
    return;
  }
  close();
}

async function submitUrl(): Promise<void> {
  const value = url.value.trim();
  if (value === "") return;
  actionError.value = null;
  await props.store.addRepo(value);
  if (props.store.error) {
    actionError.value = props.store.error;
    return;
  }
  close();
}

function repoName(repoId: string): string {
  return repoId.split("/").pop() ?? repoId;
}

function repoOwner(repoId: string): string {
  return repoId.split("/").slice(0, -1).join("/");
}
</script>

<template>
  <dialog ref="dialog" class="repository-picker" aria-labelledby="repository-picker-title" @close="onClosed" @click="onBackdropClick">
    <header class="picker-header">
      <div>
        <h1 id="repository-picker-title">Add a repository</h1>
        <p>Choose from GitHub, or enter a repository URL.</p>
      </div>
      <button class="icon-button" type="button" aria-label="Close repository picker" @click="close">
        <X :size="17" aria-hidden="true" />
      </button>
    </header>

    <div class="tabs" role="tablist" aria-label="Repository source">
      <button
        id="github-repositories-tab"
        type="button"
        role="tab"
        :aria-selected="activeTab === 'github'"
        :tabindex="activeTab === 'github' ? 0 : -1"
        @click="showTab('github')"
        @keydown.right.prevent="showTab('url')"
        @keydown.end.prevent="showTab('url')"
      >GitHub</button>
      <button
        id="repository-url-tab"
        type="button"
        role="tab"
        :aria-selected="activeTab === 'url'"
        :tabindex="activeTab === 'url' ? 0 : -1"
        @click="showTab('url')"
        @keydown.left.prevent="showTab('github')"
        @keydown.home.prevent="showTab('github')"
      >URL</button>
    </div>

    <section
      v-if="activeTab === 'github'"
      class="picker-body github-panel"
      role="tabpanel"
      aria-labelledby="github-repositories-tab"
    >
      <search class="repository-search">
        <SearchIcon :size="15" aria-hidden="true" />
        <label class="sr-only" for="repository-filter">Filter repositories</label>
        <input
          id="repository-filter"
          ref="searchInput"
          v-model="query"
          type="search"
          placeholder="Filter repositories…"
        />
      </search>

      <p v-if="actionError" class="inline-error github-action-error" role="alert">{{ actionError }}</p>
      <p v-if="store.githubReposBusy" class="picker-state"><span class="spinner" />Loading repositories…</p>
      <div v-else-if="store.githubReposError" class="picker-error" role="alert">
        <p>{{ store.githubReposError }}</p>
        <button type="button" @click="store.loadGithubRepos()">Try again</button>
      </div>
      <p v-else-if="filteredRepos.length === 0" class="picker-state">
        {{ query.trim() ? "No repositories match that filter." : "No active repositories are available to this GitHub account." }}
      </p>
      <ul v-else class="repository-list" aria-label="Available repositories">
        <li v-for="repo in filteredRepos" :key="repo.repoId">
          <button type="button" :disabled="store.busy" @click="choose(repo)">
            <FolderGit2 :size="17" aria-hidden="true" />
            <span class="repo-identity">
              <span class="repo-name">{{ repoName(repo.repoId) }}</span>
              <span class="repo-owner">{{ repoOwner(repo.repoId) }}</span>
            </span>
            <span v-if="repo.private" class="repo-private"><LockKeyhole :size="12" aria-hidden="true" />Private</span>
            <span v-if="registeredIds.has(repo.repoId)" class="repo-added"><Check :size="13" aria-hidden="true" />Added</span>
          </button>
        </li>
      </ul>
    </section>

    <section v-else class="picker-body url-panel" role="tabpanel" aria-labelledby="repository-url-tab">
      <form @submit.prevent="submitUrl">
        <label for="repository-url">GitHub repository URL</label>
        <div class="url-row">
          <input
            id="repository-url"
            ref="urlInput"
            v-model="url"
            type="url"
            placeholder="https://github.com/owner/repo"
            required
          />
          <button class="primary-button" type="submit" :disabled="store.busy || url.trim() === ''">
            {{ store.busy ? "Adding…" : "Add repository" }}
          </button>
        </div>
        <p class="url-help">Use this when a repository does not appear in your GitHub list.</p>
      </form>
      <p v-if="actionError" class="inline-error" role="alert">{{ actionError }}</p>
    </section>
  </dialog>
</template>

<style scoped>
.repository-picker {
  width: min(620px, calc(100vw - 48px));
  max-height: min(620px, calc(100vh - 72px));
  margin: auto;
  padding: 0;
  overflow: hidden;
  color: var(--workbench-foreground);
  background: var(--panel-background);
  border: 1px solid var(--workbench-border);
  border-radius: 12px;
  box-shadow: 0 24px 70px var(--workbench-shadow);
}
.repository-picker::backdrop { background: var(--overlay-background); }
.picker-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; padding: 20px 22px 16px; }
.picker-header h1 { font-size: 18px; line-height: 1.3; font-weight: 650; }
.picker-header p { margin-top: 3px; color: var(--muted-foreground); font-size: 12px; }
.icon-button { display: grid; place-items: center; width: 30px; height: 30px; flex: none; color: var(--muted-foreground); background: none; border: 0; border-radius: 6px; cursor: pointer; }
.icon-button:hover { color: var(--workbench-foreground); background: var(--hover-background); }
.tabs { display: flex; gap: 18px; padding: 0 22px; border-bottom: 1px solid var(--workbench-border); }
.tabs button { position: relative; padding: 8px 1px 10px; color: var(--muted-foreground); background: none; border: 0; font: inherit; cursor: pointer; }
.tabs button[aria-selected="true"] { color: var(--workbench-foreground); }
.tabs button[aria-selected="true"]::after { content: ""; position: absolute; right: 0; bottom: -1px; left: 0; height: 2px; background: var(--accent); }
.github-panel { display: flex; min-height: 0; max-height: min(488px, calc(100vh - 184px)); flex-direction: column; }
.repository-search { display: flex; align-items: center; gap: 8px; margin: 14px 16px 8px; padding: 0 10px; color: var(--faint-foreground); background: var(--input-background); border: 1px solid var(--workbench-border); border-radius: 7px; }
.repository-search:focus-within { border-color: var(--accent); box-shadow: 0 0 0 2px var(--focus-ring); }
.repository-search input { width: 100%; height: 34px; color: var(--workbench-foreground); background: transparent; border: 0; outline: 0; font: inherit; }
.repository-search input::placeholder, .url-row input::placeholder { color: var(--faint-foreground); }
.repository-list { min-height: 0; margin: 0; padding: 4px 8px 12px; overflow-y: auto; list-style: none; }
.repository-list button { display: flex; width: 100%; min-height: 44px; align-items: center; gap: 10px; padding: 7px 10px; color: var(--workbench-foreground); text-align: left; background: transparent; border: 0; border-radius: 7px; cursor: pointer; }
.repository-list button:hover:not(:disabled), .repository-list button:focus-visible { background: var(--selection-background); }
.repository-list button:disabled { cursor: wait; opacity: .65; }
.repository-list svg { flex: none; color: var(--muted-foreground); }
.repo-identity { display: flex; min-width: 0; flex: 1; flex-direction: column; line-height: 1.25; }
.repo-name { overflow: hidden; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.repo-owner { overflow: hidden; color: var(--faint-foreground); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.repo-private, .repo-added { display: inline-flex; align-items: center; gap: 4px; color: var(--faint-foreground); font-size: 10.5px; }
.repo-added { color: var(--success); }
.repo-added svg { color: currentColor; }
.picker-state { display: flex; min-height: 150px; align-items: center; justify-content: center; gap: 8px; padding: 30px; color: var(--muted-foreground); text-align: center; }
.spinner { width: 14px; height: 14px; border: 2px solid var(--workbench-border); border-top-color: var(--accent); border-radius: 50%; animation: spin .8s linear infinite; }
.picker-error { margin: 18px; padding: 12px 14px; color: var(--danger); background: var(--danger-background); border-radius: 7px; }
.picker-error button { margin-top: 8px; color: var(--workbench-foreground); background: none; border: 0; text-decoration: underline; text-underline-offset: 3px; cursor: pointer; }
.url-panel { padding: 22px; }
.url-panel label { display: block; margin-bottom: 7px; font-weight: 600; }
.url-row { display: flex; gap: 8px; }
.url-row input { min-width: 0; flex: 1; height: 36px; padding: 0 10px; color: var(--workbench-foreground); background: var(--input-background); border: 1px solid var(--workbench-border); border-radius: 7px; outline: 0; font: inherit; }
.url-row input:focus { border-color: var(--accent); box-shadow: 0 0 0 2px var(--focus-ring); }
.primary-button { min-width: 112px; padding: 0 14px; color: var(--accent-foreground); background: var(--accent); border: 0; border-radius: 7px; font: inherit; font-weight: 650; cursor: pointer; }
.primary-button:disabled { cursor: default; opacity: .55; }
.url-help { margin-top: 7px; color: var(--faint-foreground); font-size: 11.5px; }
.inline-error { margin-top: 16px; color: var(--danger); }
.github-action-error { margin: 4px 18px 6px; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }
</style>
