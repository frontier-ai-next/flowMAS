import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(testDir, "..");

function readSource(relativePath: string) {
  return readFileSync(path.join(srcDir, relativePath), "utf8");
}

describe("landing regression contracts", () => {
  const landing = readSource("pages/Landing.tsx");

  it("keeps the primary action wired to the project picker", () => {
    expect(landing).toContain('<Link href="/get-started">');
    expect(landing).toContain("Start");
    expect(landing).not.toContain('href="#"');
  });

  it("keeps the landing page scrollable through the app router rule", () => {
    const app = readSource("App.tsx");

    expect(app).toContain('location === "/"');
    expect(app).toContain('location === "/get-started"');
    expect(app).toContain('document.body.style.overflowY = shouldAllowPageScroll ? "auto" : "hidden"');
  });
});

describe("workflow graph regression contracts", () => {
  const workflow = readSource("pages/Workflow.tsx");

  it("renders visible idle edges with a separate click target", () => {
    expect(workflow).toContain('edgeIdle: "oklch(0.62 0.012 285 / 0.85)"');
    expect(workflow).toContain('edgeIdle: "oklch(0.55 0.015 285 / 0.9)"');
    expect(workflow).toContain('stroke="transparent"');
    expect(workflow).toContain('strokeWidth={16}');
    expect(workflow).toContain("isSelectedEdge ? 2.5 : active ? 2.25 : isLoop ? 2 : 1.75");
    expect(workflow).toContain('!edgeEnabled ? "4 4" : isLoop ? "8 5" : active || isSelectedEdge ? "none" : "6 4"');
    expect(workflow).toContain('markerEnd={`url(#arrow-${edgeEnabled && active ? "active" : isLoop ? "loop" : "idle"})`}');
    expect(workflow).toContain('id="arrow-active"');
    expect(workflow).toContain('id="arrow-idle"');
    expect(workflow).toContain('id="arrow-loop"');
  });

  it("keeps edges selectable and exposes condition editing", () => {
    const inspector = readSource("components/workflow/EdgeInspectorPanel.tsx");
    const edgeUtils = readSource("lib/edge-utils.ts");

    expect(workflow).toContain("selectedEdgeId");
    expect(workflow).toContain("onSelectEdge");
    expect(workflow).toContain("EdgeInspectorPanel");
    expect(inspector).toContain("EDGE_CONDITION_OPTIONS.map");
    expect(inspector).toContain("When to take this path");
    expect(inspector).toContain("Priority weight");
    expect(inspector).toContain("Branch keyword");
    expect(inspector).toContain("Retry keyword");
    expect(edgeUtils).toContain('kind: "skip"');
    expect(edgeUtils).toContain('kind: "conditional"');
    expect(edgeUtils).toContain('kind: "loop"');
  });

  it("keeps auto layout readable for conditional and weighted edge labels", () => {
    expect(workflow).toContain("const isBackEdge = t.x <= s.x");
    expect(workflow).toContain("const labelAnchor =");
    expect(workflow).toContain("const labelYOffset = isBackEdge");
    expect(workflow).toContain("const edgeLabelScale = zoom < 0.75");
    expect(workflow).toContain("transform={labelTransform}");
    expect(workflow).toContain("filter=\"url(#edgeChipShadow)\"");
    expect(workflow).toContain("const COL_W = 430");
    expect(workflow).toContain("const ROW_H = 210");
    expect(workflow).toContain("const laneSkew = l % 2 === 0 ? 0 : 28");
  });

  it("refits the canvas after user-controlled panel layout changes", () => {
    expect(workflow).toContain("const refitCanvasSoon = useCallback");
    expect(workflow).toContain('window.dispatchEvent(new CustomEvent("gmas:fit-to-view"))');
    expect(workflow).toContain("setAssetsOpen(o => !o); refitCanvasSoon();");
    expect(workflow).toContain("setInspectorOpen(o => !o); refitCanvasSoon();");
    expect(workflow).toContain("setConsoleCollapsed(c => !c); refitCanvasSoon();");
  });

  it("keeps graph-scoped agent list controls", () => {
    expect(workflow).toContain("This graph");
    expect(workflow).toContain("All");
    expect(workflow).toContain("No agents on this graph yet");
    expect(workflow).toContain("No agents match your filter");
    expect(workflow).toContain("graphNodes");
    expect(workflow).toContain("embeddedGraphAgents");
  });

  it("preserves graph-scoped agent metadata when rebuilding export payloads", () => {
    const mockData = readSource("lib/mock-data.ts");

    expect(mockData).toContain("description?: string");
    expect(mockData).toContain("llmConfig?: Record<string, unknown>");
    expect(mockData).toContain("inputSchema?: Record<string, unknown>");
    expect(mockData).toContain("outputSchema?: Record<string, unknown>");
    expect(workflow).toContain("description: ag?.description ?? n.description");
    expect(workflow).toContain("...(n.llmConfig ?? {})");
    expect(workflow).toContain("input_schema: ag?.input_schema ?? n.inputSchema");
    expect(workflow).toContain("output_schema: ag?.output_schema ?? n.outputSchema");
  });

  it("sends parallel and dynamic topology settings to the backend", () => {
    expect(workflow).toContain("Runs parallel-eligible nodes together");
    expect(workflow).toContain("Max parallel");
    expect(workflow).toContain("parallel ≤");
    expect(workflow).toContain("enable_parallel: runConfig.enableParallel");
    expect(workflow).toContain("max_parallel_size: runConfig.maxParallelSize");
    expect(workflow).toContain("enable_dynamic_topology: runConfig.enableDynamicTopology");
    expect(workflow).toContain("topology_hooks: runConfig.topoHooks.map");
  });

  it("keeps the advertised new graph shortcut wired", () => {
    expect(workflow).toContain('key: "n"');
    expect(workflow).toContain("setNewGraphOpen(true)");
  });

  it("keeps run inspector pinned to panel width without horizontal scrolling", () => {
    expect(workflow).toContain("setInspectorWidth] = useState(368)");
    expect(workflow).toContain("clamp(w + d, 320, 560)");
    expect(workflow).toContain("[&_[data-slot=scroll-area-viewport]]:!overflow-x-hidden");
    expect(workflow).toContain("min-w-0 overflow-x-hidden");
  });

  it("keeps inspector output actions reachable below the scrollable text", () => {
    const runs = readSource("pages/Runs.tsx");

    expect(runs).toContain('TabsContent value="output" className="m-0 flex flex-1 min-h-0 flex-col overflow-hidden"');
    expect(runs).toContain('className="flex flex-1 min-h-0 flex-col overflow-hidden p-4 gap-2"');
    expect(runs).toContain('"flex-1 min-h-0 overflow-hidden rounded border bg-muted/20"');
    expect(runs).toContain('className="flex gap-2 shrink-0"');
    expect(workflow).toContain("lastRunOutput");
    expect(workflow).toContain("Final output");
    expect(workflow).toContain("Run the graph to see the final answer here.");
    expect(workflow).toContain("<LogEventDetailPanel key={ev.id} event={ev} compact />");
  });

  it("keeps routing policy values aligned with the backend contract", () => {
    expect(workflow).toContain('routingPolicy: "topological" | "weighted_topo" | "greedy" | "beam_search" | "k_shortest"');
    expect(workflow).toContain('routingPolicy: "topological"');
    expect(workflow).toContain("routing_policy: runConfig.routingPolicy");
    expect(workflow).toContain('"adaptive" is a separate boolean flag, not a policy');
    expect(workflow).toContain("GNN routing is a manual Python-API workflow");
    expect(workflow).not.toContain('value="adaptive"');
  });
});

describe("runs observability regression contracts", () => {
  const runs = readSource("pages/Runs.tsx");
  const api = readSource("lib/api.ts");

  it("maps backend error fields through the frontend API type", () => {
    expect(api).toContain("error_detail?: string");
    expect(api).toContain("error_message?: string");
    expect(api).toContain("error_type?: string");
  });

  it("uses backend error detail in logs and failed output", () => {
    expect(runs).toContain("error_detail || ev.error || ev.error_message");
    expect(runs).toContain("run.status === 'failed'");
    expect(runs).toContain('isFailedView ? "Failure" : "Final Output"');
    expect(runs).toContain("Copy error");
    expect(runs).toContain("Run failed");
  });

  it("keeps copy actions backed by a clipboard fallback", () => {
    const workflow = readSource("pages/Workflow.tsx");

    expect(runs).toContain("async function copyText");
    expect(runs).toContain('document.execCommand("copy")');
    expect(workflow).toContain("async function copyText");
    expect(workflow).toContain('document.execCommand("copy")');
    expect(runs).toContain('toast.error("Copy failed")');
    expect(workflow).toContain('toast.error("Copy failed")');
  });

  it("does not show failure output for successful runs with transient errors", () => {
    expect(runs).toContain("run.status === 'failed' && !run.output");
    expect(runs).toContain("run.status === 'succeeded' && run.output");
  });
});
