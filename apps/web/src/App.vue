<script setup lang="ts">
import { Radar, Database, Building2, ShieldCheck } from "lucide-vue-next";
</script>

<template>
  <div class="app-shell">
    <a class="skip-link" href="#main-content">본문으로 바로가기</a>
    <header class="topbar">
      <RouterLink class="brand" to="/" aria-label="Remote Job Radar 홈">
        <span class="brand-mark"><Radar :size="19" /></span>
        <span>
          <strong>Remote Job Radar</strong>
          <small>Curated remote opportunities</small>
        </span>
      </RouterLink>
      <nav class="main-nav" aria-label="주요 메뉴">
        <RouterLink to="/"><Radar :size="16" /> Radar</RouterLink>
        <RouterLink to="/sources"><Database :size="16" /> Sources</RouterLink>
        <RouterLink to="/companies"><Building2 :size="16" /> Companies</RouterLink>
      </nav>
      <div class="access-pill" title="Cloudflare Access로 보호되는 비공개 앱">
        <ShieldCheck :size="15" /> Private
      </div>
    </header>
    <main id="main-content" class="app-main">
      <RouterView />
    </main>
  </div>
</template>
