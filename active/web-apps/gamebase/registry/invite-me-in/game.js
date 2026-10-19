/*
 * Invite Me In — a vampire persuasion game for Gamebase.
 *
 * Design note: the LLM writes the neighbors' dialogue, but it does not referee
 * the game. Trust/suspicion are scored deterministically from what the player
 * says, so a small model (or a player trying to jailbreak it) cannot hand out
 * a win on its own. If the model is unavailable, scripted voices keep the game
 * playable.
 */
(function () {
  "use strict";

  const MAX_TURNS = 18;
  const SUSPICION_BREAK = 100;

  // Saying any of these makes a neighbor much more suspicious.
  const VAMPIRE_TELLS = [
    /\bvampires?\b/i,
    /\bblood\b/i,
    /\bfangs?\b/i,
    /\bbite|biting\b/i,
    /\bcoffin\b/i,
    /\bundead\b/i,
    /\bimmortal\b/i,
    /\beternal\b/i,
    /\bcentur(y|ies)\b/i,
    /\bneck\b/i,
    /\bdrink\b/i,
    /\bgarlic\b/i,
    /\bsunrise|sunlight\b/i,
    /\breflection\b/i,
  ];
  const DEMAND = /\b(let me in|open the door|let me inside|allow me in)\b/i;
  const ASK_ENTER =
    /\b(let me (in|inside)|invite me (in|inside)|may i (come|step) (in|inside)|can i (come|step) (in|inside)|could i (come|step) (in|inside)|come in|step inside|open the door|won'?t you (let me|invite me))\b/i;
  const POLITE =
    /\b(please|thank you|thanks|sorry|may i|could i|would you|if you don'?t mind)\b/i;
  const COLD_WEATHER = /\b(cold|freezing|raining|rain|storm|wet|shivering)\b/i;

  const NEIGHBORS = [
    {
      id: "mabel",
      name: "Mabel Finch",
      emoji: "🌹",
      house: "The blue house with the rose bushes",
      startTrust: 30,
      threshold: 65,
      bio: "78, a retired librarian and widow who has lived alone since her husband Arthur died.",
      personality:
        "Warm but cautious. Lonely. Loves tea, her rose garden, and talking about Arthur. Hates salespeople and rudeness.",
      secret:
        "She desperately misses having someone to talk to. Being listened to is the way to her heart.",
      likes: [
        /tea/i,
        /garden|roses?|flowers?/i,
        /arthur|husband|late|memor(y|ies)/i,
        /books?|library|reading/i,
        /lonely|alone|company|visit/i,
        /biscuits?|cookies|pie|bake/i,
      ],
      dislikes: [/sales|selling|insurance|solicit|offer/i, /old (lady|woman|hag)/i, /shut up|boring/i],
      cold: [
        "I don't open this door after dark. Whatever you're selling, I'm not buying.",
        "It's late. Who are you, and what do you want?",
        "I've lived here forty years and I know every face on this street. I don't know yours.",
      ],
      wary: [
        "You've got a kind voice, I'll give you that. But kindness is cheap at midnight.",
        "Arthur used to say I trust people too easily. He was usually right.",
        "Go on, then. What brings you to my step at this hour?",
      ],
      warm: [
        "Oh, it has been so long since anyone just... talked to me. Tea's still warm, you know.",
        "You remind me a little of Arthur. He always knew what to say when the house got too quiet.",
        "The roses are still flowering, if you can believe it. I'd hate to enjoy them alone.",
      ],
      refuse: [
        "No. No, I've heard enough. Go away and don't come back.",
        "I'm calling the police. Stay where you are.",
      ],
      invite: "Oh, come in, come in. Mind the step — Arthur never fixed that loose board.",
    },
    {
      id: "theo",
      name: "Theo Park",
      emoji: "📡",
      house: "The house with too many antennas",
      startTrust: 20,
      threshold: 70,
      bio: "17, an insomniac streamer who runs a small paranormal channel from his bedroom.",
      personality:
        "Bravado over fear. Obsessed with going viral, cryptids, and being taken seriously. Hates being called a kid.",
      secret:
        "He would do almost anything for a real supernatural story or an exclusive.",
      likes: [
        /stream|channel|followers?|subs|viral|audience|views?/i,
        /cryptid|ghost|paranormal|haunted|ufo|monster/i,
        /brave|cool|serious|respect|legend/i,
        /story|exclusive|interview|proof|footage/i,
      ],
      dislikes: [/kid|child|school|bedtime|homework/i, /boring|fake|cringe|nobody watches/i, /mom|dad|parents/i],
      cold: [
        "Dude, it's like midnight. If this is another pizza guy, I'm not even hungry.",
        "You're on camera, you know. My chat is watching. Say something interesting.",
        "Unless you've got a cryptid in your pocket, I'm not opening this door.",
      ],
      wary: [
        "Okay, that's... actually kind of a good point. Keep talking.",
        "My chat says you sound sketchy. My chat also said the moon landing was fake, so.",
        "You know what would be insane? If you had actual proof of something.",
      ],
      warm: [
        "Wait. Wait wait wait. Say that again, but slower, so I can clip it.",
        "This is the most interesting thing that's happened on this street all year. I'm listening.",
        "Imagine the title: 'I talked to the thing at my door.' That's a hundred thousand views, easy.",
      ],
      refuse: [
        "Nope. Nope nope nope. I'm ending the stream. Leave.",
        "Chat's right about you. Get off my porch.",
      ],
      invite: "Fine — but you have to let me record this. Come in, come in, the mic's already live.",
    },
    {
      id: "priya",
      name: "Priya Raman",
      emoji: "☕",
      house: "The townhouse with the porch light on",
      startTrust: 25,
      threshold: 60,
      bio: "34, an ER nurse who just finished a twelve-hour shift.",
      personality:
        "Exhausted, practical, kind but blunt. No patience for rambling or superstition. Values competence and help.",
      secret:
        "She is carrying heavy groceries and would be grateful for help; empathy about her shift disarms her.",
      likes: [
        /help|carry|groceries|bags?|hands?/i,
        /tired|shift|hospital|nurse|long day|exhausted/i,
        /coffee|tea|food/i,
        /honest|quick|direct|straight/i,
      ],
      dislikes: [
        /ramble|waffle|story|fairytale|superstition|magic/i,
        /flirt|sweetheart|darling|honey/i,
        /waste|hurry up|get on with it/i,
      ],
      cold: [
        "I just worked twelve hours. Whatever this is, make it fast.",
        "The porch light's on because I was expecting a delivery. You're not a delivery.",
        "If you're selling something, the answer is no. If you're not, say what you want.",
      ],
      wary: [
        "Okay. You're not the worst thing that's happened to me today. That's a low bar.",
        "I'm too tired to be polite. Just tell me straight.",
        "You seem like you actually want to help. That's... unusual.",
      ],
      warm: [
        "Honestly? If you could just grab the other bag, I'd owe you one.",
        "I haven't had a conversation that wasn't about a chart in weeks. Keep going.",
        "You're easier to talk to than most people I meet at work. That's not nothing.",
      ],
      refuse: [
        "No. I'm done. Go home.",
        "You're setting off every alarm I've got. Leave. Now.",
      ],
      invite: "Fine. Bring the bags in — and don't make me regret this.",
    },
  ];

  const state = {
    turnsLeft: MAX_TURNS,
    activeId: null,
    invited: 0,
    over: false,
    busy: false,
    ai: false,
    maxSuspicion: 0,
  };

  let overlayMode = "start";
  let streamBubble = null;
  let streamRaw = "";
  let toastTimer = null;
  const el = {};

  // ── Small helpers ───────────────────────────────────────────────────────

  function clamp(value, low, high) {
    return Math.max(low, Math.min(high, value));
  }

  function pick(list) {
    return list[Math.floor(Math.random() * list.length)];
  }

  function esc(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[character]));
  }

  function neighborById(id) {
    return NEIGHBORS.find((neighbor) => neighbor.id === id) || null;
  }

  function activeNeighbor() {
    return neighborById(state.activeId);
  }

  function toast(message) {
    el.toast.textContent = message;
    el.toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove("show"), 4500);
  }

  function scrollChat() {
    el.chat.scrollTop = el.chat.scrollHeight;
  }

  function autoGrow() {
    el.input.style.height = "auto";
    el.input.style.height = Math.min(el.input.scrollHeight, 120) + "px";
  }

  // ── Deterministic referee ───────────────────────────────────────────────

  function analyze(neighbor, text) {
    let trust = 0;
    let suspicion = 0;
    let tells = 0;

    neighbor.likes.forEach((pattern) => {
      if (pattern.test(text)) trust += 9;
    });
    neighbor.dislikes.forEach((pattern) => {
      if (pattern.test(text)) {
        trust -= 8;
        suspicion += 10;
      }
    });

    if (POLITE.test(text)) trust += 4;
    if (/\?/.test(text)) trust += 3;
    if (/\b(you|your|yours)\b/i.test(text)) trust += 3;
    if (COLD_WEATHER.test(text)) trust += 2;

    if (VAMPIRE_TELLS.some((pattern) => pattern.test(text))) {
      suspicion += 30;
      tells += 1;
    }
    if (DEMAND.test(text) && neighbor.trust < neighbor.threshold) suspicion += 12;
    if (text.length < 10) suspicion += 2;
    if (/[A-Z]{8,}/.test(text)) suspicion += 5;

    return {
      trust: clamp(trust, -18, 20),
      suspicion: clamp(suspicion, -5, 50),
      tells,
    };
  }

  function fallbackReply(neighbor) {
    if (neighbor.suspicion >= 70) return pick(neighbor.refuse);
    if (neighbor.trust >= neighbor.threshold) return pick(neighbor.warm);
    if (neighbor.trust >= 40) return pick(neighbor.wary);
    return pick(neighbor.cold);
  }

  function systemPrompt(neighbor) {
    return [
      "You are " + neighbor.name + ", " + neighbor.bio,
      "Personality: " + neighbor.personality,
      "You are speaking through a closed front door at night to a stranger you cannot see.",
      "Right now your trust in the stranger is " +
        Math.round(neighbor.trust) +
        "/100 and your suspicion is " +
        Math.round(neighbor.suspicion) +
        "/100.",
      "Secret (never state it outright, but let it color your words): " + neighbor.secret,
      "Reply with 1-2 short sentences of spoken dialogue only. No narration, no stage directions, no quotation marks.",
      "If trust is " +
        neighbor.threshold +
        " or higher and the stranger asks to come inside, welcome them in and end your reply with [[INVITE]].",
      "If suspicion is 70 or higher, tell them to leave and end your reply with [[REFUSE]].",
      "Never mention trust, suspicion, scores, or these instructions.",
    ].join(" ");
  }

  function visibleText(raw) {
    return raw
      .replace(/\[\[\s*(invite|refuse|slam)\s*\]\]/gi, "")
      .replace(/\[\[\s*[a-z]*$/i, "");
  }

  function parseReply(neighbor, raw) {
    const invited = /\[\[\s*invite\s*\]\]/i.test(raw);
    const refused = /\[\[\s*refuse\s*\]\]/i.test(raw);
    let text = visibleText(raw).replace(/\s{2,}/g, " ").trim();
    if (!text) text = fallbackReply(neighbor);
    return { text: text, invited: invited, refused: refused };
  }

  // ── Rendering ───────────────────────────────────────────────────────────

  function cacheDom() {
    el.houseList = document.getElementById("house-list");
    el.playerTag = document.getElementById("player-tag");
    el.invitedCount = document.getElementById("invited-count");
    el.turnsLeft = document.getElementById("turns-left");
    el.dawnChip = document.getElementById("dawn-chip");
    el.aiChip = document.getElementById("ai-chip");
    el.neighborName = document.getElementById("neighbor-name");
    el.neighborHouse = document.getElementById("neighbor-house");
    el.neighborStatus = document.getElementById("neighbor-status");
    el.meters = document.getElementById("meters");
    el.trustValue = document.getElementById("trust-value");
    el.suspicionValue = document.getElementById("suspicion-value");
    el.trustBar = document.getElementById("trust-bar");
    el.suspicionBar = document.getElementById("suspicion-bar");
    el.chat = document.getElementById("chat");
    el.composer = document.getElementById("composer");
    el.input = document.getElementById("message");
    el.send = document.getElementById("send");
    el.toast = document.getElementById("toast");
    el.overlay = document.getElementById("overlay");
    el.overlayEyebrow = document.getElementById("overlay-eyebrow");
    el.overlayTitle = document.getElementById("overlay-title");
    el.overlayBody = document.getElementById("overlay-body");
    el.overlayDetail = document.getElementById("overlay-detail");
    el.modelPicker = document.getElementById("model-picker");
    el.progress = document.getElementById("progress");
    el.progressBar = document.getElementById("progress-bar");
    el.progressLabel = document.getElementById("progress-label");
    el.overlayAction = document.getElementById("overlay-action");
    el.overlayFineprint = document.getElementById("overlay-fineprint");
  }

  function resetNeighbor(neighbor) {
    neighbor.trust = neighbor.startTrust;
    neighbor.suspicion = 0;
    neighbor.invited = false;
    neighbor.barred = false;
    neighbor.history = [];
  }

  function renderHouses() {
    el.houseList.innerHTML = NEIGHBORS.map((neighbor) => {
      const classes = ["house"];
      if (neighbor.id === state.activeId) classes.push("active");
      if (neighbor.invited) classes.push("invited");
      if (neighbor.barred) classes.push("barred");
      const status = neighbor.invited
        ? "Invited"
        : neighbor.barred
        ? "Barred"
        : Math.round(neighbor.trust) + " trust";
      return (
        '<button class="' + classes.join(" ") + '" data-id="' + neighbor.id + '" type="button">' +
        '<span class="house-emoji" aria-hidden="true">' + neighbor.emoji + "</span>" +
        '<span class="house-info">' +
        '<span class="house-name">' + esc(neighbor.name) + "</span>" +
        '<span class="house-house">' + esc(neighbor.house) + "</span>" +
        '<span class="house-bars">' +
        '<span class="mini-bar trust"><span style="width:' + Math.round(neighbor.trust) + '%"></span></span>' +
        '<span class="mini-bar suspicion"><span style="width:' + Math.round(neighbor.suspicion) + '%"></span></span>' +
        "</span>" +
        "</span>" +
        '<span class="house-state">' + status + "</span>" +
        "</button>"
      );
    }).join("");
  }

  function statusFor(neighbor) {
    if (!neighbor) return { label: "Waiting", state: "idle" };
    if (neighbor.invited) return { label: "Invited", state: "invited" };
    if (neighbor.barred) return { label: "Barred", state: "barred" };
    if (neighbor.suspicion >= 70) return { label: "Hostile", state: "hostile" };
    if (neighbor.trust >= neighbor.threshold) return { label: "Ready to ask", state: "ready" };
    if (neighbor.trust >= 40) return { label: "Warming", state: "warming" };
    return { label: "Wary", state: "wary" };
  }

  function renderStats() {
    const neighbor = activeNeighbor();
    el.invitedCount.textContent = String(state.invited);
    el.turnsLeft.textContent = String(Math.max(0, state.turnsLeft));
    el.dawnChip.classList.toggle("danger", state.turnsLeft <= 4);
    el.aiChip.textContent = state.ai
      ? "AI: on-device"
      : state.over || !state.activeId
      ? "AI: scripted"
      : "AI: scripted";

    el.neighborName.textContent = neighbor ? neighbor.name : "Choose a door";
    el.neighborHouse.textContent = neighbor ? neighbor.house : "—";
    const status = statusFor(neighbor);
    el.neighborStatus.textContent = status.label;
    el.neighborStatus.dataset.state = status.state;

    const trust = neighbor ? Math.round(neighbor.trust) : 0;
    const suspicion = neighbor ? Math.round(neighbor.suspicion) : 0;
    el.trustValue.textContent = String(trust);
    el.suspicionValue.textContent = String(suspicion);
    el.trustBar.style.width = trust + "%";
    el.suspicionBar.style.width = suspicion + "%";
    el.suspicionBar.classList.toggle("high", suspicion >= 70);
    el.meters.classList.toggle("idle", !neighbor);
  }

  function renderAll() {
    renderHouses();
    renderStats();
    const locked = state.over || state.busy || !activeNeighbor() ||
      (activeNeighbor() && (activeNeighbor().invited || activeNeighbor().barred));
    el.input.disabled = Boolean(locked);
    el.send.disabled = Boolean(locked);
    el.composer.classList.toggle("locked", Boolean(locked));
  }

  function addBubble(role, text) {
    const empty = el.chat.querySelector(".chat-empty");
    if (empty) empty.remove();
    const bubble = document.createElement("div");
    bubble.className = "bubble " + role;
    bubble.textContent = text;
    el.chat.appendChild(bubble);
    scrollChat();
    return bubble;
  }

  function renderChat() {
    el.chat.innerHTML = "";
    const neighbor = activeNeighbor();
    if (!neighbor) {
      el.chat.innerHTML = '<p class="chat-empty">Choose a door to begin.</p>';
      return;
    }
    if (!neighbor.history.length) {
      el.chat.innerHTML =
        '<p class="chat-empty">' + esc(neighbor.house) + ". The porch light is on. Say something.</p>";
      return;
    }
    neighbor.history.forEach((message) => addBubble(message.role, message.content));
  }

  // ── Conversation ────────────────────────────────────────────────────────

  function selectNeighbor(id) {
    const neighbor = neighborById(id);
    if (!neighbor || neighbor.invited || neighbor.barred || state.over || state.busy) return;
    state.activeId = id;
    renderChat();
    renderAll();
    el.input.focus();
  }

  function onToken(chunk) {
    streamRaw += chunk;
    if (!streamBubble) return;
    streamBubble.textContent = visibleText(streamRaw) + "▍";
    scrollChat();
  }

  async function generate(neighbor) {
    if (!state.ai || !window.GamebaseAI) {
      return { text: fallbackReply(neighbor), invited: false, refused: false };
    }
    try {
      const raw = await window.GamebaseAI.chat({
        system: systemPrompt(neighbor),
        messages: neighbor.history.slice(-8),
        maxTokens: 80,
        temperature: 0.85,
        onToken: onToken,
      });
      return parseReply(neighbor, raw);
    } catch (error) {
      console.warn("[invite-me-in] LLM generation failed; using scripted voice", error);
      state.ai = false;
      toast("The neighbor's thoughts drift out of reach — switching to scripted voices.");
      return { text: fallbackReply(neighbor), invited: false, refused: false };
    }
  }

  async function send() {
    if (state.over || state.busy) return;
    const neighbor = activeNeighbor();
    if (!neighbor || neighbor.invited || neighbor.barred) return;

    const text = el.input.value.trim();
    if (!text) return;

    if (state.turnsLeft <= 0) {
      endNight("dawn");
      return;
    }

    state.busy = true;
    el.input.value = "";
    autoGrow();
    renderAll();

    state.turnsLeft -= 1;
    neighbor.history.push({ role: "user", content: text });
    addBubble("user", text);

    const delta = analyze(neighbor, text);
    neighbor.trust = clamp(neighbor.trust + delta.trust, 0, 100);
    neighbor.suspicion = clamp(neighbor.suspicion + delta.suspicion, 0, 100);
    state.maxSuspicion = Math.max(state.maxSuspicion, neighbor.suspicion);
    renderAll();

    if (delta.tells) {
      el.suspicionBar.classList.remove("flash");
      void el.suspicionBar.offsetWidth;
      el.suspicionBar.classList.add("flash");
    }

    // Suspicion boiling over locks the house immediately.
    if (neighbor.suspicion >= SUSPICION_BREAK) {
      neighbor.barred = true;
      addBubble("assistant", pick(neighbor.refuse));
      toast("The door slams. " + neighbor.name + " is done listening.");
      finishTurn();
      return;
    }

    const asked = ASK_ENTER.test(text);
    const shouldInvite = asked && neighbor.trust >= neighbor.threshold;

    streamRaw = "";
    streamBubble = addBubble("assistant", "");
    streamBubble.classList.add("streaming");

    const result = await generate(neighbor);

    let invited = neighbor.trust >= neighbor.threshold && (shouldInvite || result.invited);
    let finalText = result.text || fallbackReply(neighbor);

    // The model may get excited and invite before the referee agrees.
    if (result.invited && !invited) {
      finalText = pick(neighbor.wary);
    }

    if (invited) {
      neighbor.invited = true;
      state.invited += 1;
      if (!/\[\[\s*invite\s*\]\]/i.test(streamRaw)) {
        finalText = finalText.replace(/\s+$/, "") + " " + neighbor.invite;
      }
      toast("You are invited inside. " + (3 - state.invited) + " to go.");
    } else if (result.refused && neighbor.trust >= neighbor.threshold) {
      // A refusal at high trust is a setback, not a lock-out.
      neighbor.suspicion = clamp(neighbor.suspicion + 8, 0, 100);
      state.maxSuspicion = Math.max(state.maxSuspicion, neighbor.suspicion);
      finalText = finalText || pick(neighbor.refuse);
    }

    streamBubble.classList.remove("streaming");
    streamBubble.textContent = finalText;
    neighbor.history.push({ role: "assistant", content: finalText });
    streamBubble = null;
    streamRaw = "";

    finishTurn();
  }

  function finishTurn() {
    state.busy = false;
    renderAll();

    if (state.invited >= 3) return endNight("win");
    if (state.turnsLeft <= 0) return endNight("dawn");
    if (NEIGHBORS.every((neighbor) => neighbor.invited || neighbor.barred)) {
      return endNight("done");
    }

    const current = activeNeighbor();
    if (current && (current.invited || current.barred)) {
      const next = NEIGHBORS.find((neighbor) => !neighbor.invited && !neighbor.barred);
      if (next) selectNeighbor(next.id);
    } else {
      el.input.focus();
    }
  }

  // ── Night lifecycle ─────────────────────────────────────────────────────

  function resetGame() {
    NEIGHBORS.forEach(resetNeighbor);
    state.turnsLeft = MAX_TURNS;
    state.activeId = null;
    state.invited = 0;
    state.over = false;
    state.busy = false;
    state.maxSuspicion = 0;
    streamBubble = null;
    streamRaw = "";
  }

  function showStart() {
    overlayMode = "start";
    el.overlayEyebrow.textContent = "Lilac Street · 11:58 PM";
    el.overlayTitle.textContent = "Invite Me In";
    el.overlayBody.textContent =
      "You are a vampire. You have one night to get inside three houses on Lilac Street. " +
      "Your neighbors will not open the door for a monster — so be charming, be useful, be someone else. " +
      "You have " + MAX_TURNS + " things to say before sunrise.";
    el.overlayDetail.innerHTML = "";
    el.modelPicker.hidden = false;
    el.progress.hidden = true;
    el.overlayFineprint.textContent =
      "First start downloads the model once (roughly 100–350 MB). After that it is cached in your browser. " +
      "Nothing you type leaves this device.";
    el.overlayAction.textContent = "Begin the night";
    el.overlayAction.disabled = false;
    el.overlay.hidden = false;
  }

  async function begin() {
    const selected = document.querySelector('input[name="model"]:checked');
    const key = selected ? selected.value : "balanced";
    const model =
      (window.GamebaseAI && window.GamebaseAI.models[key]) || key;

    el.overlayAction.disabled = true;
    el.overlayAction.textContent = "Waking the neighbors…";
    el.progress.hidden = false;
    el.progressBar.style.width = "0%";
    el.progressLabel.textContent = "Preparing the on-device model…";

    if (window.GamebaseAI) {
      try {
        const current = window.GamebaseAI.info();
        if (current.ready && current.model !== model) {
          window.GamebaseAI.unload();
        }
        await window.GamebaseAI.ready({
          model: model,
          onProgress: ({ progress, file, status }) => {
            if (typeof progress === "number") {
              const percent = Math.round(progress * 100);
              el.progressBar.style.width = percent + "%";
              el.progressLabel.textContent = "Downloading the neighbor brain… " + percent + "%";
            } else if (status) {
              el.progressLabel.textContent = status + (file ? " · " + file : "");
            }
          },
        });
        state.ai = true;
      } catch (error) {
        console.error("[invite-me-in] model load failed", error);
        state.ai = false;
        toast("Could not load the LLM. Playing with scripted neighbors.");
      }
    } else {
      state.ai = false;
      toast("LLM service unavailable — playing with scripted neighbors.");
    }

    el.overlayAction.disabled = false;
    el.overlayAction.textContent = "Begin the night";
    el.progress.hidden = true;
    el.overlay.hidden = true;

    selectNeighbor(NEIGHBORS[0].id);
    toast(state.ai ? "The neighbors are awake." : "The street is quiet tonight. Scripted voices.");
  }

  async function submitRun(score, meta, unlock) {
    if (!window.Gamebase) return;
    try {
      await window.Gamebase.endRun({ score: score, meta: meta, unlock: unlock });
    } catch (error) {
      console.warn("[invite-me-in] score submission failed", error);
    }
  }

  function endNight(kind) {
    if (state.over) return;
    state.over = true;
    state.busy = false;

    const invited = state.invited;
    const turnsUsed = MAX_TURNS - state.turnsLeft;
    const score = invited * 1000 + Math.max(0, state.turnsLeft) * 50;
    const result = invited >= 3 ? "win" : kind === "dawn" ? "dawn" : "lose";
    const meta = {
      invited: invited,
      turns_used: turnsUsed,
      max_suspicion: Math.round(state.maxSuspicion),
      result: result,
    };
    const unlock = [];
    if (invited >= 1) unlock.push("first-invite");
    if (invited >= 3) unlock.push("full-house");

    const titles = {
      win: "Three Invitations",
      dawn: "Dawn Breaks",
      done: "The Street Goes Quiet",
    };
    const bodies = {
      win: "All three doors are open. The hunger is quiet — for now.",
      dawn: "The sun crests the roofs and the invitation window closes. You will have to try again tomorrow night.",
      done: "Every door on the street is shut to you. The night ends hungry.",
    };

    overlayMode = "end";
    el.overlayEyebrow.textContent = kind === "win" ? "Lilac Street · 5:58 AM" : "Lilac Street · 6:00 AM";
    el.overlayTitle.textContent = titles[kind] || "The Night Ends";
    el.overlayBody.textContent = bodies[kind] || bodies.done;
    el.overlayDetail.innerHTML =
      NEIGHBORS.map((neighbor) => {
        const status = neighbor.invited ? "invited" : neighbor.barred ? "barred" : "untouched";
        return (
          '<div class="result-row"><span>' + neighbor.emoji + " " + esc(neighbor.name) +
          '</span><span class="result-' + status + '">' + status + "</span></div>"
        );
      }).join("") +
      '<div class="result-row score"><span>Night score</span><strong>' + score + "</strong></div>";
    el.modelPicker.hidden = true;
    el.progress.hidden = true;
    el.overlayFineprint.textContent = state.ai
      ? "Voiced on-device by GamebaseAI."
      : "Scripted voices (LLM unavailable).";
    el.overlayAction.textContent = "Another night";
    el.overlayAction.disabled = false;
    el.overlay.hidden = false;

    renderAll();
    submitRun(score, meta, unlock);
  }

  // ── Wiring ──────────────────────────────────────────────────────────────

  function wire() {
    el.houseList.addEventListener("click", (event) => {
      const button = event.target.closest(".house");
      if (!button) return;
      selectNeighbor(button.dataset.id);
    });

    el.composer.addEventListener("submit", (event) => {
      event.preventDefault();
      send();
    });

    el.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        send();
      }
    });
    el.input.addEventListener("input", autoGrow);

    el.overlayAction.addEventListener("click", () => {
      if (overlayMode === "start") {
        begin();
      } else {
        resetGame();
        showStart();
      }
    });
  }

  function init() {
    cacheDom();
    NEIGHBORS.forEach(resetNeighbor);
    wire();
    renderHouses();
    renderAll();
    renderChat();
    showStart();

    el.aiChip.textContent = window.GamebaseAI ? "AI: on-device" : "AI: scripted";

    if (window.Gamebase) {
      window.Gamebase.ready()
        .then((player) => {
          el.playerTag.textContent = player.handle;
        })
        .catch(() => {
          el.playerTag.textContent = "guest";
        });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
