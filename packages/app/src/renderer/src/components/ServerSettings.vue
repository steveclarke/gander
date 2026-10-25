<script setup lang="ts">
import { onMounted, shallowRef } from "vue";
import { readable } from "../store.js";
import { api, type ConnectionCheck } from "../api.js";
import type { ReviewServer } from "../../../main/config.js";
import type { RepoEntry } from "@gander/shared";
import ServerForm from "./ServerForm.vue";

const emit = defineEmits<{ connected: [] }>();
const servers = shallowRef<ReviewServer[]>([]);
const repos = shallowRef<RepoEntry[]>([]);
const statuses = shallowRef<Record<string, ConnectionCheck>>({});
const editing = shallowRef<ReviewServer | null | undefined>(undefined);
const error = shallowRef("");
const notice = shallowRef("");
const fromEnvironment = shallowRef(false);
const busy = shallowRef(false);
let generation = 0;

async function load(): Promise<void> {
  const current = ++generation;
  const data = await api.getServers();
  servers.value = data.servers; repos.value = data.repos;
  fromEnvironment.value = data.fromEnvironment;
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
function destination(repo: RepoEntry): string {
  const server = servers.value.find((entry) => entry.id === repo.serverId);
  return server ? `Notes save to ${server.name}` : "No server chosen";
}
async function change(repo: RepoEntry): Promise<void> {
  let changed = false;
  await act(async () => { changed = await api.changeRepoServer(repo.repoId); });
  if (changed) notice.value = "Server changed. Existing reviews stay on the server they were saved to.";
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
        <button type="button" :disabled="busy || repos.some(repo => repo.serverId === server.id)" :aria-label="`Remove ${server.name}`" title="Repositories that save notes here must be changed to another server first" @click="act(() => api.removeServer(server.id))">Remove</button>
      </li>
    </ul>
    <p v-else class="settings-description">Add a server to save reviews. Local browsing works without one.</p>
    <ServerForm v-if="editing !== undefined" :key="editing?.id ?? 'new'" :server="editing ?? undefined" @saved="saved" @cancel="editing = undefined" />
    <button v-else type="button" class="add-server" :disabled="busy" @click="editing = null">Add server</button>

    <section v-if="repos.length && servers.length" aria-labelledby="repository-servers-title">
      <h3 id="repository-servers-title">Repositories</h3>
      <p class="settings-description">Each repository saves its notes to one server. Changing it leaves existing reviews where they are.</p>
      <ul class="repository-list" aria-label="Repositories">
        <li v-for="repo in repos" :key="repo.repoId" class="repository-row">
          <div class="repository-identity"><strong>{{ repo.repoId }}</strong><span class="repository-destination" :class="{ unset: !servers.some(server => server.id === repo.serverId) }">{{ destination(repo) }}</span></div>
          <button type="button" :disabled="busy" :aria-label="`Change server for ${repo.repoId}`" @click="change(repo)">Change</button>
        </li>
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
.repository-list { margin-top: 12px; border: 1px solid var(--workbench-border); border-radius: var(--radius-md); }
.repository-row { display: flex; align-items: center; gap: 8px; padding: 12px 16px; }
.repository-row + .repository-row { border-top: 1px solid var(--workbench-border); }
.repository-identity { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: 2px; overflow-wrap: anywhere; }
.repository-destination { color: var(--muted-foreground); font-size: 12px; }
.repository-destination.unset { color: var(--warning); }
@media (max-width: 640px) { .server-row { flex-wrap: wrap; } .server-identity { flex-basis: 100%; } }
</style>
