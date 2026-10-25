<script setup lang="ts">
import { onMounted, shallowRef } from "vue";
import { api, type GithubTokenCheck } from "../api.js";
import { Loader2 } from "@lucide/vue";
import SettingsField from "./SettingsField.vue";
import ServerSettings from "./ServerSettings.vue";

// A saved connection changes what the rest of the window can do, and the status bar's own
// poll is half a minute away — too long to leave "Service unreachable" on screen under a
// connection that just succeeded.
const emit = defineEmits<{ connected: [] }>();

const githubToken = shallowRef("");
const githubBusy = shallowRef(false);
const githubResult = shallowRef<GithubTokenCheck | null>(null);

onMounted(async () => {
  const current = await api.getServers();
  githubToken.value = current.githubToken;
});

async function saveGithubToken(): Promise<void> {
  githubBusy.value = true;
  githubResult.value = null;
  try {
    githubResult.value = await api.setGithubToken(githubToken.value);
  } finally {
    githubBusy.value = false;
  }
}

</script>

<template>
  <section class="settings-page connection-settings" aria-labelledby="connection-settings-title">
    <ServerSettings @connected="emit('connected')" />

    <section class="settings-section" aria-labelledby="github-settings-title">
      <div class="settings-section-heading">
        <div>
          <h3 id="github-settings-title" class="settings-section-title">GitHub</h3>
          <p class="settings-description">Pull requests, and the clones behind them, come from GitHub.</p>
        </div>
      </div>

      <SettingsField
        id="github-token"
        label="Token"
        type="password"
        :model-value="githubToken"
        :disabled="githubBusy"
        @update:model-value="githubToken = $event"
      >
        <template #description>
          Leave empty to use the <code class="settings-code">gh</code> command's own login. An installed Gander is
          started without a shell, so it can only find <code class="settings-code">gh</code> where a package manager
          usually puts it — a token here is what always works.
        </template>
      </SettingsField>

      <div class="actions">
        <button type="button" class="primary" :disabled="githubBusy" @click="saveGithubToken">Save</button>
        <span v-if="githubBusy" class="working"><Loader2 :size="13" class="spin" />Asking GitHub…</span>
        <span v-else-if="githubResult" class="result" :class="{ bad: !githubResult.ok }" role="status" aria-live="polite">
          {{ githubResult.ok
            ? (githubResult.login === "" ? "Cleared — Gander will use `gh`" : `GitHub accepted it: ${githubResult.login}`)
            : githubResult.reason }}
        </span>
      </div>
    </section>
  </section>
</template>

<style scoped>
.settings-section { margin-top: 30px; }
.override { margin-bottom: 18px; max-width: 560px; padding: 9px 11px; border-radius: var(--radius-md); background: var(--input-background); color: var(--muted-foreground); font-size: 11.5px; line-height: 1.5; }
.actions { display: flex; align-items: center; gap: 8px; }
button { height: 28px; padding: 0 12px; border: 1px solid var(--workbench-border); border-radius: var(--radius-md); background: var(--input-background); color: var(--workbench-foreground); cursor: pointer; font: inherit; font-size: 12px; }
button.primary { border-color: var(--accent); background: var(--accent); color: var(--workbench-background); }
button:disabled { opacity: .55; cursor: default; }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.result, .working { color: var(--muted-foreground); font-size: 11.5px; }
.working { display: flex; align-items: center; gap: 5px; }
.result.bad { color: var(--danger); }
.result.warning { color: var(--warning); }
</style>
