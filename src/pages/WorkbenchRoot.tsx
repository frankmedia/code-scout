import { useEffect } from "react";
import Index from "@/pages/Index.tsx";
import { useModelStore } from "@/store/modelStore";

/**
 * Workbench shell: model refresh is only relevant behind the in-app login gate,
 * not on public marketing routes like `/code-scout`.
 */
export default function WorkbenchRoot() {
  const refreshAllEnabledModels = useModelStore((s) => s.refreshAllEnabledModels);

  useEffect(() => {
    const t = setTimeout(() => refreshAllEnabledModels(10 * 60 * 1000), 1500);
    return () => clearTimeout(t);
  }, [refreshAllEnabledModels]);

  return <Index />;
}
