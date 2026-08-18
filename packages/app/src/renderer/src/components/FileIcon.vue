<script setup lang="ts">
defineProps<{ src: string }>();
</script>

<template>
  <img class="file-icon" :src="src" alt="" aria-hidden="true" draggable="false" />
</template>

<style scoped>
.file-icon { width: 16px; height: 16px; flex: none; object-fit: contain; }
</style>
