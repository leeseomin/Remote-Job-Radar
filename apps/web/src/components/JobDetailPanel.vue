<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useQuery } from "@tanstack/vue-query";
import {
  ArrowUpRight,
  Bookmark,
  CheckCircle2,
  CircleOff,
  Clock3,
  ExternalLink,
  FileClock,
  Globe2,
  MapPin,
  RotateCcw,
  Save,
  Sparkles,
} from "lucide-vue-next";
import { api } from "../api/client";
import type { JobDetail } from "../types";
import {
  asyncLabel,
  dateTime,
  eligibilityLabel,
  remoteScopeLabel,
  salaryText,
} from "../utils/format";
import ScoreBadge from "./ScoreBadge.vue";

const props = defineProps<{
  job: JobDetail | null;
  loading: boolean;
  error: string | null;
  actionPending: boolean;
}>();
const emit = defineEmits<{
  action: [payload: { action: "saved" | "dismissed" | "applied"; notes: string | null; dismissReason: string | null }];
  clear: [];
}>();

const notes = ref("");
const dismissReason = ref("");
watch(() => props.job?.id, () => {
  notes.value = props.job?.notes ?? "";
  dismissReason.value = props.job?.dismiss_reason ?? "";
}, { immediate: true });

const versionsQuery = useQuery({
  queryKey: computed(() => ["job-versions", props.job?.id]),
  queryFn: () => api.versions(props.job!.id),
  enabled: computed(() => Boolean(props.job?.id && (props.job.version_count ?? 0) > 1)),
});

const sortedEvidence = computed(() => [...(props.job?.evidence ?? [])].sort((a, b) => b.effect - a.effect));
const salary = computed(() => props.job ? salaryText(
  props.job.salary_currency,
  props.job.salary_min,
  props.job.salary_max,
  props.job.salary_interval,
) : "—");

function send(action: "saved" | "dismissed" | "applied"): void {
  emit("action", {
    action,
    notes: notes.value.trim() || null,
    dismissReason: action === "dismissed" ? dismissReason.value.trim() || null : null,
  });
}
</script>

<template>
  <aside class="detail-panel">
    <div v-if="loading" class="panel-state">
      <span class="spinner" /> 공고 상세를 불러오는 중…
    </div>
    <div v-else-if="error" class="panel-state error-state">{{ error }}</div>
    <div v-else-if="!job" class="panel-state">
      목록에서 공고를 선택하십시오.
    </div>
    <template v-else>
      <div class="detail-scroll">
        <header class="detail-header">
          <div class="detail-company">{{ job.company_name }}</div>
          <div class="detail-title-row">
            <h2>{{ job.title }}</h2>
            <ScoreBadge :score="job.score" />
          </div>
          <div class="detail-subline">
            <span><MapPin :size="14" /> {{ job.location_text || 'Location unknown' }}</span>
            <span v-if="job.department">{{ job.department }}</span>
            <span v-if="job.employment_type">{{ job.employment_type }}</span>
          </div>
          <a class="primary-link" :href="job.canonical_url" target="_blank" rel="noopener noreferrer">
            원문 공고 열기 <ArrowUpRight :size="15" />
          </a>
        </header>

        <section class="detail-section signal-grid">
          <div class="signal-card" :class="`eligibility-${job.eligible_from_korea}`">
            <Globe2 :size="17" />
            <span>지원 가능 지역</span>
            <strong>{{ eligibilityLabel[job.eligible_from_korea] }}</strong>
          </div>
          <div class="signal-card" :class="`async-${job.async_level}`">
            <Sparkles :size="17" />
            <span>Async 적합도</span>
            <strong>{{ asyncLabel[job.async_level] }}</strong>
          </div>
          <div class="signal-card neutral-card">
            <MapPin :size="17" />
            <span>Remote 범위</span>
            <strong>{{ remoteScopeLabel[job.remote_scope] }}</strong>
          </div>
          <div class="signal-card neutral-card">
            <Clock3 :size="17" />
            <span>시간대 중첩</span>
            <strong>{{ job.required_timezone || '명시 없음' }}<template v-if="job.required_overlap_hours"> · {{ job.required_overlap_hours }}h</template></strong>
          </div>
        </section>

        <section class="detail-section">
          <div class="section-heading">
            <h3>점수 근거</h3>
            <span>{{ Math.round(job.confidence * 100) }}% confidence</span>
          </div>
          <div v-if="sortedEvidence.length" class="evidence-list">
            <article v-for="(item, index) in sortedEvidence" :key="`${item.field}-${index}`" class="evidence-item">
              <strong :class="item.effect >= 0 ? 'positive' : 'negative'">
                {{ item.effect >= 0 ? '+' : '' }}{{ item.effect }}
              </strong>
              <div>
                <span>{{ item.field }}</span>
                <p>{{ item.text }}</p>
              </div>
            </article>
          </div>
          <p v-else class="muted-copy">저장된 판정 근거가 없습니다.</p>
        </section>

        <section class="detail-section facts-list">
          <div><span>기술스택</span><strong>{{ job.skills_text || '미상' }}</strong></div>
          <div><span>급여</span><strong>{{ salary }}</strong></div>
          <div><span>최초 발견</span><strong>{{ dateTime(job.first_seen_at) }}</strong></div>
          <div><span>최근 확인</span><strong>{{ dateTime(job.last_seen_at) }}</strong></div>
          <div><span>수집 어댑터</span><strong>{{ job.source_kind }}</strong></div>
        </section>

        <section class="detail-section">
          <div class="section-heading"><h3>직무 내용</h3></div>
          <div class="description-copy">{{ job.description_text }}</div>
        </section>

        <section v-if="job.version_count > 1" class="detail-section">
          <div class="section-heading">
            <h3><FileClock :size="16" /> 변경 이력</h3>
            <span>{{ job.version_count }} versions</span>
          </div>
          <div class="version-list">
            <div v-for="version in versionsQuery.data.value || []" :key="version.contentHash">
              <span>{{ dateTime(version.observedAt) }}</span>
              <code>{{ version.contentHash.slice(0, 12) }}</code>
            </div>
          </div>
        </section>

        <section class="detail-section notes-section">
          <div class="section-heading"><h3>개인 메모</h3></div>
          <textarea v-model="notes" rows="4" placeholder="지원 포인트, 준비할 내용, 연락 기록…" />
          <label class="field-stack">
            <span>제외 이유</span>
            <input v-model="dismissReason" placeholder="예: US only, 회의 비중 높음" />
          </label>
        </section>
      </div>

      <footer class="detail-actions">
        <button class="action-button save-action" :disabled="actionPending" @click="send('saved')">
          <Bookmark :size="16" /> Save
        </button>
        <button class="action-button applied-action" :disabled="actionPending" @click="send('applied')">
          <CheckCircle2 :size="16" /> Applied
        </button>
        <button class="action-button dismiss-action" :disabled="actionPending" @click="send('dismissed')">
          <CircleOff :size="16" /> Dismiss
        </button>
        <button v-if="job.action" class="icon-button" title="상태 지우기" :disabled="actionPending" @click="$emit('clear')">
          <RotateCcw :size="16" />
        </button>
        <button v-else class="icon-button" title="메모와 Save 상태 저장" :disabled="actionPending" @click="send('saved')">
          <Save :size="16" />
        </button>
        <a class="icon-button" :href="job.canonical_url" target="_blank" rel="noopener noreferrer" title="원문 열기">
          <ExternalLink :size="16" />
        </a>
      </footer>
    </template>
  </aside>
</template>
