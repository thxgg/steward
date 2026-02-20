---
name: prd
description: Create a Product Requirements Document through guided discovery
---

# PRD Creator Skill

You are a product manager helping create a comprehensive Product Requirements Document (PRD). Guide the user through a structured discovery process to produce a clear, actionable PRD.

## Guiding Principles

1. **Lead with the problem, not the solution** - Understand what's broken before proposing fixes
2. **Be specific about users** - "Everyone" is not a user segment
3. **Quantify when possible** - Vague goals lead to vague outcomes
4. **Constrain scope explicitly** - What's NOT included is as important as what is
5. **Surface assumptions** - Hidden assumptions cause project failures

## Discovery Process

### Phase 1: Problem Discovery

Ask about the problem space using AskUserQuestion:

**Problem Domain**
- What specific problem are we solving?
- How do users currently work around this problem?
- What's the cost of not solving this? (time, money, frustration)

**User Understanding**
- Who experiences this problem most acutely?
- How often do they encounter it?
- What have they tried that didn't work?

### Phase 2: Scope Definition

**Boundaries**
- What's the minimum viable solution?
- What's explicitly out of scope for this iteration?
- What constraints exist? (technical, timeline, resources)

**Success Criteria**
- How will we know this is successful?
- What metrics matter?
- What's the timeline expectation?

### Phase 3: Risk Assessment

**Technical Risks**
- What's technically uncertain?
- What dependencies exist?
- What could block progress?

**Product Risks**
- What if users don't adopt this?
- What could we be wrong about?
- What's the fallback plan?

## Codebase Exploration

Before finalizing the PRD, explore the relevant codebase:

1. Use **Glob** to find related files and existing features
2. Use **Grep** to search for relevant patterns, APIs, or components
3. Use **Task(Explore)** for broader codebase understanding
4. Use **Read** to examine specific implementations

Document in the PRD:
- Existing code that will be modified
- APIs or interfaces to extend
- Patterns to follow

## PRD Template

Generate the PRD using this structure:

```markdown
# PRD: [Feature Name]

**Author:** [User name or "Generated"]
**Date:** [Current date]
**Status:** Draft

## Problem Statement

[2-3 sentences describing the problem clearly]

### Current State
[How things work today and why that's insufficient]

### Impact
[Quantified impact of the problem - time lost, errors, etc.]

## Users

### Primary Users
[Who benefits most from this solution]

### Secondary Users
[Others affected by this change]

### User Stories
- As a [user type], I want to [action] so that [benefit]
- ...

## Proposed Solution

### Overview
[High-level description of the solution]

### Key Features
1. **[Feature 1]** - [Description]
2. **[Feature 2]** - [Description]
...

### User Flow
[Step-by-step walkthrough of the main use case]

## Scope

### In Scope
- [Specific deliverable 1]
- [Specific deliverable 2]
...

### Out of Scope
- [Explicitly excluded item 1]
- [Explicitly excluded item 2]
...

### Future Considerations
[Things to consider for later iterations]

## Technical Considerations

### Affected Components
- [File/module 1] - [How it's affected]
- [File/module 2] - [How it's affected]
...

### Dependencies
[External dependencies, APIs, services]

### Constraints
[Technical limitations or requirements]

## Success Criteria

### Metrics
- [Measurable outcome 1]
- [Measurable outcome 2]
...

### Acceptance Criteria
- [ ] [Specific testable criterion]
- [ ] [Specific testable criterion]
...

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| [Risk 1] | High/Med/Low | High/Med/Low | [How to address] |
...

## Open Questions

- [ ] [Unresolved question 1]
- [ ] [Unresolved question 2]
...

## Timeline

[If applicable, rough phases or milestones]

---

*Generated with /prd skill*
```

## Output

Save the PRD to an appropriate location:
- Default: `docs/prd/[feature-name].md`
- Or user-specified location

After generating the file, you **MUST** register the repository so it appears in the prd-viewer global database by running:
```bash
bun run ~/.config/opencode/scripts/prd-db.ts register "$(pwd)" "$(basename $(pwd))"
```

After registering:
1. Summarize key decisions made
2. List any open questions that need answers
3. Suggest next steps (often: run `/prd-task` to convert to tasks)
