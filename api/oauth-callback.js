import { google } from 'googleapis';
import { consumeOAuthState, patchUser } from '../lib/store.js';
import { startFlow } from '../lib/flows/runtime.js';
import { sendMessage } from '../lib/telegram.js';

function html(body) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Meetup Bot</title><style>body{font-family:-apple-system,system-ui,sans-serif;max-width:480px;margin:80px auto;padding:0 24px;color:#264653;line-height:1.5}h1{font-size:22px}p{font-size:16px}</style></head><body>${body}</body></html>`;
}

export default async function handler(req, res) {
  const url = new URL(req.url, `https://${req.headers.host}`);
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  const err = url.searchParams.get('error');

  if (err) {
    res.setHeader('Content-Type', 'text/html');
    res.status(400).end(html(`<h1>Connection cancelled</h1><p>${err}. Return to Telegram and try /connect again.</p>`));
    return;
  }

  if (!state || !code) {
    res.setHeader('Content-Type', 'text/html');
    res.status(400).end(html('<h1>Missing state or code</h1><p>Return to Telegram and try /connect again.</p>'));
    return;
  }

  const chatId = await consumeOAuthState(state);
  if (!chatId) {
    res.setHeader('Content-Type', 'text/html');
    res.status(400).end(html('<h1>Link expired</h1><p>That link expired (10 min limit). Return to Telegram and try /connect again.</p>'));
    return;
  }

  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    `${process.env.PUBLIC_BASE_URL}/api/oauth-callback`
  );

  try {
    const { tokens } = await oauth2.getToken(code);
    if (!tokens.refresh_token) {
      res.setHeader('Content-Type', 'text/html');
      res.status(400).end(html('<h1>No refresh token returned</h1><p>Google did not return a refresh token. Revoke this app at <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a> and try /connect again.</p>'));
      return;
    }

    await patchUser(chatId, {
      refresh_token: tokens.refresh_token,
      connected_at: new Date().toISOString(),
    });

    res.setHeader('Content-Type', 'text/html');
    res.status(200).end(html('<h1>Connected!</h1><p>Return to Telegram to continue setup.</p>'));

    // Fire-and-forget — the user's browser already has its response.
    try {
      await sendMessage(chatId, 'Calendar connected. Let me get a few more things.');
      await startFlow(chatId, 'onboarding');
    } catch (e) {
      console.error('post-connect flow start failed', e);
    }
  } catch (e) {
    console.error('oauth token exchange failed', e);
    res.setHeader('Content-Type', 'text/html');
    res.status(500).end(html('<h1>Something went wrong</h1><p>Token exchange failed. Return to Telegram and try /connect again.</p>'));
  }
}
