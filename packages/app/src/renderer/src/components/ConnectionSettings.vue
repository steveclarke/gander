<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api, type ConnectionCheck } from "../api.js";

/**
 * Where the review service is, and the token for it.
 *
 * Separate from the settings document rather than another section of it: that document is
 * editable as JSON inside the app, and a token does not belong on screen in a text editor.
 */

const url = ref("");
const token = ref("");
const fromEnvironment = ref(false);
const busy = ref(false);
const result = ref<ConnectionCheck | null>(null);

onMounted(async () => {
  const current = await api.getConnection();
  url.value = current.url;
  token.value = current.token;
  fromEnvironment.value = current.fromEnvironment;
});

async function run(action: "test" | "save"): Promise<void> {
  busy.value = true;
  result.value = null;
  try {
    result.value = action === "test"
      ? await api.testConnection(url.value, token.value)
      : await api.setConnection(url.value, token.value);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="connection-settings" aria-labelledby="connection-settings-title">
    <header class="heading">
      <div>
        <h2 id="connection-settings-title">Connection</h2>
        <p>The review service holding checkoffs and questions. One service, one token.</p>
      </div>
    </header>

    <p v-if="fromEnvironment" class="override">
      The environment is setting the connection for this run, so what is saved here has no
      effect until Gander is started without <code>GANDER_SERVICE_URL</code> and
      <code>GANDER_TOKEN</code>.
    </p>

    <div class="setting">
      <label for="connection-url">Service URL</label>
      <p>For example <code>https://gander.example.internal</code>.</p>
      <input
        id="connection-url"
        v-model="url"
        type="url"
        spellcheck="false"
        autocomplete="off"
        placeholder="https://…"
        :disabled="busy"
      >
    </div>

    <div class="setting">
      <label for="connection-token">Token</label>
      <p>The same token the service was started with, and the one agents use.</p>
      <input
        id="connection-token"
        v-model="token"
        type="password"
        spellcheck="false"
        autocomplete="off"
        :disabled="busy"
      >
    </div>

    <div class="actions">
      <button type="button" :disabled="busy" @click="run('test')">Test</button>
      <button type="button" class="primary" :disabled="busy" @click="run('save')">Save</button>
      <!-- Saving tests first and keeps nothing that failed, so the only outcomes worth
           reporting are "connected" and the reason it is not. -->
      <span v-if="result" class="result" :class="{ bad: !result.ok }" role="status" aria-live="polite">
        {{ result.ok ? `Connected to Gander ${result.version}` : result.reason }}
      </span>
    </div>
  </section>
</template>

<style scoped>
.connection-settings { padding: 22px 24px; overflow-y: auto; height: 100%; }
.heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 20px; }
.heading h2 { color: var(--workbench-foreground); font-size: 15px; }
.heading p, .setting p { color: var(--faint-foreground); font-size: 11.5px; }
.override { margin-bottom: 18px; padding: 9px 11px; border-radius: 6px; background: var(--input-background); color: var(--muted-foreground); font-size: 11.5px; line-height: 1.5; }
.setting { margin-bottom: 18px; max-width: 560px; }
.setting label { display: block; margin-bottom: 3px; color: var(--workbench-foreground); font-size: 12.5px; }
.setting p { margin-bottom: 7px; }
input { width: 100%; height: 30px; padding: 0 9px; border: 1px solid var(--workbench-border); border-radius: 5px; background: var(--input-background); color: var(--workbench-foreground); font: inherit; font-size: 12.5px; }
input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.actions { display: flex; align-items: center; gap: 8px; }
button { height: 28px; padding: 0 12px; border: 1px solid var(--workbench-border); border-radius: 5px; background: var(--input-background); color: var(--workbench-foreground); cursor: pointer; font: inherit; font-size: 12px; }
button.primary { border-color: var(--accent); background: var(--accent); color: var(--workbench-background); }
button:disabled { opacity: .55; cursor: default; }
.result { color: var(--muted-foreground); font-size: 11.5px; }
.result.bad { color: var(--red, #e06c75); }
code { font-family: var(--mono, monospace); font-size: 11px; }
</style>
