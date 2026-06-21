import * as database from "./db.js";
import * as endpoint from "./endpoint.js";
import { buildContext } from "./context.js";
import { logger } from "./logger.js";
import { consolidate } from "./summary.js";

const listeners = new Set();
let state = {
  history: [],
  rollingSummary: null,
  interactionCount: 0,
  busy: false,
  error: null,
  initialized: false,
};

function snapshot() {
  return structuredClone(state);
}

function notify() {
  const current = snapshot();
  for (const listener of listeners) listener(current);
}

export function subscribe(listener) {
  listeners.add(listener);
  listener(snapshot());
  return () => listeners.delete(listener);
}

export async function initialize() {
  const persisted = await database.loadState();
  state = { ...state, ...persisted, initialized: true, error: null };
  logger.info("chat.initialized", {
    interactions: state.history.length,
    interactionCount: state.interactionCount,
    hasSummary: Boolean(state.rollingSummary),
  });
  notify();
  return snapshot();
}

export async function onUserMessage(input) {
  const userMessage = input.trim();
  if (!userMessage) throw new Error("Message cannot be empty");
  if (state.busy) throw new Error("A response is already being generated");

  state = { ...state, busy: true, error: null };
  notify();

  try {
    const context = buildContext(state.history, state.rollingSummary);
    const response = await endpoint.chat(context, userMessage);
    const interaction = {
      id: crypto.randomUUID(),
      user: userMessage,
      assistant: response.content,
      thinking: response.thinking,
      ts: new Date().toISOString(),
    };
    const history = [...state.history, interaction];
    const interactionCount = state.interactionCount + 1;
    state = { ...state, history, interactionCount };

    await database.putMany({
      [database.STATE_KEYS.history]: history,
      [database.STATE_KEYS.summary]: state.rollingSummary,
      [database.STATE_KEYS.counter]: interactionCount,
    });
    notify();

    const previousSummary = state.rollingSummary;
    const nextSummary = await consolidate(history, previousSummary, interactionCount);
    const summaryUpdated = nextSummary !== previousSummary;
    if (summaryUpdated) {
      state = { ...state, rollingSummary: nextSummary };
      await database.put(database.STATE_KEYS.summary, nextSummary);
    }
    logger.info("chat.turn_completed", {
      interactionId: interaction.id,
      interactionCount,
      contextMessages: context.length,
      summaryUpdated,
    });
    return interaction;
  } catch (error) {
    state = { ...state, error: error.message };
    logger.error("chat.turn_failed", { error: error.message, interactionCount: state.interactionCount });
    throw error;
  } finally {
    state = { ...state, busy: false };
    notify();
  }
}

export async function deleteAll() {
  await database.clear();
  state = {
    history: [],
    rollingSummary: null,
    interactionCount: 0,
    busy: false,
    error: null,
    initialized: true,
  };
  logger.warn("chat.deleted", { history: 0, hasSummary: false, interactionCount: 0 });
  notify();
}
