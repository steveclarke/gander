<script setup lang="ts">
/**
 * One labelled setting: the name of it, what it controls, and the control itself.
 *
 * The `name` attribute is the setting's dotted key (`editor.fontSize`), which is what the
 * tests and the end-to-end drivers reach for — a field without one is not addressable.
 */
withDefaults(defineProps<{
  id: string;
  label: string;
  name?: string;
  type?: "text" | "number" | "url" | "password";
  modelValue?: string | number;
  disabled?: boolean;
  min?: number | string;
  max?: number | string;
  step?: number | string;
  placeholder?: string;
  describedBy?: string;
  /** Width of the input when a unit sits beside it. Full width without one. */
  unitWidth?: number;
}>(), { type: "text", unitWidth: 130 });

const emit = defineEmits<{ "update:modelValue": [value: string]; change: [] }>();

function onInput(event: Event): void {
  emit("update:modelValue", (event.target as HTMLInputElement).value);
}
</script>

<template>
  <div class="settings-field">
    <label class="settings-label" :for="id">{{ label }}</label>
    <p v-if="$slots.description" class="settings-description"><slot name="description" /></p>
    <!-- `control` is for the settings that are not a text box — a select, a set of
         radios — which still want the label, the description, and the spacing. -->
    <slot name="control">
      <div :class="{ 'unit-row': $slots.unit }" :style="$slots.unit ? { width: `${unitWidth}px` } : undefined">
        <input
          :id="id"
          class="settings-control settings-text-control"
          :name="name"
          :type="type"
          :value="modelValue"
          :disabled="disabled"
          :min="min"
          :max="max"
          :step="step"
          :placeholder="placeholder"
          :aria-describedby="describedBy"
          spellcheck="false"
          autocomplete="off"
          @input="onInput"
          @change="emit('change')"
        >
        <span v-if="$slots.unit" class="unit"><slot name="unit" /></span>
      </div>
    </slot>
    <slot name="footer" />
  </div>
</template>

<style scoped>
.unit-row { display: flex; align-items: center; gap: 8px; }
/* The input carries the 8px gap under the description as a margin, so the unit beside it
   has to take the same margin or it rides high against the box. */
.unit { flex: none; margin-top: 8px; color: var(--faint-foreground); font-variant-numeric: tabular-nums; }
</style>
