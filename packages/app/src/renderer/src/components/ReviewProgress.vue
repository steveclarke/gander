<script setup lang="ts">
import type { ReviewProgress } from "@gander/shared";
import { Check } from "@lucide/vue";

defineProps<{ progress: ReviewProgress }>();
</script>

<template>
  <span v-if="progress.done === progress.total" class="review-progress complete">
    <Check :size="13" aria-hidden="true" />
    Reviewed
  </span>
  <span v-else class="review-progress">{{ progress.done }}/{{ progress.total }} reviewed</span>
</template>

<style scoped>
.review-progress {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-left: auto;
  color: var(--muted-foreground);
  font: 11px var(--mono);
  white-space: nowrap;
}
.review-progress.complete { color: var(--success); }
</style>
