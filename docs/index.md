---
hide:
  - toc
---

# One graph from design to trace

flowMAS is a graph-native studio and observability environment for mutable
multi-agent workflows. The graph authored in the browser is the graph validated
and executed by the gMAS runtime, and the same identifiers and routes remain
available during live monitoring and post-run inspection.

[Get started](GETTING_STARTED.md){ .md-button .md-button--primary }
[Open the live demo](https://gmas.frontierai.ru/){ .md-button }

![flowMAS shared workflow lifecycle](assets/flowmas-studio-architecture-detailed.png){ loading=lazy }

## What flowMAS provides

<div class="grid cards" markdown>

-   **Author an executable role graph**

    ---

    Configure agents, prompts, models, tools, routes, conditions, weights, entry
    points, and exit points on one canvas.

-   **Validate against the runtime**

    ---

    Validation materializes the gMAS graph and derives its execution order. It
    is more than document or schema validation.

-   **Inspect the realized workflow**

    ---

    Follow typed lifecycle and topology events, then move from aggregate metrics
    to traces, agents, model calls, tools, memory activity, and provider usage.

</div>

## Project boundaries

| Component | Responsibility |
| --- | --- |
| [gMAS](https://github.com/frontier-ai-next/gMAS) | Graph engine, agents, schedulers, tools, and execution semantics |
| flowMAS | Browser studio, persistence, validation API, execution control, and observability integration |
| gMAS Observability | Self-hosted event ingestion, trace reconstruction, metrics, and Trace Explorer |

flowMAS consumes gMAS through a pinned Git submodule. It does not maintain a
fork of the runtime.

## Start locally

```bash
git clone --recurse-submodules https://github.com/frontier-ai-next/flowMAS.git
cd flowMAS
./scripts/dev-up.sh
```

The development launcher starts the studio on port `3000`, the API on `8000`,
and Trace Explorer on `8100`. See [Getting started](GETTING_STARTED.md) for
prerequisites, Docker instructions, and troubleshooting.

## Read next

- [Architecture](ARCHITECTURE.md) explains the shared graph boundary and event flow.
- [UI guide](UI_GUIDE.md) documents the authoring and run experience.
- [Observability](OBSERVABILITY.md) covers telemetry, privacy, and deployment controls.
- [Evaluation](EVALUATION.md) provides complete tables, methodology, and limitations.
- [Deployment](DEPLOYMENT.md) covers local Compose and production operation.
