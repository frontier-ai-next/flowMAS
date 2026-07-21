# Evaluation

This page records the current flowMAS evaluation snapshot. It separates two
questions that use different baselines:

1. **Runtime evaluation:** gMAS versus matched LangGraph execution graphs on
   reasoning workloads.
2. **Studio-path evaluation:** flowMAS/gMAS versus paired Langflow workflows on
   a local synthetic deployment.

The two tracks are complementary and should not be combined into a single
platform ranking.

## Runtime benchmark

### Protocol

- **68 matched model-dataset-topology configurations** across BIG-Bench Hard
  (BBH), GSM8K, and MMLU-Pro.
- Public test splits: 6,511 BBH, 1,319 GSM8K, and 12,032 MMLU-Pro examples,
  with one generation per example and no random subsampling.
- Six recorded serving aliases and four graph patterns: single agent,
  three-agent chain, fan-in, and fan-out.
- Within each matched pair, both runners use the same role descriptions,
  prompts, model endpoints, decoding parameters, stopping rules, and
  concurrency limits.
- Reported latency is client-side wall-clock time and includes network and
  model-server queueing effects.
- Relative resource deltas use LangGraph as the denominator. Accuracy deltas
  are absolute percentage-point changes.

### Results by topology

| Topology | LangGraph latency (s) | gMAS latency (s) | Latency delta | LangGraph tokens | gMAS tokens | Token delta | Accuracy delta |
|---|---:|---:|---:|---:|---:|---:|---:|
| Single agent | 4.13 | 3.96 | -4.0% | 491 | 484 | -1.5% | +0.0 pp |
| Three-agent chain | 15.91 | 16.07 | +1.0% | 2,620 | 2,702 | +3.1% | +2.5 pp |
| Fan-in | 22.08 | 20.32 | -8.0% | 4,495 | 4,573 | +1.7% | +3.0 pp |
| Fan-out | 38.16 | 34.60 | -9.3% | 9,416 | 9,410 | -0.1% | +2.9 pp |

The observed latency effect is topology-dependent: fan-in and fan-out are
faster in this evaluation, while the mandatory three-agent chain is slightly
slower. Token changes are smaller and mixed. Accuracy deltas in this table are
descriptive and do not establish a universal quality improvement.

## Runtime-control ablations

Each row compares the active control with its disabled or static counterpart.
Negative token, latency, and agent deltas indicate less executed work. `n.s.`
means the reported paired accuracy difference is not statistically significant
at alpha = .05.

| Control | Accuracy delta | Token delta | Latency delta | Executed agents delta |
|---|---:|---:|---:|---:|
| Early stopping | +1.8 pp (n.s.) | -52.6% | -45.0% | -3.0 |
| Disabled nodes | +3.4 pp (p = .002) | -44.4% | -32.1% | -2.0 |
| Reachability filter | +0.5 pp (n.s.) | -23.1% | -34.3% | -2.0 |
| Adaptive policy | +3.2 pp (n.s.) | -21.2% | -18.5% | -1.0 |
| Hidden channels | -2.9 pp (p = .005) | +6.2% | +7.2% | 0.0 |
| Multi-model routing | +9.4 pp (n.s.) | -4.6% | +4.2% | 0.0 |

The strongest resource reductions come from controls that prevent model calls.
Other controls expose trade-offs: multi-model routing is quality-oriented in
this setup rather than a latency optimization, while hidden channels are
counterproductive in the evaluated configuration.

## Synthetic studio-path benchmark

Six paired Langflow and gMAS workflows use the same single LLM backend, fixed
task text, disabled tools, and one to four agents. Results are p50 over
successful runs (two repetitions for the single-agent case and one for the
remaining scenarios).

| Scenario | Agents | Design time: gMAS / Langflow (ms) | First chunk: gMAS / Langflow (ms) |
|---|---:|---:|---:|
| Single LLM | 1 | 0.8 / 8.1 | 20.4 / 43.6 |
| Research & Write | 2 | 1.5 / 10.6 | 25.6 / 55.8 |
| Plan-Execute-Review | 3 | 1.5 / 12.3 | 31.1 / 53.6 |
| Q&A + Critic | 3 | 1.0 / 7.3 | 21.1 / 210.0 |
| Data Analysis | 4 | 1.5 / 10.3 | 32.5 / 71.7 |
| Code Pipeline | 4 | 1.5 / 11.4 | 35.9 / 59.4 |

`Design time` compares gMAS graph compilation with Langflow flow build time.
`First chunk` measures submission to the first streamed byte. It is not
end-to-end answer latency.

## Interpretation and limitations

- The runtime benchmark uses controlled reasoning tasks rather than
  long-running, interactive, tool-rich deployments.
- Remote serving means latency cannot be attributed solely to local runtime
  overhead.
- Structural pairing with Langflow does not guarantee component-level semantic
  equivalence.
- The synthetic benchmark is a narrow local engineering check with few
  repetitions; it does not establish a general performance ranking.
- Token analytics depend on provider-returned usage metadata.
- Except where a p-value is shown, accuracy differences are descriptive.

The supported conclusion is deliberately narrow: flowMAS preserves explicit
graph semantics across authoring, execution, and inspection, while gMAS can
reduce latency and resource use when a topology or runtime control avoids
unnecessary downstream work. The results do not imply that every workflow is
faster, cheaper, or more accurate.

## Reproducing the studio-path benchmark

The repository includes the benchmark harness, scenario configuration, report
generation, and visualization tooling:

```bash
cp scripts/benchmark.config.example.json scripts/benchmark.config.json
.venv/bin/python scripts/setup_langflow_benchmark_flows.py \
  --config scripts/benchmark.config.json --patch-config
.venv/bin/python scripts/setup_gmas_benchmark_graphs.py --patch-config
.venv/bin/python scripts/benchmark_langflow_vs_gmas.py \
  --config scripts/benchmark.config.json
```

Reports are written to `benchmarks/reports/` as JSON, Markdown, CSV, PNG charts,
and an HTML dashboard. Keep the raw run artifact and environment manifest when
publishing new measurements.
