<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import type { Store } from "../store.js";
import SwitcherDropdown from "./SwitcherDropdown.vue";

const props = defineProps<{ store: Store }>();

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
</script>

<template>
  <div class="topbar">
    <div
      class="seg seg-repo"
      role="button"
      tabindex="0"
      aria-haspopup="listbox"
      :aria-expanded="repoOpen"
      @click.stop="toggleRepo"
      @keydown.enter.space.prevent="toggleRepo"
    >
      <span class="ic">📁</span>
      <div class="col">
        <span class="lbl">Repository</span>
        <span class="val">{{ currentRepoLabel }}<span class="caret">▼</span></span>
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
      <span class="ic">⎇</span>
      <div class="col">
        <span class="lbl">Reviewing</span>
        <span class="val">
          <template v-if="currentPr">
            <span class="chip" :class="{ draft: currentPr.draft }">{{ currentPr.draft ? "Draft " : "" }}#{{ currentPr.number }}</span>
            {{ currentPr.title }}
          </template>
          <template v-else>Select a pull request</template>
          <span class="caret">▼</span>
        </span>
      </div>
    </div>
    <div class="spacer" />
    <div class="right">
      <span class="progress"><b>{{ progress.done }}</b>/{{ progress.total }} reviewed</span>
    </div>
  </div>

  <SwitcherDropdown :open="repoOpen" :left="0" :width="320" @close="closeAll">
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
      <span class="ic">📁</span>
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
      <span class="ic">＋</span>
      <span class="nm add">Add repository…</span>
    </div>
    <form v-else class="add-row" @submit.prevent="submitAddRepo">
      <input v-model="newRepoUrl" placeholder="https://github.com/owner/repo" autofocus @click.stop />
    </form>
  </SwitcherDropdown>

  <SwitcherDropdown :open="reviewOpen" :left="190" :width="460" @close="closeAll">
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
.topbar { display: flex; align-items: stretch; background: var(--panel); border-bottom: 1px solid var(--border); height: 50px; }
.seg { display: flex; align-items: center; gap: 10px; padding: 0 14px; min-width: 0; border-right: 1px solid var(--border); cursor: pointer; position: relative; }
.seg:hover { background: #232833; }
.seg:focus-visible, .sw-item:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.seg .ic { color: var(--dim); font-size: 14px; }
.seg .col { display: flex; flex-direction: column; justify-content: center; min-width: 0; }
.seg .lbl { font-size: 10px; letter-spacing: .4px; color: var(--faint); text-transform: uppercase; }
.seg .val { font-size: 12.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center; gap: 6px; }
.seg .caret { color: var(--faint); font-size: 9px; margin-left: 4px; }
.seg-repo { width: 190px; }
.seg-review { flex: 1; max-width: 430px; }

.chip { font: 10.5px var(--mono); background: #262b34; color: var(--dim); border-radius: 9px; padding: 0 7px; white-space: nowrap; flex: none; }
.chip.draft { color: var(--yellow); border: 1px solid rgba(210,153,34,.4); background: rgba(210,153,34,.08); }

.spacer { flex: 1; }
.right { display: flex; align-items: center; gap: 10px; padding: 0 12px; }
.progress { font-size: 12px; color: var(--dim); background: #262b34; border-radius: 10px; padding: 2px 10px; white-space: nowrap; }
.progress b { color: var(--green); }

.sw-h { font-size: 10.5px; letter-spacing: .8px; color: var(--faint); font-weight: 700; padding: 10px 14px 4px; }
.sw-empty { padding: 10px 14px; color: var(--faint); font-size: 12px; }
.sw-item { display: flex; align-items: center; gap: 8px; padding: 6px 14px; cursor: pointer; }
.sw-item:hover { background: rgba(77,159,236,.12); }
.sw-item .num { font: 12px var(--mono); color: var(--dim); }
.sw-item .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sw-item .nm.add { color: var(--accent); }
.sw-item .meta { margin-left: auto; font: 11px var(--mono); color: var(--faint); }

.dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
.dot.draft { background: var(--yellow); }
.dot.open { background: var(--green); }

.add-row { padding: 10px 12px; }
.add-row input { width: 100%; background: var(--panel2); border: 1px solid var(--border); border-radius: 7px; color: var(--text); font-size: 13px; padding: 7px 10px; outline: none; }
.add-row input:focus { border-color: var(--accent); }
</style>
