import type { FastifyInstance } from "fastify";

/**
 * Serves a minimal embeddable chat widget HTML page.
 * Used as iframe src in the agent storefront: /widget/:token/embed
 */
export function registerWidgetEmbedEndpoint(app: FastifyInstance): void {
  app.get<{ Params: { token: string } }>("/widget/:token/embed", async (request, reply) => {
    reply.header("Access-Control-Allow-Origin", "*");
    reply.header("Content-Type", "text/html; charset=utf-8");

    const { token } = request.params;
    const chatServerUrl =
      process.env.CHAT_SERVER_URL || `${request.protocol}://${request.hostname}`;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Chat</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; height: 100vh; display: flex; flex-direction: column; background: #fff; color: #1a1a1a; }
    #messages { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 8px; }
    .msg { max-width: 85%; padding: 10px 14px; border-radius: 16px; font-size: 14px; line-height: 1.4; word-wrap: break-word; }
    .msg.user { align-self: flex-end; background: #2563eb; color: #fff; border-bottom-right-radius: 4px; }
    .msg.assistant { align-self: flex-start; background: #f3f4f6; color: #1a1a1a; border-bottom-left-radius: 4px; }
    .msg.typing { align-self: flex-start; background: #f3f4f6; color: #9ca3af; font-style: italic; }
    #input-area { border-top: 1px solid #e5e7eb; padding: 12px 16px; display: flex; gap: 8px; }
    #input-area input { flex: 1; padding: 10px 14px; border: 1px solid #d1d5db; border-radius: 20px; font-size: 14px; outline: none; }
    #input-area input:focus { border-color: #2563eb; }
    #input-area button { padding: 10px 20px; background: #2563eb; color: #fff; border: none; border-radius: 20px; font-size: 14px; cursor: pointer; }
    #input-area button:hover { background: #1d4ed8; }
    #input-area button:disabled { background: #93c5fd; cursor: not-allowed; }
  </style>
</head>
<body>
  <div id="messages"></div>
  <div id="input-area">
    <input type="text" id="msg-input" placeholder="Type a message..." autocomplete="off" />
    <button id="send-btn">Send</button>
  </div>
  <script>
    const TOKEN = ${JSON.stringify(token)};
    const BASE = ${JSON.stringify(chatServerUrl)};
    const SESSION_ID = sessionStorage.getItem("sw_session") || crypto.randomUUID();
    sessionStorage.setItem("sw_session", SESSION_ID);

    // fbclid capture from parent page via postMessage
    let SW_FBCLID = null;
    window.addEventListener("message", (e) => {
      if (e.data && e.data.type === "sw:init" && e.data.fbclid) {
        SW_FBCLID = e.data.fbclid;
      }
    });

    const messagesEl = document.getElementById("messages");
    const inputEl = document.getElementById("msg-input");
    const sendBtn = document.getElementById("send-btn");

    function addMessage(role, text) {
      const existing = messagesEl.querySelector(".msg.typing");
      if (existing) existing.remove();
      const div = document.createElement("div");
      div.className = "msg " + role;
      div.textContent = text;
      messagesEl.appendChild(div);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function showTyping() {
      if (messagesEl.querySelector(".msg.typing")) return;
      const div = document.createElement("div");
      div.className = "msg typing";
      div.textContent = "Typing...";
      messagesEl.appendChild(div);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    // SSE connection
    const sse = new EventSource(BASE + "/widget/" + TOKEN + "/events?sessionId=" + SESSION_ID);
    sse.addEventListener("message", (e) => { try { const d = JSON.parse(e.data); if (d.type === "message" && d.role === "assistant") addMessage("assistant", d.content); } catch {} });
    sse.addEventListener("typing", () => showTyping());

    async function sendMessage() {
      const text = inputEl.value.trim();
      if (!text) return;
      inputEl.value = "";
      addMessage("user", text);
      sendBtn.disabled = true;
      try {
        await fetch(BASE + "/widget/" + TOKEN + "/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: SESSION_ID, text, ...(SW_FBCLID ? { visitor: { fbclid: SW_FBCLID } } : {}) }),
        });
      } catch (err) { addMessage("assistant", "Failed to send. Please try again."); }
      sendBtn.disabled = false;
      inputEl.focus();
    }

    sendBtn.addEventListener("click", sendMessage);
    inputEl.addEventListener("keydown", (e) => { if (e.key === "Enter") sendMessage(); });
    inputEl.focus();
  </script>
</body>
</html>`;

    return reply.send(html);
  });
}
