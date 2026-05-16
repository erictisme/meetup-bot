import { sendMessage } from '../telegram.js';
import { addFriend } from '../store.js';

export const name = 'addfriend';

const ALLOWED_DRINKS = ['coffee', 'tea', 'beer', 'matcha', 'alcohol', 'none'];
const ALLOWED_DIETARY = ['vegetarian', 'halal', 'vegan', 'none'];

function filterList(arr, allowed) {
  if (!Array.isArray(arr)) return [];
  const lower = arr.map((s) => String(s).toLowerCase().trim());
  return lower.filter((s) => allowed.includes(s));
}

export const steps = [
  {
    name: 'name',
    prompt: "What's their name?",
    schema: {
      type: 'object',
      properties: { name: { type: 'string', description: "The friend's name." } },
      required: ['name'],
    },
    validate: (v) => {
      if (!v.name || !v.name.trim()) return { error: "I need a name — try again." };
      return { value: { name: v.name.trim() } };
    },
  },
  {
    name: 'drinks',
    prompt: (p) =>
      `What does ${p.name?.name || 'they'} like to drink? (coffee, tea, beer, matcha, alcohol, none — list any)`,
    schema: {
      type: 'object',
      properties: {
        drinks: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of drinks from: coffee, tea, beer, matcha, alcohol, none.',
        },
      },
      required: ['drinks'],
    },
    validate: (v) => ({ value: { drinks: filterList(v.drinks, ALLOWED_DRINKS) } }),
  },
  {
    name: 'dietary',
    prompt: 'Any dietary preferences? (vegetarian, halal, vegan, none)',
    schema: {
      type: 'object',
      properties: {
        dietary: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of dietary preferences from: vegetarian, halal, vegan, none.',
        },
      },
      required: ['dietary'],
    },
    validate: (v) => ({ value: { dietary: filterList(v.dietary, ALLOWED_DIETARY) } }),
  },
  {
    name: 'confirm',
    prompt: (p) => {
      const n = p.name?.name || '?';
      const d = (p.drinks?.drinks || []).join(', ') || 'none';
      const diet = (p.dietary?.dietary || []).join(', ') || 'none';
      return `Got it: *${n}*, drinks: ${d}, dietary: ${diet}. Save? (yes/no)`;
    },
    schema: {
      type: 'object',
      properties: {
        confirm: { type: 'boolean', description: 'true if user wants to save, false otherwise.' },
      },
      required: ['confirm'],
    },
    handle: async ({ chatId, value, partial }) => {
      if (!value.confirm) {
        return { cancel: true, message: 'Cancelled — nothing saved.' };
      }
      await addFriend(chatId, {
        name: partial.name.name,
        drinks: partial.drinks.drinks,
        dietary: partial.dietary.dietary,
      });
      return { message: `Saved *${partial.name.name}*. Try \`/meet ${partial.name.name.toLowerCase()} thursday 12pm\`.` };
    },
  },
];

export async function onComplete() {
  // Nothing extra — the confirm step handles save + reply.
}
