import { createRouter, createWebHistory } from "vue-router";
import RadarPage from "./pages/RadarPage.vue";
import SourcesPage from "./pages/SourcesPage.vue";
import CompaniesPage from "./pages/CompaniesPage.vue";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", name: "radar", component: RadarPage },
    { path: "/sources", name: "sources", component: SourcesPage },
    { path: "/companies", name: "companies", component: CompaniesPage },
    { path: "/:pathMatch(.*)*", redirect: "/" },
  ],
});
