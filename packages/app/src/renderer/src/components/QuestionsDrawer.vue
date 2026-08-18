<script setup lang="ts">
import { computed, reactive } from "vue";
import { MessageSquare, PanelBottom, PanelRight, Plus, Trash2, X } from "lucide-vue-next";
import type { Store } from "../store.js";
import { revealLine } from "../selection.js";

const props = defineProps<{ store: Store; dock: "right" | "bottom" }>();
const emit = defineEmits<{ close: []; dock: ["right" | "bottom"]; addQuestion: [] }>();

const questions = computed(() => props.store.view?.questions ?? []);
const drafts = reactive<Record<number, string>>({});
const submitting = reactive(new Set<number>());

function fileName(path: string | null): string {
  if (path === null) return "This pull request";
  return path.split("/").pop() ?? path;
}

function goTo(q: { path: string | null; line: number | null }): void {
  if (q.path === null) return;
  props.store.select(q.path);
  if (q.line !== null) revealLine(q.line);
}

async function reply(questionId: number): Promise<void> {
  const text = drafts[questionId]?.trim() ?? "";
  if (!text || submitting.has(questionId)) return;
  const before = questions.value.find((q) => q.id === questionId)?.replies.length ?? 0;
  submitting.add(questionId);
  try {
    await props.store.addReviewerReply(questionId, text);
    const after = questions.value.find((q) => q.id === questionId)?.replies.length ?? 0;
    if (after > before) drafts[questionId] = "";
  } finally {
    submitting.delete(questionId);
  }
}
</script>

<template>
  <aside class="drawer">
    <header>
      <MessageSquare :size="15" />
      <span class="title">Questions</span>
      <span class="count">{{ questions.length }}</span>
      <button
        class="add"
        aria-label="Add question (N)"
        title="Add question (N)"
        @click="emit('addQuestion')"
      >
        <Plus :size="14" aria-hidden="true" />
        <span>Add</span>
      </button>
      <button
        class="close dockbtn"
        :aria-label="dock === 'right' ? 'Dock questions below the diff' : 'Dock questions beside the diff'"
        :title="dock === 'right' ? 'Dock below the diff' : 'Dock beside the diff'"
        @click="$emit('dock', dock === 'right' ? 'bottom' : 'right')"
      >
        <component :is="dock === 'right' ? PanelBottom : PanelRight" :size="15" />
      </button>
      <button class="close" aria-label="Close questions" title="Close questions" @click="$emit('close')">
        <X :size="15" />
      </button>
    </header>

    <div v-if="questions.length === 0" class="empty">
      <p>Capture a question about the selected file or line.</p>
      <button type="button" @click="emit('addQuestion')">
        <Plus :size="14" aria-hidden="true" />
        Add question <kbd>N</kbd>
      </button>
    </div>

    <ul v-else>
      <li v-for="q in questions" :key="q.id" :class="{ current: q.path === store.selectedPath }">
        <div class="row">
          <button class="file" :disabled="q.path === null" @click="goTo(q)">
            {{ fileName(q.path) }}<span v-if="q.line !== null" class="line">:{{ q.line }}</span>
          </button>
          <span class="state" :class="q.state">{{ q.state }}</span>
          <button class="del" aria-label="Delete question" title="Delete question" @click="store.deleteQuestion(q.id)">
            <Trash2 :size="13" />
          </button>
        </div>
        <div class="message original">
          <span class="author">Reviewer</span>
          <p class="text">{{ q.text }}</p>
        </div>
        <div v-for="reply in q.replies" :key="reply.id" class="message reply">
          <span class="author" :class="reply.author">{{ reply.author === "reviewer" ? "Reviewer" : "Agent" }}</span>
          <p class="text">{{ reply.text }}</p>
        </div>
        <p v-if="q.note || q.commitRef" class="answer">
          <span v-if="q.note">{{ q.note }}</span>
          <code v-if="q.commitRef">{{ q.commitRef }}</code>
        </p>
        <form class="reply-form" @submit.prevent="reply(q.id)">
          <input
            v-model="drafts[q.id]"
            data-app-typing="true"
            :aria-label="`Reply to question ${q.id}`"
            placeholder="Reply…"
            :disabled="submitting.has(q.id)"
          />
        </form>
      </li>
    </ul>
  </aside>
</template>

<style scoped>
.drawer { display: flex; flex-direction: column; background: var(--panel-background); border-left: 1px solid var(--workbench-border); overflow: hidden auto; }
header { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--workbench-border); color: var(--muted-foreground); flex: none; }
.title { font-size: 12px; font-weight: 600; letter-spacing: .3px; text-transform: uppercase; }
.count { font: 11px var(--mono); background: var(--badge-background); border-radius: 9px; padding: 1px 7px; }
.add {
  margin-left: auto; display: flex; align-items: center; gap: 4px;
  background: none; border: 1px solid var(--workbench-border); border-radius: 5px;
  color: var(--workbench-foreground); padding: 3px 7px; font: inherit; font-size: 11px; cursor: pointer;
}
.add:hover { border-color: var(--accent); color: var(--accent); }
.dockbtn { margin-left: 0; }
.dockbtn + .close { margin-left: 0; }
.close { margin-left: auto; background: none; border: none; color: var(--faint-foreground); cursor: pointer; display: flex; }
.close:hover { color: var(--workbench-foreground); }

.empty { color: var(--faint-foreground); font-size: 12px; padding: 16px 12px; line-height: 1.6; }
.empty p { margin-bottom: 10px; }
.empty button {
  display: flex; align-items: center; gap: 6px;
  background: var(--accent); border: 1px solid var(--accent); border-radius: 6px;
  color: var(--accent-foreground); padding: 5px 9px; font: inherit; font-size: 12px; font-weight: 600; cursor: pointer;
}
.empty button kbd { color: var(--workbench-foreground); }
.add:focus-visible, .empty button:focus-visible, .close:focus-visible, .del:focus-visible, .file:focus-visible {
  outline: 2px solid var(--accent); outline-offset: 2px;
}
kbd { font: 11px var(--mono); background: var(--badge-background); border: 1px solid var(--workbench-border); border-radius: 4px; padding: 1px 5px; }

ul { list-style: none; margin: 0; padding: 0; }
li { padding: 10px 12px; border-bottom: 1px solid var(--workbench-border); }
li.current { background: var(--selection-background); }
.row { display: flex; align-items: center; gap: 8px; }
.file { background: none; border: none; padding: 0; color: var(--accent); font: inherit; font-size: 12px; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file:disabled { color: var(--faint-foreground); cursor: default; }
.state { font: 10px var(--mono); color: var(--faint-foreground); text-transform: uppercase; letter-spacing: .4px; }
.state.addressed { color: var(--warning); }
.state.resolved { color: var(--success); }
.del { margin-left: auto; background: none; border: none; color: var(--faint-foreground); cursor: pointer; display: flex; flex: none; }
.del:hover { color: var(--danger); }
.line { color: var(--faint-foreground); }
.message { margin-top: 8px; padding-left: 9px; border-left: 2px solid var(--workbench-border); }
.message.reply { margin-left: 8px; }
.author { display: block; color: var(--muted-foreground); font: 600 9.5px var(--mono); letter-spacing: .4px; text-transform: uppercase; }
.author.agent { color: var(--accent); }
.answer { margin: 8px 0 0 10px; display: flex; align-items: baseline; gap: 7px; font-size: 11.5px; color: var(--faint-foreground); }
.answer code { font: 10.5px var(--mono); background: var(--badge-background); border-radius: 4px; padding: 1px 5px; flex: none; }
.text { margin: 3px 0 0; font-size: 12.5px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
.reply-form { margin-top: 9px; }
.reply-form input { width: 100%; background: var(--input-background); border: 1px solid var(--workbench-border); border-radius: 6px; color: var(--workbench-foreground); font: inherit; font-size: 12px; padding: 6px 8px; }
.reply-form input:focus { outline: none; border-color: var(--accent); }
.reply-form input:disabled { color: var(--faint-foreground); }
</style>
