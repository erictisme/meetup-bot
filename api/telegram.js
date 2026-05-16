import crypto from 'node:crypto';
import { parseMeetArgs } from '../lib/parse.js';
import { sendMessage } from '../lib/telegram.js';
import { fetchBracketingEvents, eventLocation, TokenExpiredError } from '../lib/calendar.js';
import { getCandidates } from '../lib/venues.js';
import { driveTimes } from '../lib/distance.js';
import {
  getUser,
  getFriends,
  getFlow,
  clearFlow,
  setOAuthState,
  clearUserToken,
} from '../lib/store.js';
import { startFlow, continueFlow } from '../lib/flows/runtime.js';

const HELP = `*Meetup Bot*
/connect — link your Google Calendar
/sethome — update your home address
/addfriend — add someone you meet often
/listfriends — see your friends
/meet <friend> <when> — suggest 2-3 venues
/cancel — abort current flow
/disconnect — unlink your calendar
/help — this message

Example: \`/meet wachel thursday 12pm\``;

const START = `Hi! I suggest meetup venues anchored between your calendar events.

First, run /connect to link your Google Calendar.
Then /sethome and /addfriend, then try \`/meet alice thursday 12pm\`.`;

const SCOPES = ['https://www.googleapis.com/auth/calendar.readonly'];

function mapsUrl(q) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

function midpoint(a, b) {
  if (a && b) return { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 };
  return a || b;
}

async function handleConnect(chatId) {
  const state = crypto.randomBytes(24).toString('hex');
  await setOAuthState(state, chatId);

  const redirect = `${process.env.PUBLIC_BASE_URL}/api/oauth-callback`;
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_OAUTH_CLIENT_ID,
    redirect_uri: redirect,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

  await sendMessage(
    chatId,
    `Tap to connect your Google Calendar:\n\n${url}\n\nNote: while the app is in Google's Testing mode, your Gmail must be whitelisted first. DM @erictansongyi to be added.`
  );
}

async function handleDisconnect(chatId) {
  await clearUserToken(chatId);
  await sendMessage(chatId, 'Disconnected. Run /connect to re-link.');
}

async function handleListFriends(chatId) {
  const friends = await getFriends(chatId);
  if (!friends.length) {
    await sendMessage(chatId, "No friends yet. Add one with /addfriend.");
    return;
  }
  const lines = ['*Your friends:*'];
  for (const f of friends) {
    const d = (f.drinks || []).join(', ') || 'none';
    const diet = (f.dietary || []).join(', ') || 'none';
    lines.push(`• *${f.name}* — drinks: ${d}; dietary: ${diet}`);
  }
  await sendMessage(chatId, lines.join('\n'));
}

async function handleMeet(chatId, text) {
  const user = await getUser(chatId);
  if (!user?.refresh_token) {
    await sendMessage(chatId, 'You need to /connect first.');
    return;
  }
  if (!user.home) {
    await sendMessage(chatId, 'You need to /sethome first.');
    return;
  }

  const { friend, when } = parseMeetArgs(text);
  if (!friend || !when) {
    await sendMessage(chatId, `Couldn't parse that. Try: \`/meet wachel thursday 12pm\``);
    return;
  }

  const friends = await getFriends(chatId);
  const friendData = friends.find((f) => f.name.toLowerCase() === friend);
  if (!friendData) {
    await sendMessage(chatId, `I don't know *${friend}* — add them with /addfriend.`);
    return;
  }
  const friendLabel = friendData.name;

  let bracket;
  try {
    bracket = await fetchBracketingEvents(chatId, when);
  } catch (err) {
    if (err instanceof TokenExpiredError) {
      await sendMessage(chatId, 'Your connection expired — please /connect again.');
      return;
    }
    throw err;
  }

  const { pre, post } = bracket;
  const preLoc = eventLocation(pre);
  const postLoc = eventLocation(post);

  const home = user.home;
  // Use home coords for biasing midpoint when event location is a string-only address.
  const preAnchor = preLoc
    ? { address: preLoc, lat: home.lat, lng: home.lng }
    : { address: home.address, lat: home.lat, lng: home.lng };
  const postAnchor = postLoc
    ? { address: postLoc, lat: home.lat, lng: home.lng }
    : { address: home.address, lat: home.lat, lng: home.lng };

  const mid = midpoint(preAnchor, postAnchor) || home;
  const candidates = await getCandidates({ midpoint: mid, chatId });

  if (candidates.length === 0) {
    await sendMessage(chatId, `No venue candidates found near *${friendLabel}*.`);
    return;
  }

  const destAddrs = candidates.map((c) => c.address || `${c.lat},${c.lng}`);
  const [preTimes, postTimes] = await Promise.all([
    driveTimes(preAnchor.address, destAddrs),
    driveTimes(postAnchor.address, destAddrs),
  ]);

  const max = 20;
  const scored = candidates
    .map((c, i) => ({ ...c, pre: preTimes[i], post: postTimes[i] }))
    .filter((c) => c.pre && c.post && c.pre.minutes <= max && c.post.minutes <= max)
    .sort((a, b) => a.pre.minutes + a.post.minutes - (b.pre.minutes + b.post.minutes))
    .slice(0, 3);

  if (scored.length === 0) {
    await sendMessage(
      chatId,
      `Found candidates but none within ${max} min drive of both anchors. Try a different time.`
    );
    return;
  }

  const whenStr = when.toLocaleString('en-SG', {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    day: 'numeric',
    month: 'short',
  });
  const ctxLine =
    preLoc || postLoc
      ? `_Anchors: ${preLoc || 'home'} → ${postLoc || 'home'}_`
      : `_No bracketing calendar events — anchored on home._`;

  const lines = [`*Meet ${friendLabel}* — ${whenStr}`, ctxLine, ''];
  scored.forEach((v, i) => {
    lines.push(`*${i + 1}. ${v.name}*${v.rating ? ` ⭐ ${v.rating}` : ''}`);
    if (v.address) lines.push(v.address);
    lines.push(`Pre: ${v.pre.text} · Post: ${v.post.text}`);
    lines.push(`[Open in Maps](${mapsUrl(v.address || v.name)})`);
    lines.push('');
  });

  await sendMessage(chatId, lines.join('\n'));
}

async function handleCommand(chatId, text) {
  const cmd = text.split(/\s+/)[0].toLowerCase().split('@')[0];

  // Read-only commands shouldn't crash if KV is unreachable.
  const READ_ONLY = new Set(['/start', '/help']);

  if (cmd !== '/cancel' && !READ_ONLY.has(cmd)) {
    try {
      const existing = await getFlow(chatId);
      if (existing) await clearFlow(chatId);
    } catch (err) {
      console.error('flow check failed (KV unavailable?)', err.message);
    }
  }

  switch (cmd) {
    case '/start':
      return sendMessage(chatId, START);
    case '/help':
      return sendMessage(chatId, HELP);
    case '/connect':
      return handleConnect(chatId);
    case '/disconnect':
      return handleDisconnect(chatId);
    case '/sethome':
      return startFlow(chatId, 'sethome');
    case '/addfriend':
      return startFlow(chatId, 'addfriend');
    case '/listfriends':
      return handleListFriends(chatId);
    case '/cancel':
      await clearFlow(chatId);
      return sendMessage(chatId, 'Cancelled.');
    case '/meet':
      return handleMeet(chatId, text);
    default:
      return sendMessage(chatId, `Unknown command. Try /help.`);
  }
}

async function handleUpdate(update) {
  const msg = update.message || update.edited_message;
  if (!msg?.text) return;
  const chatId = msg.chat.id;
  const text = msg.text.trim();

  if (text.startsWith('/')) {
    return handleCommand(chatId, text);
  }

  const flow = await getFlow(chatId);
  if (flow) {
    return continueFlow(chatId, text);
  }

  return sendMessage(chatId, 'Not sure what you mean. Try /help.');
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(200).json({ ok: true, msg: 'meetup-bot webhook alive' });
    return;
  }

  // Telegram requires <10s — ack first, process after.
  res.status(200).json({ ok: true });
  try {
    await handleUpdate(req.body);
  } catch (err) {
    console.error('handler error', err);
  }
}
