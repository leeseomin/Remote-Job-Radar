<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { Building2, ExternalLink, Plus, Save, X } from "lucide-vue-next";
import { api, ApiClientError } from "../api/client";

const queryClient = useQueryClient();
const showForm = ref(false);
const formError = ref<string | null>(null);
const toggleError = ref<string | null>(null);
const companyForm = reactive({
  name: "",
  slug: "",
  careersUrl: "",
  remotePolicyUrl: "",
  priority: 50,
  active: true,
});

const companiesQuery = useQuery({ queryKey: ["companies"], queryFn: api.companies });
const createMutation = useMutation({
  mutationFn: () => api.createCompany({
    name: companyForm.name,
    slug: companyForm.slug,
    careersUrl: companyForm.careersUrl.trim() || null,
    remotePolicyUrl: companyForm.remotePolicyUrl.trim() || null,
    priority: companyForm.priority,
    active: companyForm.active,
  }),
  onSuccess: async () => {
    showForm.value = false;
    Object.assign(companyForm, { name: "", slug: "", careersUrl: "", remotePolicyUrl: "", priority: 50, active: true });
    await queryClient.invalidateQueries({ queryKey: ["companies"] });
  },
  onError: (error) => { formError.value = message(error); },
});
const toggleMutation = useMutation({
  mutationFn: ({ id, active }: { id: string; active: boolean }) => {
    toggleError.value = null;
    return api.patchCompany(id, { active });
  },
  onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["companies"] }),
  onError: (error) => { toggleError.value = message(error); },
});

const metrics = computed(() => {
  const rows = companiesQuery.data.value ?? [];
  return {
    total: rows.length,
    active: rows.filter((row) => Boolean(row.active)).length,
    sources: rows.reduce((sum, row) => sum + Number(row.source_count ?? 0), 0),
    jobs: rows.reduce((sum, row) => sum + Number(row.open_job_count ?? 0), 0),
  };
});

function syncSlug(): void {
  if (companyForm.slug) return;
  companyForm.slug = companyForm.name
    .normalize("NFKD")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toggleCompanyForm(): void {
  showForm.value = !showForm.value;
  formError.value = null;
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
        <span class="eyebrow"><Building2 :size="14" /> Monitored companies</span>
        <h1>관심 기업</h1>
        <p>100~250개 관심 기업과 공식 careers/remote policy 링크를 우선순위별로 관리합니다.</p>
      </div>
      <button type="button" class="primary-button" @click="toggleCompanyForm">
        <X v-if="showForm" :size="16" /><Plus v-else :size="16" />
        {{ showForm ? '닫기' : '기업 추가' }}
      </button>
    </header>

    <div class="metric-grid four">
      <article><span>Total</span><strong>{{ metrics.total }}</strong><small>companies</small></article>
      <article><span>Active</span><strong>{{ metrics.active }}</strong><small>monitored</small></article>
      <article><span>Sources</span><strong>{{ metrics.sources }}</strong><small>collectors</small></article>
      <article><span>Open jobs</span><strong>{{ metrics.jobs }}</strong><small>current</small></article>
    </div>

    <form v-if="showForm" class="editor-card" @submit.prevent="createMutation.mutate()">
      <div class="section-heading-row"><div><h2>새 기업</h2><p>Slug는 URL·식별에 쓰이는 영문 소문자 값입니다.</p></div><Building2 :size="22" /></div>
      <div class="form-grid two">
        <label class="field-stack"><span>기업명</span><input v-model="companyForm.name" required placeholder="Example Company" @blur="syncSlug" /></label>
        <label class="field-stack"><span>Slug</span><input v-model="companyForm.slug" required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="example-company" /></label>
        <label class="field-stack span-two"><span>Careers URL</span><input v-model="companyForm.careersUrl" type="url" placeholder="https://example.com/careers" /></label>
        <label class="field-stack span-two"><span>Remote policy URL</span><input v-model="companyForm.remotePolicyUrl" type="url" placeholder="https://example.com/remote" /></label>
        <label class="field-stack"><span>우선순위</span><input v-model.number="companyForm.priority" type="number" min="0" max="100" /></label>
        <div class="field-stack"><span>상태</span><label class="checkbox-field"><input v-model="companyForm.active" type="checkbox" /> 활성</label></div>
      </div>
      <div v-if="formError" class="form-error" role="alert">{{ formError }}</div>
      <div class="form-actions"><button class="primary-button" type="submit" :disabled="createMutation.isPending.value"><Save :size="16" /> {{ createMutation.isPending.value ? '저장 중…' : '저장' }}</button></div>
    </form>

    <div v-if="toggleError" class="management-alert" role="alert">{{ toggleError }}</div>
    <div v-if="companiesQuery.isPending.value" class="management-state" role="status"><span class="spinner" /> 기업을 불러오는 중…</div>
    <div v-else-if="companiesQuery.error.value" class="management-state error-state" role="alert">{{ message(companiesQuery.error.value) }}</div>
    <div v-else class="company-grid">
      <article v-for="company in companiesQuery.data.value || []" :key="company.id" class="company-card" :class="{ disabled: !company.active }">
        <header>
          <div class="company-avatar">{{ company.name.slice(0, 2).toUpperCase() }}</div>
          <div><h2>{{ company.name }}</h2><code>{{ company.slug }}</code></div>
          <span class="priority-pill" :title="`우선순위 ${company.priority}`">P{{ company.priority }}</span>
        </header>
        <div class="company-metrics">
          <div><strong>{{ company.source_count ?? 0 }}</strong><span>sources</span></div>
          <div><strong>{{ company.open_job_count ?? 0 }}</strong><span>open jobs</span></div>
        </div>
        <div class="company-links">
          <a v-if="company.careers_url" :href="company.careers_url" target="_blank" rel="noopener noreferrer" :aria-label="`${company.name} 채용 페이지를 새 창에서 열기`">Careers <ExternalLink :size="13" /></a>
          <a v-if="company.remote_policy_url" :href="company.remote_policy_url" target="_blank" rel="noopener noreferrer" :aria-label="`${company.name} Remote policy를 새 창에서 열기`">Remote policy <ExternalLink :size="13" /></a>
        </div>
        <footer>
          <span :class="company.active ? 'active-dot' : 'paused-dot'">{{ company.active ? 'Active' : 'Paused' }}</span>
          <button type="button" class="small-button" :disabled="toggleMutation.isPending.value" @click="toggleMutation.mutate({ id: company.id, active: !Boolean(company.active) })">{{ company.active ? '일시정지' : '활성화' }}</button>
        </footer>
      </article>
      <div v-if="!(companiesQuery.data.value || []).length" class="management-state empty-state"><Building2 :size="28" /><strong>등록된 기업이 없습니다.</strong><button type="button" class="primary-button" @click="toggleCompanyForm">첫 기업 추가</button></div>
    </div>
  </section>
</template>
