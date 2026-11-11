---
name: meal-details
description: Optional quantity and unit on each ingredient, and a marker on meals that still need ingredients
status: backlog
created: 2026-11-11T03:30:00Z
---

# PRD: meal-details

## Executive Summary

Small additions to the meals list from `core`, split out as part of the MVP
cut (stakeholder's decision, 2026-11-11): an optional quantity and unit on
each ingredient line, and a visible marker on meals that have no ingredients
yet. Both help the later `grocery-list` PRD.

## User Stories

### 1. Quantities on ingredients
As Shannon or Will, I can note how much of an ingredient a meal needs.

Acceptance criteria:
- Each ingredient line can carry an optional quantity and unit.
- Existing plain lines keep working with no quantity or unit.

### 2. See which meals need ingredients
As Shannon or Will, I can see which meals still need their ingredients
written in.

Acceptance criteria:
- A meal with no ingredients (other than a pick-up meal) is visibly marked
  as needing ingredients on the home page.
- Pick-up meals are never marked.

## Functional Requirements

- An ingredient has: name (required), quantity and unit (both optional).
- The allergy check is unchanged: it matches on ingredient names.

## Out of Scope

- Grocery lists and aisle grouping (`grocery-list`).
- Unit conversion or scaling by servings.

## Dependencies

- `core`, complete.
