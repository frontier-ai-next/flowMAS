# Architecture

flowMAS preserves one versioned role graph across authoring, execution, and
inspection. It does not translate a visual workflow into a separate runtime
language.

![flowMAS shared workflow lifecycle](assets/flowmas-studio-architecture-detailed.png){ loading=lazy }

## Shared workflow lifecycle

1. **Code or studio authoring** produces a graph document containing agents,
   executable routes, entry and exit points, run settings, and layout.
2. **Validation** materializes the corresponding gMAS runtime graph and derives
   an execution order.
3. **Execution** follows the declared plan or uses adaptive controls to evaluate
   conditional routes, stopping rules, fallbacks, and allowed topology changes.
4. **Typed events** retain run, agent, route, model, tool, memory, retry, budget,
   and topology context.
5. **Trace reconstruction** joins those events back to the declared graph so an
   operator can compare planned and traversed structure.

## Runtime boundaries

| Layer | Location | Owns |
| --- | --- | --- |
| Studio | `apps/web` | Canvas, inspectors, configuration, live feedback, and run navigation |
| Platform API | `apps/api` | Persistence, graph preparation, execution control, sessions, and schedules |
| Runtime | `vendor/gmas` | Role graph, agents, schedulers, runner, tools, and graph semantics |
| Observability SDK | `packages/gmas-observability` | Redaction, bounded events, asynchronous batching, and callback integration |
| Observability service | `apps/observability` | Ingestion, persistence, trace reconstruction, metrics, and Trace Explorer |

The runtime is pinned as a Git submodule. Updating it is an explicit repository
change, which keeps a flowMAS release reproducible.

## Portable graph document

The graph document is the round-trip boundary between the UI and runtime. It
contains:

- agent profiles and model configuration;
- directed routes with condition, weight, and enabled state;
- explicit start, entry, exit, and task targets;
- run settings and routing policy;
- stable identifiers and canvas layout.

Imports from other workflow tools preserve supported topology and layout, but
framework-specific execution semantics may require manual reconfiguration.
Validation warnings make that boundary explicit.

## Execution and adaptation

The fixed scheduler executes the derived plan. Adaptive execution can evaluate
conditional paths, stop work early, bypass disabled or unreachable nodes, and
apply controlled topology updates. The declared graph remains separate from the
realized graph for each run.

This separation matters operationally: a final answer alone cannot explain
which routes were considered, which agents actually ran, or where latency and
provider usage accumulated.

## Event and trace flow

```text
gMAS runner
  └─ typed callbacks
       └─ observability SDK queue
            └─ HTTP ingestion
                 └─ SQLite/WAL event store
                      ├─ aggregate metrics
                      ├─ span waterfall
                      └─ planned vs. traversed graph
```

Delivery is asynchronous and fail-open. Secret-like fields are redacted,
strings are bounded, and prompt/output capture can be disabled. See
[Observability](OBSERVABILITY.md) for the complete event and privacy model.

## Workspace and persistence model

The public studio uses anonymous session-scoped workspaces. A stable HttpOnly
cookie identifies the browser workspace; graphs, agents, schedules, and runs are
stored under the configured API data directory. Observability data is stored
separately so its retention and backup policy can differ from workflow state.

For production implications, including TLS, stable encryption keys, persistent
paths, and the current single-replica scheduler constraint, see
[Deployment](DEPLOYMENT.md).
