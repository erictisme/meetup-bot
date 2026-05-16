import { Redis } from '@upstash/redis';

let _redis;
function r() {
  if (!_redis) {
    _redis = new Redis({
      url: process.env.KV_REST_API_URL,
      token: process.env.KV_REST_API_TOKEN,
    });
  }
  return _redis;
}

const userKey = (chatId) => `user:${chatId}`;
const friendsKey = (chatId) => `user:${chatId}:friends`;
const flowKey = (chatId) => `flow:${chatId}`;
const stateKey = (token) => `oauth_state:${token}`;

export async function getUser(chatId) {
  return (await r().get(userKey(chatId))) || null;
}

export async function setUser(chatId, data) {
  await r().set(userKey(chatId), data);
}

export async function patchUser(chatId, patch) {
  const cur = (await getUser(chatId)) || {};
  const next = { ...cur, ...patch };
  await setUser(chatId, next);
  return next;
}

export async function clearUserToken(chatId) {
  const cur = (await getUser(chatId)) || {};
  delete cur.refresh_token;
  delete cur.connected_at;
  await setUser(chatId, cur);
}

export async function getFriends(chatId) {
  return (await r().get(friendsKey(chatId))) || [];
}

export async function setFriends(chatId, list) {
  await r().set(friendsKey(chatId), list);
}

export async function addFriend(chatId, friend) {
  const list = await getFriends(chatId);
  const idx = list.findIndex(
    (f) => f.name.toLowerCase() === friend.name.toLowerCase()
  );
  if (idx >= 0) list[idx] = friend;
  else list.push(friend);
  await setFriends(chatId, list);
  return list;
}

export async function getFlow(chatId) {
  return (await r().get(flowKey(chatId))) || null;
}

export async function setFlow(chatId, flow) {
  // 30 min TTL per ADR 0003.
  await r().set(flowKey(chatId), flow, { ex: 60 * 30 });
}

export async function clearFlow(chatId) {
  await r().del(flowKey(chatId));
}

export async function setOAuthState(stateToken, chatId) {
  // 10 min TTL per ADR 0002.
  await r().set(stateKey(stateToken), { chat_id: chatId }, { ex: 60 * 10 });
}

export async function consumeOAuthState(stateToken) {
  const v = await r().get(stateKey(stateToken));
  if (!v) return null;
  await r().del(stateKey(stateToken));
  return v.chat_id;
}
