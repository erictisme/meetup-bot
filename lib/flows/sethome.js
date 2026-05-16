import { sendMessage } from '../telegram.js';
import { geocode } from '../geocode.js';
import { patchUser } from '../store.js';

export const name = 'sethome';

export const steps = [
  {
    name: 'home',
    prompt: "What's your home address?",
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
        message: `Got it: *${geo.address}*.`,
      };
    },
  },
];

export async function onComplete({ chatId, partial }) {
  await patchUser(chatId, { home: partial.home });
  await sendMessage(chatId, 'Home updated.');
}
