<script setup lang="ts">
import { shallowRef } from "vue";
import { readable } from "../store.js";
import { api, type ConnectionCheck } from "../api.js";
import type { ReviewServer } from "../../../main/config.js";
import SettingsField from "./SettingsField.vue";

const props = defineProps<{ server?: ReviewServer }>();
const emit = defineEmits<{ saved: []; cancel: [] }>();
const name = shallowRef(props.server?.name ?? "");
const url = shallowRef(props.server?.url ?? "");
const token = shallowRef(props.server?.token ?? "");
const busy = shallowRef(false);
const result = shallowRef<ConnectionCheck | null>(null);
async function run(save: boolean): Promise<void> {
  busy.value = true; result.value = null;
  try {
    if (save && !name.value.trim()) throw new Error("Enter a server name.");
    result.value = save
      ? await api.saveServer({ id: props.server?.id ?? "new", name: name.value.trim(), url: url.value.trim(), token: token.value.trim() })
      : await api.testConnection(url.value, token.value);
    if (save && result.value.ok) emit("saved");
  } catch (error) { result.value = { ok: false, reason: readable((error as Error).message) }; }
  finally { busy.value = false; }
}
</script>

<template>
  <form class="server-form" @submit.prevent="run(true)">
    <h3>{{ server ? `Edit ${server.name}` : "Add a review server" }}</h3>
    <SettingsField id="server-name" label="Name" placeholder="Personal" :model-value="name" :disabled="busy" @update:model-value="name = $event" />
    <SettingsField id="connection-url" label="Service URL" type="url" placeholder="https://gander.example.internal" :model-value="url" :disabled="busy" @update:model-value="url = $event" />
    <SettingsField id="connection-token" label="Token" type="password" :model-value="token" :disabled="busy" @update:model-value="token = $event" />
    <p v-if="server" class="settings-description">Repositories keep this server. Changing its address or token does not copy any reviews.</p>
    <div class="actions">
      <button type="button" :disabled="busy" @click="run(false)">Test</button>
      <button type="submit" class="primary" :disabled="busy">{{ busy ? "Connecting…" : "Save server" }}</button>
      <button type="button" :disabled="busy" @click="emit('cancel')">Cancel</button>
    </div>
    <p v-if="result" class="result" :class="{ bad: !result.ok }" role="status">{{ result.ok ? `Connected · ${result.version}` : result.reason }}</p>
  </form>
</template>

<style scoped>
.server-form { --settings-field-gap: 0; display: flex; flex-direction: column; gap: 16px; padding: 16px; border: 1px solid var(--workbench-border); border-radius: var(--radius-md); background: var(--secondary-panel-background); }
h3 { font-size: 13px; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; }
button { padding: 6px 12px; border: 1px solid var(--workbench-border); border-radius: var(--radius-md); background: var(--input-background); color: var(--workbench-foreground); font: inherit; cursor: pointer; }
button.primary { background: var(--accent); border-color: var(--accent); color: var(--workbench-background); }
button:disabled { opacity: .55; cursor: default; }
button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.result { color: var(--success); overflow-wrap: anywhere; }
.result.bad { color: var(--danger); }
</style>
