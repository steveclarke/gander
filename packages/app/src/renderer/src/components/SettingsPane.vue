<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef, watch } from "vue";
import { Braces, Palette, Plug, Settings2, SlidersHorizontal, Type, X } from "@lucide/vue";
import type { EditorSettingsStore } from "../editor-settings-store.js";
import { settingsFromJson, settingsToJson, type AppSettings } from "../../../settings.js";
import EditorSettings from "./EditorSettings.vue";
import SettingsJsonEditor from "./SettingsJsonEditor.vue";
import WorkbenchSettings from "./WorkbenchSettings.vue";
import ConnectionSettings from "./ConnectionSettings.vue";

type Category = "workbench" | "editor" | "connection";

const props = defineProps<{ store: EditorSettingsStore; initialCategory?: Category }>();
const emit = defineEmits<{ close: []; connected: [] }>();

const mode = shallowRef<"ui" | "json">("ui");
const category = shallowRef<Category>(props.initialCategory ?? "workbench");
const saveState = shallowRef<"idle" | "saving" | "saved" | "error">("idle");
const jsonSource = shallowRef(settingsToJson(props.store.settings));
const jsonError = shallowRef<string | null>(null);
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let pendingJsonSettings: AppSettings | null = null;
let revision = 0;

const status = computed(() => {
  if (props.store.error) return props.store.error;
  if (jsonError.value) return jsonError.value;
  if (saveState.value === "saving") return "Saving…";
  if (saveState.value === "saved") return "Saved automatically";
  return null;
});

async function setMode(next: "ui" | "json"): Promise<void> {
  if (mode.value === "json" && next === "ui") await flushJsonSave();
  mode.value = next;
  jsonError.value = null;
  saveState.value = "idle";
  if (next === "json") jsonSource.value = settingsToJson(props.store.settings);
}

function onUiSaved(success: boolean): void {
  saveState.value = success ? "saved" : "error";
}

function onJsonChange(source: string): void {
  jsonSource.value = source;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  const currentRevision = ++revision;

  let settings;
  try {
    settings = settingsFromJson(source);
    jsonError.value = null;
    saveState.value = "saving";
  } catch (error) {
    pendingJsonSettings = null;
    jsonError.value = (error as Error).message;
    saveState.value = "error";
    return;
  }

  pendingJsonSettings = settings;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    pendingJsonSettings = null;
    const success = await props.store.update(settings);
    if (currentRevision === revision) saveState.value = success ? "saved" : "error";
  }, 400);
}

async function flushJsonSave(): Promise<void> {
  if (!saveTimer || !pendingJsonSettings) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  const settings = pendingJsonSettings;
  pendingJsonSettings = null;
  const success = await props.store.update(settings);
  saveState.value = success ? "saved" : "error";
}

watch(
  () => props.store.settings,
  (settings) => {
    if (mode.value === "ui") jsonSource.value = settingsToJson(settings);
  },
);

onBeforeUnmount(() => {
  void flushJsonSave();
});
</script>

<template>
  <section class="settings-pane" aria-labelledby="settings-title">
    <header class="titlebar">
      <div class="title">
        <Settings2 :size="20" />
        <div>
          <h1 id="settings-title">Settings</h1>
          <p>{{ category === "connection" ? "Connection is saved when it answers." : "Changes are saved automatically." }}</p>
        </div>
      </div>
      <div class="title-actions">
        <div class="view-switcher" role="tablist" aria-label="Settings view">
          <button
            role="tab"
            :aria-selected="mode === 'ui'"
            :class="{ active: mode === 'ui' }"
            @click="setMode('ui')"
          >
            <SlidersHorizontal :size="14" />UI
          </button>
          <button
            role="tab"
            :aria-selected="mode === 'json'"
            :class="{ active: mode === 'json' }"
            @click="setMode('json')"
          >
            <Braces :size="14" />JSON
          </button>
        </div>
        <button class="close" aria-label="Close settings" title="Close settings" @click="emit('close')">
          <X :size="17" />
        </button>
      </div>
    </header>

    <div class="settings-body">
      <nav class="categories" aria-label="Settings categories">
        <p>Categories</p>
        <button
          class="category"
          :class="{ active: category === 'workbench' }"
          :aria-current="category === 'workbench' ? 'page' : undefined"
          @click="category = 'workbench'"
        >
          <Palette :size="15" />Workbench
        </button>
        <button
          class="category"
          :class="{ active: category === 'editor' }"
          :aria-current="category === 'editor' ? 'page' : undefined"
          @click="category = 'editor'"
        >
          <Type :size="15" />Editor
        </button>
        <button
          class="category"
          :class="{ active: category === 'connection' }"
          :aria-current="category === 'connection' ? 'page' : undefined"
          @click="category = 'connection'"
        >
          <Plug :size="15" />Connection
        </button>
      </nav>

      <div class="content">
        <template v-if="mode === 'ui'">
          <WorkbenchSettings v-if="category === 'workbench'" :store="store" @saved="onUiSaved" />
          <!-- Connection is not part of the settings document, so it saves itself rather
               than reporting through the document's automatic save. -->
          <ConnectionSettings v-else-if="category === 'connection'" @connected="emit('connected')" />
          <EditorSettings v-else :store="store" @saved="onUiSaved" />
        </template>
        <div v-else class="json-view">
          <div class="json-heading">
            <div>
              <h2>Settings JSON</h2>
              <p>Edit the public VS Code-style keys directly. Valid JSON saves after you stop typing.</p>
            </div>
          </div>
          <SettingsJsonEditor
            :model-value="jsonSource"
            :editor-settings="store.settings.editor"
            @update:model-value="onJsonChange"
          />
        </div>
      </div>
    </div>

    <footer class="settings-status">
      <span v-if="category !== 'connection' || mode === 'json'" :class="{ error: jsonError || store.error }" role="status" aria-live="polite">{{ status }}</span>
      <span v-else />
      <span v-if="mode === 'json'" class="format">Only public application settings are shown — not the connection.</span>
    </footer>
  </section>
</template>

<style scoped>
.settings-pane { flex: 1; display: grid; grid-template-rows: auto 1fr 28px; min-width: 0; min-height: 0; background: var(--workbench-background); }
.titlebar { display: flex; align-items: center; justify-content: space-between; gap: 24px; min-height: 64px; padding: 10px 18px; border-bottom: 1px solid var(--workbench-border); background: var(--panel-background); }
.title { display: flex; align-items: center; gap: 10px; min-width: 0; }
.title > svg { color: var(--muted-foreground); flex: none; }
.title h1 { color: var(--workbench-foreground); font-size: 16px; line-height: 1.25; }
.title p, .json-heading p { color: var(--faint-foreground); font-size: 11.5px; }
.title-actions, .view-switcher { display: flex; align-items: center; gap: 4px; }
.view-switcher { padding: 2px; border-radius: var(--radius-md); background: var(--input-background); }
.view-switcher button, .close {
  display: flex; align-items: center; justify-content: center; gap: 6px;
  height: 28px; border: 0; border-radius: var(--radius-md); background: transparent;
  color: var(--muted-foreground); cursor: pointer; font: inherit; font-size: 12px;
}
.view-switcher button { padding: 0 10px; }
.view-switcher button.active { background: var(--elevated-background); color: var(--workbench-foreground); }
.view-switcher button:focus-visible, .close:focus-visible, .category:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.close { width: 28px; }
.close:hover { background: var(--hover-background); color: var(--workbench-foreground); }
.settings-body { display: grid; grid-template-columns: 190px 1fr; min-width: 0; min-height: 0; }
.categories { padding: 18px 10px; border-right: 1px solid var(--workbench-border); background: var(--secondary-panel-background); }
.categories > p { padding: 0 10px 8px; color: var(--faint-foreground); font-size: 10px; font-weight: 700; letter-spacing: .55px; text-transform: uppercase; }
.category { display: flex; align-items: center; gap: 8px; width: 100%; padding: 7px 10px; border: 0; border-radius: var(--radius-md); background: transparent; color: var(--muted-foreground); cursor: pointer; font: inherit; text-align: left; }
.category.active { background: var(--selection-background); color: var(--workbench-foreground); }
.content { min-width: 0; min-height: 0; overflow: hidden; }
.json-view { display: grid; grid-template-rows: auto 1fr; height: 100%; min-width: 0; min-height: 0; }
.json-heading { padding: 22px 28px 16px; }
.json-heading h2 { color: var(--workbench-foreground); font-size: 17px; margin-bottom: 3px; }
.settings-status { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 0 12px; border-top: 1px solid var(--workbench-border); background: var(--panel-background); color: var(--success); font-size: 11px; }
.settings-status .error { color: var(--danger); }
.format { margin-left: auto; color: var(--faint-foreground); }
@media (max-width: 720px) {
  .settings-body { grid-template-columns: 1fr; }
  .categories { display: none; }
  .titlebar { padding-inline: 12px; }
  .content { min-width: 0; }
}
</style>
