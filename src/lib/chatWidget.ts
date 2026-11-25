// ============================================================
// Smart Feni AI চ্যাট উইজেট — মূল কোড (lazy)
// ChatWidget.astro শুধু বাবল দেখায়; এই ফাইল লোড হয় প্রথম ট্যাপে (বা ফোন ফাঁকা থাকলে
// কয়েক সেকেন্ড পরে)। এতে প্রতিটা পেজ খোলার সময় চ্যাটের JS/রেন্ডার কাজ হয় না।
// কোড আগে ChatWidget.astro-র <script>-এ ছিল, হুবহু সরানো হয়েছে।
// ============================================================
import { supabase } from "./supabase.js";

type Sender = "bot" | "user";
interface StoredMsg {
  sender: Sender;
  text: string;
  time: number;
  feedback?: "up" | "down" | null;
  // AI-র তৈরি ম্যানুয়াল অর্ডারের ড্রাফট (ইউজার কনফার্ম বাটনে জমা দেয়)
  draft?: any;
  draftState?: "pending" | "done" | "cancelled";
}

// সাইটের মূল ব্যবহার শেখানোর জন্য প্রাসঙ্গিক quick reply (আইকন + লেবেল)
const QUICK_REPLIES: { icon: string; label: string; query: string }[] = [
  { icon: "📋", label: "লিস্টিং পোস্ট", query: "কীভাবে লিস্টিং পোস্ট করব?" },
  { icon: "🩸", label: "ব্লাড ডোনার", query: "ব্লাড ডোনার কীভাবে খুঁজব?" },
  { icon: "📍", label: "আমার উপজেলা", query: "আমার উপজেলায় কী সার্ভিস আছে?" },
  { icon: "👤", label: "অ্যাকাউন্ট", query: "অ্যাকাউন্ট কীভাবে খুলব?" },
  { icon: "☎️", label: "যোগাযোগ", query: "যোগাযোগ নম্বর কী?" },
];

const STORAGE_KEY = "sf_chat_messages_v2";
const GREETING =
  "আজ কীভাবে সাহায্য করতে পারি?\n\nফেনীর বিভিন্ন সেবা, ব্যবসা ও তথ্য খুঁজে পেতে আমি সাহায্য করতে পারি। আমাকে জিজ্ঞেস করুন।";

// ইনলাইন স্টাইল কনস্ট্যান্ট — Astro scoped CSS dynamically তৈরি এলিমেন্টে
// কাজ করে না, তাই সব সাইজ/স্পেসিং এখানে সরাসরি সেট করা হয়
const STYLE = {
  rowUser: "display:flex;flex-direction:column;max-width:86%;align-self:flex-end;align-items:flex-end;",
  rowBot: "display:flex;flex-direction:column;max-width:88%;align-self:flex-start;align-items:flex-start;",
  bubbleBase:
    "padding:9px 12px;border-radius:12px;font-size:14px;line-height:1.5;white-space:pre-line;word-break:break-word;",
  bubbleBot: "background:#fff;border:1px solid #e2ece4;border-bottom-left-radius:3px;color:#1B2A4A;",
  bubbleUser: "background:#1F9254;border-bottom-right-radius:3px;color:#fff;",
  time: "font-size:10.5px;color:#9aa0aa;margin-top:3px;padding:0 3px;",
  linkCard:
    "display:inline-flex;align-items:center;gap:6px;margin-top:6px;padding:8px 12px;background:#EAF7EE;border:1px solid #BFE6CC;border-radius:8px;text-decoration:none;color:#14532D;font-size:13px;font-weight:600;max-width:100%;",
  linkIcon: "width:14px;height:14px;color:#1F9254;flex-shrink:0;",
  feedbackRow: "display:flex;gap:2px;margin-top:2px;",
  fbBtn:
    "background:transparent;border:none;cursor:pointer;width:22px;height:22px;padding:0;border-radius:5px;display:flex;align-items:center;justify-content:center;color:#c2c6cd;",
  fbBtnActiveUp: "color:#2e9e5b;",
  fbBtnActiveDown: "color:#d9534f;",
  typingWrap:
    "display:flex;gap:4px;align-items:center;padding:10px 13px;background:#fff;border:1px solid #e2ece4;border-radius:12px;border-bottom-left-radius:3px;width:fit-content;",
  typingDot: "width:6px;height:6px;border-radius:50%;background:#c2c6cd;",
  quickBtn:
    "flex:0 0 auto;scroll-snap-align:start;display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;white-space:nowrap;background:#F6FAF7;color:#14532D;border:1px solid #d7ecdc;border-radius:20px;padding:8px 13px;cursor:pointer;",
  quickIcon: "font-size:14px;line-height:1;",
  draftRow: "display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;",
  draftPrimary:
    "background:#1F9254;color:#fff;border:none;border-radius:8px;padding:9px 14px;font-size:13px;font-weight:700;cursor:pointer;",
  draftGhost:
    "background:#fff;color:#14532D;border:1px solid #BFE6CC;border-radius:8px;padding:9px 14px;font-size:13px;font-weight:600;cursor:pointer;",
  draftNote: "font-size:12px;color:#9aa0aa;margin-top:6px;",
  startCaption: "font-size:12px;color:#5b6b60;margin-top:8px;",
  startOrder:
    "display:flex;align-items:center;justify-content:center;gap:8px;width:100%;margin-top:4px;background:#FF6B35;color:#fff;border:none;border-radius:10px;padding:11px 14px;font-size:14px;font-weight:700;cursor:pointer;box-shadow:0 3px 10px rgba(255,107,53,0.28);",
};


let started: { open: () => void } | null = null;

export function initChatWidget() {
  if (started) return started;
  started = (() => {
    const toggle = document.getElementById("sf-chat-toggle")!;
    const panel = document.getElementById("sf-chat-panel")!;
    const panelClose = document.getElementById("sf-chat-panel-close")!;
    const resetBtn = document.getElementById("sf-chat-reset")!;
    const iconChat = document.getElementById("sf-icon-chat")!;
    const iconClose = document.getElementById("sf-icon-close")!;
    const messages = document.getElementById("sf-chat-messages")!;
    const form = document.getElementById("sf-chat-form") as HTMLFormElement;
    const input = document.getElementById("sf-chat-input") as HTMLInputElement;
    const submitBtn = form.querySelector('button[type="submit"]') as HTMLButtonElement;
    const quickWrap = document.getElementById("sf-chat-quick")!;

    let opened = false;
    let isSending = false;
    let store: StoredMsg[] = loadStore();

    function loadStore(): StoredMsg[] {
      try {
        const raw = sessionStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }

    function saveStore() {
      try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(store));
      } catch {
        // storage unavailable — চ্যাট তবুও কাজ করবে, শুধু persist হবে না
      }
    }

    function formatTime(ts: number) {
      return new Date(ts).toLocaleTimeString("bn-BD", { hour: "2-digit", minute: "2-digit" });
    }

    function buildHistoryPayload() {
      return store
        .filter((m) => m.text && m.text.trim().length > 0)
        .slice(-20)
        .map((m) => ({ role: m.sender === "user" ? "user" : "model", text: m.text }));
    }

    function extractLink(text: string): { clean: string; label: string | null; href: string | null } {
      const match = text.match(/\[LINK\]([^|\n]+)\|(\/[a-zA-Z0-9\-\/]+)/);
      if (!match) return { clean: text, label: null, href: null };
      const clean = text.replace(match[0], "").trim();
      return { clean, label: match[1].trim(), href: match[2].trim() };
    }

    // চ্যাটের শুরুর গ্রিটিংয়ের নিচে অর্ডারের কুইক-স্টার্ট বাটন
    function renderStartOrderButton(row: HTMLElement) {
      const caption = document.createElement("div");
      caption.setAttribute("style", STYLE.startCaption);
      caption.textContent = "কিছু আনাতে বা পাঠাতে চান?";
      row.appendChild(caption);

      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("style", STYLE.startOrder);
      btn.textContent = "🛵 অর্ডার করুন";
      btn.addEventListener("click", () => handleUserText("আমি একটা ডেলিভারি অর্ডার দিতে চাই"));
      row.appendChild(btn);
    }

    async function getToken(): Promise<string> {
      try {
        const { data } = await supabase.auth.getSession();
        return data?.session?.access_token || "";
      } catch {
        return "";
      }
    }

    // অর্ডার ড্রাফটের কনফার্ম / বদলাব বাটন
    function renderDraftActions(row: HTMLElement, msg: StoredMsg, index: number) {
      if (!msg.draft) return;

      if (msg.draftState !== "pending") {
        const note = document.createElement("div");
        note.setAttribute("style", STYLE.draftNote);
        note.textContent = msg.draftState === "done" ? "অর্ডার জমা হয়েছে" : "এই ড্রাফট বাতিল করা হয়েছে";
        row.appendChild(note);
        return;
      }

      const wrap = document.createElement("div");
      wrap.setAttribute("style", STYLE.draftRow);

      const okBtn = document.createElement("button");
      okBtn.type = "button";
      okBtn.setAttribute("style", STYLE.draftPrimary);
      okBtn.textContent = "✅ অর্ডার কনফার্ম করুন";

      const editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.setAttribute("style", STYLE.draftGhost);
      editBtn.textContent = "✏️ বদলাতে চাই";

      okBtn.addEventListener("click", async () => {
        if (okBtn.disabled) return;
        okBtn.disabled = true;
        editBtn.disabled = true;
        okBtn.textContent = "জমা হচ্ছে...";
        try {
          const token = await getToken();
          const res = await fetch("/api/chat-order", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ draft: msg.draft }),
          });
          const data = await res.json();
          if (data?.ok) {
            msg.draftState = "done";
            store[index] = msg;
            saveStore();
            renderAll();
            addMessage(data.message, "bot");
          } else {
            okBtn.disabled = false;
            editBtn.disabled = false;
            okBtn.textContent = "✅ অর্ডার কনফার্ম করুন";
            addMessage(data?.message || "দুঃখিত, অর্ডারটি জমা দেওয়া যায়নি। আবার চেষ্টা করুন।", "bot");
          }
        } catch {
          okBtn.disabled = false;
          editBtn.disabled = false;
          okBtn.textContent = "✅ অর্ডার কনফার্ম করুন";
          addMessage("দুঃখিত, ইন্টারনেট সংযোগে সমস্যা হচ্ছে। আবার চেষ্টা করুন।", "bot");
        }
      });

      editBtn.addEventListener("click", () => {
        msg.draftState = "cancelled";
        store[index] = msg;
        saveStore();
        renderAll();
        addMessage("ঠিক আছে, কোন তথ্যটা বদলাতে চান বলুন।", "bot");
      });

      wrap.appendChild(okBtn);
      wrap.appendChild(editBtn);
      row.appendChild(wrap);
    }

    function renderMessage(msg: StoredMsg, index: number) {
      const row = document.createElement("div");
      row.setAttribute("style", msg.sender === "user" ? STYLE.rowUser : STYLE.rowBot);

      const bubble = document.createElement("div");
      bubble.setAttribute(
        "style",
        STYLE.bubbleBase + (msg.sender === "user" ? STYLE.bubbleUser : STYLE.bubbleBot)
      );

      if (msg.sender === "bot") {
        const { clean, label, href } = extractLink(msg.text);
        bubble.textContent = clean;
        row.appendChild(bubble);
        renderDraftActions(row, msg, index);
        if (index === 0 && msg.text === GREETING) renderStartOrderButton(row);

        if (label && href) {
          const card = document.createElement("a");
          card.setAttribute("style", STYLE.linkCard);
          card.href = href;
          // label মডেলের আউটপুট — তাই textContent দিয়ে বসানো (innerHTML নয়), HTML ঢোকার সুযোগ নেই
          const labelEl = document.createElement("span");
          labelEl.textContent = label;
          card.appendChild(labelEl);
          card.insertAdjacentHTML(
            "beforeend",
            `<svg style="${STYLE.linkIcon}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><path d="M5 12h14M13 5l7 7-7 7"/></svg>`
          );
          row.appendChild(card);
        }

        const time = document.createElement("div");
        time.setAttribute("style", STYLE.time);
        time.textContent = formatTime(msg.time);
        row.appendChild(time);

        const fb = document.createElement("div");
        fb.setAttribute("style", STYLE.feedbackRow);

        const upBtn = document.createElement("button");
        upBtn.type = "button";
        const downBtn = document.createElement("button");
        downBtn.type = "button";

        function applyFbState() {
          upBtn.setAttribute(
            "style",
            STYLE.fbBtn + (msg.feedback === "up" ? STYLE.fbBtnActiveUp : "")
          );
          downBtn.setAttribute(
            "style",
            STYLE.fbBtn + (msg.feedback === "down" ? STYLE.fbBtnActiveDown : "")
          );
          upBtn.disabled = !!msg.feedback;
          downBtn.disabled = !!msg.feedback;
        }

        upBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 10v11M15 5.88 14 10h6.29a2 2 0 0 1 1.94 2.5l-1.83 7A2 2 0 0 1 18.46 21H8a2 2 0 0 1-2-2v-8a2 2 0 0 1 .59-1.42L12 4a2 2 0 0 1 3 1.88Z"/></svg>`;
        downBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 14V3M9 18.12 10 14H3.71a2 2 0 0 1-1.94-2.5l1.83-7A2 2 0 0 1 5.54 3H16a2 2 0 0 1 2 2v8a2 2 0 0 1-.59 1.42L12 20a2 2 0 0 1-3-1.88Z"/></svg>`;

        applyFbState();

        upBtn.addEventListener("click", () => {
          if (msg.feedback) return;
          msg.feedback = "up";
          store[index] = msg;
          saveStore();
          applyFbState();
        });
        downBtn.addEventListener("click", () => {
          if (msg.feedback) return;
          msg.feedback = "down";
          store[index] = msg;
          saveStore();
          applyFbState();
        });

        fb.appendChild(upBtn);
        fb.appendChild(downBtn);
        row.appendChild(fb);
      } else {
        bubble.textContent = msg.text;
        row.appendChild(bubble);
        const time = document.createElement("div");
        time.setAttribute("style", STYLE.time);
        time.textContent = formatTime(msg.time);
        row.appendChild(time);
      }

      messages.appendChild(row);
    }

    function renderAll() {
      messages.innerHTML = "";
      store.forEach((m, i) => renderMessage(m, i));
      messages.scrollTop = messages.scrollHeight;
    }

    function addMessage(text: string, sender: Sender, draft?: any) {
      const msg: StoredMsg = {
        sender,
        text,
        time: Date.now(),
        feedback: null,
        ...(draft ? { draft, draftState: "pending" as const } : {}),
      };
      store.push(msg);
      saveStore();
      renderMessage(msg, store.length - 1);
      messages.scrollTop = messages.scrollHeight;
    }

    function showTyping() {
      const row = document.createElement("div");
      row.id = "sf-typing-row";
      row.setAttribute("style", STYLE.rowBot);
      const wrap = document.createElement("div");
      wrap.setAttribute("style", STYLE.typingWrap);
      for (let i = 0; i < 3; i++) {
        const dot = document.createElement("span");
        dot.setAttribute("style", STYLE.typingDot + `animation:sfBlink 1.2s infinite ease-in-out;animation-delay:${i * 0.2}s;`);
        wrap.appendChild(dot);
      }
      row.appendChild(wrap);
      messages.appendChild(row);
      messages.scrollTop = messages.scrollHeight;
    }

    function hideTyping() {
      document.getElementById("sf-typing-row")?.remove();
    }

    function setSending(next: boolean) {
      isSending = next;
      input.disabled = next;
      submitBtn.disabled = next;
      quickWrap.querySelectorAll("button").forEach((b) => {
        (b as HTMLButtonElement).disabled = next;
      });
    }

    function setOpen(next: boolean) {
      opened = next;
      panel.classList.toggle("sf-open", opened);
      iconChat.style.display = opened ? "none" : "block";
      iconClose.style.display = opened ? "block" : "none";
      if (opened && store.length === 0) {
        addMessage(GREETING, "bot");
      }
    }

    function resetChat() {
      store = [];
      saveStore();
      messages.innerHTML = "";
      addMessage(GREETING, "bot");
      input.focus();
    }

    async function handleUserText(text: string) {
      if (!text.trim() || isSending) return;
      const historyPayload = buildHistoryPayload();
      addMessage(text, "user");
      setSending(true);
      showTyping();

      try {
        // লগইন থাকলে টোকেন পাঠানো হয় — সার্ভার যাচাই করে অর্ডার-সুবিধা চালু করে
        const token = await getToken();
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ message: text, history: historyPayload }),
        });
        const data = await res.json();
        hideTyping();
        addMessage(
          data?.reply || "দুঃখিত, উত্তর দিতে সমস্যা হয়েছে। আবার চেষ্টা করুন।",
          "bot",
          data?.order_draft
        );
      } catch (err) {
        hideTyping();
        addMessage(
          "দুঃখিত, ইন্টারনেট সংযোগে সমস্যা হচ্ছে। একটু পরে আবার চেষ্টা করুন।",
          "bot"
        );
      } finally {
        setSending(false);
        input.focus();
      }
    }

    QUICK_REPLIES.forEach((q) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.setAttribute("style", STYLE.quickBtn);
      btn.innerHTML = `<span style="${STYLE.quickIcon}">${q.icon}</span><span>${q.label}</span>`;
      btn.addEventListener("click", () => handleUserText(q.query));
      quickWrap.appendChild(btn);
    });

    if (store.length > 0) {
      renderAll();
    }

    toggle.addEventListener("click", () => setOpen(!opened));
    panelClose.addEventListener("click", () => setOpen(false));
    resetBtn.addEventListener("click", () => {
      if (isSending) return;
      resetChat();
    });

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const text = input.value;
      input.value = "";
      handleUserText(text);
    });

    return { open: () => setOpen(true) };
  })();
  return started;
}
