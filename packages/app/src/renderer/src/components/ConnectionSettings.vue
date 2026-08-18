<script setup lang="ts">
import { onMounted, ref } from "vue";
import { api, type ConnectionCheck, type GithubTokenCheck } from "../api.js";
import { Loader2 } from "lucide-vue-next";

// A saved connection changes what the rest of the window can do, and the status bar's own
// poll is half a minute away — too long to leave "Service unreachable" on screen under a
// connection that just succeeded.
const emit = defineEmits<{ connected: [] }>();

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

const githubToken = ref("");
const githubBusy = ref(false);
const githubResult = ref<GithubTokenCheck | null>(null);

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
      <span v-if="busy" class="working"><Loader2 :size="13" class="spin" />Reaching the service…</span>
      <!-- Saving tests first and keeps nothing that failed, so the only outcomes worth
           reporting are "connected" and the reason it is not. -->
      <span v-if="result" class="result" :class="{ bad: !result.ok }" role="status" aria-live="polite">
        {{ result.ok ? `Connected to Gander ${result.version}` : result.reason }}
      </span>
    </div>

    <hr>

    <header class="heading">
      <div>
        <h2>GitHub</h2>
        <p>Pull requests, and the clones behind them, come from GitHub.</p>
      </div>
    </header>

    <div class="setting">
      <label for="github-token">Token</label>
      <p>
        Leave empty to use the <code>gh</code> command's own login. An installed Gander is
        started without a shell, so it can only find <code>gh</code> where a package manager
        usually puts it — a token here is what always works.
      </p>
      <input
        id="github-token"
        v-model="githubToken"
        type="password"
        spellcheck="false"
        autocomplete="off"
        :disabled="githubBusy"
      >
    </div>

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
hr { margin: 26px 0 22px; max-width: 560px; border: 0; border-top: 1px solid var(--workbench-border); }
button { height: 28px; padding: 0 12px; border: 1px solid var(--workbench-border); border-radius: 5px; background: var(--input-background); color: var(--workbench-foreground); cursor: pointer; font: inherit; font-size: 12px; }
button.primary { border-color: var(--accent); background: var(--accent); color: var(--workbench-background); }
button:disabled { opacity: .55; cursor: default; }
.result, .working { color: var(--muted-foreground); font-size: 11.5px; }
.working { display: flex; align-items: center; gap: 5px; }
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.result.bad { color: var(--red, #e06c75); }
code { font-family: var(--mono, monospace); font-size: 11px; }
</style>
