import { sendMessage } from '../telegram.js';
import { getFlow, setFlow, clearFlow } from '../store.js';
import { extractSlot } from '../llm.js';
import * as onboarding from './onboarding.js';
import * as addfriend from './addfriend.js';
import * as sethome from './sethome.js';

const FLOWS = {
  [onboarding.name]: onboarding,
  [addfriend.name]: addfriend,
  [sethome.name]: sethome,
};

function getFlowDef(name) {
  const f = FLOWS[name];
  if (!f) throw new Error(`Unknown flow: ${name}`);
  return f;
}

function getStep(flowDef, stepName) {
  return flowDef.steps.find((s) => s.name === stepName);
}

async function renderPrompt(step, partial) {
  return typeof step.prompt === 'function' ? step.prompt(partial) : step.prompt;
}

export async function startFlow(chatId, flowName, initialPartial = {}) {
  const flowDef = getFlowDef(flowName);
  const first = flowDef.steps[0];
  await setFlow(chatId, {
    name: flowName,
    step: first.name,
    partial: initialPartial,
  });
  await sendMessage(chatId, await renderPrompt(first, initialPartial));
}

export async function continueFlow(chatId, userText) {
  const state = await getFlow(chatId);
  if (!state) {
    await sendMessage(chatId, "Not sure what you mean. Try /help.");
    return;
  }

  const flowDef = getFlowDef(state.name);
  const step = getStep(flowDef, state.step);
  if (!step) {
    await clearFlow(chatId);
    await sendMessage(chatId, "Something went wrong with that flow. Cancelled — try again.");
    return;
  }

  let value;
  try {
    value = await extractSlot({
      question: await renderPrompt(step, state.partial),
      userReply: userText,
      schema: step.schema,
    });
  } catch (err) {
    console.error('slot extraction failed', err);
    await sendMessage(chatId, "I didn't catch that — could you say it differently?");
    return;
  }

  if (step.validate) {
    const v = step.validate(value, state.partial);
    if (v?.error) {
      await sendMessage(chatId, v.error);
      return;
    }
    if (v?.value !== undefined) value = v.value;
  }

  let nextPartial = { ...state.partial, [step.name]: value };

  if (step.handle) {
    const out = await step.handle({ chatId, value, partial: nextPartial });
    if (out?.partial) nextPartial = out.partial;
    if (out?.cancel) {
      await clearFlow(chatId);
      if (out.message) await sendMessage(chatId, out.message);
      return;
    }
    if (out?.message) await sendMessage(chatId, out.message);
    if (out?.repeat) {
      await setFlow(chatId, { name: state.name, step: state.step, partial: nextPartial });
      return;
    }
  }

  const idx = flowDef.steps.findIndex((s) => s.name === step.name);
  const next = flowDef.steps[idx + 1];

  if (!next) {
    await clearFlow(chatId);
    if (flowDef.onComplete) {
      await flowDef.onComplete({ chatId, partial: nextPartial });
    }
    return;
  }

  await setFlow(chatId, { name: state.name, step: next.name, partial: nextPartial });
  await sendMessage(chatId, await renderPrompt(next, nextPartial));
}
