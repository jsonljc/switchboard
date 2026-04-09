/**
 * Switchboard Chat Widget — self-contained embed script.
 *
 * Usage:
 *   <script
 *     src="https://your-domain.com/widget.js"
 *     data-token="YOUR_WIDGET_TOKEN"
 *     data-visitor-name="Jane"
 *     data-visitor-email="jane@example.com"
 *     data-api="https://chat-api.example.com"
 *   ></script>
 *
 * No build step required. Creates an iframe with full chat UI.
 */
(function () {
  "use strict";

  // ---------------------------------------------------------------------------
  // 1. Read configuration from the script tag
  // ---------------------------------------------------------------------------

  var scriptEl =
    document.currentScript ||
    document.querySelector("script[data-token]");

  if (!scriptEl) {
    console.error("[Switchboard] Could not locate widget script tag.");
    return;
  }

  var token = scriptEl.getAttribute("data-token");
  if (!token) {
    console.error("[Switchboard] Missing required data-token attribute.");
    return;
  }

  var visitorName = scriptEl.getAttribute("data-visitor-name") || "";
  var visitorEmail = scriptEl.getAttribute("data-visitor-email") || "";

  // Derive API base: explicit data-api, or same origin as the script src
  var apiBase = scriptEl.getAttribute("data-api") || "";
  if (!apiBase) {
    try {
      var srcUrl = new URL(scriptEl.src);
      apiBase = srcUrl.origin;
    } catch (_e) {
      apiBase = window.location.origin;
    }
  }
  // Strip trailing slash
  apiBase = apiBase.replace(/\/+$/, "");

  // ---------------------------------------------------------------------------
  // 2. Session management
  // ---------------------------------------------------------------------------

  var storageKey = "sw_session_" + token;

  function getSessionId() {
    try {
      var id = localStorage.getItem(storageKey);
      if (id) return id;
    } catch (_e) {
      // localStorage may be unavailable
    }
    var newId = "s_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    try {
      localStorage.setItem(storageKey, newId);
    } catch (_e) {
      // ignore
    }
    return newId;
  }

  var sessionId = getSessionId();

  // ---------------------------------------------------------------------------
  // 3. Build srcdoc HTML for the iframe
  // ---------------------------------------------------------------------------

  var srcdoc = [
    "<!DOCTYPE html>",
    '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    "<style>",
    "*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}",
    "body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:#1e293b;background:transparent}",

    /* Bubble trigger */
    "#sw-bubble{position:fixed;bottom:20px;right:20px;width:56px;height:56px;border-radius:50%;background:#2563eb;border:none;cursor:pointer;box-shadow:0 4px 12px rgba(37,99,235,.4);display:flex;align-items:center;justify-content:center;z-index:9999;transition:transform .2s}",
    "#sw-bubble:hover{transform:scale(1.08)}",
    "#sw-bubble svg{width:28px;height:28px;fill:#fff}",

    /* Panel */
    "#sw-panel{position:fixed;bottom:88px;right:20px;width:380px;max-width:calc(100vw - 32px);height:500px;max-height:calc(100vh - 100px);border-radius:12px;border:1px solid #e2e8f0;background:#fff;box-shadow:0 8px 30px rgba(0,0,0,.12);display:none;flex-direction:column;z-index:9999;overflow:hidden}",
    "#sw-panel.open{display:flex}",

    /* Header */
    "#sw-header{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;background:#2563eb;color:#fff;flex-shrink:0}",
    "#sw-header span{font-weight:600;font-size:15px}",
    "#sw-close{background:none;border:none;color:#fff;cursor:pointer;font-size:20px;line-height:1;padding:0 4px}",

    /* Messages */
    "#sw-messages{flex:1;overflow-y:auto;padding:12px 16px;display:flex;flex-direction:column;gap:8px}",
    ".sw-msg{max-width:80%;padding:8px 12px;border-radius:12px;line-height:1.45;word-wrap:break-word;white-space:pre-wrap}",
    ".sw-msg.visitor{align-self:flex-end;background:#2563eb;color:#fff;border-bottom-right-radius:4px}",
    ".sw-msg.agent{align-self:flex-start;background:#f1f5f9;color:#1e293b;border-bottom-left-radius:4px}",

    /* Typing indicator */
    "#sw-typing{display:none;align-self:flex-start;padding:8px 14px;background:#f1f5f9;border-radius:12px;border-bottom-left-radius:4px}",
    "#sw-typing.visible{display:flex;gap:4px;align-items:center}",
    ".sw-dot{width:6px;height:6px;border-radius:50%;background:#94a3b8;animation:sw-bounce .6s infinite alternate}",
    ".sw-dot:nth-child(2){animation-delay:.2s}",
    ".sw-dot:nth-child(3){animation-delay:.4s}",
    "@keyframes sw-bounce{0%{opacity:.4;transform:translateY(0)}100%{opacity:1;transform:translateY(-4px)}}",

    /* Input area */
    "#sw-input-area{display:flex;align-items:center;padding:10px 12px;border-top:1px solid #e2e8f0;gap:8px;flex-shrink:0}",
    "#sw-input{flex:1;border:1px solid #cbd5e1;border-radius:8px;padding:8px 12px;font-size:14px;outline:none;resize:none;font-family:inherit;line-height:1.4}",
    "#sw-input:focus{border-color:#2563eb}",
    "#sw-send{width:36px;height:36px;border-radius:8px;background:#2563eb;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0}",
    "#sw-send:disabled{opacity:.5;cursor:default}",
    "#sw-send svg{width:18px;height:18px;fill:#fff}",

    /* Footer */
    "#sw-footer{text-align:center;padding:6px;font-size:11px;color:#94a3b8;border-top:1px solid #f1f5f9;flex-shrink:0}",
    "#sw-footer a{color:#94a3b8;text-decoration:none}",
    "#sw-footer a:hover{color:#64748b}",
    "</style></head><body>",

    /* Bubble */
    '<button id="sw-bubble" aria-label="Open chat">',
    '<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>',
    "</button>",

    /* Panel */
    '<div id="sw-panel">',
    '<div id="sw-header"><span>Chat with us</span><button id="sw-close">&times;</button></div>',
    '<div id="sw-messages"><div id="sw-typing"><span class="sw-dot"></span><span class="sw-dot"></span><span class="sw-dot"></span></div></div>',
    '<div id="sw-input-area">',
    '<input id="sw-input" type="text" placeholder="Type a message…" autocomplete="off">',
    '<button id="sw-send" aria-label="Send"><svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg></button>',
    "</div>",
    '<div id="sw-footer"><a href="https://switchboard.ai" target="_blank" rel="noopener">Powered by Switchboard</a></div>',
    "</div>",

    "<script>",
    /* --- Inner iframe JS --- */
    "(function(){",
    "var panel=document.getElementById('sw-panel');",
    "var bubble=document.getElementById('sw-bubble');",
    "var closeBtn=document.getElementById('sw-close');",
    "var msgList=document.getElementById('sw-messages');",
    "var typing=document.getElementById('sw-typing');",
    "var input=document.getElementById('sw-input');",
    "var sendBtn=document.getElementById('sw-send');",
    "var isOpen=false;",

    /* Toggle */
    "function toggle(){isOpen=!isOpen;panel.classList.toggle('open',isOpen);if(isOpen){input.focus();window.parent.postMessage({sw:'opened'},'*')}else{window.parent.postMessage({sw:'closed'},'*')}}",
    "bubble.addEventListener('click',toggle);",
    "closeBtn.addEventListener('click',toggle);",

    /* Add message */
    "function addMsg(text,role){",
    "var el=document.createElement('div');",
    "el.className='sw-msg '+role;",
    "el.textContent=text;",
    "msgList.insertBefore(el,typing);",
    "msgList.scrollTop=msgList.scrollHeight;}",

    /* Show / hide typing */
    "function showTyping(v){typing.classList.toggle('visible',v);if(v)msgList.scrollTop=msgList.scrollHeight;}",

    /* Send */
    "function send(){",
    "var text=input.value.trim();",
    "if(!text)return;",
    "addMsg(text,'visitor');",
    "input.value='';",
    "window.parent.postMessage({sw:'send',text:text},'*');}",

    "sendBtn.addEventListener('click',send);",
    "input.addEventListener('keydown',function(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}});",

    /* Listen for messages from parent */
    "window.addEventListener('message',function(e){",
    "var d=e.data;if(!d||!d.sw)return;",
    "if(d.sw==='agent-msg')addMsg(d.text,'agent');",
    "if(d.sw==='typing')showTyping(d.visible);",
    "if(d.sw==='open'&&!isOpen)toggle();",
    "});",

    "})();",
    "</script></body></html>",
  ].join("\n");

  // ---------------------------------------------------------------------------
  // 4. Create and insert the iframe
  // ---------------------------------------------------------------------------

  var iframe = document.createElement("iframe");
  iframe.style.cssText =
    "position:fixed;bottom:0;right:0;width:440px;height:600px;border:none;z-index:2147483647;background:transparent;pointer-events:none;";
  iframe.setAttribute("srcdoc", srcdoc);
  iframe.setAttribute("title", "Switchboard Chat Widget");
  iframe.setAttribute("allowtransparency", "true");
  document.body.appendChild(iframe);

  // Allow clicks to pass through to the chat UI inside the iframe
  iframe.addEventListener("load", function () {
    iframe.style.pointerEvents = "auto";
  });

  // ---------------------------------------------------------------------------
  // 5. SSE connection with exponential backoff
  // ---------------------------------------------------------------------------

  var evtSource = null;
  var retryDelay = 1000;
  var maxRetryDelay = 30000;
  var panelOpen = false;

  function connectSSE() {
    if (evtSource) {
      evtSource.close();
      evtSource = null;
    }

    var url =
      apiBase +
      "/widget/" +
      encodeURIComponent(token) +
      "/events?sessionId=" +
      encodeURIComponent(sessionId);

    evtSource = new EventSource(url);

    evtSource.addEventListener("connected", function () {
      retryDelay = 1000; // reset backoff on successful connection
    });

    evtSource.addEventListener("message", function (e) {
      try {
        var data = JSON.parse(e.data);
        if (data.text && iframe.contentWindow) {
          iframe.contentWindow.postMessage({ sw: "agent-msg", text: data.text }, "*");
        }
      } catch (_e) {
        // ignore parse errors
      }
    });

    evtSource.addEventListener("typing", function () {
      if (iframe.contentWindow) {
        iframe.contentWindow.postMessage({ sw: "typing", visible: true }, "*");
        // Auto-hide after 3 seconds if no follow-up
        clearTimeout(connectSSE._typingTimer);
        connectSSE._typingTimer = setTimeout(function () {
          if (iframe.contentWindow) {
            iframe.contentWindow.postMessage({ sw: "typing", visible: false }, "*");
          }
        }, 3000);
      }
    });

    evtSource.addEventListener("error", function () {
      if (evtSource) {
        evtSource.close();
        evtSource = null;
      }
      if (panelOpen) {
        setTimeout(function () {
          connectSSE();
        }, retryDelay);
        retryDelay = Math.min(retryDelay * 2, maxRetryDelay);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // 6. Send message via POST
  // ---------------------------------------------------------------------------

  function sendMessage(text) {
    var url =
      apiBase +
      "/widget/" +
      encodeURIComponent(token) +
      "/messages";

    var body = JSON.stringify({
      sessionId: sessionId,
      text: text,
      visitor: {
        name: visitorName,
        email: visitorEmail,
      },
    });

    // Use fetch if available, fall back to XMLHttpRequest
    if (typeof fetch === "function") {
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body,
      }).catch(function () {
        // silently ignore send errors
      });
    } else {
      var xhr = new XMLHttpRequest();
      xhr.open("POST", url, true);
      xhr.setRequestHeader("Content-Type", "application/json");
      xhr.send(body);
    }
  }

  // ---------------------------------------------------------------------------
  // 7. Listen for messages from the iframe
  // ---------------------------------------------------------------------------

  window.addEventListener("message", function (e) {
    var d = e.data;
    if (!d || !d.sw) return;

    if (d.sw === "send") {
      sendMessage(d.text);
    }

    if (d.sw === "opened") {
      panelOpen = true;
      connectSSE();
    }

    if (d.sw === "closed") {
      panelOpen = false;
      if (evtSource) {
        evtSource.close();
        evtSource = null;
      }
      retryDelay = 1000;
    }
  });
})();
