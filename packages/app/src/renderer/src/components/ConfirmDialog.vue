<script setup lang="ts">
import { ref, watch } from "vue";

/**
 * A modal for the one thing in this app that cannot be undone.
 *
 * Built on the native `<dialog>` rather than a floating div: it brings the focus trap,
 * the backdrop, Escape, and the top layer with it, and none of those are worth
 * reimplementing for a two-button question.
 */

const props = defineProps<{
  open: boolean;
  title: string;
  detail?: string;
  confirmLabel: string;
}>();
const emit = defineEmits<{ confirm: []; cancel: [] }>();

const dialog = ref<HTMLDialogElement | null>(null);

watch(() => props.open, (open) => {
  const element = dialog.value;
  if (element === null) return;
  if (open && !element.open) element.showModal();
  if (!open && element.open) element.close();
});
</script>

<template>
  <!-- `close` fires for Escape and for the backdrop, so cancelling never needs its own
       key handling. -->
  <dialog ref="dialog" class="confirm" @close="emit('cancel')" @cancel.prevent="emit('cancel')">
    <h2>{{ title }}</h2>
    <p v-if="detail" class="detail">{{ detail }}</p>
    <div class="actions">
      <button type="button" class="cancel" @click="emit('cancel')">Cancel</button>
      <!-- Focused on open, matching the editor this app is modelled on: the reviewer
           opened this dialog on purpose, and Escape is always the way out. -->
      <button ref="confirmButton" type="button" class="danger" autofocus @click="emit('confirm')">
        {{ confirmLabel }}
      </button>
    </div>
  </dialog>
</template>

<style scoped>
.confirm {
  min-width: 340px; max-width: 460px; padding: 18px 20px 16px;
  border: 1px solid var(--workbench-border); border-radius: 8px;
  background: var(--panel-background); color: var(--workbench-foreground);
  box-shadow: 0 16px 40px rgb(0 0 0 / .45);
}
.confirm::backdrop { background: rgb(0 0 0 / .45); }
h2 { font-size: 14px; line-height: 1.35; }
.detail { margin-top: 7px; color: var(--faint-foreground); font-size: 12px; line-height: 1.5; }
.actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
button {
  height: 28px; padding: 0 13px; border-radius: 5px; border: 1px solid var(--workbench-border);
  background: var(--input-background); color: var(--workbench-foreground);
  font: inherit; font-size: 12px; cursor: pointer;
}
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.danger { border-color: var(--danger); background: var(--danger); color: var(--workbench-background); }
</style>
