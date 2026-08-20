import { marked } from "/vendor/marked.esm.js";

const form = document.querySelector("#question-form");
const question = document.querySelector("#question");
const submit = document.querySelector("#submit");
const status = document.querySelector("#status");
const answerNodes = {
  noMemory: document.querySelector("#noMemory"),
  longTermMemory: document.querySelector("#longTermMemory"),
  episodicMemory: document.querySelector("#episodicMemory"),
};
const recallPanels = {
  longTermMemory: document.querySelector("#longTermMemory-recall"),
  episodicMemory: document.querySelector("#episodicMemory-recall"),
};
const memoryKeys = new Set(Object.keys(recallPanels));
const answerBuffers = {};

function renderAnswer(node, message) {
  // marked handles standard Markdown; DOMPurify strips unsafe HTML generated
  // by untrusted model output before it reaches the viewer.
  node.innerHTML = window.DOMPurify.sanitize(marked.parse(String(message), { gfm: true, breaks: true }));
}

function resetAnswers() {
  for (const [key, node] of Object.entries(answerNodes)) {
    answerBuffers[key] = "";
    node.textContent = "Thinking…";
  }
}

function appendAnswer(key, text) {
  answerBuffers[key] += text;
  answerNodes[key].textContent = `${answerBuffers[key]}▍`;
}

function finishAnswer(key) {
  const answer = answerBuffers[key];
  if (answer.trim()) renderAnswer(answerNodes[key], answer);
}

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "undated"
    : new Intl.DateTimeFormat("en", { year: "numeric", month: "short", day: "numeric" }).format(date);
}

function clearRecallPanels() {
  for (const panel of Object.values(recallPanels)) {
    panel.hidden = true;
    const button = panel.querySelector(".recall-toggle");
    const state = panel.querySelector(".recall-state");
    const details = panel.querySelector(".recall-details");
    button.setAttribute("aria-expanded", "false");
    state.textContent = "Waiting for recall";
    details.hidden = true;
    details.replaceChildren();
  }
}

function setRecalling(key, query) {
  if (!memoryKeys.has(key)) return;
  const panel = recallPanels[key];
  panel.hidden = false;
  panel.querySelector(".recall-state").textContent = "Searching founder history…";
  panel.querySelector(".recall-details").replaceChildren();
  panel.dataset.query = typeof query === "string" ? query : "founder history";
}

function evidenceNode(memory) {
  const item = document.createElement("article");
  item.className = "memory-evidence";

  const meta = document.createElement("div");
  meta.className = "memory-evidence-meta";
  const type = document.createElement("span");
  type.textContent = memory.type;
  const date = document.createElement("time");
  date.textContent = formatDate(memory.created_at);
  meta.append(type, date);

  const title = document.createElement("h3");
  title.textContent = memory.title;
  const excerpt = document.createElement("p");
  excerpt.textContent = memory.content_excerpt || "No excerpt returned.";
  item.append(meta, title, excerpt);

  if (memory.tags?.length) {
    const tags = document.createElement("div");
    tags.className = "memory-tags";
    for (const tag of memory.tags) {
      const pill = document.createElement("span");
      pill.textContent = tag;
      tags.append(pill);
    }
    item.append(tags);
  }
  return item;
}

function showRecall(key, memories) {
  if (!memoryKeys.has(key)) return;
  const panel = recallPanels[key];
  const details = panel.querySelector(".recall-details");
  const state = panel.querySelector(".recall-state");
  panel.hidden = false;
  details.replaceChildren();

  const note = document.createElement("p");
  note.className = "recall-note";
  const mode = key === "episodicMemory" ? "Time-weighted recall returned" : "Hybrid recall returned";
  note.textContent = memories.length
    ? `${mode} the following ${memories.length} memories for this answer.`
    : "Recall completed, but no relevant prior memory was returned.";
  details.append(note);
  for (const memory of memories) details.append(evidenceNode(memory));
  state.textContent = memories.length ? `${memories.length} memories used` : "No matching memories";
}

function readFrame(frame) {
  const lines = frame.split(/\r?\n/);
  const name = lines.find((line) => line.startsWith("event:"))?.slice(6).trim() || "message";
  const raw = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart())
    .join("\n");
  if (!raw) return;
  try {
    return { name, data: JSON.parse(raw) };
  } catch {
    return;
  }
}

async function consumeStream(stream, onFrame) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let boundary = buffer.search(/\r?\n\r?\n/);
      while (boundary >= 0) {
        const frame = readFrame(buffer.slice(0, boundary));
        if (frame) onFrame(frame);
        buffer = buffer.slice(boundary).replace(/^\r?\n\r?\n/, "");
        boundary = buffer.search(/\r?\n\r?\n/);
      }
      if (done) break;
    }
    const frame = readFrame(buffer);
    if (frame) onFrame(frame);
  } finally {
    reader.releaseLock();
  }
}

for (const panel of Object.values(recallPanels)) {
  const button = panel.querySelector(".recall-toggle");
  const details = panel.querySelector(".recall-details");
  button.addEventListener("click", () => {
    const expanded = button.getAttribute("aria-expanded") === "true";
    button.setAttribute("aria-expanded", String(!expanded));
    details.hidden = expanded;
  });
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const prompt = question.value.trim();
  if (!prompt) return;

  submit.disabled = true;
  submit.querySelector("span").textContent = "Reasoning…";
  status.textContent = "Running the same prompt through all three reasoning modes…";
  resetAnswers();
  clearRecallPanels();

  try {
    const response = await fetch("/compare/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: prompt }),
    });
    if (!response.ok || !response.body) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error ?? "Comparison failed.");
    }

    await consumeStream(response.body, ({ name, data }) => {
      if (name === "delta") appendAnswer(data.key, data.text);
      if (name === "recalling") setRecalling(data.key, data.query);
      if (name === "recall") showRecall(data.key, data.memories ?? []);
      if (name === "complete") finishAnswer(data.key);
      if (name === "error") {
        answerBuffers[data.key] = `### Could not answer\n\n${data.message}`;
        renderAnswer(answerNodes[data.key], answerBuffers[data.key]);
      }
      if (name === "done") status.textContent = "Complete. Expand the memory evidence, then inspect the episodic trace in Studio.";
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Comparison failed.";
    for (const node of Object.values(answerNodes)) renderAnswer(node, `Could not run comparison: ${message}`);
    status.textContent = "Make sure Mastra is running at localhost:4111, then try again.";
  } finally {
    submit.disabled = false;
    submit.querySelector("span").textContent = "Run comparison";
  }
});
