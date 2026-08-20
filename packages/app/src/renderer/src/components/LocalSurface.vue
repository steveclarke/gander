<script setup lang="ts">
import type { Store } from "../store.js";
import type { EditorSettings } from "../../../settings.js";
import ContextToolbar from "./ContextToolbar.vue";
import DiffPane from "./DiffPane.vue";
import EmptyState from "./EmptyState.vue";
import FullFilePane from "./FullFilePane.vue";

/**
 * A worktree on this machine: its files in Explorer, or what is uncommitted in it under
 * Current Diff. Nothing here is reviewable — there is no checkoff, no note, and no
 * pull request behind it.
 */
defineProps<{
  store: Store;
  editorSettings: EditorSettings;
  mode: "explorer" | "changes";
  repoName: string;
  /** No review service configured, so the offer to connect one is worth making here. */
  unconfigured: boolean;
}>();
defineEmits<{ chooseRepo: [repoId?: string]; connectService: [] }>();
</script>

<template>
  <ContextToolbar
    v-if="store.localView"
    :title="repoName"
    refresh-label="Refresh local changes"
    :busy="store.busy"
    :progress="`${store.localView.files.length} changed`"
    progress-class="local-progress"
    @refresh="store.fetchNow()"
  >
    <template #subtitle>{{ store.localView.worktree.branch ?? store.localView.worktree.headSha.slice(0, 8) }}</template>
  </ContextToolbar>
  <section class="work-surface">
    <p v-if="store.busy && !store.localView" class="empty"><span class="spinner spin" />Opening worktree…</p>
    <EmptyState
      v-else-if="!store.targetRepoId"
      title="Open a repository from disk"
      detail="Gander will discover its linked worktrees and pull requests from one local checkout."
    >
      <button type="button" @click="$emit('chooseRepo')">Open repository folder…</button>
      <button v-if="unconfigured" class="text-action" type="button" @click="$emit('connectService')">Connect a review service for pull requests</button>
    </EmptyState>
    <EmptyState
      v-else-if="!store.targetWorktreePath"
      title="Checkout unavailable"
      detail="Gander cannot read the registered checkout for this repository."
    >
      <button type="button" @click="$emit('chooseRepo', store.targetRepoId ?? undefined)">Locate checkout…</button>
    </EmptyState>
    <div v-else-if="!store.localView" class="empty">Select the target again to load this worktree.</div>
    <FullFilePane v-else-if="mode === 'explorer'" :file="store.localFile" :editor-settings="editorSettings" class="diff" />
    <DiffPane v-else :store="store" :editor-settings="editorSettings" class="diff" />
  </section>
</template>

<style scoped src="../styles/work-surface.css"></style>
