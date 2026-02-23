# PRD: Graph Explorer (Per-Repo and Per-PRD)

**Author:** Generated
**Date:** 2026-02-23
**Status:** Draft

## Problem Statement

Steward currently provides two ways to inspect PRD work: a markdown document view and a kanban-style task board. Both are useful, but neither makes dependency structure obvious. Users cannot quickly answer questions like "what is blocked," "what unlocks this task," or "what is the critical path" without manually opening many tasks.

### Current State

- PRD page supports two tabs: Document and Task Board
- Task dependencies are visible only as text in task detail
- No visual map of task relationships or blocking chains
- No way to visualize multiple PRDs together inside one repository
- Existing PRD (`prd-viewer`) lists dependency graph visualization as a future consideration

### Impact

- Slower planning and sequencing decisions for active PRDs
- Harder to identify bottlenecks and unblocker tasks
- Repo-level coordination is manual when several PRDs are in flight
- Reduced confidence in execution order for complex dependency sets

## Users

### Primary Users

Developers and technical leads managing PRD task execution inside a single repository.

### User Stories

- As a developer, I want a dependency graph for the current PRD so I can see blockers and downstream tasks at a glance.
- As a developer, I want to switch to a repo-wide graph so I can see how multiple PRDs progress together.
- As a technical lead, I want status-colored nodes and clear edges so I can quickly assess readiness and risk.
- As a user, I want clicking a node to open task details so I can inspect implementation context without leaving the graph.

## Proposed Solution

### Overview

Add a **Graph** experience on the PRD page with a scope switch:

- **PRD scope**: graph of tasks for the current PRD only
- **Repo scope**: graph of tasks across all PRDs in the selected repository

The graph interaction model should match Overseer core parity for v1: auto-layout DAG, pan/zoom controls, status-colored nodes, and click-to-open task detail.

### Key Features

1. **Graph Tab on PRD Page**
   - Add a third tab next to Document and Task Board.
2. **Scope Toggle**
   - Switch between `PRD` and `Repo` scopes without leaving the page.
3. **Dependency DAG Rendering**
   - Display directional edges from dependency -> dependent task.
4. **Status-Driven Node Styling**
   - Distinct visual treatment for pending, in-progress, and completed tasks.
5. **Task Detail Integration**
   - Clicking a node opens existing task detail UI.
6. **Live Refresh**
   - Graph updates when watched task/progress files change.

### User Flow

**PRD Scope Flow**
1. User opens `/:repo/:prd`.
2. User selects the Graph tab.
3. Graph loads only tasks for the current PRD.
4. User pans/zooms and clicks nodes to inspect details.

**Repo Scope Flow**
1. User selects scope `Repo` inside the Graph tab.
2. Graph loads tasks from all PRDs with task state in the selected repository.
3. Nodes include PRD context (badge or subtitle) to avoid ambiguity.
4. User clicks any node to open the task detail sheet in-place.
5. If the node belongs to another PRD, the sheet includes a link to open that PRD route.

## Scope

### In Scope

- Graph tab in `app/pages/[repo]/[prd].vue`
- Scope toggle (`PRD` vs `Repo`) within Graph tab
- New graph APIs for both scopes
- Normalized graph payload with typed nodes/edges
- Namespaced node identifiers to avoid cross-PRD ID collisions
- Auto-layout (dagre), pan/zoom controls, and fit-view behavior
- Click node -> open task detail panel
- Live refresh behavior for both scopes

### Out of Scope

- Editing tasks or dependencies from the graph
- Drag-to-reorder graph persistence
- Advanced graph keyboard navigation parity (beyond current app shortcuts)
- Cross-repository graph aggregation
- Analytics dashboards (cycle time, throughput, burn-up)

### Future Considerations

- Graph filters by status, category, priority, PRD, and assignee
- Critical path highlighting
- Toggle parent/secondary edge types
- Saved graph view preferences (layout direction, zoom preset)
- Repo-level entry route (e.g. `/:repo/graph`) if demand is high

## Technical Considerations

### Affected Components

| File | Changes |
|------|---------|
| `app/pages/[repo]/[prd].vue` | Add Graph tab, scope toggle, graph data loading, detail wiring |
| `app/composables/usePrd.ts` | Add fetch methods for graph endpoints |
| `app/types/graph.ts` | New graph payload types |
| `app/components/graph/Explorer.vue` | New graph container and controls |
| `app/components/graph/Node.vue` | New custom task node renderer |
| `server/utils/task-graph.ts` | New shared graph builder for PRD and repo scopes |
| `server/api/repos/[repoId]/prd/[prdSlug]/graph.get.ts` | New PRD-scope graph endpoint |
| `server/api/repos/[repoId]/graph.get.ts` | New repo-scope graph endpoint |
| `app/layouts/default.vue` | Ensure repo-scope graph refreshes on any PRD task/progress update in repo |
| `app/assets/css/main.css` | Add graph library base styles if required |

### API Endpoints

```http
GET /api/repos/:repoId/prd/:prdSlug/graph
GET /api/repos/:repoId/graph
```

**PRD-scope response**

```json
{
  "scope": "prd",
  "repoId": "badf2f76-7fe1-4891-a67c-f451b65971e0",
  "prdSlug": "graph-explorer",
  "nodes": [],
  "edges": [],
  "stats": { "total": 0, "pending": 0, "inProgress": 0, "completed": 0 }
}
```

**Repo-scope response**

```json
{
  "scope": "repo",
  "repoId": "badf2f76-7fe1-4891-a67c-f451b65971e0",
  "nodes": [],
  "edges": [],
  "stats": { "total": 0, "pending": 0, "inProgress": 0, "completed": 0 },
  "prds": ["prd-a", "prd-b"]
}
```

### Graph Data Model

```typescript
export type GraphScope = 'prd' | 'repo'

export interface GraphNode {
  id: string                // `${prdSlug}::${taskId}`
  taskId: string
  prdSlug: string
  prdName: string
  title: string
  status: 'pending' | 'in_progress' | 'completed'
  category: 'setup' | 'feature' | 'integration' | 'testing' | 'documentation'
  priority: 'critical' | 'high' | 'medium' | 'low'
}

export interface GraphEdge {
  id: string                // `${source}->${target}`
  source: string
  target: string
  type: 'dependency'
  unresolved?: boolean
}

export interface GraphPayload {
  scope: GraphScope
  repoId: string
  prdSlug?: string
  nodes: GraphNode[]
  edges: GraphEdge[]
  stats: {
    total: number
    pending: number
    inProgress: number
    completed: number
  }
}
```

### Graph Construction Rules

1. **Node identity**
   - Always namespace task IDs as `${prdSlug}::${taskId}`.
2. **PRD-scope dependency resolution**
   - Resolve `dependencies[]` inside current PRD.
3. **Repo-scope dependency resolution**
   - Resolve dependencies to tasks in the same PRD by default.
   - If dependency syntax is explicitly namespaced (future-compatible), resolve cross-PRD.
   - If unresolved, create an explicit external/missing node and edge instead of dropping silently.
4. **Ordering and determinism**
   - Sort nodes and edges for stable rendering and predictable snapshots.

### Unresolved Dependency Handling (Decided)

If a task references a dependency that cannot be resolved in the graph payload, we treat it as unresolved.

- Example: `payments::task-014` depends on `task-999`, but `task-999` is not found.
- **Chosen for v1 (Option A):** render a dashed node like `Missing: task-999` with edge `task-999 -> payments::task-014`.
- Alternative (not chosen): do not render a node and only show warnings in panel/legend.

### Interaction and UX Requirements

- Pan and zoom support with visible controls
- Fit-to-view on initial load and scope switch
- Distinct node styling per status
- Tooltips or compact metadata for category/priority
- Repo-scope nodes display PRD context label
- Clicking any node opens task detail sheet in current route
- Repo-scope task details include `Open PRD` link when node belongs to another PRD
- Empty states for:
  - no tasks for current PRD
  - no PRDs with state in repo scope

### UI and Motion Takeaways (Skill Review)

These takeaways come from reviewing `web-animation-design` and `frontend-design` guidance and are intended to shape implementation details.

#### Visual Direction

- Preserve Steward's existing shadcn-vue + Tailwind visual language; avoid introducing a disconnected one-off theme for graph views.
- Keep the graph surface technical and low-noise (subtle grid/dot background, clear hierarchy, no decorative clutter).
- Use status-first node semantics (pending, in-progress, completed) with strong contrast and consistent badge/color mapping.
- Render unresolved nodes as dashed "Missing" nodes with lower emphasis than real tasks.

#### Motion Direction

- Use `ease-out` for enter/exit transitions (graph tab content, scope switch panel transitions).
- Use `ease-in-out` only for in-place movement/morphing (layout reflow and viewport adjustments).
- Use lightweight `ease` transitions for hover/focus affordances.
- Keep animation durations short:
  - 120-150ms for hover/focus
  - 180-220ms for enter/exit UI
  - 200-300ms max for larger panel transitions
- Avoid extra animation for high-frequency keyboard actions (tab/scope switching via shortcuts should feel immediate).

#### Performance and Accessibility Rules

- Animate only `transform` and `opacity`.
- Avoid layout-triggering animation properties (`height`, `width`, `margin`, etc.).
- Respect `prefers-reduced-motion: reduce` by disabling non-essential graph transitions.
- Keep touch targets at least 44x44px and avoid hover-dependent behavior on touch devices.
- Apply paired timing to related elements (for example, graph panel + overlay/legend transitions should share duration and easing).

### Performance Constraints

- Build graph in O(n + e)
- Load graph lazily only when Graph tab is active
- Cache graph payload per scope until invalidated by file watch event
- Keep interaction smooth with moderate task counts (target: 500 nodes)

## Success Criteria

### Metrics

- Graph tab opens in under 1 second for typical PRD-sized graphs
- Repo-scope graph loads in under 2 seconds for typical repositories
- Users can identify blocked tasks without opening task detail in most cases

### Acceptance Criteria

- [ ] PRD page includes a Graph tab alongside Document and Task Board
- [ ] Graph tab includes a scope toggle with `PRD` and `Repo` options
- [ ] PRD scope shows only current PRD tasks and dependency edges
- [ ] Repo scope shows tasks aggregated from all PRDs with state in the selected repo
- [ ] Node IDs are namespaced to avoid cross-PRD collisions
- [ ] Nodes are visually differentiated by task status
- [ ] Graph supports pan, zoom, and fit-view controls
- [ ] Clicking a node opens task details for that task
- [ ] Repo-scope nodes indicate source PRD context
- [ ] Repo-scope detail sheet includes `Open PRD` link for cross-PRD nodes
- [ ] Unresolved dependencies render as explicit dashed external nodes with dependency edges
- [ ] Graph UI animations use `transform`/`opacity` only with documented easing and duration ranges
- [ ] Graph view respects `prefers-reduced-motion: reduce`
- [ ] Graph data refreshes when task/progress files change
- [ ] Empty states are shown when no graphable tasks exist

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Task ID collisions across PRDs (`task-001`) | High | High | Namespace node IDs by `prdSlug::taskId` |
| Ambiguous cross-PRD dependencies | Medium | Medium | Default to same-PRD resolution and mark unresolved edges explicitly |
| Repo-scope graph too dense for readability | Medium | Medium | Add PRD context labels and plan future filtering |
| Graph performance degradation on large repos | Medium | Medium | Lazy load, cache payloads, and optimize layout inputs |
| Inconsistent live updates across scopes | Medium | Low | Centralize watch invalidation and include repo-level refresh path |

## Open Questions

- [ ] Should repo-scope graph support status/category filtering in the first follow-up release?

## Decisions

- [x] Unresolved dependencies render as explicit dashed external nodes (Option A).
- [x] Unresolved external nodes are non-interactive in v1.
- [x] Repo-scope node click behavior: always open task detail sheet in-place.
- [x] Cross-PRD detail behavior: include `Open PRD` link for nodes from another PRD.
- [x] Repo-scope source set: include only PRDs with task state (exclude markdown-only PRDs).
- [x] Graph UI preserves existing Steward design language and applies purpose-driven, low-noise motion.

## Implementation Phases

### Phase 1: Backend Graph Foundation

1. Add `app/types/graph.ts`
2. Implement `server/utils/task-graph.ts` with shared graph builder
3. Add PRD-scope graph endpoint
4. Add repo-scope graph endpoint

### Phase 2: Frontend Graph Experience

5. Build graph components (`Explorer`, custom node, legend/controls)
6. Integrate graph library and dagre layout
7. Add Graph tab and scope toggle on PRD page

### Phase 3: Integration and Live Refresh

8. Wire node selection to existing task detail flow
9. Handle repo-scope selection for tasks outside current PRD
10. Ensure file-watch updates invalidate/reload the correct graph scope

### Phase 4: Polish

11. Empty/loading/error states
12. Accessibility pass and visual consistency with existing UI
13. Performance tuning for medium/large graphs

---

*Generated with Steward MCP workflow*
