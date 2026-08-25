import { defineStore } from "pinia";
import { ref } from "vue";

export const useRadarStore = defineStore("radar", () => {
  const selectedJobId = ref<string | null>(null);
  const mobilePanel = ref<"list" | "detail" | "filters">("list");

  function selectJob(id: string | null): void {
    selectedJobId.value = id;
    if (id) mobilePanel.value = "detail";
  }

  return { selectedJobId, mobilePanel, selectJob };
});
