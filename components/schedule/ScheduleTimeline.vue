<script setup lang="ts">
import type { ScheduleBlockData } from '~/utils/schedule'

const props = defineProps<{ blocks: ScheduleBlockData[], flagged?: Set<string> }>()
const emit = defineEmits<{ select: [id: string] }>()

const HOUR_PX = 44
const hours = Array.from({ length: 25 }, (_, i) => i)
const hourLabel = (h: number) => scheduleClock(minutesToTime(h * 60)).replace(':00', '')

const segments = computed(() => props.blocks
  .filter(b => isValidClock(b.start) && isValidClock(b.end) && b.start !== b.end)
  .flatMap((b, bi) => blockSegments(b).map((seg, i, all) => ({
    key: `${b.id}-${i}`,
    block: b,
    delay: Math.min(bi, 8) * 40,
    top: (seg.from / 60) * HOUR_PX,
    height: Math.max(((seg.to - seg.from) / 60) * HOUR_PX - 3, 22),
    continues: all.length > 1,
    first: i === 0,
    short: seg.to - seg.from < 50,
  }))))

// Current time marker (client only, to avoid a hydration mismatch).
const now = ref<number | null>(null)
let timer: ReturnType<typeof setInterval> | undefined
function tick() {
  const d = new Date()
  now.value = d.getHours() * 60 + d.getMinutes()
}
onMounted(() => { tick(); timer = setInterval(tick, 60_000) })
onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <div class="relative ml-12 mr-1" :style="{ height: `${24 * HOUR_PX}px` }" role="group" aria-label="Day timeline">
    <div v-for="h in hours" :key="h" class="absolute inset-x-0" :style="{ top: `${h * HOUR_PX}px` }" aria-hidden="true">
      <span v-if="h < 24" class="absolute -left-12 -top-2 w-10 text-right text-xs tabular-nums text-muted">{{ hourLabel(h) }}</span>
      <div class="h-px w-full" style="background: rgb(var(--hairline))" />
    </div>

    <button
      v-for="s in segments"
      :key="s.key"
      type="button"
      class="tl-block absolute inset-x-1 overflow-hidden rounded-xl px-3 text-left backdrop-blur-md transition duration-200 hover:brightness-110 active:scale-[0.99]"
      :class="[
        s.block.productive ? 'tl-productive' : 'tl-rest',
        flagged?.has(s.block.id) && 'tl-flagged',
      ]"
      :style="{ top: `${s.top + 1.5}px`, height: `${s.height}px`, animationDelay: `${s.delay}ms` }"
      :aria-label="`${s.block.label}, ${scheduleClock(s.block.start)} to ${scheduleClock(s.block.end)}${s.block.productive ? ', productive' : ''}. Edit`"
      @click="emit('select', s.block.id)"
    >
      <span class="flex gap-2" :class="s.short ? 'h-full items-center' : 'items-center pt-2'">
        <span class="truncate text-sm font-semibold">{{ s.block.label }}</span>
        <span v-if="s.block.productive" class="shrink-0 rounded-full bg-accent/20 px-2 py-0.5 text-[0.7rem] font-semibold text-accent">Productive</span>
        <span v-if="s.continues" class="shrink-0 text-xs text-muted">{{ s.first ? 'continues' : 'from yesterday' }}</span>
      </span>
      <span v-if="!s.short" class="block pt-0.5 text-xs tabular-nums text-muted">
        {{ scheduleClock(s.block.start) }} – {{ scheduleClock(s.block.end) }}
      </span>
    </button>

    <div v-if="now !== null" class="pointer-events-none absolute inset-x-0 z-10 flex items-center" :style="{ top: `${(now / 60) * HOUR_PX}px` }" aria-hidden="true">
      <span class="-ml-1 h-2.5 w-2.5 rounded-full bg-danger shadow-[0_0_12px_rgb(var(--danger))]" />
      <span class="h-px flex-1 bg-danger/70" />
    </div>
  </div>
</template>

<style scoped>
.tl-block {
  animation: pop-in 0.5s var(--ease) both;
  border: 1px solid rgb(var(--glass-border));
  color: rgb(var(--ink));
}
.tl-rest { background: rgb(var(--glass) / 0.78); box-shadow: var(--shadow); }
.tl-productive {
  background: linear-gradient(135deg, rgb(var(--accent) / 0.34), rgb(var(--accent) / 0.12));
  border-color: rgb(var(--accent) / 0.55);
  box-shadow: 0 8px 28px rgb(var(--accent) / 0.22), 0 1px 0 rgb(255 255 255 / 0.18) inset;
}
.tl-flagged { outline: 2px solid rgb(var(--danger)); outline-offset: 1px; }
</style>
