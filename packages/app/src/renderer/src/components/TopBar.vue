<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import type { Store } from "../store.js";
import { ChevronDown, FolderGit2, GitPullRequest, MessageSquare, Plus, RefreshCw, Settings } from "lucide-vue-next";
import SwitcherDropdown from "./SwitcherDropdown.vue";

const props = defineProps<{
  store: Store;
  questions: number;
  settingsActive: boolean;
  integratedTitleBar: boolean;
}>();
const emit = defineEmits<{ toggleQuestions: []; toggleSettings: [] }>();

const repoOpen = ref(false);
const reviewOpen = ref(false);
const addingRepo = ref(false);
const newRepoUrl = ref("");

function toggleRepo() {
  reviewOpen.value = false;
  repoOpen.value = !repoOpen.value;
  if (!repoOpen.value) addingRepo.value = false;
}

function toggleReview() {
  repoOpen.value = false;
  reviewOpen.value = !reviewOpen.value;
}

function toggleSettings(): void {
  closeAll();
  emit("toggleSettings");
}

function closeAll() {
  repoOpen.value = false;
  reviewOpen.value = false;
  addingRepo.value = false;
}

async function pickRepo(repoId: string) {
  await props.store.selectRepo(repoId);
  closeAll();
}

async function submitAddRepo() {
  const url = newRepoUrl.value.trim();
  if (!url) return;
  await props.store.addRepo(url);
  newRepoUrl.value = "";
  addingRepo.value = false;
}

async function pickPr(prNumber: number) {
  await props.store.openPr(prNumber);
  closeAll();
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") closeAll();
}

onMounted(() => window.addEventListener("keydown", onKeydown));
onUnmounted(() => window.removeEventListener("keydown", onKeydown));

function repoName(repoId: string): string {
  return repoId.split("/").pop() ?? repoId;
}

function repoOwner(repoId: string): string | null {
  const parts = repoId.split("/");
  return parts.length > 1 ? parts.slice(0, -1).join("/") : null;
}

const currentRepoLabel = computed(() =>
  props.store.currentRepoId ? repoName(props.store.currentRepoId) : "Select repo",
);
const currentPr = computed(() => props.store.view?.pr ?? null);
const progress = computed(() => props.store.progress());
const TITLE_BAR_INSET = 78;
const titleBarInset = computed(() => props.integratedTitleBar ? TITLE_BAR_INSET : 0);
</script>

<template>
  <div
    class="topbar"
    :class="{ 'integrated-titlebar': integratedTitleBar }"
    :style="{ paddingLeft: titleBarInset ? `${titleBarInset}px` : undefined }"
  >
    <div
      class="seg seg-repo"
      role="button"
      tabindex="0"
      aria-haspopup="listbox"
      :aria-expanded="repoOpen"
      @click.stop="toggleRepo"
      @keydown.enter.space.prevent="toggleRepo"
    >
      <FolderGit2 class="ic" :size="18" />
      <div class="col">
        <span class="lbl">Repository</span>
        <span class="val">{{ currentRepoLabel }}<ChevronDown class="caret" :size="14" /></span>
      </div>
    </div>
    <div
      class="seg seg-review"
      role="button"
      tabindex="0"
      aria-haspopup="listbox"
      :aria-expanded="reviewOpen"
      @click.stop="toggleReview"
      @keydown.enter.space.prevent="toggleReview"
    >
      <GitPullRequest class="ic" :size="18" />
      <div class="col">
        <span class="lbl">Reviewing</span>
        <span class="val">
          <template v-if="currentPr">
            <span class="chip" :class="{ draft: currentPr.draft }">{{ currentPr.draft ? "Draft " : "" }}#{{ currentPr.number }}</span>
            {{ currentPr.title }}
          </template>
          <template v-else>Select a pull request</template>
          <ChevronDown class="caret" :size="14" />
        </span>
      </div>
    </div>
    <div class="spacer" />
    <div class="right">
      <button
        class="fetch"
        :class="{ active: settingsActive }"
        aria-label="Editor settings"
        title="Editor settings"
        :aria-pressed="settingsActive"
        @click.stop="toggleSettings"
      >
        <Settings :size="16" />
      </button>
      <button
        v-if="store.view"
        class="fetch"
        aria-label="Questions"
        title="Questions (press n to capture one)"
        @click="$emit('toggleQuestions')"
      >
        <MessageSquare :size="16" />
        <span v-if="questions" class="badge">{{ questions }}</span>
      </button>
      <button
        v-if="store.view"
        class="fetch"
        :disabled="store.busy"
        aria-label="Fetch origin"
        title="Fetch origin — also runs every 30 seconds and whenever the window regains focus"
        @click="store.fetchNow()"
      >
        <RefreshCw :size="16" :class="{ spin: store.busy }" />
      </button>
      <span class="progress"><b>{{ progress.done }}</b>/{{ progress.total }} reviewed</span>
    </div>
  </div>

  <SwitcherDropdown :open="repoOpen" :left="titleBarInset" :width="320" @close="closeAll">
    <div class="sw-h">REPOSITORIES</div>
    <div
      v-for="repo in store.repos"
      :key="repo.repoId"
      class="sw-item"
      role="option"
      tabindex="0"
      @click="pickRepo(repo.repoId)"
      @keydown.enter.space.prevent="pickRepo(repo.repoId)"
    >
      <FolderGit2 class="ic" :size="16" />
      <span class="nm">{{ repoName(repo.repoId) }}</span>
      <span v-if="repoOwner(repo.repoId)" class="meta">{{ repoOwner(repo.repoId) }}</span>
    </div>
    <div
      v-if="!addingRepo"
      class="sw-item"
      role="button"
      tabindex="0"
      @click.stop="addingRepo = true"
      @keydown.enter.space.prevent="addingRepo = true"
    >
      <Plus class="ic" :size="16" />
      <span class="nm add">Add repository…</span>
    </div>
    <form v-else class="add-row" @submit.prevent="submitAddRepo">
      <input v-model="newRepoUrl" placeholder="https://github.com/owner/repo" autofocus @click.stop />
    </form>
  </SwitcherDropdown>

  <SwitcherDropdown :open="reviewOpen" :left="190 + titleBarInset" :width="460" @close="closeAll">
    <div class="sw-h">OPEN PULL REQUESTS</div>
    <div v-if="store.prs.length === 0" class="sw-empty">No open pull requests</div>
    <div
      v-for="pr in store.prs"
      :key="pr.number"
      class="sw-item"
      role="option"
      tabindex="0"
      @click="pickPr(pr.number)"
      @keydown.enter.space.prevent="pickPr(pr.number)"
    >
      <span class="dot" :class="pr.draft ? 'draft' : 'open'" />
      <span class="num">#{{ pr.number }}</span>
      <span class="nm">{{ pr.title }}</span>
    </div>
  </SwitcherDropdown>

</template>

<style scoped>
.topbar { display: flex; align-items: stretch; background: var(--panel-background); border-bottom: 1px solid var(--workbench-border); height: 50px; }
.topbar.integrated-titlebar {
  user-select: none;
  -webkit-app-region: drag;
}
.integrated-titlebar .seg,
.integrated-titlebar .right,
.integrated-titlebar button,
.integrated-titlebar [role="button"] {
  -webkit-app-region: no-drag;
}
.seg { display: flex; align-items: center; gap: 10px; padding: 0 14px; min-width: 0; border-right: 1px solid var(--workbench-border); cursor: pointer; position: relative; }
.seg:hover { background: var(--hover-background); }
.seg:focus-visible, .sw-item:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.seg .ic { color: var(--muted-foreground); flex: none; }
.seg .col { display: flex; flex-direction: column; justify-content: center; min-width: 0; }
.seg .lbl { font-size: 10px; letter-spacing: .4px; color: var(--faint-foreground); text-transform: uppercase; }
.seg .val { font-size: 12.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center; gap: 6px; }
.seg .caret { color: var(--faint-foreground); flex: none; margin-left: 4px; }
.seg-repo { width: 190px; }
.seg-review { flex: 1; max-width: 430px; }

.chip { font: 10.5px var(--mono); background: var(--badge-background); color: var(--muted-foreground); border-radius: 9px; padding: 0 7px; white-space: nowrap; flex: none; }
.chip.draft { color: var(--warning); border: 1px solid var(--warning); background: var(--warning-background); }

.spacer { flex: 1; }
.right { display: flex; align-items: center; gap: 10px; padding: 0 12px; }
.progress { font-size: 12px; color: var(--muted-foreground); background: var(--badge-background); border-radius: 10px; padding: 2px 10px; white-space: nowrap; }
.progress b { color: var(--success); }
/* Icon-only, sized to stay a comfortable pointer target at any zoom level. */
.fetch {
  display: flex; align-items: center; justify-content: center;
  width: 28px; height: 28px;
  background: none; border: 1px solid var(--workbench-border); border-radius: 6px;
  color: var(--workbench-foreground); cursor: pointer;
}
.fetch:hover:not(:disabled) { background: var(--hover-background); }
.fetch.active { border-color: var(--accent); background: var(--selection-background); color: var(--accent); }
.fetch:disabled { cursor: default; color: var(--faint-foreground); }
.fetch { position: relative; }
.badge {
  position: absolute; top: -5px; right: -5px;
  min-width: 15px; height: 15px; padding: 0 3px;
  border-radius: 8px; background: var(--accent); color: var(--accent-foreground);
  font: 700 9.5px var(--mono); display: flex; align-items: center; justify-content: center;
}
.fetch .spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .fetch .spin { animation: none; } }

.sw-h { font-size: 10.5px; letter-spacing: .8px; color: var(--faint-foreground); font-weight: 700; padding: 10px 14px 4px; }
.sw-empty { padding: 10px 14px; color: var(--faint-foreground); font-size: 12px; }
.sw-item { display: flex; align-items: center; gap: 8px; padding: 6px 14px; cursor: pointer; }
.sw-item:hover { background: var(--selection-background); }
.sw-item .ic { color: var(--muted-foreground); flex: none; }
.sw-item .num { font: 12px var(--mono); color: var(--muted-foreground); }
.sw-item .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sw-item .nm.add { color: var(--accent); }
.sw-item .meta { margin-left: auto; font: 11px var(--mono); color: var(--faint-foreground); }

.dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
.dot.draft { background: var(--warning); }
.dot.open { background: var(--success); }

.add-row { padding: 10px 12px; }
.add-row input { width: 100%; background: var(--secondary-panel-background); border: 1px solid var(--workbench-border); border-radius: 7px; color: var(--workbench-foreground); font-size: 13px; padding: 7px 10px; outline: none; }
.add-row input:focus { border-color: var(--accent); }
</style>
