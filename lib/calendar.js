import { google } from 'googleapis';
import { getUser, clearUserToken } from './store.js';

export class TokenExpiredError extends Error {
  constructor(chatId) {
    super('Google refresh token expired or revoked');
    this.name = 'TokenExpiredError';
    this.chatId = chatId;
  }
}

function getOAuthClient(refreshToken) {
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    `${process.env.PUBLIC_BASE_URL}/api/oauth-callback`
  );
  oauth2.setCredentials({ refresh_token: refreshToken });
  return oauth2;
}

function isAuthError(err) {
  const code = err?.code || err?.response?.status;
  const data = err?.response?.data;
  if (code === 401) return true;
  if (code === 400 && typeof data === 'object' && data?.error === 'invalid_grant') return true;
  return false;
}

export async function fetchBracketingEvents(chatId, meetingTime, windowHours = 1) {
  const user = await getUser(chatId);
  if (!user?.refresh_token) throw new TokenExpiredError(chatId);

  const auth = getOAuthClient(user.refresh_token);
  const cal = google.calendar({ version: 'v3', auth });

  const start = new Date(meetingTime.getTime() - windowHours * 3600 * 1000);
  const end = new Date(meetingTime.getTime() + windowHours * 3600 * 1000);

  let res;
  try {
    res = await cal.events.list({
      calendarId: 'primary',
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });
  } catch (err) {
    if (isAuthError(err)) {
      await clearUserToken(chatId);
      throw new TokenExpiredError(chatId);
    }
    throw err;
  }

  const events = (res.data.items || []).filter((e) => e.start?.dateTime);

  let pre = null;
  let post = null;
  for (const e of events) {
    const eStart = new Date(e.start.dateTime);
    const eEnd = e.end?.dateTime ? new Date(e.end.dateTime) : eStart;
    if (eEnd <= meetingTime && (!pre || eEnd > new Date(pre.end.dateTime))) pre = e;
    if (eStart >= meetingTime && (!post || eStart < new Date(post.start.dateTime))) post = e;
  }

  return { pre, post };
}

export function eventLocation(event) {
  if (!event) return null;
  const loc = event.location?.trim();
  return loc || null;
}
