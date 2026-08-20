<script setup lang="ts">
import type { ResolvedFileIcon } from "../icon-theme.js";

// The id rides along as an attribute because it names the icon the theme actually chose,
// which is the only way a test can tell one 16px square from another.
defineProps<{ icon: ResolvedFileIcon }>();
</script>

<template>
  <img class="file-icon" :src="icon.src" :data-icon-id="icon.id" alt="" aria-hidden="true" draggable="false">
</template>

<style scoped>
.file-icon { width: 16px; height: 16px; flex: none; object-fit: contain; }
</style>
