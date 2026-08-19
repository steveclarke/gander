<script setup lang="ts">
import { computed } from "vue";
import type { PrListItem } from "@gander/shared";
import { Layers3 } from "lucide-vue-next";
import StackPosition from "./StackPosition.vue";
import ReviewProgress from "./ReviewProgress.vue";

const props = defineProps<{ prs: PrListItem[]; selectedPrNumber?: number | null }>();
const emit = defineEmits<{ select: [prNumber: number] }>();

type ReviewGroup =
  | { kind: "standalone"; pr: PrListItem }
  | { kind: "stack"; id: number; size: number; prs: PrListItem[] };

const groups = computed<ReviewGroup[]>(() => {
  const seenStacks = new Set<number>();
  const result: ReviewGroup[] = [];

  for (const pr of props.prs) {
    if (pr.stack === null) {
      result.push({ kind: "standalone", pr });
      continue;
    }
    if (seenStacks.has(pr.stack.id)) continue;

    seenStacks.add(pr.stack.id);
    result.push({
      kind: "stack",
      id: pr.stack.id,
      size: pr.stack.size,
      prs: props.prs
        .filter((candidate) => candidate.stack?.id === pr.stack?.id)
        .sort((left, right) => (left.stack?.position ?? 0) - (right.stack?.position ?? 0)),
    });
  }

  return result;
});

function select(prNumber: number): void {
  emit("select", prNumber);
}
</script>

<template>
  <div class="reviewing-list" role="listbox" aria-label="Open pull requests">
    <template v-for="group in groups" :key="group.kind === 'stack' ? `stack-${group.id}` : `pr-${group.pr.number}`">
      <div
        v-if="group.kind === 'stack'"
        class="stack-group"
        role="group"
        :aria-label="`Stack of ${group.size} pull requests`"
      >
        <div class="stack-heading" aria-hidden="true">
          <Layers3 :size="13" />
          <span>Stack</span>
          <span class="stack-size">{{ group.size }} pull requests</span>
        </div>
        <div
          v-for="pr in group.prs"
          :key="pr.number"
          class="sw-item stack-member"
          role="option"
          :aria-selected="pr.number === selectedPrNumber"
          tabindex="0"
          @click="select(pr.number)"
          @keydown.enter.space.prevent="select(pr.number)"
        >
          <StackPosition
            v-if="pr.stack"
            class="member-stack-position"
            :position="pr.stack.position"
            :size="pr.stack.size"
          />
          <span class="dot" :class="pr.draft ? 'draft' : 'open'" />
          <span class="num">#{{ pr.number }}</span>
          <span class="nm">{{ pr.title }}</span>
          <ReviewProgress v-if="pr.reviewProgress" :progress="pr.reviewProgress" />
        </div>
      </div>
      <div
        v-else
        class="sw-item standalone-item"
        role="option"
        :aria-selected="group.pr.number === selectedPrNumber"
        tabindex="0"
        @click="select(group.pr.number)"
        @keydown.enter.space.prevent="select(group.pr.number)"
      >
        <span class="dot" :class="group.pr.draft ? 'draft' : 'open'" />
        <span class="num">#{{ group.pr.number }}</span>
        <span class="nm">{{ group.pr.title }}</span>
        <ReviewProgress v-if="group.pr.reviewProgress" :progress="group.pr.reviewProgress" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.stack-group {
  margin: 5px 8px;
  padding: 4px 0;
  border: 1px solid var(--workbench-border);
  border-radius: 7px;
  background: color-mix(in srgb, var(--badge-background) 45%, transparent);
}
.stack-heading {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 2px 10px 5px;
  color: var(--muted-foreground);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .5px;
  text-transform: uppercase;
}
.stack-size {
  margin-left: auto;
  color: var(--faint-foreground);
  font-weight: 500;
  letter-spacing: 0;
  text-transform: none;
}
.sw-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  cursor: pointer;
}
.stack-group .sw-item { padding-inline: 10px; }
.sw-item:hover { background: var(--selection-background); }
.sw-item:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.sw-item .num { font: 12px var(--mono); color: var(--muted-foreground); }
.sw-item .nm { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.member-stack-position { width: 35px; }
.dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
.dot.draft { background: var(--warning); }
.dot.open { background: var(--success); }
</style>
