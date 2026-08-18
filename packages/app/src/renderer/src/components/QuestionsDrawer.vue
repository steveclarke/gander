<script setup lang="ts">
import { computed, reactive } from "vue";
import { MessageSquare, PanelBottom, PanelRight, Trash2, X } from "lucide-vue-next";
import type { Store } from "../store.js";
import { revealLine } from "../selection.js";

const props = defineProps<{ store: Store; dock: "right" | "bottom" }>();
defineEmits<{ close: []; dock: ["right" | "bottom"] }>();

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

    <p v-if="questions.length === 0" class="empty">
      Press <kbd>n</kbd> while a file is selected to capture a question against it.
    </p>

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
.drawer { display: flex; flex-direction: column; background: var(--panel); border-left: 1px solid var(--border); overflow: hidden auto; }
header { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--border); color: var(--dim); flex: none; }
.title { font-size: 12px; font-weight: 600; letter-spacing: .3px; text-transform: uppercase; }
.count { font: 11px var(--mono); background: #262b34; border-radius: 9px; padding: 1px 7px; }
.dockbtn { margin-left: auto; }
.dockbtn + .close { margin-left: 0; }
.close { margin-left: auto; background: none; border: none; color: var(--faint); cursor: pointer; display: flex; }
.close:hover { color: var(--fg); }

.empty { color: var(--faint); font-size: 12px; padding: 16px 12px; line-height: 1.6; }
kbd { font: 11px var(--mono); background: #262b34; border: 1px solid var(--border); border-radius: 4px; padding: 1px 5px; }

ul { list-style: none; margin: 0; padding: 0; }
li { padding: 10px 12px; border-bottom: 1px solid var(--border); }
li.current { background: rgba(77,159,236,.08); }
.row { display: flex; align-items: center; gap: 8px; }
.file { background: none; border: none; padding: 0; color: var(--accent); font: inherit; font-size: 12px; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file:disabled { color: var(--faint); cursor: default; }
.state { font: 10px var(--mono); color: var(--faint); text-transform: uppercase; letter-spacing: .4px; }
.state.addressed { color: var(--yellow); }
.state.resolved { color: var(--green); }
.del { margin-left: auto; background: none; border: none; color: var(--faint); cursor: pointer; display: flex; flex: none; }
.del:hover { color: var(--red); }
.line { color: var(--faint); }
.message { margin-top: 8px; padding-left: 9px; border-left: 2px solid var(--border); }
.message.reply { margin-left: 8px; }
.author { display: block; color: var(--dim); font: 600 9.5px var(--mono); letter-spacing: .4px; text-transform: uppercase; }
.author.agent { color: var(--accent); }
.answer { margin: 8px 0 0 10px; display: flex; align-items: baseline; gap: 7px; font-size: 11.5px; color: var(--faint); }
.answer code { font: 10.5px var(--mono); background: #262b34; border-radius: 4px; padding: 1px 5px; flex: none; }
.text { margin: 3px 0 0; font-size: 12.5px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
.reply-form { margin-top: 9px; }
.reply-form input { width: 100%; background: #14161b; border: 1px solid var(--border); border-radius: 6px; color: var(--fg); font: inherit; font-size: 12px; padding: 6px 8px; }
.reply-form input:focus { outline: none; border-color: var(--accent); }
.reply-form input:disabled { color: var(--faint); }
</style>
