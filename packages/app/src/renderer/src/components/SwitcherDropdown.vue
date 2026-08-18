<script setup lang="ts">
const props = defineProps<{ open: boolean; left?: number; right?: number; width?: number }>();
const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="veil" @click="emit('close')" />
    <div
      v-if="open"
      class="dd"
      :style="{
        left: props.right === undefined ? `${props.left ?? 0}px` : undefined,
        right: props.right === undefined ? undefined : `${props.right}px`,
        width: props.width ? `${props.width}px` : undefined,
      }"
    >
      <slot />
    </div>
  </Teleport>
</template>

<style scoped>
.veil { position: fixed; inset: 0; z-index: 30; }
.dd { position: fixed; top: 51px; background: var(--panel); border: 1px solid var(--border); border-radius: 0 0 12px 12px; box-shadow: 0 20px 50px rgba(0,0,0,.5); max-height: 65vh; overflow: auto; z-index: 31; min-width: 320px; }
</style>
