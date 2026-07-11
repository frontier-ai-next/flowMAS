#!/usr/bin/env python3
"""Charts and comparison tables for Langflow vs gMAS benchmark JSON reports."""

import csv
import json
import math
from pathlib import Path
from typing import Any


def load_report(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _fmt_num(value: Any, digits: int = 1) -> str:
    if value is None:
        return "—"
    if isinstance(value, (int, float)):
        if isinstance(value, float) and math.isnan(value):
            return "—"
        if float(value).is_integer():
            return str(int(value))
        return f"{float(value):.{digits}f}"
    return str(value)


def _pct_delta(langflow_ms: float | None, gmas_ms: float | None) -> float | None:
    if langflow_ms is None or gmas_ms is None or langflow_ms == 0:
        return None
    return round((gmas_ms - langflow_ms) / langflow_ms * 100, 1)


def _phase_ms_by_scenario(report: dict[str, Any], prefix: str) -> dict[str, float]:
    """Map scenario_id -> duration_ms for phases like build_flow:{sid}."""
    out: dict[str, float] = {}
    for phase in report.get("phases") or []:
        name = str(phase.get("name") or "")
        if not name.startswith(f"{prefix}:"):
            continue
        sid = name.split(":", 1)[1]
        if phase.get("ok"):
            out[sid] = float(phase.get("duration_ms") or 0)
    return out


def build_comparison_rows(report: dict[str, Any]) -> list[dict[str, Any]]:
    """Flat comparison table: one row per scenario with head-to-head metrics."""
    rows: list[dict[str, Any]] = []
    by_scenario = (report.get("comparison") or {}).get("by_scenario") or []
    graph_profiles = report.get("graph_profiles") or {}

    scenario_meta: dict[str, dict[str, Any]] = {}
    for sc in report.get("scenarios") or []:
        sid = str(sc.get("id") or "")
        if sid:
            scenario_meta[sid] = sc

    graph_by_scenario: dict[str, str] = {}
    for run in report.get("runs") or []:
        sid = str(run.get("scenario_id") or "")
        gid = run.get("graph_id")
        if sid and gid and sid not in graph_by_scenario:
            graph_by_scenario[sid] = str(gid)

    build_flow_ms = _phase_ms_by_scenario(report, "build_flow")
    validate_inline_ms = _phase_ms_by_scenario(report, "validate_inline")
    fetch_flow_ms = _phase_ms_by_scenario(report, "fetch_flow")
    fetch_graph_ms = _phase_ms_by_scenario(report, "fetch_graph")

    for item in by_scenario:
        sid = str(item.get("scenario_id") or "")
        meta = scenario_meta.get(sid, {})
        platforms = item.get("platforms") or {}
        lf = platforms.get("langflow") or {}
        gm = platforms.get("gmas") or {}
        lf_e2e = (lf.get("e2e_ms") or {}).get("p50_ms")
        gm_e2e = (gm.get("e2e_ms") or {}).get("p50_ms")
        lf_tok = (lf.get("tokens_ui_total") or {}).get("p50_ms")
        gm_tok = (gm.get("tokens_ui_total") or {}).get("p50_ms")
        delta = item.get("e2e_delta_ms")
        if delta is None and lf_e2e is not None and gm_e2e is not None:
            delta = round(gm_e2e - lf_e2e, 2)

        gid = graph_by_scenario.get(sid, "")
        compile_p50 = None
        agent_count = None
        if gid and gid in graph_profiles:
            compile_p50 = ((graph_profiles[gid].get("compile_validate") or {}).get("compile_validate_p50_ms"))
            agent_count = (graph_profiles[gid].get("structure") or {}).get("agent_count")

        gm_setup = (gm.get("compile_setup_ms") or {}).get("p50_ms")
        gm_llm = (gm.get("agent_llm_ms_sum") or {}).get("p50_ms")
        gm_ttfa = (gm.get("time_to_first_agent_ms") or {}).get("p50_ms")
        gm_poll = (gm.get("poll_wait_ms") or {}).get("p50_ms")
        gm_gap = (gm.get("agent_gap_ms_mean") or {}).get("p50_ms")

        rows.append(
            {
                "scenario_id": sid,
                "scenario_name": item.get("scenario_name") or sid,
                "architecture": item.get("architecture") or meta.get("architecture") or "",
                "agent_count": agent_count,
                "langflow_e2e_p50_ms": lf_e2e,
                "gmas_e2e_p50_ms": gm_e2e,
                "e2e_delta_ms": delta,
                "e2e_delta_pct": _pct_delta(lf_e2e, gm_e2e),
                "langflow_tokens_p50": lf_tok,
                "gmas_tokens_p50": gm_tok,
                "langflow_success_rate": lf.get("success_rate"),
                "gmas_success_rate": gm.get("success_rate"),
                "gmas_compile_p50_ms": compile_p50,
                "gmas_e2e_per_agent_p50_ms": (gm.get("e2e_per_agent_ms") or {}).get("p50_ms"),
                "gmas_setup_p50_ms": gm_setup,
                "gmas_llm_sum_p50_ms": gm_llm,
                "gmas_ttfa_p50_ms": gm_ttfa,
                "gmas_poll_wait_p50_ms": gm_poll,
                "gmas_agent_gap_p50_ms": gm_gap,
                "langflow_fetch_flow_ms": fetch_flow_ms.get(sid),
                "langflow_build_flow_ms": build_flow_ms.get(sid),
                "gmas_fetch_graph_ms": fetch_graph_ms.get(sid),
                "gmas_validate_inline_ms": validate_inline_ms.get(sid),
                "faster_platform": (
                    "gMAS"
                    if delta is not None and delta < 0
                    else ("Langflow" if delta is not None and delta > 0 else "—")
                ),
            }
        )
    return rows


COMPARISON_FIELDS = [
    "scenario_id",
    "scenario_name",
    "architecture",
    "agent_count",
    "langflow_e2e_p50_ms",
    "gmas_e2e_p50_ms",
    "e2e_delta_ms",
    "e2e_delta_pct",
    "faster_platform",
    "langflow_tokens_p50",
    "gmas_tokens_p50",
    "gmas_compile_p50_ms",
    "gmas_e2e_per_agent_p50_ms",
    "gmas_setup_p50_ms",
    "gmas_llm_sum_p50_ms",
    "gmas_ttfa_p50_ms",
    "gmas_poll_wait_p50_ms",
    "gmas_agent_gap_p50_ms",
    "langflow_fetch_flow_ms",
    "langflow_build_flow_ms",
    "gmas_fetch_graph_ms",
    "gmas_validate_inline_ms",
    "langflow_success_rate",
    "gmas_success_rate",
]


def write_comparison_table_csv(rows: list[dict[str, Any]], path: Path) -> None:
    with path.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=COMPARISON_FIELDS, extrasaction="ignore")
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def render_comparison_table_md(rows: list[dict[str, Any]]) -> str:
    headers = [
        ("scenario_name", "Scenario"),
        ("architecture", "Architecture"),
        ("agent_count", "Agents"),
        ("langflow_e2e_p50_ms", "LF e2e p50"),
        ("gmas_e2e_p50_ms", "gMAS e2e p50"),
        ("e2e_delta_ms", "Δ ms"),
        ("e2e_delta_pct", "Δ %"),
        ("faster_platform", "Faster"),
        ("langflow_tokens_p50", "LF tokens"),
        ("gmas_tokens_p50", "gMAS tokens"),
        ("gmas_compile_p50_ms", "compile p50"),
        ("gmas_setup_p50_ms", "setup p50"),
        ("gmas_llm_sum_p50_ms", "LLM sum p50"),
        ("gmas_ttfa_p50_ms", "TTFA p50"),
        ("langflow_build_flow_ms", "LF build"),
        ("gmas_validate_inline_ms", "validate inline"),
    ]
    lines = [
        "## Comparison table",
        "",
        "| " + " | ".join(h[1] for h in headers) + " |",
        "| " + " | ".join("---" if i else ":---" for i, _ in enumerate(headers)) + " |",
    ]
    for row in rows:
        cells = [_fmt_num(row.get(key)) for key, _ in headers]
        lines.append("| " + " | ".join(cells) + " |")
    lines.append("")
    return "\n".join(lines)


def _scenario_labels(rows: list[dict[str, Any]]) -> list[str]:
    labels = []
    for row in rows:
        name = str(row.get("scenario_name") or row.get("scenario_id") or "")
        if len(name) > 28:
            name = name[:25] + "…"
        labels.append(name)
    return labels


def _gmas_breakdown_by_scenario(report: dict[str, Any]) -> dict[str, dict[str, float]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for run in report.get("runs") or []:
        if run.get("platform") != "gmas" or not run.get("ok"):
            continue
        sid = str(run.get("scenario_id") or "default")
        grouped.setdefault(sid, []).append(run)

    out: dict[str, dict[str, float]] = {}
    for sid, runs in grouped.items():
        setup = [r["compile_setup_ms"] for r in runs if r.get("compile_setup_ms") is not None]
        llm = [r["agent_llm_ms_sum"] for r in runs if r.get("agent_llm_ms_sum") is not None]
        orch = [r["orchestration_overhead_ms"] for r in runs if r.get("orchestration_overhead_ms") is not None]
        out[sid] = {
            "setup": sum(setup) / len(setup) if setup else 0,
            "llm": sum(llm) / len(llm) if llm else 0,
            "overhead": sum(orch) / len(orch) if orch else 0,
        }
    return out


def generate_charts(report: dict[str, Any], out_dir: Path, prefix: str) -> dict[str, Path]:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import numpy as np

    rows = build_comparison_rows(report)
    if not rows:
        return {}

    paths: dict[str, Path] = {}
    labels = _scenario_labels(rows)
    x = np.arange(len(rows))
    width = 0.36

    # 1) E2E p50 grouped bars
    lf_vals = [r.get("langflow_e2e_p50_ms") or 0 for r in rows]
    gm_vals = [r.get("gmas_e2e_p50_ms") or 0 for r in rows]
    has_lf = any(r.get("langflow_e2e_p50_ms") is not None for r in rows)
    has_gm = any(r.get("gmas_e2e_p50_ms") is not None for r in rows)

    fig, ax = plt.subplots(figsize=(max(8, len(rows) * 1.4), 5))
    if has_lf:
        ax.bar(x - width / 2, lf_vals, width, label="Langflow", color="#6366f1")
    if has_gm:
        ax.bar(x + width / 2, gm_vals, width, label="gMAS", color="#059669")
    ax.set_ylabel("E2E latency p50 (ms)")
    ax.set_title("End-to-end latency by scenario")
    ax.set_xticks(x)
    ax.set_xticklabels(labels, rotation=25, ha="right")
    ax.legend()
    ax.grid(axis="y", alpha=0.3)
    fig.tight_layout()
    p1 = out_dir / f"{prefix}_chart_e2e_p50.png"
    fig.savefig(p1, dpi=144)
    plt.close(fig)
    paths["e2e_p50"] = p1

    # 2) Delta chart (scenarios with both platforms)
    delta_rows = [r for r in rows if r.get("e2e_delta_ms") is not None]
    if delta_rows:
        fig, ax = plt.subplots(figsize=(max(7, len(delta_rows) * 1.2), 4.5))
        dlabels = _scenario_labels(delta_rows)
        deltas = [float(r["e2e_delta_ms"]) for r in delta_rows]
        colors = ["#059669" if d < 0 else "#dc2626" for d in deltas]
        ax.barh(dlabels, deltas, color=colors)
        ax.axvline(0, color="#666", linewidth=0.8)
        ax.set_xlabel("Δ e2e p50: gMAS − Langflow (ms)")
        ax.set_title("Head-to-head delta (negative = gMAS faster)")
        ax.grid(axis="x", alpha=0.3)
        fig.tight_layout()
        p2 = out_dir / f"{prefix}_chart_e2e_delta.png"
        fig.savefig(p2, dpi=144)
        plt.close(fig)
        paths["e2e_delta"] = p2

    # 3) Tokens
    tok_rows = [
        r
        for r in rows
        if r.get("langflow_tokens_p50") is not None or r.get("gmas_tokens_p50") is not None
    ]
    if tok_rows:
        fig, ax = plt.subplots(figsize=(max(8, len(tok_rows) * 1.4), 5))
        tx = np.arange(len(tok_rows))
        lf_t = [r.get("langflow_tokens_p50") or 0 for r in tok_rows]
        gm_t = [r.get("gmas_tokens_p50") or 0 for r in tok_rows]
        if any(r.get("langflow_tokens_p50") for r in tok_rows):
            ax.bar(tx - width / 2, lf_t, width, label="Langflow", color="#818cf8")
        if any(r.get("gmas_tokens_p50") for r in tok_rows):
            ax.bar(tx + width / 2, gm_t, width, label="gMAS", color="#34d399")
        ax.set_ylabel("Tokens p50")
        ax.set_title("Token usage by scenario")
        ax.set_xticks(tx)
        ax.set_xticklabels(_scenario_labels(tok_rows), rotation=25, ha="right")
        ax.legend()
        ax.grid(axis="y", alpha=0.3)
        fig.tight_layout()
        p3 = out_dir / f"{prefix}_chart_tokens.png"
        fig.savefig(p3, dpi=144)
        plt.close(fig)
        paths["tokens"] = p3

    # 4) Compile validate p50
    compile_vals = [r.get("gmas_compile_p50_ms") for r in rows if r.get("gmas_compile_p50_ms") is not None]
    if compile_vals:
        fig, ax = plt.subplots(figsize=(max(7, len(rows) * 1.1), 4))
        cvals = [r.get("gmas_compile_p50_ms") or 0 for r in rows]
        cx = np.arange(len(rows))
        ax.bar(cx, cvals, color="#0ea5e9")
        ax.set_ylabel("Compile/validate p50 (ms)")
        ax.set_title("gMAS graph compile (validate endpoint)")
        ax.set_xticks(cx)
        ax.set_xticklabels(labels, rotation=25, ha="right")
        ax.grid(axis="y", alpha=0.3)
        fig.tight_layout()
        p4 = out_dir / f"{prefix}_chart_compile.png"
        fig.savefig(p4, dpi=144)
        plt.close(fig)
        paths["compile"] = p4

    # 5) gMAS timing breakdown
    breakdown = _gmas_breakdown_by_scenario(report)
    if breakdown:
        ordered_sids = [str(r.get("scenario_id")) for r in rows if str(r.get("scenario_id")) in breakdown]
        if ordered_sids:
            blabels = [
                next((r["scenario_name"] for r in rows if r.get("scenario_id") == sid), sid)[:28]
                for sid in ordered_sids
            ]
            setup = [breakdown[sid]["setup"] for sid in ordered_sids]
            llm = [breakdown[sid]["llm"] for sid in ordered_sids]
            overhead = [breakdown[sid]["overhead"] for sid in ordered_sids]
            fig, ax = plt.subplots(figsize=(max(8, len(ordered_sids) * 1.3), 5))
            bx = np.arange(len(ordered_sids))
            ax.bar(bx, setup, label="setup", color="#fbbf24")
            ax.bar(bx, llm, bottom=setup, label="LLM", color="#34d399")
            bottom2 = [setup[i] + llm[i] for i in range(len(ordered_sids))]
            ax.bar(bx, overhead, bottom=bottom2, label="orchestration", color="#94a3b8")
            ax.set_ylabel("Mean time (ms)")
            ax.set_title("gMAS E2E breakdown (successful runs)")
            ax.set_xticks(bx)
            ax.set_xticklabels(blabels, rotation=25, ha="right")
            ax.legend()
            ax.grid(axis="y", alpha=0.3)
            fig.tight_layout()
            p5 = out_dir / f"{prefix}_chart_gmas_breakdown.png"
            fig.savefig(p5, dpi=144)
            plt.close(fig)
            paths["gmas_breakdown"] = p5

    # 6) Design-time fetch/build/validate per scenario
    design_rows = [
        r
        for r in rows
        if any(
            r.get(k) is not None
            for k in (
                "langflow_fetch_flow_ms",
                "langflow_build_flow_ms",
                "gmas_fetch_graph_ms",
                "gmas_validate_inline_ms",
                "gmas_compile_p50_ms",
            )
        )
    ]
    if design_rows:
        fig, ax = plt.subplots(figsize=(max(9, len(design_rows) * 1.5), 5))
        dx = np.arange(len(design_rows))
        w = 0.18
        series = [
            ("langflow_fetch_flow_ms", "LF fetch", "#818cf8"),
            ("langflow_build_flow_ms", "LF build", "#6366f1"),
            ("gmas_fetch_graph_ms", "gMAS fetch", "#34d399"),
            ("gmas_validate_inline_ms", "gMAS validate", "#059669"),
            ("gmas_compile_p50_ms", "gMAS compile", "#0ea5e9"),
        ]
        offset = -2 * w
        for key, label, color in series:
            if any(r.get(key) is not None for r in design_rows):
                vals = [float(r.get(key) or 0) for r in design_rows]
                ax.bar(dx + offset, vals, w, label=label, color=color)
            offset += w
        ax.set_ylabel("Latency (ms)")
        ax.set_title("Design-time API latency by scenario")
        ax.set_xticks(dx)
        ax.set_xticklabels(_scenario_labels(design_rows), rotation=25, ha="right")
        ax.legend(fontsize=8, ncol=2)
        ax.grid(axis="y", alpha=0.3)
        fig.tight_layout()
        p6 = out_dir / f"{prefix}_chart_design_time.png"
        fig.savefig(p6, dpi=144)
        plt.close(fig)
        paths["design_time"] = p6

    return paths


def write_html_dashboard(
    report: dict[str, Any],
    rows: list[dict[str, Any]],
    chart_paths: dict[str, Path],
    html_path: Path,
) -> None:
    generated = report.get("generated_at", "")
    report_id = report.get("report_id", "")
    cfg = report.get("config_summary") or {}

    chart_sections = []
    titles = {
        "e2e_p50": "E2E latency (p50)",
        "e2e_delta": "Head-to-head delta",
        "tokens": "Token usage",
        "compile": "Graph compile",
        "gmas_breakdown": "gMAS timing breakdown",
        "design_time": "Design-time API latency",
    }
    for key, path in chart_paths.items():
        chart_sections.append(
            f'<section class="card"><h2>{titles.get(key, key)}</h2>'
            f'<img src="{path.name}" alt="{key}" loading="lazy"/></section>'
        )

    table_headers = [
        ("scenario_name", "Scenario"),
        ("architecture", "Architecture"),
        ("agent_count", "Agents"),
        ("langflow_e2e_p50_ms", "LF e2e p50"),
        ("gmas_e2e_p50_ms", "gMAS e2e p50"),
        ("e2e_delta_ms", "Δ ms"),
        ("e2e_delta_pct", "Δ %"),
        ("faster_platform", "Faster"),
        ("langflow_tokens_p50", "LF tokens"),
        ("gmas_tokens_p50", "gMAS tokens"),
        ("gmas_compile_p50_ms", "compile p50"),
        ("gmas_setup_p50_ms", "setup p50"),
        ("gmas_llm_sum_p50_ms", "LLM sum p50"),
        ("gmas_ttfa_p50_ms", "TTFA p50"),
        ("langflow_build_flow_ms", "LF build"),
        ("gmas_validate_inline_ms", "validate inline"),
    ]
    thead = "".join(f"<th>{label}</th>" for _, label in table_headers)
    tbody_rows = []
    for row in rows:
        cells = []
        for key, _ in table_headers:
            val = _fmt_num(row.get(key))
            cls = ""
            if key == "e2e_delta_ms" and row.get("e2e_delta_ms") is not None:
                cls = ' class="pos"' if row["e2e_delta_ms"] < 0 else ' class="neg"'
            if key == "faster_platform":
                if val == "gMAS":
                    cls = ' class="pos"'
                elif val == "Langflow":
                    cls = ' class="neg"'
            cells.append(f"<td{cls}>{val}</td>")
        tbody_rows.append("<tr>" + "".join(cells) + "</tr>")

    html = f"""<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Langflow vs gMAS — benchmark {report_id[:8] if report_id else ""}</title>
  <style>
    :root {{ font-family: system-ui, -apple-system, sans-serif; color: #111; background: #f4f4f5; }}
    body {{ max-width: 1200px; margin: 0 auto; padding: 24px 16px 48px; }}
    h1 {{ font-size: 1.5rem; margin-bottom: 4px; }}
    .meta {{ color: #52525b; margin-bottom: 24px; font-size: 0.9rem; }}
    .grid {{ display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 16px; }}
    .card {{ background: #fff; border-radius: 10px; padding: 16px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }}
    .card h2 {{ font-size: 1rem; margin: 0 0 12px; }}
    .card img {{ width: 100%; height: auto; border-radius: 6px; }}
    table {{ width: 100%; border-collapse: collapse; font-size: 0.85rem; }}
    th, td {{ border-bottom: 1px solid #e4e4e7; padding: 8px 10px; text-align: right; }}
    th:first-child, td:first-child, th:nth-child(2), td:nth-child(2) {{ text-align: left; }}
    th {{ background: #fafafa; font-weight: 600; }}
    tr:hover td {{ background: #fafafa; }}
    .pos {{ color: #059669; font-weight: 600; }}
    .neg {{ color: #dc2626; font-weight: 600; }}
    .pill {{ display: inline-block; background: #e0e7ff; color: #3730a3; padding: 2px 8px; border-radius: 999px; font-size: 0.75rem; }}
  </style>
</head>
<body>
  <h1>Langflow vs gMAS benchmark</h1>
  <p class="meta">Generated: {generated} · Report <span class="pill">{report_id[:8] if report_id else "n/a"}</span>
  · Scenarios: {cfg.get("scenario_count", "—")} · Tools disabled: yes (gMAS LLM-only parity)</p>

  <section class="card" style="margin-bottom:16px;overflow-x:auto">
    <h2>Comparison table</h2>
    <table>
      <thead><tr>{thead}</tr></thead>
      <tbody>{"".join(tbody_rows)}</tbody>
    </table>
  </section>

  <div class="grid">
    {"".join(chart_sections)}
  </div>
</body>
</html>
"""
    html_path.write_text(html, encoding="utf-8")


def write_visual_report(report: dict[str, Any], out_dir: Path, prefix: str) -> dict[str, str]:
    """Write comparison table, charts, and HTML dashboard. Returns output paths."""
    rows = build_comparison_rows(report)
    out_dir.mkdir(parents=True, exist_ok=True)

    comparison_csv = out_dir / f"{prefix}_comparison.csv"
    write_comparison_table_csv(rows, comparison_csv)

    comparison_md_snippet = render_comparison_table_md(rows)
    comparison_md = out_dir / f"{prefix}_comparison.md"
    comparison_md.write_text(
        "# Benchmark comparison\n\n"
        f"- Generated: `{report.get('generated_at', '')}`\n"
        f"- Report id: `{report.get('report_id', '')}`\n\n"
        + comparison_md_snippet,
        encoding="utf-8",
    )

    chart_paths = generate_charts(report, out_dir, prefix)
    html_path = out_dir / f"{prefix}_dashboard.html"
    write_html_dashboard(report, rows, chart_paths, html_path)

    paths = {
        "comparison_csv": str(comparison_csv),
        "comparison_markdown": str(comparison_md),
        "html_dashboard": str(html_path),
    }
    for key, path in chart_paths.items():
        paths[f"chart_{key}"] = str(path)
    return paths


def visualize_report_file(json_path: Path, out_dir: Path | None = None) -> dict[str, str]:
    report = load_report(json_path)
    out_dir = out_dir or json_path.parent
    prefix = json_path.stem
    return write_visual_report(report, out_dir, prefix)
