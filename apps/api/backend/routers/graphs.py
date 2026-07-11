"""Graph CRUD and validation endpoints."""

from fastapi import APIRouter, HTTPException

from backend.models.graph import (
    AIBuildRequest,
    AutoBuildRequest,
    GraphExportRequest,
    GraphExportResponse,
    GraphExportFormat,
    GraphImportRequest,
    GraphImportResponse,
    GraphListItem,
    GraphResponse,
    GraphSaveRequest,
    GraphTemplate,
    GraphValidationResponse,
)
from backend.services import graph_codec_service, graph_import_service, graph_service, graph_templates_service

router = APIRouter(prefix="/api/graphs", tags=["graphs"])


@router.get("", response_model=list[GraphListItem])
def list_graphs():
    return graph_service.list_graphs()


@router.get("/templates", response_model=list[GraphTemplate])
def list_graph_templates():
    """Predefined graph templates (architecture patterns) ready to be cloned."""
    return graph_templates_service.list_templates()


@router.post("/templates/{template_id}", response_model=GraphResponse, status_code=201)
def create_from_template(template_id: str):
    """Clone a predefined template into a new graph."""
    tpl = graph_templates_service.get_template(template_id)
    if tpl is None:
        raise HTTPException(status_code=404, detail=f"Template '{template_id}' not found")
    return graph_service.create_graph(tpl.graph)


@router.post("/export", response_model=GraphExportResponse)
def export_graph(req: GraphExportRequest):
    """Export the current canvas graph without requiring it to be saved first."""
    try:
        if req.format == "gmas_python":
            return graph_codec_service.export_graph_python(
                req.graph,
                source_graph_id=req.source_graph_id,
                filename_hint=req.filename_hint,
            )
        return graph_codec_service.export_graph_json(
            req.graph,
            source_graph_id=req.source_graph_id,
            filename_hint=req.filename_hint,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/{graph_id}", response_model=GraphResponse)
def get_graph(graph_id: str):
    graph = graph_service.get_graph(graph_id)
    if graph is None:
        raise HTTPException(status_code=404, detail=f"Graph '{graph_id}' not found")
    return graph


@router.get("/{graph_id}/export", response_model=GraphExportResponse)
def export_saved_graph(graph_id: str, format: GraphExportFormat = "gmas_json"):
    """Export a saved graph by id."""
    graph = graph_service.get_graph(graph_id)
    if graph is None:
        raise HTTPException(status_code=404, detail=f"Graph '{graph_id}' not found")
    try:
        if format == "gmas_python":
            return graph_codec_service.export_graph_python(
                graph.model_dump(mode="json"),
                source_graph_id=graph_id,
                filename_hint=graph.name,
            )
        if format == "gmas_json":
            return graph_codec_service.export_graph_json(
                graph.model_dump(mode="json"),
                source_graph_id=graph_id,
                filename_hint=graph.name,
            )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    raise HTTPException(status_code=400, detail=f"Unsupported export format: {format}")


@router.post("", response_model=GraphResponse, status_code=201)
def create_graph(req: GraphSaveRequest):
    return graph_service.create_graph(req)


@router.post("/import", response_model=GraphImportResponse, status_code=201)
def import_graph(req: GraphImportRequest):
    try:
        if req.source == "gmas_json":
            graph_req, warnings = graph_codec_service.import_gmas_json(
                req.payload,
                name_override=req.name_override,
            )
            import_mode = "native_graph"
        elif req.source == "gmas_python":
            graph_req, warnings = graph_codec_service.import_gmas_python(
                req.payload,
                name_override=req.name_override,
            )
            import_mode = "native_python"
        else:
            graph_req, warnings, import_mode = graph_import_service.import_graph(
                source=req.source,
                payload=req.payload,
                name_override=req.name_override,
            )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    created = graph_service.create_graph(graph_req)
    return GraphImportResponse(
        source=req.source,
        import_mode=import_mode,
        warnings=warnings,
        graph=created,
    )


@router.put("/{graph_id}", response_model=GraphResponse)
def update_graph(graph_id: str, req: GraphSaveRequest):
    graph = graph_service.update_graph(graph_id, req)
    if graph is None:
        raise HTTPException(status_code=404, detail=f"Graph '{graph_id}' not found")
    return graph


@router.delete("/{graph_id}", status_code=204)
def delete_graph(graph_id: str):
    if not graph_service.delete_graph(graph_id):
        raise HTTPException(status_code=404, detail=f"Graph '{graph_id}' not found")


@router.post("/{graph_id}/validate", response_model=GraphValidationResponse)
def validate_graph(graph_id: str):
    result = graph_service.validate_graph(graph_id)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Graph '{graph_id}' not found")
    return result


@router.post("/validate", response_model=GraphValidationResponse)
def validate_graph_inline(req: GraphSaveRequest):
    return graph_service.validate_graph_inline(req)


@router.post("/auto-build", response_model=GraphSaveRequest)
def auto_build_graph(req: AutoBuildRequest):
    """Auto-generate a graph from saved agents and task query."""
    try:
        return graph_service.auto_build_graph(
            name=req.name,
            description=req.description,
            task_query=req.task_query,
            agent_ids=req.agent_ids,
            strategy=req.strategy,
            max_edges_per_agent=req.max_edges_per_agent,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/ai-build", response_model=GraphSaveRequest)
async def ai_build_graph(req: AIBuildRequest):
    """LLM-powered graph assembly — designs agents AND topology from scratch.

    Reads task_query, calls the configured default LLM provider, and returns
    a ready-to-save GraphSaveRequest. The graph is *not* persisted automatically;
    the UI gets the design back and decides whether to save it.
    """
    try:
        return await graph_service.ai_build_graph(
            task_query=req.task_query,
            name=req.name,
            description=req.description,
            max_agents=req.max_agents,
            enabled_tools=req.enabled_tools,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"AI Build failed: {exc}") from exc
