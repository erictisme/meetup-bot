import * as chrono from 'chrono-node';

export function parseMeetArgs(text) {
  const stripped = text.replace(/^\/meet(@\w+)?\s*/i, '').trim();
  if (!stripped) return { friend: null, when: null, raw: '' };

  const parsed = chrono.parse(stripped, new Date(), { forwardDate: true });
  if (parsed.length === 0) {
    const tokens = stripped.split(/\s+/);
    return { friend: tokens[0]?.toLowerCase() || null, when: null, raw: stripped };
  }

  const result = parsed[0];
  const when = result.start.date();
  const friend = stripped.slice(0, result.index).trim().split(/\s+/)[0]?.toLowerCase() || null;
  return { friend, when, raw: stripped };
}
