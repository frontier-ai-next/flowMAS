"""API tests for native graph export/import routes."""

from pathlib import Path
import sys
import unittest

from fastapi import FastAPI
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "apps" / "api"))
sys.path.insert(0, str(ROOT / "vendor" / "gmas" / "src"))

from backend.routers.graphs import router as graphs_router  # noqa: E402
from backend.services import graph_service  # noqa: E402
from test_graph_codec_service import sample_graph  # noqa: E402


def build_test_app() -> FastAPI:
    app = FastAPI()
    app.include_router(graphs_router)
    return app


class GraphExportImportRouteTests(unittest.TestCase):
    def setUp(self) -> None:
        self.client = TestClient(build_test_app())

    def test_export_route_returns_native_json_for_unsaved_graph(self) -> None:
        body = {"format": "gmas_json", "graph": sample_graph().model_dump(mode="json")}

        response = self.client.post("/api/graphs/export", json=body)

        self.assertEqual(response.status_code, 200, response.text)
        payload = response.json()
        self.assertEqual(payload["format"], "gmas_json")
        self.assertTrue(payload["filename"].endswith(".gmas.json"))
        self.assertIn('"format": "gmas.studio.graph"', payload["content"])
        self.assertNotIn("sk-liv...port", payload["content"])

    def test_import_route_accepts_generated_python_and_creates_graph(self) -> None:
        export_response = self.client.post(
            "/api/graphs/export",
            json={"format": "gmas_python", "graph": sample_graph().model_dump(mode="json")},
        )
        self.assertEqual(export_response.status_code, 200, export_response.text)
        source = export_response.json()["content"]

        response = self.client.post(
            "/api/graphs/import",
            json={"source": "gmas_python", "payload": source, "name_override": "Imported SDK Graph"},
        )

        self.assertEqual(response.status_code, 201, response.text)
        payload = response.json()
        self.assertEqual(payload["source"], "gmas_python")
        self.assertEqual(payload["import_mode"], "native_python")
        self.assertEqual(payload["graph"]["name"], "Imported SDK Graph")
        self.assertIn("__start__", payload["graph"]["positions"])
        graph_service.delete_graph(payload["graph"]["graph_id"])

    def test_saved_export_route_returns_clean_python_sdk(self) -> None:
        create_response = self.client.post("/api/graphs", json=sample_graph().model_dump(mode="json"))
        self.assertEqual(create_response.status_code, 201, create_response.text)
        graph_id = create_response.json()["graph_id"]

        try:
            response = self.client.get(f"/api/graphs/{graph_id}/export?format=gmas_python")

            self.assertEqual(response.status_code, 200, response.text)
            payload = response.json()
            self.assertEqual(payload["format"], "gmas_python")
            self.assertIn("builder.add_agent(", payload["content"])
            self.assertIn("graph = builder.build()", payload["content"])
            self.assertNotIn("GRAPH" + "_SPEC =", payload["content"])
            self.assertNotIn("\ndef ", payload["content"])
        finally:
            graph_service.delete_graph(graph_id)


if __name__ == "__main__":
    unittest.main()
