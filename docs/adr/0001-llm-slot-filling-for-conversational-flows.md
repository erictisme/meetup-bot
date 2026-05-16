# ADR 0001 — LLM Slot-Filling for Conversational Flows

**Status:** Accepted
**Date:** 2026-05-16

## Context

The bot's onboarding requires three pieces of per-User data: `home` address, `friends` list (name + drinks + dietary), and prefs (cuisines, min_rating, price). The User population is non-technical — they expect to talk to the bot the way they talk to ChatGPT or OpenClaw, not fill out command-line arguments.

The earlier design (now superseded) used slash commands with positional args: `/meet wachel thursday 12pm`. That decision (recorded in the original mp-grill-me session) was made under a "podcast prop" framing — single user, demo-only, no onboarding required.

The product framing has changed to "real product that John (and eventually other AI-pro guests + viewers) can sign up and use." Slash-args UX does not survive contact with non-technical users in flows that have 3+ fields.

## Decision

The bot uses **Claude Haiku 4.5 for slot-filling within conversational flows**, and nothing else.

- Slash commands trigger flows: `/sethome`, `/addfriend`, `/connect`, `/meet`.
- Each flow is a hand-coded state machine. The bot asks one question, the User replies in free text, an LLM call extracts the structured value, the bot echoes back for confirmation, then advances state.
- Slash commands with args continue to work as a power-user shortcut (`/meet wachel thursday 12pm`) — they bypass the LLM and the conversational flow entirely.
- The LLM is NOT used for: general chitchat, intent classification (any `/` prefix is a command), or `/meet` date parsing (`chrono-node` is sufficient).

## Alternatives considered

- **Rule-based parsing (regex / keyword matching).** Free, no dependency. Rejected because non-technical Users phrase replies in ways that break rules ("she's more of a matcha girl"). The product bar is "people can actually use it" — rule-based parsing forfeits that.
- **Full LLM intent routing.** Every message goes through an LLM that decides whether it's a command, answer, or chitchat. Rejected as overkill — Telegram's `/` prefix already gives free command detection. Unbounded LLM calls per message create cost + latency risk.

## Consequences

- **New dependency:** `@anthropic-ai/sdk` + `ANTHROPIC_API_KEY` env var.
- **Cost:** ~$0.001 per onboarding step (Haiku 4.5 pricing). Bounded — each flow is ≤10 steps. At 1000 active Users/month, expected spend is < $5/mo.
- **Latency:** Each conversational reply adds ~1s round-trip to Anthropic. Acceptable for onboarding flows; never blocks `/meet` execution (which uses `chrono-node`, not LLM).
- **Failure modes:** LLM returns invalid JSON, Anthropic API down, or extracts wrong values. Mitigations: (a) always echo extracted values back to the User for confirmation, (b) wrap LLM call in try/catch with retry, (c) on permanent failure, fall back to "I didn't catch that — could you say it differently?" rather than crash.
- **Prompt-caching:** The flow definitions (question text + extraction schema) should be cached via Anthropic's prompt caching. Static across calls, only the User reply varies.

## Reversibility

Medium. The state machine and flow structure stay the same if we ever rip out the LLM. The slot-extraction call sites would each need a rule-based replacement. Estimated 1-day refactor.
