<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import { useMagicKeys, watchDebounced } from "@vueuse/core";
import {
  Bookmark,
  BriefcaseBusiness,
  ChevronDown,
  Filter,
  Globe2,
  Layers3,
  Search,
  Sparkles,
  TriangleAlert,
  WandSparkles,
  X,
} from "lucide-vue-next";
import { api, ApiClientError } from "../api/client";
import JobCard from "../components/JobCard.vue";
import JobDetailPanel from "../components/JobDetailPanel.vue";
import { useRadarStore } from "../stores/radar";
import type { JobFilters, JobsPage } from "../types";

const queryClient = useQueryClient();
const radar = useRadarStore();
const selectedView = ref("new");
const searchInput = ref("");
const filters = reactive<JobFilters>({
  q: "",
  status: "open",
  minScore: 0,
  eligibility: [],
  async: [],
  remoteScope: [],
  skills: [],
  action: "none",
  changed: false,
});

watchDebounced(searchInput, (value) => {
  const nextQuery = value.trim();
  if (filters.q === nextQuery) return;
  filters.q = nextQuery;
  selectedView.value = "custom";
}, { debounce: 280, maxWait: 700 });

const dashboardQuery = useQuery({
  queryKey: ["dashboard"],
  queryFn: api.dashboard,
  refetchInterval: 120_000,
});

const jobsQuery = useInfiniteQuery({
  queryKey: computed(() => ["jobs", JSON.stringify(filters)]),
  queryFn: ({ pageParam }) => api.jobs(filters, pageParam as string | null),
  initialPageParam: null as string | null,
  getNextPageParam: (lastPage: JobsPage) => lastPage.nextCursor ?? undefined,
});

const jobs = computed(() => jobsQuery.data.value?.pages.flatMap((page) => page.items) ?? []);
const selectedIndex = computed(() => jobs.value.findIndex((job) => job.id === radar.selectedJobId));
watch(jobs, (items) => {
  if (items.length === 0) {
    radar.selectJob(null);
    return;
  }
  if (!radar.selectedJobId || !items.some((item) => item.id === radar.selectedJobId)) {
    radar.selectedJobId = items[0]?.id ?? null;
  }
}, { immediate: true });

const detailQuery = useQuery({
  queryKey: computed(() => ["job", radar.selectedJobId]),
  queryFn: () => api.job(radar.selectedJobId!),
  enabled: computed(() => Boolean(radar.selectedJobId)),
});

const actionMutation = useMutation({
  mutationFn: (payload: { action?: "saved" | "dismissed" | "applied"; notes?: string | null; dismissReason?: string | null; clear?: boolean }) => {
    if (!radar.selectedJobId) throw new Error("선택된 공고가 없습니다.");
    if (payload.clear) return api.clearAction(radar.selectedJobId);
    return api.setAction(radar.selectedJobId, {
      action: payload.action!,
      notes: payload.notes ?? null,
      dismissReason: payload.dismissReason ?? null,
    });
  },
  onSuccess: async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["jobs"] }),
      queryClient.invalidateQueries({ queryKey: ["job", radar.selectedJobId] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
    ]);
  },
});

const savedViews = computed(() => [
  { id: "new", label: "새 공고", icon: WandSparkles, count: dashboardQuery.data.value?.jobs.new ?? 0 },
  { id: "top", label: "85점 이상", icon: Sparkles, count: dashboardQuery.data.value?.jobs.top_matches ?? 0 },
  { id: "worldwide", label: "Worldwide Async", icon: Globe2, count: dashboardQuery.data.value?.jobs.async_friendly ?? 0 },
  { id: "apac", label: "APAC Remote", icon: Layers3, count: null },
  { id: "graphics", label: "Three.js · Graphics", icon: BriefcaseBusiness, count: null },
  { id: "changed", label: "내용 변경", icon: TriangleAlert, count: null },
  { id: "saved", label: "저장한 공고", icon: Bookmark, count: dashboardQuery.data.value?.actions.saved ?? 0 },
  { id: "applied", label: "지원한 공고", icon: BriefcaseBusiness, count: dashboardQuery.data.value?.actions.applied ?? 0 },
]);

function resetFilters(): void {
  Object.assign(filters, {
    q: "",
    status: "open",
    minScore: 0,
    eligibility: [],
    async: [],
    remoteScope: [],
    skills: [],
    action: "",
    changed: false,
  });
  searchInput.value = "";
}

function applyView(id: string): void {
  resetFilters();
  selectedView.value = id;
  switch (id) {
    case "new":
      filters.action = "none";
      break;
    case "top":
      filters.minScore = 85;
      filters.eligibility = ["yes", "likely"];
      break;
    case "worldwide":
      filters.remoteScope = ["worldwide"];
      filters.async = ["explicit", "strong"];
      filters.eligibility = ["yes"];
      break;
    case "apac":
      filters.remoteScope = ["apac"];
      filters.eligibility = ["yes", "likely"];
      break;
    case "graphics":
      filters.skills = ["three.js", "webgl", "webgpu", "glsl", "visualization"];
      break;
    case "changed":
      filters.changed = true;
      break;
    case "saved":
      filters.action = "saved";
      break;
    case "applied":
      filters.action = "applied";
      break;
  }
}

function toggleArray(target: string[], value: string): void {
  selectedView.value = "custom";
  const index = target.indexOf(value);
  if (index >= 0) target.splice(index, 1);
  else target.push(value);
}

function clearAll(): void {
  resetFilters();
  selectedView.value = "custom";
}

function moveSelection(delta: number): void {
  const element = document.activeElement;
  if (element && ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName)) return;
  if (!jobs.value.length) return;
  const next = Math.max(0, Math.min(jobs.value.length - 1, (selectedIndex.value < 0 ? 0 : selectedIndex.value) + delta));
  const job = jobs.value[next];
  if (job) radar.selectJob(job.id);
}

const keys = useMagicKeys();
watch(keys.j!, (pressed) => { if (pressed) moveSelection(1); });
watch(keys.k!, (pressed) => { if (pressed) moveSelection(-1); });
watch(keys.escape!, (pressed) => { if (pressed) radar.mobilePanel = "list"; });

function message(error: unknown): string {
  if (error instanceof ApiClientError) return `${error.message}${error.requestId ? ` · ${error.requestId}` : ""}`;
  return error instanceof Error ? error.message : "알 수 없는 오류";
}
</script>

<template>
  <section class="radar-page">
    <div class="mobile-panel-switcher">
      <button :class="{ active: radar.mobilePanel === 'filters' }" @click="radar.mobilePanel = 'filters'"><Filter :size="15" /> 필터</button>
      <button :class="{ active: radar.mobilePanel === 'list' }" @click="radar.mobilePanel = 'list'">목록 {{ jobs.length }}</button>
      <button :class="{ active: radar.mobilePanel === 'detail' }" :disabled="!radar.selectedJobId" @click="radar.mobilePanel = 'detail'">상세</button>
    </div>

    <aside class="filter-rail" :class="{ 'mobile-active': radar.mobilePanel === 'filters' }">
      <div class="rail-heading">
        <span>Saved views</span>
        <small>J/K 이동</small>
      </div>
      <nav class="saved-view-list">
        <button
          v-for="view in savedViews"
          :key="view.id"
          :class="{ active: selectedView === view.id }"
          @click="applyView(view.id)"
        >
          <component :is="view.icon" :size="15" />
          <span>{{ view.label }}</span>
          <strong v-if="view.count !== null">{{ view.count }}</strong>
        </button>
      </nav>

      <div class="rail-divider" />
      <div class="rail-heading"><span>Eligibility</span></div>
      <div class="check-list">
        <label><input type="checkbox" :checked="filters.eligibility.includes('yes')" @change="toggleArray(filters.eligibility, 'yes')" /> 한국 지원 가능</label>
        <label><input type="checkbox" :checked="filters.eligibility.includes('likely')" @change="toggleArray(filters.eligibility, 'likely')" /> 지원 유력</label>
        <label><input type="checkbox" :checked="filters.eligibility.includes('unknown')" @change="toggleArray(filters.eligibility, 'unknown')" /> 판정 불명</label>
      </div>

      <div class="rail-heading"><span>Async</span></div>
      <div class="check-list">
        <label><input type="checkbox" :checked="filters.async.includes('explicit')" @change="toggleArray(filters.async, 'explicit')" /> 명시적 Async</label>
        <label><input type="checkbox" :checked="filters.async.includes('strong')" @change="toggleArray(filters.async, 'strong')" /> 강한 신호</label>
        <label><input type="checkbox" :checked="filters.async.includes('synchronous')" @change="toggleArray(filters.async, 'synchronous')" /> 동기식 위험</label>
      </div>

      <label class="score-filter">
        <span>최소 점수 <strong>{{ filters.minScore }}</strong></span>
        <input v-model.number="filters.minScore" type="range" min="0" max="100" step="5" @input="selectedView = 'custom'" />
      </label>

      <button class="ghost-button full-width" @click="clearAll"><X :size="14" /> 필터 초기화</button>
      <div class="rail-footnote">
        <strong>{{ dashboardQuery.data.value?.sources.active ?? 0 }}</strong> active sources
        <span v-if="dashboardQuery.data.value?.sources.quarantined">· {{ dashboardQuery.data.value.sources.quarantined }} quarantined</span>
      </div>
    </aside>

    <section class="job-list-pane" :class="{ 'mobile-active': radar.mobilePanel === 'list' }">
      <header class="list-toolbar">
        <label class="search-box">
          <Search :size="17" />
          <input v-model="searchInput" type="search" placeholder="직무, 기업, Three.js, WebGPU…" />
          <kbd>/</kbd>
        </label>
        <div class="toolbar-summary">
          <strong>{{ jobs.length }}</strong> loaded
          <span v-if="jobsQuery.isFetching.value" class="spinner small" />
        </div>
      </header>

      <div v-if="filters.eligibility.length || filters.async.length || filters.remoteScope.length || filters.skills.length || filters.minScore" class="active-filters">
        <span v-if="filters.minScore">{{ filters.minScore }}점+</span>
        <span v-for="value in filters.eligibility" :key="`e-${value}`">{{ value }}</span>
        <span v-for="value in filters.async" :key="`a-${value}`">{{ value }}</span>
        <span v-for="value in filters.remoteScope" :key="`r-${value}`">{{ value }}</span>
        <span v-for="value in filters.skills" :key="`s-${value}`">{{ value }}</span>
      </div>

      <div class="job-list-scroll">
        <div v-if="jobsQuery.isPending.value" class="list-state"><span class="spinner" /> 공고를 불러오는 중…</div>
        <div v-else-if="jobsQuery.error.value" class="list-state error-state">{{ message(jobsQuery.error.value) }}</div>
        <div v-else-if="jobs.length === 0" class="list-state empty-state">
          <Search :size="28" />
          <strong>조건에 맞는 공고가 없습니다.</strong>
          <span>필터를 줄이거나 다른 저장 뷰를 선택하십시오.</span>
        </div>
        <template v-else>
          <JobCard
            v-for="job in jobs"
            :key="job.id"
            :job="job"
            :selected="radar.selectedJobId === job.id"
            @select="radar.selectJob"
          />
          <button
            v-if="jobsQuery.hasNextPage.value"
            class="load-more"
            :disabled="jobsQuery.isFetchingNextPage.value"
            @click="jobsQuery.fetchNextPage()"
          >
            <ChevronDown :size="16" />
            {{ jobsQuery.isFetchingNextPage.value ? '불러오는 중…' : '다음 공고 50개' }}
          </button>
        </template>
      </div>
    </section>

    <JobDetailPanel
      class="detail-pane-wrap"
      :class="{ 'mobile-active': radar.mobilePanel === 'detail' }"
      :job="detailQuery.data.value || null"
      :loading="detailQuery.isPending.value && Boolean(radar.selectedJobId)"
      :error="detailQuery.error.value ? message(detailQuery.error.value) : null"
      :action-pending="actionMutation.isPending.value"
      @action="actionMutation.mutate($event)"
      @clear="actionMutation.mutate({ clear: true })"
    />
  </section>
</template>
