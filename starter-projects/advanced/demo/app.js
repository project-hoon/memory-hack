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

function renderAnswer(node, message) {
  // marked handles standard Markdown; DOMPurify strips unsafe HTML generated
  // by untrusted model output before it reaches the viewer.
  node.innerHTML = window.DOMPurify.sanitize(marked.parse(String(message), { gfm: true, breaks: true }));
}

function setAnswers(message) {
  for (const node of Object.values(answerNodes)) renderAnswer(node, message);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const prompt = question.value.trim();
  if (!prompt) return;

  submit.disabled = true;
  submit.textContent = "Comparing…";
  status.textContent = "Running the same question through all three memory modes…";
  setAnswers("Thinking…");

  try {
    const response = await fetch("/compare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: prompt }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "Comparison failed.");

    for (const [key, node] of Object.entries(answerNodes)) {
      const result = payload.answers[key];
      renderAnswer(node, result.error ? `### Could not answer\n\n${result.error}` : result.text);
    }
    status.textContent = "Complete. Compare the reasoning, then open the episodic trace in Studio.";
  } catch (error) {
    const message = error instanceof Error ? error.message : "Comparison failed.";
    setAnswers(`Could not run comparison: ${message}`);
    status.textContent = "Make sure Mastra is running at localhost:4111, then try again.";
  } finally {
    submit.disabled = false;
    submit.textContent = "Compare answers";
  }
});
