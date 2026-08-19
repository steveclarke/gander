<script setup lang="ts">
import { Layers3 } from "@lucide/vue";

const props = defineProps<{ position: number; size: number }>();
</script>

<template>
  <span class="stack-position" role="img" :aria-label="`Stack position ${props.position} of ${props.size}`">
    <Layers3 :size="13" aria-hidden="true" />
    <span aria-hidden="true">{{ props.position }}/{{ props.size }}</span>
  </span>
</template>

<style scoped>
.stack-position {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex: none;
  color: var(--muted-foreground);
  font: 11px var(--mono);
  white-space: nowrap;
}
</style>
