const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const express = require("express");
const cors = require("cors");
const Anthropic = require("@anthropic-ai/sdk");
const {
  buildKnowledgeContext,
  buildReferencePayload,
  loadKnowledgeBase,
  retrieveKnowledgeEntries,
} = require("./knowledge-base");

const defaultEnvPath = path.join(process.cwd(), ".env");
const fallbackEnvPath = path.join(process.cwd(), ".env.txt");

if (fs.existsSync(defaultEnvPath)) {
  dotenv.config({ path: defaultEnvPath, quiet: true });
} else if (fs.existsSync(fallbackEnvPath)) {
  dotenv.config({ path: fallbackEnvPath, quiet: true });
} else {
  dotenv.config({ quiet: true });
}

const app = express();
const port = Number(process.env.PORT) || 3000;
const knowledgeBase = loadKnowledgeBase();
const widgetShellHtml = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Chatbot Widget</title>
    <link rel="stylesheet" href="/chat-widget.css" />
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        background: #f6f2eb;
      }
    </style>
  </head>
  <body>
    <script src="/chat-widget.js" defer></script>
  </body>
</html>`;

app.use(cors());
app.use(express.json());
app.use(express.static("public", { index: false }));

const client = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

function getMessageText(content) {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }

        if (item?.type === "text") {
          return item.text || "";
        }

        return "";
      })
      .join("\n")
      .trim();
  }

  return "";
}

function getLatestUserQuestion(messages) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      const text = getMessageText(messages[index].content);

      if (text) {
        return text;
      }
    }
  }

  return "";
}

function getConversationForModel(messages) {
  return messages
    .slice(-8)
    .map((message) => ({
      role: message.role,
      content: getMessageText(message.content),
    }))
    .filter((message) => message.content);
}

function buildKnowledgeOnlyReply(matches) {
  if (!matches.length) {
    return "I could not find an answer for that in the uploaded DJP Level 1 training data.";
  }

  const bestMatch = matches[0];
  const nextMatches = matches.slice(1, 3);

  if (
    bestMatch.score >= 85 ||
    !nextMatches.length ||
    bestMatch.score >= (nextMatches[0]?.score || 1) * 1.6
  ) {
    return bestMatch.answer;
  }

  const combinedAnswers = [bestMatch, ...nextMatches]
    .map((entry, index) => `Point ${index + 1}: ${entry.answer}`)
    .join("\n\n");

  return `I found multiple relevant points in the DJP Level 1 material:\n\n${combinedAnswers}`;
}

function extractAnthropicMessage(error) {
  const directMessage =
    error?.error?.message ||
    error?.response?.data?.error?.message ||
    error?.message;

  if (typeof directMessage !== "string") {
    return null;
  }

  const jsonStart = directMessage.indexOf("{");
  if (jsonStart === -1) {
    return directMessage;
  }

  try {
    const parsed = JSON.parse(directMessage.slice(jsonStart));
    return parsed?.error?.message || directMessage;
  } catch {
    return directMessage;
  }
}

function normalizeAnthropicError(error) {
  const statusCode = Number(error?.status) || 500;
  const providerMessage =
    extractAnthropicMessage(error) ||
    "Something went wrong while contacting Anthropic.";

  if (/credit balance is too low/i.test(providerMessage)) {
    return {
      statusCode,
      error:
        "Your Anthropic API key is valid, but the account does not have enough credits to run this request.",
      hint: "Add credits or upgrade the Anthropic plan tied to this API key, then try again.",
      code: "anthropic_insufficient_credits",
      providerMessage,
    };
  }

  if (/invalid x-api-key|authentication/i.test(providerMessage)) {
    return {
      statusCode,
      error: "The Anthropic API key was rejected.",
      hint: "Check ANTHROPIC_API_KEY in .env or .env.txt and restart the server.",
      code: "anthropic_auth_error",
      providerMessage,
    };
  }

  return {
    statusCode,
    error: providerMessage,
    code: "anthropic_request_error",
    providerMessage,
  };
}

app.get("/", (req, res) => {
  if (req.accepts("html")) {
    return res.type("html").send(widgetShellHtml);
  }

  return res.json({
    status: "ok",
    message: "Chatbot backend is running.",
  });
});

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    knowledgeLoaded: knowledgeBase.loaded,
    knowledgeEntries: knowledgeBase.entries.length,
  });
});

app.get("/chat", (req, res) => {
  if (req.accepts("html")) {
    return res.redirect("/#chatbot");
  }

  return res.status(405).json({
    error: "Use POST /chat with a JSON body containing a messages array.",
  });
});

app.get("/knowledge-status", (_req, res) => {
  res.json({
    loaded: knowledgeBase.loaded,
    entries: knowledgeBase.entries.length,
    filePath: knowledgeBase.filePath,
    error: knowledgeBase.error,
  });
});

app.post("/chat", async (req, res) => {
  const { messages } = req.body ?? {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({
      error: "Request body must include a non-empty messages array.",
    });
  }

  const latestQuestion = getLatestUserQuestion(messages);

  if (!latestQuestion) {
    return res.status(400).json({
      error: "Could not find a user question in the messages array.",
    });
  }

  const knowledgeMatches = retrieveKnowledgeEntries(knowledgeBase, latestQuestion, 5);
  const references = buildReferencePayload(knowledgeMatches);

  if (!knowledgeMatches.length) {
    return res.json({
      reply:
        "I could not find an answer for that in the uploaded DJP Level 1 training data.",
      references: [],
      source: "knowledge-base",
    });
  }

  if (!client) {
    return res.json({
      reply: buildKnowledgeOnlyReply(knowledgeMatches),
      references,
      source: "knowledge-base-fallback",
    });
  }

  try {
    const knowledgeContext = buildKnowledgeContext(knowledgeMatches);
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: `You are a textbook-grounded assistant for Digital Jain Pathshala Level 1.
Answer only from the provided knowledge context.
If the answer is not supported by the context, clearly say you do not know based on the uploaded training data.
Do not invent facts.
Keep the answer clear and concise for website visitors.`,
      messages: [
        ...getConversationForModel(messages),
        {
          role: "user",
          content: `Knowledge context:\n${knowledgeContext}\n\nCurrent user question:\n${latestQuestion}`,
        },
      ],
    });

    const reply =
      response.content.find((item) => item.type === "text")?.text ??
      "No text response returned.";

    return res.json({
      reply,
      references,
      source: "anthropic-grounded",
    });
  } catch (error) {
    const normalizedError = normalizeAnthropicError(error);

    return res.json({
      reply: buildKnowledgeOnlyReply(knowledgeMatches),
      references,
      source: "knowledge-base-fallback",
      warning: {
        error: normalizedError.error,
        hint: normalizedError.hint,
        code: normalizedError.code,
      },
    });
  }
});

if (require.main === module) {
  app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
  });
}

module.exports = app;
module.exports.app = app;
