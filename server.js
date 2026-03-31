const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const express = require("express");
const cors = require("cors");
const Anthropic = require("@anthropic-ai/sdk");

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

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const client = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

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
    return res.redirect("/index.html");
  }

  return res.json({
    status: "ok",
    message: "Chatbot backend is running.",
  });
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/chat", (req, res) => {
  if (req.accepts("html")) {
    return res.redirect("/index.html");
  }

  return res.status(405).json({
    error: "Use POST /chat with a JSON body containing a messages array.",
  });
});

app.post("/chat", async (req, res) => {
  const { messages } = req.body ?? {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({
      error: "Request body must include a non-empty messages array.",
    });
  }

  if (!client) {
    return res.status(500).json({
      error: "Missing ANTHROPIC_API_KEY. Add it to .env or .env.txt.",
    });
  }

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: "You are a helpful assistant for my website.",
      messages,
    });

    const reply =
      response.content.find((item) => item.type === "text")?.text ??
      "No text response returned.";

    return res.json({ reply });
  } catch (error) {
    const normalizedError = normalizeAnthropicError(error);

    return res.status(normalizedError.statusCode).json({
      error: normalizedError.error,
      hint: normalizedError.hint,
      code: normalizedError.code,
      providerMessage: normalizedError.providerMessage,
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
