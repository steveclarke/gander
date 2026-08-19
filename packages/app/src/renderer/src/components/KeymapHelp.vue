<script setup lang="ts">
import { BINDINGS, GROUPS } from "../keymap.js";

defineEmits<{ close: [] }>();

// Rendered from the same table the handler dispatches on, so the sheet cannot drift
// from what the keys actually do.
const inGroup = (group: string) => BINDINGS.filter((binding) => binding.group === group);
</script>

<template>
  <div class="scrim" @click="$emit('close')">
    <section class="sheet" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" @click.stop>
      <header>
        <h2>Keyboard</h2>
        <p>Esc or ? closes this.</p>
      </header>
      <div class="groups">
        <section v-for="group in GROUPS" :key="group">
          <h3>{{ group }}</h3>
          <dl>
            <template v-for="binding in inGroup(group)" :key="binding.command">
              <dt><kbd>{{ binding.label }}</kbd></dt>
              <dd>
                {{ binding.description }}
                <span v-if="binding.treeOnly" class="scope">in the tree</span>
              </dd>
            </template>
          </dl>
        </section>
      </div>
    </section>
  </div>
</template>

<style scoped>
.scrim { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; background: rgb(0 0 0 / 45%); z-index: 40; }
.sheet { width: min(680px, 90vw); max-height: 80vh; overflow-y: auto; padding: 20px 24px 24px; border: 1px solid var(--border); border-radius: var(--radius-lg); background: var(--panel-background); box-shadow: var(--shadow-lg); }
header h2 { margin: 0; font-size: 15px; }
header p { margin: 2px 0 16px; color: var(--faint-foreground); font-size: 12px; }
.groups { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 20px 28px; }
h3 { margin: 0 0 6px; color: var(--faint-foreground); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; }
dl { display: grid; grid-template-columns: auto 1fr; gap: 6px 12px; margin: 0; align-items: baseline; }
dt { justify-self: start; }
dd { margin: 0; font-size: 13px; }
kbd { display: inline-block; padding: 2px 6px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--background); font: 11px var(--mono); white-space: nowrap; }
.scope { color: var(--faint-foreground); font-size: 11px; }
</style>
