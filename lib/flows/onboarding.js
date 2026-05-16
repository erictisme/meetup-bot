import { sendMessage } from '../telegram.js';
import { geocode } from '../geocode.js';
import { patchUser } from '../store.js';

export const name = 'onboarding';

export const steps = [
  {
    name: 'home',
    prompt: "Welcome! What's your home address? (street + city is enough — I'll look it up)",
    schema: {
      type: 'object',
      properties: {
        address: { type: 'string', description: 'The home address the user provided, as-is.' },
      },
      required: ['address'],
    },
    handle: async ({ chatId, value, partial }) => {
      const geo = await geocode(value.address);
      if (!geo) {
        return { message: "Couldn't find that address — try a different one.", repeat: true };
      }
      return {
        partial: { ...partial, home: geo },
        message: `Got it: *${geo.address}*. Saving as your home base.`,
      };
    },
  },
];

export async function onComplete({ chatId, partial }) {
  await patchUser(chatId, { home: partial.home });
  await sendMessage(
    chatId,
    "You're all set. Next steps:\n• /addfriend — add someone you meet often\n• /meet <friend> <when> — get venue picks\n\nTry: `/meet alice thursday 12pm`"
  );
}
