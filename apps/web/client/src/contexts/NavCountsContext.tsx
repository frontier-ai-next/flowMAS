import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { agentsApi, executionApi, toolsApi } from "@/lib/api";

const POLL_MS = 30_000;

interface NavCounts {
  agents: number;
  tools: number;
  runs: number;
}

const NavCountsContext = createContext<NavCounts>({ agents: 0, tools: 0, runs: 0 });

export function NavCountsProvider({ children }: { children: ReactNode }) {
  const [counts, setCounts] = useState<NavCounts>({ agents: 0, tools: 0, runs: 0 });

  useEffect(() => {
    let cancelled = false;

    const fetchCounts = () => {
      if (document.hidden) return;
      Promise.all([
        agentsApi.list().catch(() => []),
        toolsApi.list().catch(() => []),
        executionApi.historySummary().catch(() => ({ running: 0 })),
      ]).then(([agents, tools, runs]) => {
        if (cancelled) return;
        setCounts({
          agents: agents.length,
          tools: tools.length,
          runs: runs.running ?? 0,
        });
      });
    };

    fetchCounts();
    const onVisible = () => {
      if (!document.hidden) fetchCounts();
    };
    document.addEventListener("visibilitychange", onVisible);
    const id = window.setInterval(fetchCounts, POLL_MS);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(id);
    };
  }, []);

  return (
    <NavCountsContext.Provider value={counts}>
      {children}
    </NavCountsContext.Provider>
  );
}

export function useNavCounts() {
  return useContext(NavCountsContext);
}
