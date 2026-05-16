import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-haiku-4-5-20251001';
const TIMEOUT_MS = 8000;

let _client;
function client() {
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}

const SYSTEM = `You are a slot-filling assistant for a Telegram meetup bot.
Given a question the bot asked and a user's free-text reply, extract the answer into the structured format defined by the tool's input schema.
Rules:
- Be tolerant of casual phrasing ("she's more of a matcha girl" → matcha).
- If the user says "none", "no", "nothing", "n/a", return an empty array (for array fields) or false (for booleans where appropriate).
- For confirmation questions: "yes/yeah/sure/ok/save it" → true; "no/cancel/scratch that" → false.
- Never invent data not present in the user's reply.
- Always call the extract tool. Do not reply in plain text.`;

// Rule-based fallback when ANTHROPIC_API_KEY is not set. Handles the 4 schema
// shapes used by current flows. Less forgiving of casual phrasing but ships
// without external dep. See ADR 0001 for the LLM-first rationale.
function ruleBasedExtract({ schema, userReply }) {
  const props = schema?.properties || {};
  const out = {};
  const reply = String(userReply).trim();
  const lower = reply.toLowerCase();

  for (const [key, def] of Object.entries(props)) {
    if (def.type === 'string') {
      out[key] = reply;
    } else if (def.type === 'array') {
      const tokens = lower
        .split(/[,;]|\band\b|\bor\b|\bplus\b/)
        .map((s) => s.trim())
        .filter(Boolean);
      out[key] = tokens;
    } else if (def.type === 'boolean') {
      if (/\b(yes|yeah|yep|sure|ok|okay|save|do it|please|y)\b/.test(lower)) {
        out[key] = true;
      } else if (/\b(no|nope|cancel|nah|scratch|don'?t|stop|n)\b/.test(lower)) {
        out[key] = false;
      } else {
        out[key] = false;
      }
    }
  }
  return out;
}

export async function extractSlot({ question, userReply, schema }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return ruleBasedExtract({ schema, userReply });
  }

  const tool = {
    name: 'extract',
    description: 'Return the structured value extracted from the user reply.',
    input_schema: schema,
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  try {
    const res = await client().messages.create(
      {
        model: MODEL,
        max_tokens: 512,
        system: [
          { type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } },
        ],
        tools: [tool],
        tool_choice: { type: 'tool', name: 'extract' },
        messages: [
          {
            role: 'user',
            content: `Bot asked: ${question}\n\nUser replied: ${userReply}`,
          },
        ],
      },
      { signal: ctrl.signal }
    );

    const toolUse = res.content?.find((b) => b.type === 'tool_use');
    if (!toolUse) throw new Error('No tool_use block in LLM response');
    return toolUse.input;
  } catch (err) {
    // LLM failed — degrade gracefully rather than break the flow.
    console.error('llm extractSlot failed, falling back to rules', err.message);
    return ruleBasedExtract({ schema, userReply });
  } finally {
    clearTimeout(timer);
  }
}
