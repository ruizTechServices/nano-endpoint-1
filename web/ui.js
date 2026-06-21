import { deleteAll, initialize, onUserMessage, subscribe } from "./chat.js";
import { CONTEXT_SIZE, contextSlotCount } from "./context.js";
import { logger } from "./logger.js";
import { renderMarkdown } from "./markdown.js";
import { saveHistory } from "./save.js";
import { SUMMARIZE_EVERY } from "./summary.js";

const elements = {
  transcript: document.querySelector("[data-transcript]"),
  welcome: document.querySelector("[data-welcome]"),
  form: document.querySelector("[data-composer]"),
  input: document.querySelector("[data-message-input]"),
  send: document.querySelector("[data-send]"),
  activity: document.querySelector("[data-activity]"),
  contextStatus: document.querySelector("[data-context-status]"),
  cadenceStatus: document.querySelector("[data-cadence-status]"),
  summaryDetails: document.querySelector("[data-summary-details]"),
  summaryLabel: document.querySelector("[data-summary-label]"),
  summaryText: document.querySelector("[data-summary-text]"),
  deleteButton: document.querySelector("[data-delete]"),
  deleteDialog: document.querySelector("[data-delete-dialog]"),
  cancelDelete: document.querySelector("[data-cancel-delete]"),
  confirmDelete: document.querySelector("[data-confirm-delete]"),
  saveButton: document.querySelector("[data-save]"),
  saveStatus: document.querySelector("[data-save-status]"),
  error: document.querySelector("[data-error]"),
};

let previousHistoryLength = 0;
let latestState = null;

function showSaveStatus(text, state) {
  elements.saveStatus.hidden = false;
  elements.saveStatus.textContent = text;
  elements.saveStatus.dataset.state = state;
}

function formatTime(timestamp) {
  return new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit" }).format(new Date(timestamp));
}

function message(role, text, timestamp, thinking = "") {
  const article = document.createElement("article");
  article.className = `message message--${role}`;

  const meta = document.createElement("div");
  meta.className = "message__meta";
  meta.textContent = role === "user" ? `You · ${formatTime(timestamp)}` : `Orin · ${formatTime(timestamp)}`;

  const body = document.createElement(role === "assistant" ? "div" : "p");
  body.className = "message__body";
  if (role === "assistant") body.append(renderMarkdown(text));
  else body.textContent = text;

  article.append(meta);
  if (role === "assistant" && thinking) {
    const details = document.createElement("details");
    details.className = "thinking-panel";
    const summary = document.createElement("summary");
    summary.textContent = "Thinking";
    const content = document.createElement("div");
    content.className = "thinking-panel__content markdown";
    content.append(renderMarkdown(thinking));
    details.append(summary, content);
    details.addEventListener("toggle", () => {
      if (details.open) {
        requestAnimationFrame(() => article.scrollIntoView({ behavior: "smooth", block: "end" }));
      }
    });
    article.append(details);
  }
  article.append(body);
  return article;
}

function render(state) {
  latestState = state;
  elements.welcome.hidden = state.history.length > 0;
  elements.transcript.replaceChildren(elements.welcome);
  for (const interaction of state.history) {
    elements.transcript.append(
      message("user", interaction.user, interaction.ts),
      message("assistant", interaction.assistant, interaction.ts, interaction.thinking ?? ""),
    );
  }

  elements.input.disabled = state.busy || !state.initialized;
  elements.send.disabled = state.busy || !state.initialized;
  elements.saveButton.disabled = state.busy || !state.initialized || state.history.length === 0;
  elements.activity.hidden = !state.busy;
  elements.activity.textContent = state.busy ? "Orin is generating…" : "";
  elements.error.hidden = !state.error;
  elements.error.textContent = state.error ?? "";

  const slots = contextSlotCount(state.history, state.rollingSummary);
  elements.contextStatus.textContent = `${slots} of ${CONTEXT_SIZE} context slots`;
  const remainder = state.interactionCount % SUMMARIZE_EVERY;
  const turnsUntilSummary = remainder === 0 ? SUMMARIZE_EVERY : SUMMARIZE_EVERY - remainder;
  elements.cadenceStatus.textContent = `Summary in ${turnsUntilSummary} ${turnsUntilSummary === 1 ? "turn" : "turns"}`;

  elements.summaryDetails.hidden = !state.rollingSummary;
  elements.summaryLabel.textContent = state.rollingSummary ? "Memory summary" : "No memory summary yet";
  elements.summaryText.textContent = state.rollingSummary ?? "";

  if (state.history.length > previousHistoryLength) {
    requestAnimationFrame(() => elements.transcript.lastElementChild?.scrollIntoView({ behavior: "smooth", block: "end" }));
  }
  previousHistoryLength = state.history.length;
}

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = elements.input.value;
  if (!text.trim()) return;
  elements.input.value = "";
  try {
    await onUserMessage(text);
  } catch (error) {
    elements.input.value = text;
    logger.warn("ui.message_restored", { error: error.message });
  }
});

elements.input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    elements.form.requestSubmit();
  }
});

elements.deleteButton.addEventListener("click", () => elements.deleteDialog.showModal());
elements.cancelDelete.addEventListener("click", () => elements.deleteDialog.close());
elements.confirmDelete.addEventListener("click", async () => {
  elements.confirmDelete.disabled = true;
  try {
    await deleteAll();
    elements.deleteDialog.close();
    elements.input.focus();
  } finally {
    elements.confirmDelete.disabled = false;
  }
});

elements.saveButton.addEventListener("click", async () => {
  elements.saveButton.disabled = true;
  showSaveStatus("Saving to cloud…", "pending");
  try {
    const result = await saveHistory();
    const conversationId = latestState?.conversationId ?? 0;
    const savedTotal = result.saved_turns + result.saved_thinking + result.saved_summaries;
    if (savedTotal === 0) {
      showSaveStatus(`Already up to date (conversation #${conversationId})`, "success");
    } else {
      showSaveStatus(
        `Saved ${result.saved_turns} new turns · ${result.saved_thinking} thinking · ` +
          `${result.saved_summaries} summaries (conversation #${conversationId})`,
        "success",
      );
    }
  } catch (error) {
    showSaveStatus(error.message, "error");
    logger.warn("ui.save_failed", { error: error.message });
  } finally {
    elements.saveButton.disabled =
      !latestState || latestState.busy || !latestState.initialized || latestState.history.length === 0;
  }
});

subscribe(render);
initialize().catch((error) => {
  logger.error("ui.initialize_failed", { error: error.message });
  elements.error.hidden = false;
  elements.error.textContent = `Could not load local chat data: ${error.message}`;
});
