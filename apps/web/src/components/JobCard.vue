<script setup lang="ts">
import { Bookmark, CheckCircle2, CircleOff, Globe2, MapPin, Sparkles } from "lucide-vue-next";
import type { JobSummary } from "../types";
import { asyncLabel, eligibilityLabel, relativeTime, remoteScopeLabel } from "../utils/format";
import ScoreBadge from "./ScoreBadge.vue";

defineProps<{ job: JobSummary; selected: boolean }>();
defineEmits<{ select: [id: string] }>();
</script>

<template>
  <button class="job-card" :class="{ selected }" type="button" @click="$emit('select', job.id)">
    <div class="job-card-top">
      <div class="job-card-heading">
        <span class="company-name">{{ job.company_name }}</span>
        <h3>{{ job.title }}</h3>
      </div>
      <ScoreBadge :score="job.score" compact />
    </div>
    <div class="job-meta-line">
      <span><MapPin :size="13" /> {{ job.location_text || 'Location unknown' }}</span>
      <span>{{ relativeTime(job.first_seen_at) }}</span>
    </div>
    <div class="tag-row">
      <span class="signal-tag" :class="`eligibility-${job.eligible_from_korea}`">
        <Globe2 :size="12" /> {{ eligibilityLabel[job.eligible_from_korea] }}
      </span>
      <span class="signal-tag" :class="`async-${job.async_level}`">
        <Sparkles :size="12" /> {{ asyncLabel[job.async_level] }}
      </span>
      <span class="signal-tag neutral">{{ remoteScopeLabel[job.remote_scope] }}</span>
    </div>
    <div class="job-card-footer">
      <span class="skills-preview">{{ job.skills_text || job.department || '기술스택 미상' }}</span>
      <span v-if="job.action" class="action-indicator" :class="`action-${job.action}`">
        <Bookmark v-if="job.action === 'saved'" :size="13" />
        <CheckCircle2 v-else-if="job.action === 'applied'" :size="13" />
        <CircleOff v-else :size="13" />
        {{ job.action }}
      </span>
    </div>
  </button>
</template>
