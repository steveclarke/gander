<script setup lang="ts">
import { computed, reactive, shallowRef } from "vue";
import type { Question } from "@gander/shared";
import { Copy, MessageSquare, PanelBottom, PanelRight, Plus, X } from "lucide-vue-next";
import type { Store } from "../store.js";
import { revealLine } from "../selection.js";
import QuestionThread from "./QuestionThread.vue";

const props = defineProps<{ store: Store; dock: "right" | "bottom" }>();
const emit = defineEmits<{ close: []; dock: ["right" | "bottom"]; addQuestion: [] }>();

const questions = computed(() => props.store.view?.questions ?? []);
const drafts = reactive<Record<number, string>>({});
const submitting = reactive(new Set<number>());
const copiedQuestionId = shallowRef<number | null>(null);
const copiedAll = shallowRef(false);

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

function questionMarkdown(question: Question): string {
  const location = question.path === null
    ? "Pull request"
    : `${question.path}${question.line === null ? "" : `:${question.line}`}`;
  const parts = [
    `### ${location} — ${question.state}`,
    "",
    `Reviewer: ${question.text}`,
  ];
  if (question.note || question.commitRef) {
    const commit = question.commitRef ? ` (${question.commitRef})` : "";
    parts.push("", `Agent update${commit}: ${question.note ?? "Addressed"}`);
  }
  for (const threadReply of question.replies) {
    parts.push("", `${threadReply.author === "reviewer" ? "Reviewer" : "Agent"}: ${threadReply.text}`);
  }
  return parts.join("\n");
}

async function copyText(text: string, questionId: number | null): Promise<void> {
  try {
    if (!navigator.clipboard) throw new Error("Clipboard access is unavailable");
    await navigator.clipboard.writeText(text);
    copiedQuestionId.value = questionId;
    copiedAll.value = questionId === null;
  } catch (error) {
    props.store.error = (error as Error).message;
  }
}

async function copyQuestion(question: Question): Promise<void> {
  await copyText(questionMarkdown(question), question.id);
}

async function copyAll(): Promise<void> {
  await copyText(questions.value.map(questionMarkdown).join("\n\n"), null);
}
</script>

<template>
  <aside class="drawer" aria-label="Questions">
    <header>
      <MessageSquare :size="15" />
      <h2 class="title">Questions</h2>
      <span class="count">{{ questions.length }}</span>
      <button
        v-if="questions.length > 0"
        class="copy-all"
        aria-label="Copy all question threads"
        title="Copy all question threads"
        @click="copyAll"
      >
        <Copy :size="13" aria-hidden="true" />
        <span>{{ copiedAll ? "Copied" : "Copy all" }}</span>
      </button>
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

    <ul v-else aria-label="Review questions">
      <QuestionThread
        v-for="question in questions"
        :key="question.id"
        v-model="drafts[question.id]"
        :question="question"
        :current="question.path === store.selectedPath"
        :submitting="submitting.has(question.id)"
        :copied="copiedQuestionId === question.id"
        @navigate="goTo"
        @reply="reply"
        @copy="copyQuestion"
        @delete="store.deleteQuestion"
      />
    </ul>
  </aside>
</template>

<style scoped>
.drawer { container: questions / inline-size; display: flex; flex-direction: column; background: var(--panel-background); border-left: 1px solid var(--workbench-border); overflow: hidden auto; }
header { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--workbench-border); color: var(--muted-foreground); flex: none; }
.title { margin: 0; font-size: 12px; font-weight: 600; letter-spacing: .3px; text-transform: uppercase; }
.count { font: 11px var(--mono); background: var(--badge-background); border-radius: 9px; padding: 1px 7px; }
.add, .copy-all {
  display: flex; align-items: center; gap: 4px;
  background: none; border: 1px solid var(--workbench-border); border-radius: 5px;
  color: var(--workbench-foreground); padding: 3px 7px; font: inherit; font-size: 11px; cursor: pointer;
}
.copy-all { margin-left: auto; }
.add:first-of-type { margin-left: auto; }
.add:hover, .copy-all:hover { border-color: var(--accent); color: var(--accent); }
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
.add:focus-visible, .copy-all:focus-visible, .empty button:focus-visible, .close:focus-visible {
  outline: 2px solid var(--accent); outline-offset: 2px;
}
kbd { font: 11px var(--mono); background: var(--badge-background); border: 1px solid var(--workbench-border); border-radius: 4px; padding: 1px 5px; }

ul { list-style: none; margin: 0; padding: 0; }
@container questions (max-width: 330px) {
  .copy-all span, .add span { display: none; }
}
</style>
