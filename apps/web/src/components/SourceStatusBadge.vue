<script setup lang="ts">
import { computed } from "vue";
import { AlertTriangle, CheckCircle2, CirclePause, ShieldAlert } from "lucide-vue-next";

const props = defineProps<{ status: string; failures?: number }>();
const label = computed(() => ({
  active: props.failures ? "경고" : "정상",
  paused: "일시정지",
  quarantined: "Quarantine",
  disabled: "비활성",
}[props.status] ?? props.status));
</script>

<template>
  <span class="source-status" :class="`source-${status}`">
    <ShieldAlert v-if="status === 'quarantined'" :size="13" />
    <CirclePause v-else-if="status === 'paused' || status === 'disabled'" :size="13" />
    <AlertTriangle v-else-if="failures" :size="13" />
    <CheckCircle2 v-else :size="13" />
    {{ label }}
  </span>
</template>
