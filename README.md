# Meetup Bot

Multi-tenant Telegram bot that suggests meetup venues anchored between users' Google Calendar events.

You ask: `/meet wachel thursday 12pm`
It looks at your calendar around that time, finds places ≤20 min drive from where you are before AND after, and replies with 3 picks.

Each user connects their own Google Calendar via OAuth and manages their own friends list inside Telegram. No config files to edit.

## Architecture

- **Vercel** — hosts two serverless functions: `/api/telegram` (webhook) and `/api/oauth-callback` (OAuth redirect target)
- **Upstash Redis (Vercel KV)** — per-user state: refresh tokens, home, friends, in-flight conversational flows
- **Claude Haiku 4.5** — slot-filling inside conversational flows (`/addfriend`, `/sethome`, onboarding)
- **Google Calendar / Maps / Places / Distance Matrix** — calendar reads + venue search + drive times

See `CONTEXT.md` for the domain glossary and `docs/adr/` for design decisions.

## Setup (for the operator — you)

You only do this once. End users just message the bot.

### 1. Clone & install

```bash
git clone <this-repo>
cd meetup-bot
npm install
```

### 2. Telegram bot

- Open Telegram, message `@BotFather`.
- `/newbot` → follow prompts → copy the token. You'll paste it later as `TELEGRAM_BOT_TOKEN`.

### 3. Google Cloud project

1. https://console.cloud.google.com → create a project.
2. **APIs & Services → Library** — enable: Google Calendar API, Places API, Distance Matrix API, Geocoding API.
3. **APIs & Services → OAuth consent screen** — type **External**, fill in basics, **add `https://www.googleapis.com/auth/calendar.readonly` to scopes**. Stay in **Testing** mode for now (you'll add each new user as a test user manually — cap is 100).
4. **APIs & Services → Credentials** — create:
   - **OAuth client ID** → type **Web application**. Authorized redirect URI: `https://meetup-bot.vercel.app/api/oauth-callback` (replace with your actual Vercel URL). Save the client ID + secret.
   - **API key** → restrict to Places API + Distance Matrix API + Geocoding API. Save the key.

> **Test users:** every Gmail that wants to `/connect` must be on the OAuth consent screen's test-user list while the app is in Testing mode. Add John (and any other guests) there. Refresh tokens issued in Testing mode expire after 7 days — users will need to re-`/connect` weekly until you push the app to Production via Google verification.

### 4. Anthropic API key

- https://console.anthropic.com → API keys → create one. Save as `ANTHROPIC_API_KEY`.

### 5. Deploy to Vercel

```bash
vercel link        # link to a project (or `vercel --prod` first time to create one)
vercel --prod
```

Note your deployed URL (e.g. `https://meetup-bot.vercel.app`). If it differs, update the Google OAuth redirect URI in step 3 and the `PUBLIC_BASE_URL` env var below.

### 6. Add Upstash Redis (provides KV)

In the Vercel dashboard → your project → **Storage** → **Create Database** → pick **Upstash Redis**. Vercel auto-injects `KV_REST_API_URL` and `KV_REST_API_TOKEN` into the project's env vars.

### 7. Set the rest of the env vars

In Vercel dashboard → **Settings → Environment Variables**, add:

```
TELEGRAM_BOT_TOKEN=...
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
GOOGLE_MAPS_API_KEY=...
ANTHROPIC_API_KEY=...
PUBLIC_BASE_URL=https://meetup-bot.vercel.app
```

Redeploy: `vercel --prod`.

### 8. Set the Telegram webhook

Replace `<token>` and `<url>`:

```
https://api.telegram.org/bot<token>/setWebhook?url=https://<url>/api/telegram
```

Open in browser — expect `{"ok":true,"result":true,...}`.

## End-user flow (what each user does)

1. Open Telegram, message your bot.
2. `/start` — see the welcome.
3. `/connect` — bot replies with a Google OAuth link. User taps it, signs in with the Gmail you whitelisted, sees "Connected!" page.
4. Bot DMs them and starts onboarding: asks for home address.
5. `/addfriend` — bot walks them through name, drinks, dietary, confirm.
6. `/meet alice thursday 12pm` — bot picks 2-3 venues.
7. `/listfriends`, `/sethome`, `/disconnect`, `/cancel` as needed.

## Commands

| Command | What it does |
|---|---|
| `/start` | Welcome message |
| `/help` | List of commands |
| `/connect` | Link Google Calendar via OAuth |
| `/disconnect` | Unlink Google Calendar |
| `/sethome` | Conversational flow — update home address |
| `/addfriend` | Conversational flow — add a friend |
| `/listfriends` | Show your saved friends |
| `/meet <friend> <when>` | Suggest venues |
| `/cancel` | Abort an in-progress conversational flow |

Starting any new command silently replaces an in-progress flow.

## Files

- `api/telegram.js` — Telegram webhook entry
- `api/oauth-callback.js` — Google OAuth redirect handler
- `lib/store.js` — Upstash Redis wrapper (per-user state)
- `lib/llm.js` — Claude Haiku 4.5 slot-filling
- `lib/calendar.js` — per-user Google Calendar reads
- `lib/venues.js` — curated venues fallback + Places search
- `lib/distance.js` — Distance Matrix wrapper
- `lib/geocode.js` — address → lat/lng
- `lib/parse.js` — chrono-node `/meet` arg parser
- `lib/telegram.js` — sendMessage helper
- `lib/flows/runtime.js` — generic flow state machine driver
- `lib/flows/onboarding.js` — runs after first successful `/connect`
- `lib/flows/sethome.js` — `/sethome` flow
- `lib/flows/addfriend.js` — `/addfriend` flow
- `config/venues.json` — optional curated venue list (leave `[]` to use Places auto-suggest)

## Costs (rough)

- Vercel Hobby — free
- Upstash Redis — free tier (30k commands/day, 256MB)
- Claude Haiku 4.5 — ~$0.001 per slot-filling step. Onboarding a user is ~5 steps.
- Google Maps APIs — free up to $200/month credit
- Anthropic + Telegram + Google OAuth — free at this scale

Expected: <$5/month at <1000 active users.

## When something breaks

- **User says "/connect link expired"** — link's 10-min TTL elapsed. Tell them to run `/connect` again.
- **User says "Your connection expired"** — Google refresh token revoked or hit Testing-mode 7-day cap. Run `/connect` again. Long-term fix: push OAuth app to Production via Google verification.
- **Bot doesn't reply** — check Vercel function logs. Common causes: missing env var, Upstash not connected, Telegram webhook not set.
- **"I don't know X"** when calling `/meet` — friend not in their list. `/addfriend` first.
