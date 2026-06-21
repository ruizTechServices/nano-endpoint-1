import { logger } from "./logger.js";

const DATABASE_NAME = "orin-local-chat";
const DATABASE_VERSION = 2;
const STATE_STORE = "state";
const META_STORE = "meta";

export const STATE_KEYS = Object.freeze({
  history: "history",
  summary: "rollingSummary",
  counter: "interactionCount",
  summaryLog: "summaryLog",
});

export const META_KEYS = Object.freeze({
  conversationId: "conversationId",
});

let databasePromise;

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error), { once: true });
  });
}

function transactionComplete(transaction) {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", resolve, { once: true });
    transaction.addEventListener("error", () => reject(transaction.error), { once: true });
    transaction.addEventListener("abort", () => reject(transaction.error), { once: true });
  });
}

export function openDatabase() {
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.addEventListener("upgradeneeded", () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STATE_STORE)) {
        database.createObjectStore(STATE_STORE);
      }
      if (!database.objectStoreNames.contains(META_STORE)) {
        // The meta store holds the durable conversation counter. It is intentionally separate
        // from STATE_STORE so clear() (the "Delete all" wipe) never resets the counter.
        const meta = database.createObjectStore(META_STORE);
        meta.put(0, META_KEYS.conversationId);
      }
      logger.info("persistence.upgrade", { store: STATE_STORE, action: "upgrade", key: null });
    });
    request.addEventListener("success", () => {
      logger.info("persistence.open", { store: STATE_STORE, action: "open", key: null });
      resolve(request.result);
    });
    request.addEventListener("error", () => {
      databasePromise = undefined;
      logger.error("persistence.open_failed", {
        store: STATE_STORE,
        action: "open",
        key: null,
        error: request.error?.message ?? "IndexedDB open failed",
      });
      reject(request.error);
    });
  });

  return databasePromise;
}

export async function get(key) {
  const database = await openDatabase();
  const transaction = database.transaction(STATE_STORE, "readonly");
  const result = await requestResult(transaction.objectStore(STATE_STORE).get(key));
  logger.debug("persistence.get", { store: STATE_STORE, action: "get", key });
  return result;
}

export async function put(key, value) {
  const database = await openDatabase();
  const transaction = database.transaction(STATE_STORE, "readwrite");
  transaction.objectStore(STATE_STORE).put(value, key);
  await transactionComplete(transaction);
  logger.info("persistence.put", { store: STATE_STORE, action: "put", key });
}

export async function putMany(entries) {
  const database = await openDatabase();
  const transaction = database.transaction(STATE_STORE, "readwrite");
  const store = transaction.objectStore(STATE_STORE);
  for (const [key, value] of Object.entries(entries)) store.put(value, key);
  await transactionComplete(transaction);
  for (const key of Object.keys(entries)) {
    logger.info("persistence.put", { store: STATE_STORE, action: "put", key });
  }
}

export async function clear() {
  const database = await openDatabase();
  const transaction = database.transaction(STATE_STORE, "readwrite");
  transaction.objectStore(STATE_STORE).clear();
  await transactionComplete(transaction);
  logger.warn("persistence.clear", { store: STATE_STORE, action: "clear", key: null });
}

export async function getMeta(key) {
  const database = await openDatabase();
  const transaction = database.transaction(META_STORE, "readonly");
  const result = await requestResult(transaction.objectStore(META_STORE).get(key));
  logger.debug("persistence.get", { store: META_STORE, action: "get", key });
  return result;
}

export async function putMeta(key, value) {
  const database = await openDatabase();
  const transaction = database.transaction(META_STORE, "readwrite");
  transaction.objectStore(META_STORE).put(value, key);
  await transactionComplete(transaction);
  logger.info("persistence.put", { store: META_STORE, action: "put", key });
}

export async function getConversationId() {
  const value = await getMeta(META_KEYS.conversationId);
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

export async function setConversationId(value) {
  await putMeta(META_KEYS.conversationId, value);
}

export async function loadState() {
  const [history, rollingSummary, interactionCount, summaryLog, conversationId] = await Promise.all([
    get(STATE_KEYS.history),
    get(STATE_KEYS.summary),
    get(STATE_KEYS.counter),
    get(STATE_KEYS.summaryLog),
    getConversationId(),
  ]);
  return {
    history: Array.isArray(history) ? history : [],
    rollingSummary: typeof rollingSummary === "string" && rollingSummary ? rollingSummary : null,
    interactionCount: Number.isInteger(interactionCount) && interactionCount >= 0 ? interactionCount : 0,
    summaryLog: Array.isArray(summaryLog) ? summaryLog : [],
    conversationId,
  };
}

