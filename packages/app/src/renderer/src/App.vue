<script setup lang="ts">
import { onMounted } from "vue";
import { api } from "./api.js";
import { createStore } from "./store.js";
import TopBar from "./components/TopBar.vue";
import FileTree from "./components/FileTree.vue";
import "./theme.css";

const store = createStore(api);
onMounted(() => store.loadRepos());
</script>

<template>
  <div class="app">
    <TopBar :store="store" />
    <div v-if="store.error" class="error-banner">{{ store.error }}</div>
    <main class="body">
      <p v-if="!store.view" class="empty">Pick a repository, then a pull request.</p>
      <template v-else>
        <FileTree :store="store" class="tree" />
        <section class="diff-placeholder">{{ store.selectedPath }}</section>
      </template>
    </main>
  </div>
</template>

<style scoped>
.app { display: grid; grid-template-rows: 50px 1fr; height: 100vh; }
.error-banner { background: rgba(248,81,73,.12); color: var(--red); padding: 8px 14px; font-size: 12px; border-bottom: 1px solid var(--border); }
.empty { color: var(--faint); padding: 2rem; }
.body { display: grid; grid-template-columns: 264px 1fr; min-height: 0; }
.tree { border-right: 1px solid var(--border); overflow: hidden auto; }
.diff-placeholder { min-width: 0; padding: 14px; color: var(--faint); font: 12.5px var(--mono); }
</style>
