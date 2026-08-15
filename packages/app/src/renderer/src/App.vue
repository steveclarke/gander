<script setup lang="ts">
import { onMounted } from "vue";
import { api } from "./api.js";
import { createStore } from "./store.js";
import TopBar from "./components/TopBar.vue";
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
    </main>
  </div>
</template>

<style scoped>
.app { display: grid; grid-template-rows: 50px 1fr; height: 100vh; }
.error-banner { background: rgba(248,81,73,.12); color: var(--red); padding: 8px 14px; font-size: 12px; border-bottom: 1px solid var(--border); }
.empty { color: var(--faint); padding: 2rem; }
</style>
