<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import {
  Activity,
  CirclePlay,
  Database,
  ExternalLink,
  Plus,
  RefreshCw,
  Save,
  ServerCog,
  X,
} from "lucide-vue-next";
import { api, ApiClientError } from "../api/client";
import SourceStatusBadge from "../components/SourceStatusBadge.vue";
import { dateTime, relativeTime } from "../utils/format";

const queryClient = useQueryClient();
const showForm = ref(false);
const formError = ref<string | null>(null);
const sourceForm = reactive({
  companyId: "",
  kind: "greenhouse",
  url: "",
  adapterKey: "",
  crawlIntervalMinutes: 360,
  browserRequired: false,
  active: true,
  configText: "{}",
});

const sourcesQuery = useQuery({ queryKey: ["sources"], queryFn: api.sources });
const companiesQuery = useQuery({ queryKey: ["companies"], queryFn: api.companies });

watch(() => sourceForm.kind, (kind) => {
  sourceForm.browserRequired = kind === "playwright";
});
watch(() => companiesQuery.data.value, (companies) => {
  if (!sourceForm.companyId && companies?.[0]) sourceForm.companyId = companies[0].id;
}, { immediate: true });

const createMutation = useMutation({
  mutationFn: () => {
    formError.value = null;
    let config: Record<string, unknown>;
    try {
      config = JSON.parse(sourceForm.configText) as Record<string, unknown>;
    } catch {
      throw new Error("Selector config JSON 형식이 올바르지 않습니다.");
    }
    return api.createSource({
      companyId: sourceForm.companyId,
      kind: sourceForm.kind,
      url: sourceForm.url,
      adapterKey: sourceForm.adapterKey.trim() || null,
      config,
      browserRequired: sourceForm.browserRequired,
      crawlIntervalMinutes: sourceForm.crawlIntervalMinutes,
      active: sourceForm.active,
    });
  },
  onSuccess: async () => {
    showForm.value = false;
    Object.assign(sourceForm, {
      url: "",
      adapterKey: "",
      crawlIntervalMinutes: 360,
      browserRequired: false,
      active: true,
      configText: "{}",
    });
    await queryClient.invalidateQueries({ queryKey: ["sources"] });
  },
  onError: (error) => { formError.value = message(error); },
});

const commandMutation = useMutation({
  mutationFn: ({ action, id, active }: { action: "test" | "reset" | "toggle"; id: string; active?: boolean }) => {
    if (action === "test") return api.testSource(id);
    if (action === "reset") return api.resetSource(id);
    return api.patchSource(id, { active });
  },
  onSuccess: async () => {
    await queryClient.invalidateQueries({ queryKey: ["sources"] });
  },
});

const stats = computed(() => {
  const rows = sourcesQuery.data.value ?? [];
  return {
    total: rows.length,
    active: rows.filter((row) => row.status === "active" && Boolean(row.company_active)).length,
    browser: rows.filter((row) => Boolean(row.browser_required)).length,
    quarantined: rows.filter((row) => row.status === "quarantined").length,
  };
});

function isStale(nextDueAt: number, browser: number): boolean {
  const threshold = (browser ? 36 : 12) * 3_600;
  return Math.floor(Date.now() / 1_000) - nextDueAt > threshold;
}

function message(error: unknown): string {
  if (error instanceof ApiClientError) return `${error.message}${error.requestId ? ` · ${error.requestId}` : ""}`;
  return error instanceof Error ? error.message : "알 수 없는 오류";
}
</script>

<template>
  <section class="management-page">
    <header class="page-heading">
      <div>
        <span class="eyebrow"><Database :size="14" /> Collection sources</span>
        <h1>수집 소스</h1>
        <p>공식 ATS·공개 채용 페이지를 등록하고 수집 상태와 파서 오류를 관리합니다.</p>
      </div>
      <button class="primary-button" @click="showForm = !showForm">
        <X v-if="showForm" :size="16" />
        <Plus v-else :size="16" />
        {{ showForm ? '닫기' : '소스 추가' }}
      </button>
    </header>

    <div class="metric-grid four">
      <article><span>Total</span><strong>{{ stats.total }}</strong><small>registered sources</small></article>
      <article><span>Active</span><strong>{{ stats.active }}</strong><small>scheduled</small></article>
      <article><span>Browser</span><strong>{{ stats.browser }}</strong><small>Playwright</small></article>
      <article :class="{ warning: stats.quarantined }"><span>Quarantine</span><strong>{{ stats.quarantined }}</strong><small>manual review</small></article>
    </div>

    <form v-if="showForm" class="editor-card" @submit.prevent="createMutation.mutate()">
      <div class="section-heading-row">
        <div><h2>새 소스</h2><p>ATS 식별자는 adapter key에, 사이트별 selector는 JSON config에 입력합니다.</p></div>
        <ServerCog :size="22" />
      </div>
      <div class="form-grid two">
        <label class="field-stack">
          <span>기업</span>
          <select v-model="sourceForm.companyId" required>
            <option v-for="company in companiesQuery.data.value || []" :key="company.id" :value="company.id">{{ company.name }}</option>
          </select>
        </label>
        <label class="field-stack">
          <span>Adapter</span>
          <select v-model="sourceForm.kind">
            <option value="greenhouse">Greenhouse</option>
            <option value="lever">Lever</option>
            <option value="ashby">Ashby</option>
            <option value="jsonld">JobPosting JSON-LD</option>
            <option value="static-html">Static HTML</option>
            <option value="playwright">Playwright</option>
          </select>
        </label>
        <label class="field-stack span-two">
          <span>채용 페이지 URL</span>
          <input v-model="sourceForm.url" type="url" placeholder="https://company.example/careers" required />
        </label>
        <label class="field-stack">
          <span>Adapter key</span>
          <input v-model="sourceForm.adapterKey" placeholder="Greenhouse board token / Lever site / Ashby board" />
        </label>
        <label class="field-stack">
          <span>수집 주기(분)</span>
          <input v-model.number="sourceForm.crawlIntervalMinutes" type="number" min="30" max="43200" step="30" required />
        </label>
        <label class="field-stack span-two">
          <span>Selector config JSON</span>
          <textarea v-model="sourceForm.configText" rows="7" spellcheck="false" placeholder='{"listSelector":".job-card","titleSelector":".job-title","linkSelector":"a"}' />
        </label>
      </div>
      <div class="inline-options">
        <label><input v-model="sourceForm.browserRequired" type="checkbox" :disabled="sourceForm.kind === 'playwright'" /> 브라우저 러너 사용</label>
        <label><input v-model="sourceForm.active" type="checkbox" /> 즉시 활성화</label>
      </div>
      <div v-if="formError" class="form-error">{{ formError }}</div>
      <div class="form-actions">
        <button class="primary-button" type="submit" :disabled="createMutation.isPending.value || !companiesQuery.data.value?.length">
          <Save :size="16" /> {{ createMutation.isPending.value ? '저장 중…' : '저장' }}
        </button>
      </div>
    </form>

    <div v-if="sourcesQuery.isPending.value" class="management-state"><span class="spinner" /> 소스를 불러오는 중…</div>
    <div v-else-if="sourcesQuery.error.value" class="management-state error-state">{{ message(sourcesQuery.error.value) }}</div>
    <div v-else class="source-table-wrap">
      <table class="data-table source-table">
        <thead>
          <tr>
            <th>기업 / Adapter</th>
            <th>상태</th>
            <th>최근 결과</th>
            <th>공고 수</th>
            <th>다음 실행</th>
            <th class="right">작업</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="source in sourcesQuery.data.value || []" :key="source.id" :class="{ stale: isStale(source.next_due_at, source.browser_required), disabled: !source.company_active }">
            <td>
              <div class="table-primary">{{ source.company_name }}</div>
              <div class="table-secondary"><code>{{ source.kind }}</code><span>{{ source.adapter_key || 'URL mode' }}</span></div>
              <a :href="source.url" target="_blank" rel="noopener noreferrer" class="table-link">{{ source.url }} <ExternalLink :size="12" /></a>
            </td>
            <td>
              <SourceStatusBadge :status="source.status" :failures="source.consecutive_failures" />
              <div v-if="!source.company_active" class="stale-label">company paused</div>
              <div v-else-if="isStale(source.next_due_at, source.browser_required)" class="stale-label">stale</div>
            </td>
            <td>
              <div class="table-primary">{{ source.last_http_status ? `HTTP ${source.last_http_status}` : '실행 전' }}</div>
              <div class="table-secondary">{{ source.last_success_at ? relativeTime(source.last_success_at) : '성공 기록 없음' }}</div>
              <div v-if="source.last_error_code" class="error-copy" :title="source.last_error_message || ''">{{ source.last_error_code }}</div>
            </td>
            <td>
              <div class="table-primary">{{ source.previous_job_count }}</div>
              <div class="table-secondary">previous healthy run</div>
            </td>
            <td>
              <div class="table-primary">{{ relativeTime(source.next_due_at) }}</div>
              <div class="table-secondary">{{ dateTime(source.next_due_at) }}</div>
            </td>
            <td class="right actions-cell">
              <button class="icon-button" title="다음 크롤러에서 테스트" :disabled="commandMutation.isPending.value" @click="commandMutation.mutate({ action: 'test', id: source.id })"><CirclePlay :size="15" /></button>
              <button v-if="source.status === 'quarantined'" class="icon-button" title="상태 초기화" :disabled="commandMutation.isPending.value" @click="commandMutation.mutate({ action: 'reset', id: source.id })"><RefreshCw :size="15" /></button>
              <button class="small-button" :disabled="commandMutation.isPending.value" @click="commandMutation.mutate({ action: 'toggle', id: source.id, active: source.status !== 'active' })">
                {{ source.status === 'active' ? 'Pause' : 'Enable' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="!(sourcesQuery.data.value || []).length" class="management-state empty-state"><Activity :size="28" /> 등록된 수집 소스가 없습니다.</div>
    </div>
  </section>
</template>
