/* Reflex Duel — 1v1 matchmaking demo built on the Gamebase SDK. */
(() => {
  const action = document.getElementById("action");
  const phase = document.getElementById("phase");
  const playersEl = document.getElementById("players");
  const resultEl = document.getElementById("result");

  let state = "idle";
  let match = null;
  let greenAt = 0;
  let roundTimer = null;

  const setPhase = (text) => { phase.textContent = text; };
  const setAction = (label, cls) => {
    action.textContent = label;
    action.className = "action" + (cls ? " " + cls : "");
  };

  function renderPlayers() {
    playersEl.innerHTML = match.players
      .map((player) => {
        const you = player.player_id === Gamebase.player.id ? " (you)" : "";
        return `<span><strong>${player.handle}</strong>${you}</span>`;
      })
      .join("");
  }

  async function queue() {
    state = "queued";
    resultEl.textContent = "";
    setAction("Finding…", "wait");
    setPhase("Searching for an opponent…");
    const ticket = await Gamebase.findMatch();
    if (ticket.status === "matched" && ticket.match) return enterMatch(ticket.match);
    const found = await Gamebase.waitForMatch({ interval: 1000, timeout: 120000 });
    if (found) return enterMatch(found);
    state = "idle";
    setAction("Find Match", "");
    setPhase("No match found. Try again.");
  }

  function enterMatch(found) {
    match = found;
    state = "ready";
    renderPlayers();
    setAction("Ready", "go");
    setPhase("Tap Ready, then wait for green — the fastest tap wins.");
  }

  function startRound() {
    state = "waiting";
    setAction("Wait…", "wait");
    setPhase("Wait for green…");
    roundTimer = setTimeout(() => {
      state = "green";
      greenAt = performance.now();
      setAction("TAP!", "go");
      setPhase("Now!");
    }, 1500 + Math.random() * 2500);
  }

  async function tap() {
    if (state === "ready") return startRound();
    if (state === "waiting") {
      clearTimeout(roundTimer);
      state = "idle";
      setAction("Find Match", "");
      setPhase("Too early! You flinched. Queue again.");
      return;
    }
    if (state !== "green") return;

    const reaction = Math.round(performance.now() - greenAt);
    state = "done";
    setAction("Submitted", "");
    setPhase("Your reaction: " + reaction + " ms");
    try {
      await Gamebase.submitScore(reaction);
      await Gamebase.reportResult(match.id, { reaction_ms: reaction });
      await Gamebase.unlock("first-duel");
      await showOutcome();
    } catch (error) {
      setPhase("Could not submit: " + error.message);
    }
  }

  function describeOutcome(latest) {
    const results = latest.result || {};
    const mine = results[Gamebase.player.id];
    const opponent = latest.players.find((player) => player.player_id !== Gamebase.player.id);
    const theirs = opponent ? results[opponent.player_id] : null;
    if (!mine || !theirs) return "Duel finished.";
    if (mine.reaction_ms < theirs.reaction_ms) {
      return `You win! ${mine.reaction_ms} ms vs ${theirs.reaction_ms} ms.`;
    }
    if (mine.reaction_ms > theirs.reaction_ms) {
      return `You lose. ${mine.reaction_ms} ms vs ${theirs.reaction_ms} ms.`;
    }
    return `Draw at ${mine.reaction_ms} ms.`;
  }

  async function showOutcome() {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const latest = await Gamebase.match(match.id);
      if (latest.state === "completed") {
        resultEl.textContent = describeOutcome(latest);
        return;
      }
      setPhase("Waiting for opponent…");
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    resultEl.textContent = "Opponent did not finish in time.";
  }

  action.addEventListener("click", () => {
    if (state === "idle" || state === "done") {
      queue().catch((error) => setPhase("Error: " + error.message));
    } else {
      tap();
    }
  });

  Gamebase.ready()
    .then((player) => setPhase("Playing as " + player.handle + ". Queue up!"))
    .catch((error) => setPhase("Offline: " + error.message));
})();
