<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from "vue";
import { api } from "../api.js";
import type { ServerChoiceRequest } from "../../../api.js";
import { choiceDetail, choiceTitle, claimLabel, initialChoice } from "../server-choice-text.js";

/**
 * The one question Gander asks about servers: which one a repository's notes belong on.
 *
 * Main sends it when a repository is first opened and no single server claims it, or when
 * the reviewer asks to change. Requests queue, so two repositories registered at once are
 * asked one after the other rather than over each other. Built on `<dialog>` like
 * ConfirmDialog, for the focus trap, backdrop and Escape.
 */

const queue = shallowRef<ServerChoiceRequest[]>([]);
const request = computed(() => queue.value[0] ?? null);
const selected = ref<string | null>(null);
const dialog = ref<HTMLDialogElement | null>(null);
const chosenName = computed(() => request.value?.claims.find((claim) => claim.serverId === selected.value)?.name ?? "");

async function show(): Promise<void> {
  const current = request.value;
  if (current === null) return;
  selected.value = initialChoice(current);
  await nextTick();
  if (dialog.value && !dialog.value.open) dialog.value.showModal();
}

function answer(serverId: string | null): void {
  const current = request.value;
  if (current === null) return;
  void api.answerServerChoice(current.requestId, serverId);
  queue.value = queue.value.slice(1);
  if (queue.value.length === 0) dialog.value?.close();
  else void show();
}

let unsubscribe = (): void => {};
onMounted(() => {
  unsubscribe = api.onChooseServer((incoming) => {
    queue.value = [...queue.value, incoming];
    if (queue.value.length === 1) void show();
  });
});
onBeforeUnmount(() => unsubscribe());
</script>

<template>
  <!-- `close` also fires after a programmatic close, so only an open question is cancelled. -->
  <dialog ref="dialog" class="server-choice" aria-labelledby="server-choice-title" @cancel.prevent="answer(null)">
    <form v-if="request" method="dialog" @submit.prevent="selected && answer(selected)">
      <h2 id="server-choice-title">{{ choiceTitle(request) }}</h2>
      <p class="detail">{{ choiceDetail(request) }}</p>
      <fieldset>
        <legend class="visually-hidden">Review server</legend>
        <label v-for="claim in request.claims" :key="claim.serverId" class="option" :class="{ selected: selected === claim.serverId }">
          <input v-model="selected" type="radio" name="server" :value="claim.serverId">
          <span class="option-text">
            <span class="option-name">{{ claim.name }}<span v-if="claim.serverId === request.currentServerId" class="current"> · current</span></span>
            <span class="option-claim" :class="claim.answer">{{ claimLabel(claim) }}</span>
          </span>
        </label>
      </fieldset>
      <div class="actions">
        <button type="button" class="cancel" @click="answer(null)">Cancel</button>
        <button type="submit" class="primary" :disabled="!selected">Use {{ chosenName }}</button>
      </div>
    </form>
  </dialog>
</template>

<style scoped>
.server-choice {
  width: min(440px, calc(100vw - 32px)); padding: 18px 20px 16px;
  border: 1px solid var(--workbench-border); border-radius: var(--radius-lg);
  background: var(--panel-background); color: var(--workbench-foreground);
  box-shadow: 0 16px 40px rgb(0 0 0 / .3);
}
.server-choice::backdrop { background: rgb(0 0 0 / .4); }
h2 { font-size: 14px; line-height: 1.35; overflow-wrap: anywhere; }
.detail { margin-top: 7px; color: var(--faint-foreground); font-size: 12px; line-height: 1.5; }
fieldset { display: flex; flex-direction: column; gap: 6px; margin: 14px 0 0; padding: 0; border: 0; }
.visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
.option {
  display: flex; align-items: flex-start; gap: 10px; padding: 10px 12px; cursor: pointer;
  border: 1px solid var(--workbench-border); border-radius: var(--radius-md); background: var(--input-background);
}
.option.selected { border-color: var(--accent); }
.option:has(input:focus-visible) { outline: 2px solid var(--accent); outline-offset: 1px; }
.option input { margin: 2px 0 0; accent-color: var(--accent); }
.option input:focus-visible { outline: none; }
.option-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.option-name { font-size: 13px; font-weight: 600; }
.current { color: var(--faint-foreground); font-weight: 400; }
.option-claim { color: var(--faint-foreground); font-size: 12px; overflow-wrap: anywhere; }
.option-claim.claimed { color: var(--success); }
.option-claim.unavailable { color: var(--warning); }
.actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
button {
  height: 28px; padding: 0 13px; border-radius: var(--radius-md); border: 1px solid var(--workbench-border);
  background: var(--input-background); color: var(--workbench-foreground);
  font: inherit; font-size: 12px; cursor: pointer;
}
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
button:disabled { opacity: .5; cursor: default; }
.primary { border-color: var(--accent); background: var(--accent); color: var(--accent-foreground); }
</style>
