<script setup lang="ts">
import { computed } from "vue";
import { ChevronDown, ChevronRight, FolderGit2, GitBranch, FolderPlus } from "lucide-vue-next";
import type { Store } from "../store.js";
import ReviewingList from "./ReviewingList.vue";

const props = defineProps<{ store: Store }>();
const emit = defineEmits<{ openFolder: [] }>();
const selectedRepo = computed(() => props.store.repos.find((repo) => repo.repoId === props.store.navigatorRepoId) ?? null);
const name = (repoId: string): string => repoId.split("/").at(-1) ?? repoId;
const worktreeLabel = (path: string, branch: string | null, sha: string): string => branch ?? `${path.split("/").at(-1) ?? "Detached"} · ${sha.slice(0, 8)}`;
</script>

<template>
  <aside class="navigator">
    <header>
      <span>Repositories</span>
      <button aria-label="Open repository folder" title="Open repository folder" @click="emit('openFolder')"><FolderPlus :size="16" /></button>
    </header>
    <div class="repo-list">
      <section v-for="repo in store.repos" :key="repo.repoId" class="repo">
        <button class="repo-row" :class="{ selected: repo.repoId === store.navigatorRepoId }" :aria-expanded="repo.repoId === store.navigatorRepoId" :aria-controls="`repo-${repo.repoId.replace('/', '-')}-contexts`" @click="store.selectRepo(repo.repoId)">
          <ChevronDown v-if="repo.repoId === store.navigatorRepoId" :size="14" />
          <ChevronRight v-else :size="14" />
          <FolderGit2 :size="16" />
          <span>{{ name(repo.repoId) }}</span>
        </button>
        <div v-if="repo.repoId === store.navigatorRepoId" :id="`repo-${repo.repoId.replace('/', '-')}-contexts`" class="contexts">
          <template v-if="selectedRepo?.localPath">
            <div class="group-label">Worktrees <span>{{ store.worktrees.length }}</span></div>
            <button v-for="worktree in store.worktrees" :key="worktree.path" class="context-row" :aria-current="store.activeTabKey === `local:${repo.repoId}:${worktree.path}` ? 'page' : undefined" @click="store.openLocal(worktree.path)">
              <GitBranch :size="14" />
              <span>{{ worktreeLabel(worktree.path, worktree.branch, worktree.headSha) }}</span>
            </button>
          </template>
          <div v-else class="hint">Open this repository from disk to discover its worktrees.</div>
          <div class="group-label">Pull requests <span>{{ store.prs.length }}</span></div>
          <ReviewingList v-if="store.prs.length" :prs="store.prs" :selected-pr-number="store.currentRepoId === repo.repoId ? store.view?.pr.number ?? null : null" @select="store.openPr" />
          <div v-if="store.prs.length === 0" class="hint">No open pull requests.</div>
        </div>
      </section>
      <button class="open-folder" @click="emit('openFolder')"><FolderPlus :size="16" /> Open repository folder…</button>
    </div>
  </aside>
</template>

<style scoped>
.navigator { width: 248px; flex: none; display: flex; flex-direction: column; min-height: 0; background: var(--panel-background); border-right: 1px solid var(--workbench-border); }
header { height: 35px; padding-inline: 12px 7px; display: flex; align-items: center; justify-content: space-between; text-transform: uppercase; letter-spacing: .55px; font-size: 10px; font-weight: 700; color: var(--muted-foreground); }
header button { width: 26px; height: 26px; display: grid; place-items: center; color: inherit; background: none; border: 0; border-radius: 5px; cursor: pointer; }
header button:hover { background: var(--hover-background); color: var(--workbench-foreground); }
.repo-list { overflow: auto; scrollbar-gutter: stable; padding-bottom: 12px; }
button { font: inherit; }
.repo-row, .context-row, .open-folder { width: 100%; min-height: 28px; display: flex; align-items: center; gap: 7px; padding: 4px 10px; border: 0; background: none; color: var(--muted-foreground); text-align: left; cursor: pointer; }
.repo-row { font-weight: 650; color: var(--workbench-foreground); }
.repo-row.selected { background: var(--hover-background); }
.repo-row:hover, .context-row:hover, .open-folder:hover { background: var(--hover-background); }
.repo-row:focus-visible, .context-row:focus-visible, .open-folder:focus-visible, header button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.context-row { padding-inline-start: 31px; }
.context-row span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.group-label { margin: 9px 10px 3px 31px; display: flex; justify-content: space-between; color: var(--faint-foreground); text-transform: uppercase; letter-spacing: .45px; font-size: 9px; font-weight: 700; }
.hint { margin: 5px 12px 9px 31px; color: var(--faint-foreground); font-size: 11px; line-height: 1.35; }
.open-folder { margin-top: 8px; color: var(--accent); }
</style>
