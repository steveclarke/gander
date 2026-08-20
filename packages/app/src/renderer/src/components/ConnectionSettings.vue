<script setup lang="ts">
import { onMounted, shallowRef } from "vue";
import { api, type ConnectionCheck, type GithubTokenCheck } from "../api.js";
import { Loader2 } from "@lucide/vue";
import SettingsField from "./SettingsField.vue";

// A saved connection changes what the rest of the window can do, and the status bar's own
// poll is half a minute away — too long to leave "Service unreachable" on screen under a
// connection that just succeeded.
const emit = defineEmits<{ connected: [] }>();

/**
 * Where the review service is, and the token for it.
 *
 * Separate from the settings document rather than another section of it: that document is
 * editable as JSON inside the app, and a token does not belong on screen in a text editor.
 * That is also why nothing here saves itself the way the document's fields do — it is
 * saved once, deliberately, and only if the service answers.
 */

const url = shallowRef("");
const token = shallowRef("");
const fromEnvironment = shallowRef(false);
const busy = shallowRef(false);
const result = shallowRef<ConnectionCheck | null>(null);

const githubToken = shallowRef("");
const githubBusy = shallowRef(false);
const githubResult = shallowRef<GithubTokenCheck | null>(null);

onMounted(async () => {
  const current = await api.getConnection();
  url.value = current.url;
  token.value = current.token;
  fromEnvironment.value = current.fromEnvironment;
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

async function run(action: "test" | "save"): Promise<void> {
  busy.value = true;
  result.value = null;
  try {
    result.value = action === "test"
      ? await api.testConnection(url.value, token.value)
      : await api.setConnection(url.value, token.value);
    if (action === "save" && result.value.ok) emit("connected");
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="settings-page connection-settings" aria-labelledby="connection-settings-title">
    <header class="settings-page-heading">
      <div>
        <h2 id="connection-settings-title" class="settings-page-title">Connection</h2>
        <p class="settings-description">The review service holding checkoffs and notes. One service, one token.</p>
      </div>
    </header>

    <p v-if="fromEnvironment" class="override">
      The environment is setting the connection for this run, so what is saved here has no
      effect until Gander is started without <code class="settings-code">GANDER_SERVICE_URL</code> and
      <code class="settings-code">GANDER_TOKEN</code>.
    </p>

    <SettingsField
      id="connection-url"
      label="Service URL"
      type="url"
      placeholder="https://…"
      :model-value="url"
      :disabled="busy"
      @update:model-value="url = $event"
    >
      <template #description>
        For example <code class="settings-code">https://gander.example.internal</code>.
      </template>
    </SettingsField>

    <SettingsField
      id="connection-token"
      label="Token"
      type="password"
      :model-value="token"
      :disabled="busy"
      @update:model-value="token = $event"
    >
      <template #description>
        The same token the service was started with, and the one agents use.
      </template>
    </SettingsField>

    <div class="actions">
      <button type="button" :disabled="busy" @click="run('test')">Test</button>
      <button type="button" class="primary" :disabled="busy" @click="run('save')">Save</button>
      <span v-if="busy" class="working"><Loader2 :size="13" class="spin" />Reaching the service…</span>
      <!-- Saving tests first and keeps nothing that failed, so the only outcomes worth
           reporting are "connected" and the reason it is not. -->
      <span
        v-if="result"
        class="result"
        :class="{ bad: !result.ok, warning: result.ok && result.compatibility === 'newer' }"
        role="status"
        aria-live="polite"
      >
        {{ result.ok
          ? (result.compatibility === "newer"
            ? `Connected with warning: service ${result.version} is newer than this app`
            : `Connected to Gander ${result.version}`)
          : result.reason }}
      </span>
    </div>

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
/* A URL and a token are short: the document's fields run to the width of prose, these
   do not. */
.connection-settings :deep(.settings-field) { max-width: 560px; }
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
