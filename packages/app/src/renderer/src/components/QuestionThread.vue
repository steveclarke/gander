<script setup lang="ts">
import { computed, shallowRef } from "vue";
import type { Question } from "@gander/shared";
import ConfirmDialog from "./ConfirmDialog.vue";
import {
  Check,
  CheckCheck,
  ChevronDown,
  CircleHelp,
  Copy,
  MessageSquare,
  Trash2,
} from "lucide-vue-next";

const props = defineProps<{
  question: Question;
  current: boolean;
  submitting: boolean;
  copied: boolean;
}>();
const emit = defineEmits<{
  navigate: [question: Question];
  reply: [questionId: number];
  copy: [question: Question];
  delete: [questionId: number];
}>();
const draft = defineModel<string>({ default: "" });

// Deleting a question is the only thing here that cannot be taken back: the text, the
// line it was captured against, and any reasoning an agent replied with all go together.
const confirmingDelete = shallowRef(false);

const deleteDetail = computed(() => {
  const replies = props.question.replies.length;
  const thread = replies === 0
    ? "The question"
    : `The question and ${replies === 1 ? "its reply" : `its ${replies} replies`}`;
  return `${thread} will be removed from the review. This cannot be undone.`;
});

// A keyed thread instance survives service refreshes, so a reviewer's disclosure
// choice remains stable even when a reply replaces the Question object.
const expanded = shallowRef(props.question.state === "open");
const bodyId = computed(() => `question-body-${props.question.id}`);
const titleId = computed(() => `question-title-${props.question.id}`);
const replyCount = computed(() => props.question.replies.length);
const replyCountLabel = computed(() => `${replyCount.value} ${replyCount.value === 1 ? "reply" : "replies"}`);
const location = computed(() => {
  if (props.question.path === null) return "This pull request";
  const name = props.question.path.split("/").pop() ?? props.question.path;
  return props.question.line === null ? name : `${name}:${props.question.line}`;
});

const timestamp = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : timestamp.format(date);
}
</script>

<template>
  <li
    class="thread"
    :class="[{ current }, `state-${question.state}`]"
    :data-question-id="question.id"
    :aria-labelledby="titleId"
  >
    <div class="thread-header">
      <div class="identity">
        <button
          class="location"
          data-question-location
          :disabled="question.path === null"
          :title="question.path ?? undefined"
          @click="emit('navigate', question)"
        >
          {{ location }}
        </button>
        <span class="state" :class="question.state">
          <CircleHelp v-if="question.state === 'open'" :size="12" aria-hidden="true" />
          <Check v-else-if="question.state === 'addressed'" :size="12" aria-hidden="true" />
          <CheckCheck v-else :size="12" aria-hidden="true" />
          {{ question.state }}
        </span>
      </div>
      <button
        class="disclosure"
        type="button"
        :aria-expanded="expanded"
        :aria-controls="bodyId"
        :aria-label="`${expanded ? 'Collapse' : 'Expand'} question ${question.id}`"
        @click="expanded = !expanded"
      >
        <span :id="titleId" class="preview">{{ question.text }}</span>
        <span class="reply-count">
          <MessageSquare :size="12" aria-hidden="true" />
          {{ replyCountLabel }}
        </span>
        <ChevronDown class="chevron" :class="{ expanded }" :size="15" aria-hidden="true" />
      </button>
    </div>

    <section v-show="expanded" :id="bodyId" class="thread-body" data-question-body>
      <div class="question-message">
        <div class="message-heading">
          <h3>Question</h3>
          <time :datetime="question.createdAt">{{ formatTimestamp(question.createdAt) }}</time>
        </div>
        <p class="message-text">{{ question.text }}</p>
      </div>

      <section v-if="question.note || question.commitRef" class="agent-update" aria-label="Agent update">
        <div class="message-heading">
          <h3>Agent update</h3>
          <code v-if="question.commitRef">{{ question.commitRef }}</code>
        </div>
        <p v-if="question.note" class="message-text">{{ question.note }}</p>
      </section>

      <section v-if="question.replies.length > 0" class="replies" aria-label="Replies">
        <h3>Replies</h3>
        <ol>
          <li v-for="reply in question.replies" :key="reply.id" class="reply">
            <div class="message-heading">
              <span class="author" :class="reply.author">
                {{ reply.author === "reviewer" ? "Reviewer" : "Agent" }}
              </span>
              <time :datetime="reply.createdAt">{{ formatTimestamp(reply.createdAt) }}</time>
            </div>
            <p class="message-text">{{ reply.text }}</p>
          </li>
        </ol>
      </section>

      <form class="reply-form" @submit.prevent="emit('reply', question.id)">
        <label :for="`question-reply-${question.id}`">Reply</label>
        <input
          :id="`question-reply-${question.id}`"
          v-model="draft"
          data-app-typing="true"
          :aria-label="`Reply to question ${question.id}`"
          placeholder="Reply…"
          :disabled="submitting"
        />
      </form>

      <div class="thread-actions">
        <button
          type="button"
          :aria-label="`Copy question ${question.id} thread`"
          @click="emit('copy', question)"
        >
          <Copy :size="13" aria-hidden="true" />
          {{ copied ? "Copied" : "Copy thread" }}
        </button>
        <button
          class="delete"
          type="button"
          :aria-label="`Delete question ${question.id}`"
          @click="confirmingDelete = true"
        >
          <Trash2 :size="13" aria-hidden="true" />
          Delete
        </button>
      </div>

      <ConfirmDialog
        :open="confirmingDelete"
        :title="`Delete this question?`"
        :detail="deleteDetail"
        confirm-label="Delete"
        @cancel="confirmingDelete = false"
        @confirm="confirmingDelete = false; emit('delete', question.id)"
      />
    </section>
  </li>
</template>

<style scoped>
.thread {
  border-bottom: 1px solid var(--workbench-border);
  border-left: 1px solid transparent;
  min-width: 0;
}
.thread.state-open { border-left-color: var(--accent); }
.thread.current { background: var(--selection-background); }
.thread-header { display: flex; flex-direction: column; gap: 5px; padding: 9px 10px 8px; min-width: 0; }
.identity { display: flex; align-items: center; gap: 8px; min-width: 0; }
.location {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  background: none; border: none; padding: 0; color: var(--accent); font: inherit; font-size: 11.5px; cursor: pointer;
}
.location:disabled { color: var(--faint-foreground); cursor: default; }
.state {
  display: inline-flex; align-items: center; gap: 3px; flex: none;
  border: 1px solid var(--workbench-border); border-radius: var(--radius-pill); padding: 1px 5px;
  color: var(--faint-foreground); font: 600 9px var(--mono); letter-spacing: .35px; text-transform: uppercase;
}
.state.open { color: var(--accent); }
.state.addressed { color: var(--warning); }
.state.resolved { color: var(--success); }
.disclosure {
  display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 8px;
  width: 100%; min-width: 0; padding: 2px 0; border: 0; background: none; color: inherit; cursor: pointer; text-align: left;
}
.preview { min-width: 0; overflow: hidden; color: var(--workbench-foreground); font-size: 12.5px; line-height: 1.35; text-overflow: ellipsis; white-space: nowrap; }
.reply-count { display: inline-flex; align-items: center; gap: 4px; color: var(--faint-foreground); font: 10px var(--mono); white-space: nowrap; }
.chevron { color: var(--faint-foreground); transition: transform 120ms ease; }
.chevron.expanded { transform: rotate(180deg); }
.thread-body { padding: 1px 10px 11px; }
.question-message, .agent-update, .replies { min-width: 0; border-radius: var(--radius-md); }
.question-message { padding: 9px 10px; background: var(--input-background); border: 1px solid var(--workbench-border); }
.agent-update, .replies { margin: 8px 0 0 12px; padding: 9px 10px; border-left: 1px solid var(--accent); background: color-mix(in srgb, var(--accent) 6%, transparent); }
.replies { border-left-color: var(--workbench-border); background: transparent; }
.message-heading { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; min-width: 0; }
.message-heading h3, .replies > h3, .author { margin: 0; color: var(--muted-foreground); font: 600 9.5px var(--mono); letter-spacing: .4px; text-transform: uppercase; }
.agent-update .message-heading h3, .author.agent { color: var(--accent); }
.message-heading time { min-width: 0; color: var(--faint-foreground); font-size: 9.5px; text-align: right; }
.message-heading code { overflow: hidden; max-width: 45%; padding: 1px 5px; border-radius: var(--radius-sm); background: var(--badge-background); color: var(--muted-foreground); font: 10px var(--mono); text-overflow: ellipsis; white-space: nowrap; }
.message-text { margin: 4px 0 0; min-width: 0; color: var(--workbench-foreground); font-size: 12.5px; line-height: 1.5; overflow-wrap: anywhere; white-space: pre-wrap; }
.replies ol { list-style: none; margin: 7px 0 0; padding: 0; }
.reply { padding: 8px 0; border-top: 1px solid var(--workbench-border); }
.reply:last-child { padding-bottom: 0; }
.reply-form { margin-top: 9px; }
.reply-form label { display: block; margin-bottom: 4px; color: var(--muted-foreground); font: 600 9.5px var(--mono); letter-spacing: .4px; text-transform: uppercase; }
.reply-form input { width: 100%; background: var(--input-background); border: 1px solid var(--workbench-border); border-radius: var(--radius-md); color: var(--workbench-foreground); font: inherit; font-size: 12px; padding: 6px 8px; }
.reply-form input:focus { outline: none; border-color: var(--accent); }
.reply-form input:disabled { color: var(--faint-foreground); }
.thread-actions { display: flex; align-items: center; gap: 12px; margin-top: 8px; }
.thread-actions button { display: inline-flex; align-items: center; gap: 5px; border: 0; padding: 2px 0; background: none; color: var(--muted-foreground); font: inherit; font-size: 10.5px; cursor: pointer; }
.thread-actions .delete { margin-left: auto; color: var(--faint-foreground); }
.thread-actions .delete:hover { color: var(--danger); }
.location:focus-visible, .disclosure:focus-visible, .thread-actions button:focus-visible {
  outline: 2px solid var(--accent); outline-offset: 2px;
}
@media (prefers-reduced-motion: reduce) { .chevron { transition: none; } }
</style>
