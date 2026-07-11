"""Tests for native gMAS Studio graph export/import codecs."""

from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "apps" / "api"))
sys.path.insert(0, str(ROOT / "vendor" / "gmas" / "src"))

from backend.models.graph import GraphSaveRequest  # noqa: E402
from backend.services.graph_codec_service import (  # noqa: E402
    export_graph_json,
    export_graph_python,
    import_gmas_json,
    import_gmas_python,
)


def sample_graph() -> GraphSaveRequest:
    return GraphSaveRequest(
        name="SDK Round Trip Demo",
        description="Graph used to verify native export/import.",
        agents=[
            {
                "agent_id": "researcher",
                "display_name": "Researcher",
                "persona": "Research the topic and cite evidence.",
                "description": "Research role",
                "tools": ["web_search"],
                "llm_backbone": "gpt-5.5",
                "llm_config": {
                    "model_name": "gpt-5.5",
                    "base_url": "https://api.example.test/v1",
                    "api_key": "sk-liv...port",
                    "max_tokens": 1200,
                    "temperature": 0.2,
                    "timeout": 90,
                    "top_p": 0.9,
                    "top_k": 40,
                    "stop_sequences": ["DONE"],
                    "tool_calling_enabled": True,
                    "tool_choice": "auto",
                    "parallel_tool_calls": False,
                    "extra_params": {"response_format": "text"},
                },
                "input_schema": {"type": "object", "properties": {"topic": {"type": "string"}}},
                "output_schema": {"type": "object", "properties": {"summary": {"type": "string"}}},
            },
            {
                "agent_id": "writer",
                "display_name": "Writer",
                "persona": "Write a concise final answer.",
                "description": "Writing role",
                "tools": [],
            },
            {
                "agent_id": "reviewer",
                "display_name": "Reviewer",
                "persona": "Approve or ask for revision. Emit approved or needs_revision.",
                "description": "Review role",
                "tools": [],
            },
        ],
        edges=[
            {"source": "researcher", "target": "writer", "weight": 1.0, "enabled": True},
            {"source": "writer", "target": "reviewer", "weight": 1.0, "enabled": True, "condition": "source_success"},
            {
                "source": "reviewer",
                "target": "writer",
                "weight": 0.7,
                "enabled": True,
                "condition": "loop",
                "label": "needs_revision",
            },
            {"source": "researcher", "target": "reviewer", "weight": 0.0, "enabled": False, "label": "disabled path"},
        ],
        positions={
            "__start__": {"x": 80, "y": 200},
            "researcher": {"x": 320, "y": 160},
            "writer": {"x": 620, "y": 160},
            "reviewer": {"x": 920, "y": 160},
            "__end__": {"x": 1180, "y": 200},
        },
        start_node="researcher",
        end_node="reviewer",
        task_targets=["researcher"],
        task_query="Research GraphSpec round-tripping and produce a short report.",
        llm_provider_id="default-provider",
        llm_model="gpt-5.5",
        run_config={
            "timeout": 45,
            "adaptive": True,
            "enable_parallel": False,
            "max_parallel_size": 2,
            "max_retries": 1,
            "retry_delay": 0.5,
            "retry_backoff": 1.5,
            "update_states": True,
            "routing_policy": "weighted_topo",
            "pruning_config": {"min_weight_threshold": 0.2, "enable_fallback": True},
            "enable_hidden_channels": True,
            "hidden_combine_strategy": "concat",
            "pass_embeddings": False,
            "error_policy": {"on_timeout": "retry", "on_unknown_error": "skip", "max_skipped_agents": 2},
            "budget_config": {"total_token_limit": 5000, "warn_at_usage_ratio": 0.75},
            "enable_memory": True,
            "memory_context_limit": 7,
            "memory_config": {"working_max_entries": 5, "auto_compress": False},
            "enable_token_streaming": True,
            "broadcast_task_to_all": False,
            "enable_dynamic_topology": True,
            "early_stop_conditions": [{"type": "keyword", "keyword": "approved", "reason": "approval found"}],
            "topology_hooks": [
                {"type": "add_edge_on_keyword", "keyword": "escalate", "source_agent": "writer", "target_agent": "reviewer", "weight": 0.6},
                {"type": "skip_agent_on_keyword", "keyword": "skip-review", "target_agent": "reviewer"},
            ],
            "max_tool_iterations": 4,
            "max_loop_iterations": 3,
            "callback_modes": ["metrics"],
            "execution_mode": "stream",
        },
    )


def comparable(graph: GraphSaveRequest) -> dict:
    data = graph.model_dump(mode="json")
    # Secrets are intentionally stripped/nullified on export.
    for agent in data.get("agents", []):
        llm_config = agent.get("llm_config")
        if isinstance(llm_config, dict) and "api_key" in llm_config:
            llm_config["api_key"] = None
    return data


class GraphCodecServiceTests(unittest.TestCase):
    def test_native_json_round_trip_preserves_visual_and_runtime_fields_without_secrets(self) -> None:
        graph = sample_graph()

        exported = export_graph_json(graph, source_graph_id="graph-123")

        self.assertEqual(exported.format, "gmas_json")
        self.assertEqual(exported.mime_type, "application/json")
        self.assertTrue(exported.filename.endswith(".gmas.json"))
        self.assertNotIn("sk-live-secret-should-not-export", exported.content)
        self.assertIn('"format": "gmas.studio.graph"', exported.content)

        imported, warnings = import_gmas_json(exported.content)

        self.assertEqual(warnings, [])
        self.assertEqual(comparable(imported), comparable(graph))
        self.assertIn("__start__", imported.positions)
        self.assertIn("__end__", imported.positions)
        self.assertEqual(imported.edges[2].condition, "loop")
        self.assertEqual(imported.edges[2].label, "needs_revision")
        self.assertFalse(imported.edges[3].enabled)

    def test_generated_python_round_trip_uses_clean_builder_code_without_executing_on_import(self) -> None:
        graph = sample_graph()

        exported = export_graph_python(graph, source_graph_id="graph-123")

        self.assertEqual(exported.format, "gmas_python")
        self.assertEqual(exported.mime_type, "text/x-python")
        self.assertTrue(exported.filename.endswith(".gmas.py"))
        self.assertIn("builder = GraphBuilder()", exported.content)
        self.assertIn("builder.add_agent(", exported.content)
        self.assertIn("builder.add_conditional_edge", exported.content)
        self.assertNotIn("GRAPH" + "_SPEC =", exported.content)
        self.assertNotIn("\ndef ", exported.content)
        self.assertNotIn("__future__", exported.content)
        self.assertNotIn("sk-liv...port", exported.content)
        self.assertNotIn("***", exported.content)

        imported, warnings = import_gmas_python(exported.content)

        self.assertEqual(warnings, [])
        self.assertEqual(comparable(imported), comparable(graph))

    def test_generated_python_executes_as_code_first_graphbuilder_script(self) -> None:
        exported = export_graph_python(sample_graph(), source_graph_id="graph-123")
        namespace: dict[str, object] = {}

        exec(exported.content, namespace)

        role_graph = namespace["graph"]
        studio = namespace["STUDIO"]

        self.assertEqual(getattr(role_graph, "start_node", None), "researcher")
        self.assertEqual(getattr(role_graph, "end_node", None), "reviewer")
        self.assertTrue(studio["run_config"]["adaptive"])
        self.assertEqual(studio["run_config"]["max_tool_iterations"], 4)
        self.assertEqual(studio["run_config"]["max_loop_iterations"], 3)
        self.assertEqual(len(studio["run_config"]["topology_hooks"]), 2)
        self.assertEqual(studio["edges"][2]["condition"], "loop")

    def test_python_export_warns_when_sdk_runtime_drops_extended_llm_fields(self) -> None:
        exported = export_graph_python(sample_graph(), source_graph_id="graph-123")

        self.assertTrue(
            any("GraphBuilder runtime" in warning and "top_k" in warning for warning in exported.warnings),
            exported.warnings,
        )

    def test_python_import_accepts_hand_written_builder_subset(self) -> None:
        source = '''from gmas.builder import GraphBuilder

GRAPH_NAME = "Hand Written"
TASK_QUERY = "Summarize"
TASK_TARGETS = ["researcher"]
STUDIO = {"positions": {"researcher": {"x": 1, "y": 2}}, "run_config": {"adaptive": True}}

builder = GraphBuilder()
builder.add_agent("researcher", "Researcher", "Research", tools=["web_search"])
builder.add_agent("writer", "Writer", "Write")
builder.add_workflow_edge("researcher", "writer", weight=1.0)
builder.set_start_node("researcher")
builder.set_end_node("writer")
builder.add_task(query=TASK_QUERY)
builder.connect_task_to_agents(agent_ids=TASK_TARGETS, bidirectional=True)
graph = builder.build()
'''

        imported, warnings = import_gmas_python(source)

        self.assertEqual(warnings, [])
        self.assertEqual(imported.name, "Hand Written")
        self.assertEqual([agent.agent_id for agent in imported.agents], ["researcher", "writer"])
        self.assertEqual(imported.agents[0].display_name, "Researcher")
        self.assertEqual(imported.agents[0].persona, "Research")
        self.assertEqual(imported.edges[0].source, "researcher")
        self.assertEqual(imported.task_targets, ["researcher"])
        self.assertTrue(imported.run_config["adaptive"])

    def test_python_import_rejects_non_literal_or_non_builder_code(self) -> None:
        with self.assertRaises(ValueError):
            import_gmas_python("payload = make_graph_spec()\n")

        with self.assertRaises(ValueError):
            import_gmas_python("import os\nos.system('echo should-not-run')\n")


if __name__ == "__main__":
    unittest.main()
