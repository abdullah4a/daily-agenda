<script setup lang="ts">
import type { DayInsight } from './week'
import { dayLabel, formatHours, formatHoursSpoken } from './week'

const props = defineProps<{ days: DayInsight[], today: string }>()

// Scale rounds up to a whole hour so bars never touch the top edge.
const ceilHours = computed(() => Math.max(1, Math.ceil(Math.max(...props.days.map(d => d.productiveMinutes)) / 60)))
const ticks = computed(() => (ceilHours.value <= 4
  ? Array.from({ length: ceilHours.value + 1 }, (_, i) => i)
  : [0, Math.round(ceilHours.value / 2), ceilHours.value]))

const summary = computed(() => props.days
  .map(d => `${dayLabel(d.date, 'long')}: ${formatHoursSpoken(d.productiveMinutes)}, ${d.done} done, ${d.skipped} skipped`)
  .join('. '))
</script>

<template>
  <figure class="m-0">
    <div class="grid grid-cols-[2rem_1fr] gap-x-2 sm:grid-cols-[2.5rem_1fr]">
      <!-- Y axis -->
      <div class="relative h-56 text-xs tabular-nums text-muted sm:h-64" aria-hidden="true">
        <span
          v-for="t in ticks"
          :key="t"
          class="absolute right-0 translate-y-1/2"
          :style="{ bottom: `${(t / ceilHours) * 100}%` }"
        >{{ t }}h</span>
      </div>
      <!-- Plot -->
      <div class="relative h-56 sm:h-64" role="img" :aria-label="`Productive hours per day. ${summary}`">
        <div
          v-for="t in ticks"
          :key="t"
          class="absolute inset-x-0 border-t border-dashed border-ink/15"
          :style="{ bottom: `${(t / ceilHours) * 100}%` }"
          aria-hidden="true"
        />
        <div class="absolute inset-0 grid grid-cols-7 gap-1.5 sm:gap-3" aria-hidden="true">
          <div v-for="(d, i) in days" :key="d.date" class="relative flex h-full flex-col justify-end">
            <span
              v-if="d.productiveMinutes > 0"
              class="mb-1 text-center text-[0.7rem] font-semibold tabular-nums sm:text-xs"
            >{{ formatHours(d.productiveMinutes) }}</span>
            <div
              class="bar-grow w-full rounded-t-xl bg-accent"
              :class="[
                d.date === today ? 'outline outline-2 -outline-offset-1 outline-ink/50' : '',
                d.productiveMinutes === 0 ? 'opacity-30' : '',
              ]"
              :style="{
                height: d.productiveMinutes > 0 ? `${(d.productiveMinutes / (ceilHours * 60)) * 100}%` : '4px',
                animationDelay: `${i * 45}ms`,
              }"
            />
          </div>
        </div>
      </div>
      <div />
      <!-- X axis -->
      <div class="mt-2 grid grid-cols-7 gap-1.5 text-center sm:gap-3" aria-hidden="true">
        <div v-for="d in days" :key="d.date" :class="d.date === today ? 'font-semibold text-ink' : 'text-muted'">
          <p class="text-xs sm:text-sm">{{ dayLabel(d.date) }}</p>
          <p class="text-[0.7rem] tabular-nums opacity-80">{{ Number(d.date.slice(8)) }}</p>
        </div>
      </div>
    </div>

    <!-- Text alternative: the same data as a table -->
    <figcaption class="sr-only">
      <table>
        <caption>Productive hours, done and skipped blocks by day</caption>
        <thead>
          <tr><th scope="col">Day</th><th scope="col">Productive time</th><th scope="col">Done</th><th scope="col">Skipped</th></tr>
        </thead>
        <tbody>
          <tr v-for="d in days" :key="d.date">
            <th scope="row">{{ dayLabel(d.date, 'long') }} {{ d.date }}</th>
            <td>{{ formatHoursSpoken(d.productiveMinutes) }}</td>
            <td>{{ d.done }}</td>
            <td>{{ d.skipped }}</td>
          </tr>
        </tbody>
      </table>
    </figcaption>
  </figure>
</template>

<style scoped>
.bar-grow {
  transform-origin: bottom;
  animation: bar-grow 700ms var(--ease) both;
}
@keyframes bar-grow {
  from { transform: scaleY(0); opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .bar-grow { animation: none; }
}
</style>
