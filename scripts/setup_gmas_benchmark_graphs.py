#!/usr/bin/env python3
"""
Create tool-free gMAS benchmark graphs from templates (LLM-only parity with Langflow chains).

Usage:
  .venv/bin/python scripts/setup_gmas_benchmark_graphs.py --patch-config
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Any

try:
    import httpx
except ImportError as exc:  # pragma: no cover
    print("Install httpx in repo .venv", file=sys.stderr)
    raise SystemExit(1) from exc


REPO_ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = REPO_ROOT / "scripts" / "gmas_benchmark_graphs.json"

BENCHMARK_GRAPHS = [
    {
        "scenario_id": "research_2",
        "template_id": "research-writer",
        "name": "Benchmark Research & Write (no tools)",
    },
    {
        "scenario_id": "pipeline_3",
        "template_id": "plan-execute-review",
        "name": "Benchmark Plan Execute Review (no tools)",
    },
    {
        "scenario_id": "qa_critic",
        "template_id": "qa-pipeline",
        "name": "Benchmark Q&A Critic (no tools)",
    },
    {
        "scenario_id": "data_pipeline",
        "template_id": "data-analysis",
        "name": "Benchmark Data Analysis (no tools)",
    },
    {
        "scenario_id": "code_pipeline",
        "template_id": "code-pipeline",
        "name": "Benchmark Code Pipeline (no tools)",
    },
]


def strip_tools(graph: dict[str, Any]) -> dict[str, Any]:
    agents = [{**a, "tools": []} for a in graph.get("agents") or [] if isinstance(a, dict)]
    return {**graph, "agents": agents, "name": graph.get("name", "Benchmark graph")}


def load_config(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def patch_benchmark_config(config_path: Path, graph_ids: dict[str, str]) -> None:
    cfg = load_config(config_path)
    for scenario in cfg.get("scenarios") or []:
        sid = scenario.get("id")
        if sid not in graph_ids:
            continue
        scenario.setdefault("gmas", {})["graph_id"] = graph_ids[sid]
        scenario["gmas"]["disable_tools"] = True
        platforms = scenario.get("platforms") or []
        if "gmas" not in platforms:
            scenario["platforms"] = [*platforms, "gmas"] if "langflow" in platforms else ["langflow", "gmas"]
    cfg.setdefault("gmas", {})["disable_tools"] = True
    config_path.write_text(json.dumps(cfg, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Create tool-free gMAS benchmark graphs")
    parser.add_argument("--config", type=Path, default=REPO_ROOT / "scripts/benchmark.config.json")
    parser.add_argument("--gmas-url", default=None)
    parser.add_argument("--patch-config", action="store_true")
    args = parser.parse_args()

    cfg = load_config(args.config)
    gmas_cfg = cfg.get("gmas") or {}
    base_url = (args.gmas_url or gmas_cfg.get("base_url") or "http://localhost:8000").rstrip("/")

    client = httpx.Client(base_url=base_url, timeout=120.0)
    created: dict[str, str] = {}
    manifest: dict[str, Any] = {"graphs": {}, "disable_tools": True}

    try:
        templates_resp = client.get("/api/graphs/templates")
        templates_resp.raise_for_status()
        templates = {t["template_id"]: t for t in templates_resp.json()}

        existing_resp = client.get("/api/graphs")
        existing_resp.raise_for_status()
        by_name = {g.get("name"): g.get("graph_id") for g in existing_resp.json()}

        for spec in BENCHMARK_GRAPHS:
            tpl = templates.get(spec["template_id"])
            if not tpl:
                print(f"Missing template {spec['template_id']}", file=sys.stderr)
                return 1

            graph_req = strip_tools(tpl["graph"])
            graph_req["name"] = spec["name"]
            graph_req["description"] = f"Benchmark graph from template {spec['template_id']} (tools disabled)"

            if spec["name"] in by_name and by_name[spec["name"]]:
                graph_id = by_name[spec["name"]]
                print(f"Reuse {spec['scenario_id']}: {graph_id} ({spec['name']})")
            else:
                post = client.post("/api/graphs", json=graph_req)
                post.raise_for_status()
                body = post.json()
                graph_id = body.get("graph_id")
                if not graph_id:
                    print(f"Failed to create {spec['scenario_id']}", file=sys.stderr)
                    return 1
                print(f"Created {spec['scenario_id']}: {graph_id} ({spec['name']})")
                by_name[spec["name"]] = graph_id

            created[spec["scenario_id"]] = graph_id
            manifest["graphs"][spec["scenario_id"]] = {
                "graph_id": graph_id,
                "template_id": spec["template_id"],
                "name": spec["name"],
                "agent_count": len(graph_req.get("agents") or []),
            }

        MANIFEST_PATH.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"Wrote {MANIFEST_PATH}")

        if args.patch_config:
            patch_benchmark_config(args.config, created)
            print(f"Patched {args.config}")

        print(json.dumps({"gmas_graph_ids": created}, indent=2))
        return 0
    finally:
        client.close()


if __name__ == "__main__":
    raise SystemExit(main())
