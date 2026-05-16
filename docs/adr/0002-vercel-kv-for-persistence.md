# ADR 0002 — Vercel KV for Per-User Persistence

**Status:** Accepted
**Date:** 2026-05-16

## Context

Multi-tenant requirements added in the rebuild (see [ADR 0001](./0001-llm-slot-filling-for-conversational-flows.md)) introduce four kinds of per-User state:

- OAuth refresh tokens (one per User)
- Onboarding data (home address + coords, friends list, prefs)
- Conversational flow state ("User is in `/addfriend` flow, awaiting `drinks` answer")
- Short-lived OAuth state tokens (CSRF protection, ~10 min TTL)

All four are keyed by Telegram `chat_id`. None require joins, aggregations, or ad-hoc queries at runtime.

The wider Code Riff codebase already uses Supabase, which would normally be the obvious reach.

## Decision

Use **Vercel KV** (Redis-backed) as the persistence layer for all per-User state in this bot.

## Alternatives considered

- **Supabase Postgres.** Already in the stack. Rejected because the data shape is purely key-value — using Postgres here means a single table with JSONB columns, i.e., a glorified KV store. Schema design + migrations + RLS policies are tax we don't need to pay yet. If future requirements introduce relational queries (analytics, leaderboards, multi-friend group meetups), revisit.
- **Upstash Redis.** Functionally equivalent to Vercel KV with slightly better pricing at scale. Rejected for MVP — portability gain doesn't matter until we have users.
- **Vercel Edge Config.** Read-only at runtime, designed for feature flags. Wrong tool.

## Consequences

- **Setup:** `npx vercel kv create` adds `KV_REST_API_URL` + `KV_REST_API_TOKEN` to project env automatically. ~30 seconds.
- **Edge-runtime compatible** — KV works in Vercel Edge functions if we ever move the webhook handler there.
- **Free tier:** 30k commands/day, 256MB storage. Comfortable headroom for the first 1000+ active Users.
- **Migration cost if we outgrow it:** Estimated 2–4 hours to move to Supabase. The read/write surface area is contained to one `lib/store.js` module.
- **No SQL = no ad-hoc analytics.** Counting `/meet` calls per week requires either dumping KV to a DB on a schedule, or instrumenting via a separate analytics tool (PostHog, Plausible). Accept this trade-off for now.

## Key layout (informal — not a schema)

| Key | Value | TTL |
|---|---|---|
| `user:{chat_id}` | `{ refresh_token, home, prefs, created_at }` | none |
| `user:{chat_id}:friends` | `[ { name, drinks, dietary }, ... ]` | none |
| `flow:{chat_id}` | `{ name, step, partial_data }` | 30 min |
| `oauth_state:{state_token}` | `{ chat_id }` | 10 min |

## Reversibility

Medium. Code references to KV are intended to be isolated to one module. Moving to Supabase later is a real-but-bounded refactor.
