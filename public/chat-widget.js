(function () {
  const root = document.getElementById("chat-widget-root");
  if (!root) {
    return;
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
            Ready. Messages will be sent to the backend at <code>/chat</code>.
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
  }

  launcher.addEventListener("click", open);
  closeButton.addEventListener("click", close);

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
      const response = await fetch("/chat", {
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
      addMessage("assistant", data.reply);
      status.textContent = "Response received.";
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

  window.ChatWidget = { open, close };
})();
