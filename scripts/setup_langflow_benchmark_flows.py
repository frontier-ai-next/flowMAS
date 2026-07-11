#!/usr/bin/env python3
"""
Create Langflow benchmark flows (2- and 3-LLM sequential chains) for head-to-head comparison.

Chains: Chat Input → Language Model × N → Chat Output
Uses the same MECE model / credentials as the template single-LLM flow.

Usage:
  .venv/bin/python scripts/setup_langflow_benchmark_flows.py \\
    --config scripts/benchmark.config.json

Prints flow IDs to paste into benchmark.config.json scenarios.
"""

import argparse
import copy
import json
import sys
import uuid
from pathlib import Path
from typing import Any

try:
    import httpx
except ImportError as exc:  # pragma: no cover
    print("Install httpx in repo .venv", file=sys.stderr)
    raise SystemExit(1) from exc


REPO_ROOT = Path(__file__).resolve().parents[1]

BENCHMARK_FLOWS = [
    {
        "key": "research_2",
        "name": "Benchmark Research & Write (2 LLM)",
        "description": "Sequential 2-LLM chain for benchmark parity with gMAS research_2",
        "system_messages": [
            "You are an expert researcher. Gather comprehensive information and provide well-sourced analysis. Be concise.",
            "You are a skilled technical writer. Summarize the researcher's findings in exactly one sentence.",
        ],
        "smoke_query": "Summarize in one sentence: what is 2+2?",
    },
    {
        "key": "pipeline_3",
        "name": "Benchmark Plan Execute Review (3 LLM)",
        "description": "Sequential 3-LLM chain for benchmark parity with gMAS pipeline_3",
        "system_messages": [
            "You are a strategic planner. Break the task into clear, actionable steps. Keep the plan to one short line.",
            "You are an expert software engineer. Implement the plan briefly in one line.",
            "You are a critical reviewer. Reply with exactly: benchmark-pipeline-ok",
        ],
        "smoke_query": "Reply with exactly: benchmark-pipeline-ok",
    },
    {
        "key": "qa_critic",
        "name": "Benchmark Q&A Critic (3 LLM)",
        "description": "Answerer → critic → finalizer chain",
        "system_messages": [
            "You provide a direct, accurate answer to the user's question. Be brief.",
            "You are a strict fact-checker. Note any issues in one short line.",
            "You produce the final polished answer in exactly one sentence.",
        ],
        "smoke_query": "Answer in one word: what is 2+2?",
    },
    {
        "key": "data_pipeline",
        "name": "Benchmark Data Analysis (4 LLM)",
        "description": "Loader → cleaner → analyst → reporter chain",
        "system_messages": [
            "You collect raw data requirements in one short line.",
            "You clean and validate data assumptions in one short line.",
            "You compute findings in one short line.",
            "You write the final report. Reply with exactly: benchmark-data-ok",
        ],
        "smoke_query": "Reply with exactly: benchmark-data-ok",
    },
    {
        "key": "code_pipeline",
        "name": "Benchmark Code Pipeline (4 LLM)",
        "description": "Architect → dev A → dev B → reviewer sequential chain",
        "system_messages": [
            "You are a senior software architect. Produce a one-line technical spec.",
            "You implement Module A in one line.",
            "You implement Module B in one line.",
            "You review both modules. Reply with exactly: benchmark-code-ok",
        ],
        "smoke_query": "Reply with exactly: benchmark-code-ok",
    },
]


def _handle(obj: dict[str, Any]) -> str:
    return json.dumps(obj, separators=(",", ":")).replace('"', "œ")


def _edge_id(source: str, source_handle: str, target: str, target_handle: str) -> str:
    return f"xy-edge__{source}{source_handle}-{target}{target_handle}"


def _make_edge(source: str, target: str, *, source_data_type: str, source_name: str, target_field: str) -> dict[str, Any]:
    source_handle_obj = {
        "dataType": source_data_type,
        "id": source,
        "name": source_name,
        "output_types": ["Message"],
    }
    target_handle_obj = {
        "fieldName": target_field,
        "id": target,
        "inputTypes": ["Message"] if target_field == "input_value" and "LanguageModel" in target else ["Data", "JSON", "DataFrame", "Table", "Message"],
        "type": "str" if "LanguageModel" in target else "other",
    }
    if "LanguageModel" in target and target_field == "input_value":
        target_handle_obj["inputTypes"] = ["Message"]
        target_handle_obj["type"] = "str"
    source_handle = _handle(source_handle_obj)
    target_handle = _handle(target_handle_obj)
    return {
        "source": source,
        "sourceHandle": source_handle,
        "target": target,
        "targetHandle": target_handle,
        "data": {"sourceHandle": source_handle_obj, "targetHandle": target_handle_obj},
        "id": _edge_id(source, source_handle, target, target_handle),
        "selected": False,
        "animated": False,
    }


def _clone_llm_node(template: dict[str, Any], node_id: str, system_message: str, x: float, y: float) -> dict[str, Any]:
    node = copy.deepcopy(template)
    node["id"] = node_id
    node["position"] = {"x": x, "y": y}
    node["data"]["id"] = node_id
    node["data"]["node"]["template"]["system_message"]["value"] = system_message
    node["data"]["node"]["template"]["input_value"]["value"] = ""
    if "_frontend_node_flow_id" in node["data"]["node"]["template"]:
        node["data"]["node"]["template"].pop("_frontend_node_flow_id", None)
    return node


def build_sequential_flow(
    template_flow: dict[str, Any],
    *,
    name: str,
    description: str,
    system_messages: list[str],
) -> dict[str, Any]:
    data = template_flow.get("data") or {}
    nodes = data.get("nodes") or []
    by_type = {n["data"]["type"]: n for n in nodes}

    llm_template = by_type.get("LanguageModelComponent")
    chat_in = by_type.get("ChatInput")
    chat_out = by_type.get("ChatOutput")
    if not llm_template or not chat_in or not chat_out:
        raise ValueError("Template flow must contain ChatInput, LanguageModelComponent, ChatOutput")

    chat_in_id = f"ChatInput-{uuid.uuid4().hex[:6]}"
    chat_out_id = f"ChatOutput-{uuid.uuid4().hex[:6]}"
    llm_ids = [f"LanguageModelComponent-{uuid.uuid4().hex[:6]}" for _ in system_messages]

    in_node = copy.deepcopy(chat_in)
    in_node["id"] = chat_in_id
    in_node["position"] = {"x": 80, "y": 280}
    in_node["data"]["id"] = chat_in_id

    out_node = copy.deepcopy(chat_out)
    out_node["id"] = chat_out_id
    out_node["position"] = {"x": 180 + 320 * len(system_messages), "y": 280}
    out_node["data"]["id"] = chat_out_id

    llm_nodes = [
        _clone_llm_node(llm_template, llm_ids[i], system_messages[i], 280 + 320 * i, 280)
        for i in range(len(system_messages))
    ]

    edges: list[dict[str, Any]] = []
    edges.append(
        _make_edge(
            chat_in_id,
            llm_ids[0],
            source_data_type="ChatInput",
            source_name="message",
            target_field="input_value",
        )
    )
    for i in range(len(llm_ids) - 1):
        edges.append(
            _make_edge(
                llm_ids[i],
                llm_ids[i + 1],
                source_data_type="LanguageModelComponent",
                source_name="text_output",
                target_field="input_value",
            )
        )
    edges.append(
        _make_edge(
            llm_ids[-1],
            chat_out_id,
            source_data_type="LanguageModelComponent",
            source_name="text_output",
            target_field="input_value",
        )
    )

    return {
        "name": name,
        "description": description,
        "data": {"nodes": [in_node, *llm_nodes, out_node], "edges": edges, "viewport": data.get("viewport") or {"x": 0, "y": 0, "zoom": 1}},
        "is_component": False,
        "endpoint_name": None,
        "tags": ["benchmark", "gmas-demo"],
    }


def load_config(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def patch_benchmark_config(config_path: Path, flow_ids: dict[str, str]) -> None:
    cfg = load_config(config_path)
    for scenario in cfg.get("scenarios") or []:
        sid = scenario.get("id")
        if sid not in flow_ids:
            continue
        scenario.setdefault("langflow", {})["flow_id"] = flow_ids[sid]
        platforms = scenario.get("platforms") or []
        if "langflow" not in platforms:
            scenario["platforms"] = ["langflow", *platforms]
    config_path.write_text(json.dumps(cfg, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Create Langflow benchmark flows")
    parser.add_argument("--config", type=Path, default=REPO_ROOT / "scripts/benchmark.config.json")
    parser.add_argument("--template-flow-id", help="Existing single-LLM flow UUID (default: from config)")
    parser.add_argument("--patch-config", action="store_true", help="Write flow IDs into benchmark.config.json")
    parser.add_argument("--update-existing", action="store_true", help="PATCH flows listed in scripts/langflow_benchmark_flows.json")
    parser.add_argument("--dry-run", action="store_true", help="Build payloads only, do not POST")
    args = parser.parse_args()

    cfg = load_config(args.config)
    langflow = cfg.get("langflow") or {}
    base_url = (langflow.get("base_url") or "http://localhost:7860").rstrip("/")
    api_key = langflow.get("api_key") or ""
    template_id = args.template_flow_id or langflow.get("flow_id")
    if not template_id:
        print("Missing template flow id (--template-flow-id or langflow.flow_id in config)", file=sys.stderr)
        return 1

    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    if api_key:
        headers["x-api-key"] = api_key

    client = httpx.Client(base_url=base_url, headers=headers, timeout=120.0)
    try:
        resp = client.get(f"/api/v1/flows/{template_id}")
        resp.raise_for_status()
        template_flow = resp.json()

        existing_path = REPO_ROOT / "scripts/langflow_benchmark_flows.json"
        existing_ids: dict[str, str] = {}
        if args.update_existing and existing_path.exists():
            manifest = json.loads(existing_path.read_text(encoding="utf-8"))
            for key, meta in (manifest.get("flows") or {}).items():
                if isinstance(meta, dict) and meta.get("flow_id"):
                    existing_ids[key] = str(meta["flow_id"])

        created: dict[str, str] = {}
        for spec in BENCHMARK_FLOWS:
            payload = build_sequential_flow(
                template_flow,
                name=spec["name"],
                description=spec["description"],
                system_messages=spec["system_messages"],
            )
            if args.dry_run:
                print(f"[dry-run] {spec['key']}: {spec['name']} ({len(spec['system_messages'])} LLMs)")
                continue

            flow_id = existing_ids.get(spec["key"]) if args.update_existing else None
            if flow_id:
                put = client.patch(f"/api/v1/flows/{flow_id}", json={"data": payload["data"], "name": payload["name"], "description": payload["description"]})
                if put.status_code == 405:
                    put = client.put(f"/api/v1/flows/{flow_id}", json={**payload, "id": flow_id})
                put.raise_for_status()
                body = put.json()
                flow_id = body.get("id") or flow_id
                print(f"Updated {spec['key']}: {flow_id}")
            else:
                post = client.post("/api/v1/flows/", json=payload)
                post.raise_for_status()
                body = post.json()
                flow_id = body.get("id")
                if not flow_id:
                    print(f"Failed to create {spec['key']}: no id in response", file=sys.stderr)
                    return 1
                print(f"Created {spec['key']}: {flow_id}  ({spec['name']})")
            created[spec["key"]] = flow_id

            # Smoke test via run API
            task = spec.get("smoke_query") or "Reply with exactly: benchmark-ok"
            run_resp = client.post(
                f"/api/v1/run/{flow_id}",
                params={"stream": "false"},
                json={"input_value": task, "output_type": "chat", "input_type": "chat"},
            )
            run_resp.raise_for_status()
            run_body = run_resp.json()
            outputs = run_body.get("outputs") or []
            ok = bool(outputs)
            print(f"  smoke run ok={ok} outputs={len(outputs)}")

        if created and args.patch_config:
            patch_benchmark_config(args.config, created)
            print(f"Patched {args.config}")

        if created:
            print("\nAdd to benchmark.config.json scenarios:")
            print(json.dumps({"langflow_flow_ids": created}, indent=2))
        return 0
    finally:
        client.close()


if __name__ == "__main__":
    raise SystemExit(main())
