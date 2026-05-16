# Meetup Bot — Domain Context

A Telegram bot that suggests meetup venues constrained by what's in a user's Google Calendar before and after the meeting time.

## Glossary

### User
A person who has authorized the bot to read their Google Calendar via OAuth. Identified by their Telegram `chat_id`. One User has exactly one connected Google account at a time. Re-connecting overwrites the prior connection.

> *Not to be confused with "Friend" (see below).*

### Friend
A contact the User wants to meet with. Has a name + optional preferences (drinks, dietary). Owned by a User — not a separate authenticated entity. Friends do not log in or connect their calendars.

### Anchor
A geographic point used as a constraint when picking venues. Two kinds:
- **Pre-anchor** — where the User will be in the hour before the meeting time (typically from a calendar event with a location).
- **Post-anchor** — where the User will be in the hour after the meeting time.

If no bracketing calendar event exists, the User's `home` address is the fallback anchor.

### Constraint
A filter applied to candidate venues. Currently the only hard constraint is **max drive time from BOTH anchors** (default 20 minutes by car). Future constraints (cuisine, price, rating) are soft filters applied before scoring.

### Flow
A multi-step conversational interaction the bot drives with a User to collect structured data (e.g., `/addfriend` asks for name, drinks, dietary, then confirms). A User is in at most one Flow at a time. Flow state lives in KV at `flow:{chat_id}` with a 30-min TTL.

### Connection
A User's authorization to read their Google Calendar via OAuth. Created via `/connect`, revoked via `/disconnect`. Stored as a refresh token at `user:{chat_id}` in KV. Refresh tokens expire after 7 days in Testing mode and indefinitely after Google verification.

## Decisions

(See `docs/adr/` for ADRs.)

## Out of scope (explicit non-decisions)

- The bot does NOT message Friends. The User copy-pastes suggestions to their friend externally.
- The bot does NOT book reservations. It returns links to Google Maps.
- The bot does NOT support recurring meetings or rescheduling.

## Operational constraints

- **OAuth app status:** Testing mode. New Users must be manually added to the Google Cloud OAuth test-user whitelist before they can `/connect`. Cap: 100 test users. Bot surfaces this to unverified Users: "DM @erictansongyi with your Gmail to be whitelisted."
- **Refresh token lifetime:** 7 days while in Testing mode. Users must re-`/connect` weekly. Lifts to permanent after Google verification (deferred — see follow-up issue).
