<script setup lang="ts">
import { onMounted, shallowRef } from "vue";
import { readable } from "../store.js";
import { api, type ConnectionCheck } from "../api.js";
import type { ReviewServer, GanderConfig } from "../../../main/config.js";
import type { RepoEntry } from "@gander/shared";
import ServerForm from "./ServerForm.vue";

const emit = defineEmits<{ connected: [] }>();
const servers = shallowRef<ReviewServer[]>([]);
const repos = shallowRef<RepoEntry[]>([]);
const rules = shallowRef<GanderConfig["ownerServers"]>([]);
const statuses = shallowRef<Record<string, ConnectionCheck>>({});
const editing = shallowRef<ReviewServer | null | undefined>(undefined);
const owner = shallowRef("");
const ruleServer = shallowRef("");
const error = shallowRef("");
const notice = shallowRef("");
const fromEnvironment = shallowRef(false);
const busy = shallowRef(false);
let generation = 0;

async function load(): Promise<void> {
  const current = ++generation;
  const data = await api.getServers();
  servers.value = data.servers; rules.value = data.ownerServers; repos.value = data.repos;
  fromEnvironment.value = data.fromEnvironment;
  ruleServer.value = ruleServer.value || data.servers[0]?.id || "";
  statuses.value = {};
  await Promise.all(data.servers.map(async (server) => {
    const result = await api.testConnection(server.url, server.token);
    if (generation === current) statuses.value = { ...statuses.value, [server.id]: result };
  }));
}
async function act(action: () => Promise<void>, message = ""): Promise<void> {
  error.value = ""; notice.value = ""; busy.value = true;
  try { await action(); await load(); notice.value = message; emit("connected"); }
  catch (failure) { error.value = readable((failure as Error).message); }
  finally { busy.value = false; }
}
async function saved(): Promise<void> { editing.value = undefined; await act(async () => {}, "Server saved."); }
function addRule(): void {
  const value = owner.value.trim().replace(/\/\*$/, "");
  if (!value || !ruleServer.value) { error.value = "Enter a repository owner and choose a server."; return; }
  void act(async () => {
    await api.setOwnerServers([...rules.value.filter((rule) => rule.owner.toLowerCase() !== value.toLowerCase()), { owner: value, serverId: ruleServer.value }]);
    owner.value = "";
  }, "Owner default saved. Existing repositories keep their server.");
}
function serverName(id?: string): string { return servers.value.find((server) => server.id === id)?.name ?? "Choose a server"; }
function assign(repoId: string, event: Event): void {
  const serverId = (event.target as HTMLSelectElement).value;
  if (serverId) void act(() => api.setRepoServer(repoId, serverId), "Repository server saved. Existing reviews stay on their original server.");
}
onMounted(() => { void act(async () => {}); });
</script>

<template>
  <section class="server-settings" aria-labelledby="connection-settings-title">
    <header class="settings-page-heading">
      <h2 id="connection-settings-title" class="settings-page-title">Review servers</h2>
      <p class="settings-description">Connect once. Each repository remembers where its checkoffs and notes belong.</p>
    </header>
    <p v-if="fromEnvironment" class="notice">The development environment overrides saved servers for this run.</p>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <p v-if="notice" class="notice" role="status">{{ notice }}</p>
    <ul v-if="servers.length" class="server-list" aria-label="Signed-in servers">
      <li v-for="server in servers" :key="server.id" class="server-row">
        <div class="server-identity"><strong>{{ server.name }}</strong><span class="server-url">{{ server.url }}</span>
          <span class="connection-status" :class="{ error: statuses[server.id] && !statuses[server.id]!.ok }" role="status">
            {{ !statuses[server.id] ? "Checking…" : statuses[server.id]!.ok ? "Connected" : (statuses[server.id] as { ok: false; reason: string }).reason }}
          </span>
        </div>
        <button type="button" :disabled="busy" :aria-label="`Edit ${server.name}`" @click="editing = server">Edit</button>
        <button type="button" :disabled="busy || repos.some(repo => repo.serverId === server.id) || rules.some(rule => rule.serverId === server.id)" :aria-label="`Remove ${server.name}`" title="Assigned servers must be unassigned before removal" @click="act(() => api.removeServer(server.id))">Remove</button>
      </li>
    </ul>
    <p v-else class="settings-description">Add a server to save reviews. Local browsing works without one.</p>
    <ServerForm v-if="editing !== undefined" :key="editing?.id ?? 'new'" :server="editing ?? undefined" @saved="saved" @cancel="editing = undefined" />
    <button v-else type="button" class="add-server" :disabled="busy" @click="editing = null">Add server</button>

    <section v-if="servers.length" class="defaults" aria-labelledby="owner-defaults-title">
      <h3 id="owner-defaults-title">Defaults by owner</h3>
      <p class="settings-description">New repositories use their owner's server. Existing choices stay as they are.</p>
      <ul v-if="rules.length" class="rule-list">
        <li v-for="rule in rules" :key="rule.owner"><span>{{ rule.owner }}/* → {{ serverName(rule.serverId) }}</span><button type="button" :disabled="busy" :aria-label="`Remove default for ${rule.owner}`" @click="act(() => api.setOwnerServers(rules.filter(entry => entry.owner !== rule.owner)))">Remove</button></li>
      </ul>
      <form class="rule-form" @submit.prevent="addRule">
        <label>Repository owner<input v-model="owner" placeholder="acme" :disabled="busy" class="settings-text-control"></label>
        <label>Review server<select aria-label="Review server" v-model="ruleServer" :disabled="busy" class="settings-select"><option v-for="server in servers" :key="server.id" :value="server.id">{{ server.name }}</option></select></label>
        <button type="submit" :disabled="busy">Save default</button>
      </form>
    </section>
    <section v-if="repos.length && servers.length" aria-labelledby="repository-servers-title">
      <h3 id="repository-servers-title">Repositories</h3>
      <p class="settings-description">Changing a choice leaves existing reviews on their original server.</p>
      <ul class="repository-list">
        <li v-for="repo in repos" :key="repo.repoId"><label :for="`repo-${repo.repoId}`">{{ repo.repoId }}</label><select :id="`repo-${repo.repoId}`" class="settings-select" :aria-label="`Server for ${repo.repoId}`" :value="repo.serverId ?? ''" :disabled="busy" @change="assign(repo.repoId, $event)"><option value="" disabled>Choose a server</option><option v-for="server in servers" :key="server.id" :value="server.id">{{ server.name }}</option></select></li>
      </ul>
    </section>
  </section>
</template>

<style scoped>
.server-settings { display: flex; flex-direction: column; gap: 24px; max-width: 720px; }
.settings-page-heading { margin: 0; display: flex; flex-direction: column; gap: 4px; }
h3 { font-size: 13px; color: var(--workbench-foreground); }
section > .settings-description { margin-top: 4px; }
ul { list-style: none; margin: 0; padding: 0; }
.server-list { border: 1px solid var(--workbench-border); border-radius: var(--radius-md); }
.server-row { display: flex; align-items: center; gap: 8px; padding: 16px; }
.server-row + .server-row { border-top: 1px solid var(--workbench-border); }
.server-identity { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: 4px; }
.server-url { color: var(--muted-foreground); overflow-wrap: anywhere; font-size: 12px; }
.connection-status { color: var(--success); font-size: 11px; overflow-wrap: anywhere; }
.error { color: var(--danger); overflow-wrap: anywhere; }
.notice { color: var(--muted-foreground); }
button { flex: none; padding: 6px 12px; border: 1px solid var(--workbench-border); border-radius: var(--radius-md); color: var(--workbench-foreground); background: var(--input-background); font: inherit; font-size: 12px; cursor: pointer; }
button:disabled { opacity: .5; cursor: default; }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.add-server { align-self: flex-start; color: var(--accent); }
.rule-form { display: flex; flex-wrap: wrap; align-items: end; gap: 8px; margin-top: 16px; }
.rule-form label { display: flex; flex: 1; flex-direction: column; gap: 4px; min-width: 140px; font-size: 12px; }
.rule-form input { margin: 0; }
.rule-list li, .repository-list li { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding-block: 8px; border-bottom: 1px solid var(--workbench-border); }
.repository-list label { overflow-wrap: anywhere; }
@media (max-width: 640px) { .server-row { flex-wrap: wrap; } .server-identity { flex-basis: 100%; } }
</style>
