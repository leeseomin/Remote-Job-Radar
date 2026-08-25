<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{ score: number; compact?: boolean }>();
const tone = computed(() => props.score >= 85 ? "excellent" : props.score >= 70 ? "good" : props.score >= 50 ? "mixed" : "low");
</script>

<template>
  <div class="score-badge" :class="[`score-${tone}`, { compact }]" :aria-label="`적합도 ${score}점`">
    <strong>{{ score }}</strong>
    <span v-if="!compact">match</span>
  </div>
</template>
