<script setup lang="ts">
/**
 * What fills the work surface when there is nothing to review yet: why it is empty, and
 * the one action that ends that. The action is a slot because each surface reaches for a
 * different one.
 */
defineProps<{ title: string; detail: string }>();
</script>

<template>
  <div class="empty-state">
    <h1>{{ title }}</h1>
    <p>{{ detail }}</p>
    <slot />
  </div>
</template>

<style scoped>
.empty-state { margin: auto; max-width: 460px; padding: 40px; text-align: center; color: var(--muted-foreground); }
h1 { margin: 0 0 10px; color: var(--workbench-foreground); font-size: 22px; letter-spacing: -.02em; }
p { margin: 0 0 22px; line-height: 1.55; }
.empty-state :slotted(button) { min-height: 32px; padding: 6px 13px; border: 1px solid var(--accent); border-radius: var(--radius-md); background: var(--accent); color: var(--accent-foreground); font: inherit; cursor: pointer; }
.empty-state :slotted(button:focus-visible) { outline: 2px solid var(--accent); outline-offset: 2px; }
/* The second way out of an empty state is never as important as the first. */
.empty-state :slotted(.text-action) { display: block; margin: 14px auto 0; border: 0; background: none; color: var(--accent); }
</style>
