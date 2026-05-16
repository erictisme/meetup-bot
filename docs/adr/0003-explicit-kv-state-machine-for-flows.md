# ADR 0003 — Explicit KV State Machine for Conversational Flows

**Status:** Accepted
**Date:** 2026-05-16

## Context

Per [ADR 0001](./0001-llm-slot-filling-for-conversational-flows.md), the bot uses conversational flows (e.g., `/addfriend` asks `name → drinks → dietary → confirm`). Each incoming non-command message must be routed to "the next step in whatever flow this User is in." The bot must also handle abandonment, cancellation, and concurrent flows.

## Decision

Track flow state explicitly in Vercel KV at `flow:{chat_id}` with a 30-minute TTL.

**Shape:**

```json
{
  "name": "addfriend",
  "step": "drinks",
  "partial": { "name": "Wachel" }
}
```

**Message router (per inbound Telegram message):**

1. If `text.startsWith('/')` → treat as command. Starting a new command while a flow exists silently replaces the flow (with one-line warning back to User).
2. Else if `flow:{chat_id}` exists → route to that flow's step handler. Step handler uses Claude Haiku 4.5 to extract structured data, validates, updates `partial`, advances to next step OR finishes (writes to durable User store, deletes flow key).
3. Else → reply with `/help` hint.

**Lifecycle:**
- `/cancel` → `DEL flow:{chat_id}`, reply "Cancelled."
- 30-min TTL → next User message gets "That timed out — start over with /<command>."
- Flow definitions live as JS modules in `lib/flows/<name>.js`, each exporting `{ steps: [...], onComplete }`.

## Alternatives considered

- **Implicit state inferred from message history** (no KV writes for flow state). Rejected — Telegram doesn't guarantee message ordering in edge cases, and "what state is this User in?" becomes a forensic exercise when debugging.
- **LLM-decided routing on every message.** Rejected (already rejected in [ADR 0001](./0001-llm-slot-filling-for-conversational-flows.md)) — unbounded LLM cost, slower, and `/` prefix gives free command detection.

## Consequences

- **Debuggability:** Dumping `flow:{chat_id}` from KV makes "what state is the user stuck in?" answerable in seconds.
- **Predictable failure recovery:** TTL means no User is permanently trapped in a half-finished flow.
- **Adding a new flow = adding one file.** Onboarding new contributors to the codebase is cheap.
- **Concurrent flows per User are impossible.** Starting a new command mid-flow replaces the old one. Acceptable — Users don't actually multi-flow in practice.

## Reversibility

High. Flow framework is isolated to one module; swapping the storage backend (KV → Postgres → in-memory map for tests) requires changing one interface.
