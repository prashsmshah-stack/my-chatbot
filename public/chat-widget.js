(function () {
  const bootstrapScript = document.currentScript;

  function trimTrailingSlash(value) {
    return String(value || "").replace(/\/+$/, "");
  }

  function getScriptDirectory(script) {
    if (!script?.src) {
      return "";
    }

    try {
      const url = new URL(script.src, window.location.href);
      url.pathname = url.pathname.replace(/\/[^/]*$/, "");
      return trimTrailingSlash(url.toString());
    } catch {
      return "";
    }
  }

  function joinUrl(baseUrl, path) {
    const cleanBase = trimTrailingSlash(baseUrl);
    const cleanPath = path.startsWith("/") ? path : `/${path}`;
    return cleanBase ? `${cleanBase}${cleanPath}` : cleanPath;
  }

  function injectWidgetStylesheet(cssHref) {
    if (!cssHref) {
      return;
    }

    const absoluteHref = new URL(cssHref, window.location.href).toString();
    const existingLink = Array.from(document.querySelectorAll("link[rel='stylesheet']")).find(
      (link) => link.href === absoluteHref
    );

    if (existingLink) {
      return;
    }

    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = absoluteHref;
    document.head.appendChild(link);
  }

  function initChatWidget() {
    if (window.ChatWidget) {
      return;
    }

    const config = window.ChatWidgetConfig || {};
    const assetBase =
      trimTrailingSlash(config.assetBase) || getScriptDirectory(bootstrapScript) || "";
    const apiBase =
      trimTrailingSlash(config.apiBase) ||
      trimTrailingSlash(bootstrapScript?.dataset?.apiBase) ||
      "";
    const cssHref =
      config.cssHref || bootstrapScript?.dataset?.cssHref || joinUrl(assetBase, "/chat-widget.css");
    const chatEndpoint = joinUrl(apiBase, "/chat");

    injectWidgetStylesheet(cssHref);

    const existingRoot = document.getElementById("chat-widget-root");
    const root = existingRoot || document.createElement("div");

    if (!existingRoot) {
      root.id = "chat-widget-root";
      document.body.appendChild(root);
    }

    root.innerHTML = `
      <div class="chat-widget-shell">
        <section class="chat-panel" id="chat-panel" aria-label="Website chat assistant">
          <header class="chat-header">
            <div>
              <div class="chat-title">Website Assistant</div>
              <div class="chat-subtitle">Ask questions without leaving the page.</div>
            </div>
            <button class="chat-close" id="chat-close" type="button" aria-label="Close chat">
              X
            </button>
          </header>

          <div class="chat-messages" id="chat-messages">
            <div class="chat-message assistant">
              Welcome. Ask me anything about this website.
            </div>
          </div>

          <form class="chat-form" id="chat-form">
            <div class="chat-status" id="chat-status">
              Ready. Messages will be sent to the chatbot backend.
            </div>

            <textarea
              class="chat-input"
              id="chat-input"
              name="prompt"
              placeholder="Type your message..."
              required
            ></textarea>

            <div class="chat-actions">
              <div class="chat-hint">Your visitors can keep browsing while chatting.</div>
              <button class="chat-send" id="chat-send" type="submit">Send</button>
            </div>
          </form>
        </section>

        <button class="chat-launcher" id="chat-launcher" type="button" aria-label="Open chat">
          Chat
        </button>
      </div>
    `;

    const panel = document.getElementById("chat-panel");
    const launcher = document.getElementById("chat-launcher");
    const closeButton = document.getElementById("chat-close");
    const form = document.getElementById("chat-form");
    const input = document.getElementById("chat-input");
    const status = document.getElementById("chat-status");
    const sendButton = document.getElementById("chat-send");
    const messagesEl = document.getElementById("chat-messages");

    const conversation = [
      {
        role: "assistant",
        content: "Welcome. Ask me anything about this website.",
      },
    ];

    function open() {
      panel.classList.add("open");
      launcher.hidden = true;
      input.focus();
    }

    function close() {
      panel.classList.remove("open");
      launcher.hidden = false;
    }

    function addMessage(role, content) {
      const message = document.createElement("div");
      message.className = `chat-message ${role}`;
      message.textContent = content;
      messagesEl.appendChild(message);
      messagesEl.scrollTop = messagesEl.scrollHeight;
      return message;
    }

    function appendReferences(messageElement, references) {
      if (!messageElement || !Array.isArray(references) || references.length === 0) {
        return;
      }

      const referenceList = document.createElement("div");
      referenceList.className = "chat-reference-list";

      references.slice(0, 3).forEach((reference, index) => {
        const item = document.createElement("div");
        item.className = "chat-reference-item";

        const label = document.createElement("div");
        label.className = "chat-reference-label";
        label.textContent = `Reference ${index + 1}: ${reference.label || "Training data"}`;

        const question = document.createElement("div");
        question.className = "chat-reference-question";
        question.textContent = `Q: ${reference.question}`;

        item.appendChild(label);
        item.appendChild(question);
        referenceList.appendChild(item);
      });

      messageElement.appendChild(referenceList);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    launcher.addEventListener("click", open);
    closeButton.addEventListener("click", close);

    document.addEventListener("click", (event) => {
      const target =
        event.target instanceof Element ? event.target : event.target?.parentElement;
      const trigger = target?.closest(
        "[data-chatbot-open], a[href='#chatbot'], a[href='/#chatbot'], .chatbot-open"
      );

      if (!trigger) {
        return;
      }

      event.preventDefault();
      open();
    });

    form.addEventListener("submit", async (event) => {
      event.preventDefault();

      const prompt = input.value.trim();
      if (!prompt) {
        return;
      }

      conversation.push({ role: "user", content: prompt });
      addMessage("user", prompt);
      input.value = "";
      status.textContent = "Waiting for Claude...";
      sendButton.disabled = true;

      try {
        const response = await fetch(chatEndpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ messages: conversation }),
        });

        const data = await response.json();

        if (!response.ok) {
          const parts = [data.error || "Request failed."];
          if (data.hint) {
            parts.push(data.hint);
          }

          const error = new Error(parts.join("\n\n"));
          error.code = data.code;
          throw error;
        }

        conversation.push({ role: "assistant", content: data.reply });
        const assistantMessage = addMessage("assistant", data.reply);
        appendReferences(assistantMessage, data.references);
        status.textContent =
          data.source === "knowledge-base-fallback"
            ? "Response received from the uploaded DJP training data."
            : "Response received.";
      } catch (error) {
        addMessage("error", error.message || "Something went wrong.");
        status.textContent =
          error.code === "anthropic_insufficient_credits"
            ? "Anthropic billing or credits need attention."
            : "The request failed. Check the backend logs and API key.";
      } finally {
        sendButton.disabled = false;
        input.focus();
      }
    });

    window.ChatWidget = { open, close, endpoint: chatEndpoint };

    if (window.location.hash === "#chatbot") {
      open();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initChatWidget, { once: true });
  } else {
    initChatWidget();
  }
})();
