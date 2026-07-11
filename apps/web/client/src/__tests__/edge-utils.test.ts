import { describe, expect, it } from "vitest";
import {
  apiEdgeToGraphEdge,
  canvasEdgeLabel,
  collectRoutingMarkersForAgent,
  conditionalEdgeNeedsKeyword,
  getEdgeConditionMeta,
  graphEdgesNeedAdaptive,
  isBackwardEdge,
  isEdgeEnabled,
  isLoopEdge,
  loopEdgeDisplayLabel,
  loopEdgeNeedsKeywordWarning,
  nodeDisplayName,
  parseStoredCondition,
  roleContainsRoutingHint,
  routingInstructionForMarkers,
  serializeEdgeForApi,
} from "../lib/edge-utils";

describe("edge-utils", () => {
  it("maps UI conditional + label to API payload", () => {
    const payload = serializeEdgeForApi({
      id: "e1",
      source: "a",
      target: "b",
      condition: "conditional",
      label: "approved",
      weight: 0.8,
      enabled: true,
      active: false,
      activationCount: 0,
    });
    expect(payload).toEqual({
      source: "a",
      target: "b",
      enabled: true,
      weight: 0.8,
      condition: "conditional",
      label: "approved",
    });
  });

  it("serializes disabled edges with zero weight", () => {
    const payload = serializeEdgeForApi({
      id: "e1",
      source: "a",
      target: "b",
      enabled: false,
      weight: 1,
      active: false,
      activationCount: 0,
    });
    expect(payload.enabled).toBe(false);
    expect(payload.weight).toBe(0);
  });

  it("restores conditional edges from stored contains: prefix", () => {
    const edge = apiEdgeToGraphEdge(
      { source: "a", target: "b", condition: "contains:done", weight: 1 },
      "e1",
    );
    expect(edge.condition).toBe("conditional");
    expect(edge.label).toBe("done");
  });

  it("detects when adaptive scheduler is required", () => {
    expect(
      graphEdgesNeedAdaptive([
        { id: "e1", source: "a", target: "b", condition: "source_success", active: false, activationCount: 0 },
      ]),
    ).toBe(true);
    expect(
      graphEdgesNeedAdaptive([
        { id: "e1", source: "a", target: "b", enabled: false, condition: "source_success", active: false, activationCount: 0 },
      ]),
    ).toBe(false);
  });

  it("parses never as skip condition", () => {
    expect(parseStoredCondition("never")).toEqual({ condition: "skip", label: undefined });
  });

  it("treats zero weight as disabled", () => {
    expect(isEdgeEnabled({ weight: 0 })).toBe(false);
  });

  it("collects routing markers from conditional outgoing edges", () => {
    const markers = collectRoutingMarkersForAgent("router", [
      { id: "e1", source: "router", target: "a", condition: "conditional", label: "approved", active: false, activationCount: 0 },
      { id: "e2", source: "router", target: "b", condition: "conditional", label: "rejected", active: false, activationCount: 0 },
      { id: "e3", source: "router", target: "c", condition: "always", label: "ignored", active: false, activationCount: 0 },
    ]);
    expect(markers).toEqual(["approved", "rejected"]);
    expect(routingInstructionForMarkers(markers)).toContain("approved");
    expect(roleContainsRoutingHint("Routing: end with approved", markers)).toBe(true);
  });

  it("detects backward loop edges and display labels", () => {
    const nodes = [
      { id: "a", x: 400, y: 0 },
      { id: "b", x: 100, y: 0 },
    ];
    const edge = { source: "a", target: "b", condition: "loop" as const, label: "needs_revision" };
    expect(isBackwardEdge(edge, nodes)).toBe(true);
    expect(isLoopEdge(edge)).toBe(true);
    expect(loopEdgeDisplayLabel(edge)).toBe("↺ needs_revision");
    expect(loopEdgeNeedsKeywordWarning({ condition: "loop" })).toBe(true);
    expect(loopEdgeNeedsKeywordWarning(edge)).toBe(false);
  });

  it("humanizes node names and canvas edge labels", () => {
    const nodes = [
      { id: "__start__", type: "start" as const, label: "Start" },
      { id: "writer", type: "agent" as const, agentName: "Writer", label: "Writer" },
      { id: "__end__", type: "end" as const, label: "Finish" },
    ];
    expect(nodeDisplayName("__start__", nodes)).toBe("Start");
    expect(nodeDisplayName("writer", nodes)).toBe("Writer");
    expect(nodeDisplayName("__end__", nodes)).toBe("Finish");
    expect(canvasEdgeLabel({ condition: "conditional", label: "approved" })).toBe("If «approved»");
    expect(canvasEdgeLabel({ condition: "conditional" })).toBe("If keyword…");
    expect(canvasEdgeLabel({ condition: "source_success" })).toBe("On success");
    expect(getEdgeConditionMeta("conditional").label).toBe("If output contains keyword");
    expect(conditionalEdgeNeedsKeyword({ condition: "conditional" })).toBe(true);
    expect(conditionalEdgeNeedsKeyword({ condition: "conditional", label: "ok" })).toBe(false);
  });
});
