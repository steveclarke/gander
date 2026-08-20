<script setup lang="ts">
import { computed, ref } from "vue";
import { MessageSquare, Plus } from "@lucide/vue";
import type { Store } from "../store.js";
import type { EditorSettings } from "../../../settings.js";
import type { NoteTarget } from "../selection.js";
import { notesDock, notesHeight, notesWidth } from "../layout.js";
import ContextToolbar from "./ContextToolbar.vue";
import DiffPane from "./DiffPane.vue";
import EmptyState from "./EmptyState.vue";
import NotesDrawer from "./NotesDrawer.vue";
import Splitter from "./Splitter.vue";
import StackPosition from "./StackPosition.vue";

const props = defineProps<{
  store: Store;
  editorSettings: EditorSettings;
  repoName: string;
  drawerOpen: boolean;
}>();
const emit = defineEmits<{
  chooseRepo: [];
  addNote: [target?: NoteTarget];
  "update:drawerOpen": [open: boolean];
}>();

const diffPane = ref<InstanceType<typeof DiffPane> | null>(null);
const noteCount = computed(() => props.store.view?.notes.length ?? 0);
const notesSize = computed({
  get: () => (notesDock.value === "right" ? notesWidth.value : notesHeight.value),
  set: (value: number) => {
    if (notesDock.value === "right") notesWidth.value = value;
    else notesHeight.value = value;
  },
});

// The keymap reaches the diff through the surface that owns it: which diff is on screen
// is this component's answer, not the window's.
defineExpose({
  goToChange(target: "next" | "previous"): void { diffPane.value?.goToChange(target); },
  showDelta(): void { diffPane.value?.showDelta(); },
});
</script>

<template>
  <ContextToolbar
    v-if="store.view && store.currentRepoId === store.targetRepoId"
    :title="repoName"
    refresh-label="Fetch origin"
    :busy="store.busy"
    :progress="`${store.progress().done}/${store.progress().total} reviewed`"
    @refresh="store.fetchNow()"
  >
    <template #subtitle>
      <StackPosition v-if="store.view.pr.stack" class="header-stack-position" :position="store.view.pr.stack.position" :size="store.view.pr.stack.size" /> #{{ store.view.pr.number }} {{ store.view.pr.title }}
    </template>
    <button aria-label="Add note (N)" title="Add note (N)" @click="emit('addNote')"><Plus :size="14" /> Note</button>
    <button aria-label="Notes" :title="`Notes (${noteCount})`" @click="emit('update:drawerOpen', !drawerOpen)"><MessageSquare :size="15" /><span v-if="noteCount">{{ noteCount }}</span></button>
  </ContextToolbar>
  <section class="work-surface">
    <p v-if="store.busy && !store.view" class="empty"><span class="spinner spin" />Opening pull request…</p>
    <EmptyState
      v-else-if="!store.targetRepoId"
      title="Open a repository from disk"
      detail="Pull requests belong to the repository you choose as your target."
    >
      <button type="button" @click="emit('chooseRepo')">Open repository folder…</button>
    </EmptyState>
    <EmptyState
      v-else-if="!store.view || store.currentRepoId !== store.targetRepoId"
      title="Select a pull request"
      detail="Choose a pull request or stack from the sidebar to begin reviewing."
    />
    <div v-else class="workspace" :class="notesDock">
      <DiffPane ref="diffPane" :store="store" :editor-settings="editorSettings" class="diff" @add-note="emit('addNote', $event)" />
      <template v-if="drawerOpen">
        <Splitter v-model="notesSize" :orientation="notesDock === 'right' ? 'vertical' : 'horizontal'" :min="notesDock === 'right' ? 220 : 120" :max="700" inverted />
        <NotesDrawer
          :store="store"
          class="drawer"
          :dock="notesDock"
          :style="notesDock === 'right' ? { width: `${notesWidth}px` } : { height: `${notesHeight}px` }"
          @dock="notesDock = $event"
          @close="emit('update:drawerOpen', false)"
          @add-note="emit('addNote')"
        />
      </template>
    </div>
  </section>
</template>

<style scoped src="../styles/work-surface.css"></style>

<style scoped>
.workspace { flex: 1; display: flex; min-width: 0; min-height: 0; }
.workspace.right { flex-direction: row; }
.workspace.bottom { flex-direction: column; }
.drawer { flex: none; }
.workspace.bottom .drawer { border-left: none; border-top: 1px solid var(--workbench-border); }
</style>
