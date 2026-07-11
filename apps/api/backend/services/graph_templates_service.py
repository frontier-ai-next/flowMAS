"""Predefined graph templates — ready-to-use multi-agent architectures."""

from backend.models.agent import AgentCreateRequest
from backend.models.graph import (
    EdgeDefinition,
    GraphSaveRequest,
    GraphTemplate,
    Position,
)


def _pos(x: float, y: float) -> Position:
    return Position(x=x, y=y)


GRAPH_TEMPLATES: list[GraphTemplate] = [
    GraphTemplate(
        template_id="research-writer",
        name="Research & Write",
        description="Two-step linear pipeline: researcher gathers facts, writer produces final document.",
        category="research",
        graph=GraphSaveRequest(
            name="Research & Write",
            description="Research a topic and produce a written summary.",
            agents=[
                AgentCreateRequest(
                    agent_id="t_researcher",
                    display_name="Researcher",
                    persona="You are an expert researcher. Gather comprehensive information and provide well-sourced analysis.",
                    tools=["web_search"],
                ),
                AgentCreateRequest(
                    agent_id="t_writer",
                    display_name="Writer",
                    persona="You are a skilled technical writer. Produce clear, well-structured, and engaging content from the researcher's findings.",
                ),
            ],
            edges=[EdgeDefinition(source="t_researcher", target="t_writer")],
            positions={
                "t_researcher": _pos(60, 200),
                "t_writer": _pos(400, 200),
            },
            start_node="t_researcher",
            end_node="t_writer",
            task_query="Summarize the latest developments in <your topic>.",
        ),
    ),
    GraphTemplate(
        template_id="plan-execute-review",
        name="Plan → Execute → Review",
        description="Classic agentic pattern: planner decomposes the task, coder executes, reviewer checks the result.",
        category="coding",
        graph=GraphSaveRequest(
            name="Plan → Execute → Review",
            description="Decompose, execute, and review a coding or analysis task.",
            agents=[
                AgentCreateRequest(
                    agent_id="t_planner",
                    display_name="Planner",
                    persona="You are a strategic planner. Break the task into clear, actionable steps.",
                ),
                AgentCreateRequest(
                    agent_id="t_coder",
                    display_name="Coder",
                    persona="You are an expert software engineer. Implement the plan with clean, tested code.",
                    tools=["code_interpreter"],
                ),
                AgentCreateRequest(
                    agent_id="t_reviewer",
                    display_name="Reviewer",
                    persona="You are a critical reviewer. Check the implementation for correctness, completeness, and quality.",
                ),
            ],
            edges=[
                EdgeDefinition(source="t_planner", target="t_coder"),
                EdgeDefinition(source="t_coder", target="t_reviewer"),
            ],
            positions={
                "t_planner": _pos(60, 200),
                "t_coder": _pos(360, 200),
                "t_reviewer": _pos(660, 200),
            },
            start_node="t_planner",
            end_node="t_reviewer",
            task_query="Implement a small utility that <describe task>.",
        ),
    ),
    GraphTemplate(
        template_id="parallel-research-merge",
        name="Parallel Research → Merge",
        description="Fan-out: three researchers explore the topic from different angles, a synthesizer merges their findings.",
        category="research",
        graph=GraphSaveRequest(
            name="Parallel Research → Merge",
            description="Three parallel researchers + synthesizer.",
            agents=[
                AgentCreateRequest(
                    agent_id="t_dispatcher",
                    display_name="Dispatcher",
                    persona="You are a research coordinator. Briefly restate the user's question for the three parallel researchers.",
                ),
                AgentCreateRequest(
                    agent_id="t_research_tech",
                    display_name="Tech Researcher",
                    persona="You research the technical side of the topic. Focus on implementations, benchmarks, libraries.",
                    tools=["web_search"],
                ),
                AgentCreateRequest(
                    agent_id="t_research_market",
                    display_name="Market Researcher",
                    persona="You research the market side: adoption, competitors, trends, business impact.",
                    tools=["web_search"],
                ),
                AgentCreateRequest(
                    agent_id="t_research_papers",
                    display_name="Papers Researcher",
                    persona="You research academic papers, surveys, and citations relevant to the topic.",
                    tools=["web_search"],
                ),
                AgentCreateRequest(
                    agent_id="t_synthesizer",
                    display_name="Synthesizer",
                    persona="You consolidate findings from three independent researchers into one structured report with sections.",
                ),
            ],
            edges=[
                EdgeDefinition(source="t_dispatcher", target="t_research_tech"),
                EdgeDefinition(source="t_dispatcher", target="t_research_market"),
                EdgeDefinition(source="t_dispatcher", target="t_research_papers"),
                EdgeDefinition(source="t_research_tech", target="t_synthesizer"),
                EdgeDefinition(source="t_research_market", target="t_synthesizer"),
                EdgeDefinition(source="t_research_papers", target="t_synthesizer"),
            ],
            positions={
                "t_dispatcher": _pos(60, 240),
                "t_research_tech": _pos(340, 80),
                "t_research_market": _pos(340, 240),
                "t_research_papers": _pos(340, 400),
                "t_synthesizer": _pos(640, 240),
            },
            start_node="t_dispatcher",
            end_node="t_synthesizer",
            task_query="Produce a comprehensive overview of <your topic>.",
        ),
    ),
    GraphTemplate(
        template_id="code-pipeline",
        name="Code Pipeline",
        description="Architect designs, two coders implement in parallel, reviewer merges and reviews.",
        category="coding",
        graph=GraphSaveRequest(
            name="Code Pipeline",
            description="Architecture → parallel implementation → review.",
            agents=[
                AgentCreateRequest(
                    agent_id="t_architect",
                    display_name="Architect",
                    persona="You are a senior software architect. Produce a clear technical spec from the user task.",
                ),
                AgentCreateRequest(
                    agent_id="t_dev_a",
                    display_name="Dev A",
                    persona="You implement Module A from the architect's spec. Use code_interpreter to run examples.",
                    tools=["code_interpreter"],
                ),
                AgentCreateRequest(
                    agent_id="t_dev_b",
                    display_name="Dev B",
                    persona="You implement Module B from the architect's spec. Use code_interpreter to run examples.",
                    tools=["code_interpreter"],
                ),
                AgentCreateRequest(
                    agent_id="t_code_reviewer",
                    display_name="Code Reviewer",
                    persona="You review both modules together. Flag bugs, style, and integration issues.",
                ),
            ],
            edges=[
                EdgeDefinition(source="t_architect", target="t_dev_a"),
                EdgeDefinition(source="t_architect", target="t_dev_b"),
                EdgeDefinition(source="t_dev_a", target="t_code_reviewer"),
                EdgeDefinition(source="t_dev_b", target="t_code_reviewer"),
            ],
            positions={
                "t_architect": _pos(60, 200),
                "t_dev_a": _pos(360, 80),
                "t_dev_b": _pos(360, 320),
                "t_code_reviewer": _pos(660, 200),
            },
            start_node="t_architect",
            end_node="t_code_reviewer",
            task_query="Implement <your application> end-to-end.",
        ),
    ),
    GraphTemplate(
        template_id="qa-pipeline",
        name="Q&A with Critic",
        description="Single answerer + dedicated critic loop. Critic forwards back to answerer on issues.",
        category="review",
        graph=GraphSaveRequest(
            name="Q&A with Critic",
            description="Answer + critic refinement.",
            agents=[
                AgentCreateRequest(
                    agent_id="t_answerer",
                    display_name="Answerer",
                    persona="You provide a direct, accurate answer to the user's question.",
                    tools=["web_search"],
                ),
                AgentCreateRequest(
                    agent_id="t_critic",
                    display_name="Critic",
                    persona="You are a strict fact-checker. Identify inaccuracies, missing context, or unsupported claims.",
                ),
                AgentCreateRequest(
                    agent_id="t_finalizer",
                    display_name="Finalizer",
                    persona="You produce the final polished answer incorporating critic feedback.",
                ),
            ],
            edges=[
                EdgeDefinition(source="t_answerer", target="t_critic"),
                EdgeDefinition(source="t_critic", target="t_finalizer"),
            ],
            positions={
                "t_answerer": _pos(60, 200),
                "t_critic": _pos(360, 200),
                "t_finalizer": _pos(660, 200),
            },
            start_node="t_answerer",
            end_node="t_finalizer",
            task_query="Answer this question accurately: <question>.",
        ),
    ),
    GraphTemplate(
        template_id="data-analysis",
        name="Data Analysis",
        description="Loader → cleaner → analyst → reporter. Linear data-pipeline pattern.",
        category="analysis",
        graph=GraphSaveRequest(
            name="Data Analysis",
            description="Linear data analysis pipeline.",
            agents=[
                AgentCreateRequest(
                    agent_id="t_loader",
                    display_name="Data Loader",
                    persona="You collect and load the raw data sources required for the task.",
                    tools=["web_search", "file_search"],
                ),
                AgentCreateRequest(
                    agent_id="t_cleaner",
                    display_name="Data Cleaner",
                    persona="You clean and validate the loaded data. Remove duplicates, fix types, document assumptions.",
                    tools=["code_interpreter"],
                ),
                AgentCreateRequest(
                    agent_id="t_analyst",
                    display_name="Analyst",
                    persona="You compute statistics, identify patterns, and produce findings from the cleaned data.",
                    tools=["code_interpreter"],
                ),
                AgentCreateRequest(
                    agent_id="t_reporter",
                    display_name="Reporter",
                    persona="You write the final report: executive summary, findings, recommendations.",
                ),
            ],
            edges=[
                EdgeDefinition(source="t_loader", target="t_cleaner"),
                EdgeDefinition(source="t_cleaner", target="t_analyst"),
                EdgeDefinition(source="t_analyst", target="t_reporter"),
            ],
            positions={
                "t_loader": _pos(60, 200),
                "t_cleaner": _pos(330, 200),
                "t_analyst": _pos(600, 200),
                "t_reporter": _pos(870, 200),
            },
            start_node="t_loader",
            end_node="t_reporter",
            task_query="Analyze <dataset or topic> and produce a report.",
        ),
    ),
    GraphTemplate(
        template_id="cooking-recipe",
        name="Cooking Recipe Pipeline",
        description=(
            "Conditional cooking workflow: classify dish → propose recipe → check ingredients → "
            "optionally substitute → cook → plate. Uses conditional edges to skip substitution "
            "when nothing is missing."
        ),
        category="general",
        graph=GraphSaveRequest(
            name="Cooking Recipe Pipeline",
            description=(
                "Multi-step cooking pipeline. The Substitution agent only fires when "
                "ingredients are missing — the ingredient check edge uses condition='source_success'."
            ),
            agents=[
                AgentCreateRequest(
                    agent_id="t_classifier",
                    display_name="Dish Classifier",
                    persona=(
                        "You classify what dish the user wants to make. "
                        "Output: cuisine, dish type (main, side, dessert), difficulty, est. time."
                    ),
                ),
                AgentCreateRequest(
                    agent_id="t_recipe",
                    display_name="Recipe Designer",
                    persona=(
                        "You design a complete recipe. Output: ingredients with quantities, "
                        "equipment, prep steps, cook steps. Be specific and proportional."
                    ),
                ),
                AgentCreateRequest(
                    agent_id="t_ingredients",
                    display_name="Ingredient Checker",
                    persona=(
                        "You check the user's pantry against the recipe. Report which items "
                        "are missing or low. If everything is available, end your response with "
                        "the exact phrase 'ALL_OK'. Otherwise list the missing items."
                    ),
                ),
                AgentCreateRequest(
                    agent_id="t_substitute",
                    display_name="Substitution Expert",
                    persona=(
                        "You propose pantry-friendly substitutes for any missing ingredients "
                        "and explain how the substitution changes the dish."
                    ),
                ),
                AgentCreateRequest(
                    agent_id="t_chef",
                    display_name="Chef",
                    persona=(
                        "You walk the user through cooking step by step. Be precise about "
                        "temperatures, times, and visual cues. Use any substitutions provided."
                    ),
                ),
                AgentCreateRequest(
                    agent_id="t_plater",
                    display_name="Plating & Serving",
                    persona=(
                        "You describe plating, garnishes, and serving suggestions. "
                        "Include a short serving tip and a pairing (drink or side)."
                    ),
                ),
            ],
            edges=[
                EdgeDefinition(source="t_classifier", target="t_recipe"),
                EdgeDefinition(source="t_recipe", target="t_ingredients"),
                # Conditional skip: substitute runs only if ingredient check did NOT succeed
                # (i.e. the checker flagged missing items). When everything is in stock,
                # the flow jumps straight to the chef.
                EdgeDefinition(
                    source="t_ingredients",
                    target="t_substitute",
                    condition="source_failed",
                    label="missing items",
                ),
                EdgeDefinition(
                    source="t_ingredients",
                    target="t_chef",
                    condition="source_success",
                    label="all on hand",
                ),
                EdgeDefinition(source="t_substitute", target="t_chef"),
                EdgeDefinition(source="t_chef", target="t_plater"),
            ],
            positions={
                "t_classifier": _pos(60, 200),
                "t_recipe": _pos(310, 200),
                "t_ingredients": _pos(560, 200),
                "t_substitute": _pos(810, 80),
                "t_chef": _pos(1060, 200),
                "t_plater": _pos(1310, 200),
            },
            start_node="t_classifier",
            end_node="t_plater",
            task_query="I want to make pasta carbonara tonight. I have eggs, pasta, garlic, but no pancetta.",
        ),
    ),
]


def list_templates() -> list[GraphTemplate]:
    """Return all predefined graph templates."""
    return GRAPH_TEMPLATES


def get_template(template_id: str) -> GraphTemplate | None:
    """Find a template by id."""
    for t in GRAPH_TEMPLATES:
        if t.template_id == template_id:
            return t
    return None
