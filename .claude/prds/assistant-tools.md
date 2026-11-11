---
name: assistant-tools
description: Rebuild MCP access for assistants on the new meals and week-plan model, behind the existing bearer token
status: backlog
created: 2026-11-11T03:30:00Z
---

# PRD: assistant-tools

> **Placeholder, later.** Split out of `weekly-draft` as part of the MVP cut
> (stakeholder's decision, 2026-11-11). `core` removes the prototype's MCP
> endpoint, and assistants have no access until this is built. Real MCP work
> is a ways out; this needs a brainstorm before it becomes an epic.

## Executive Summary

Shannon and Will can ask Claude, ChatGPT or Gemini about the plan or tell it
to change it, through an MCP endpoint protected by a bearer token.

## User Stories

### 1. Ask an assistant
As Shannon or Will, I ask an assistant what's for supper, or tell it to
change the plan.

Acceptance criteria (starting point from the original `weekly-draft`):
- An MCP endpoint, protected by a bearer token, offers tools such as
  `whats_for_supper`, `get_week_plan`, `suggest_week` (draft or redraft),
  `set_night_off`, `clear_night_off`, `list_meals`, `add_meal`.
- Every tool goes through the same library functions as the pages, so the
  rules cannot be bypassed: `add_meal` runs the allergy check, and
  `suggest_week` produces the same result the scheduled job would.
- There is no tool that deletes a meal.
- In production the endpoint refuses every request when `MCP_API_KEY` is
  unset.

## Success Criteria

- An assistant connected over MCP can answer "what's for supper?" and can
  redraft the week.

## Out of Scope

- OAuth for assistants (`mcp-oauth`); the bearer token stays.

## Dependencies

- `weekly-draft`. Night-off tools need `nights-off`.
- `MCP_API_KEY` on the deployment.
