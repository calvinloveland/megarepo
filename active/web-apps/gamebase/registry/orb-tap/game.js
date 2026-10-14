/* Orb Tap — clicker wired to Gamebase scores and achievements. */
(() => {
  const orb = document.getElementById("orb");
  const scoreEl = document.getElementById("score");
  const bestEl = document.getElementById("best");
  const statusEl = document.getElementById("status");

  let score = 0;

  function setStatus(message) {
    statusEl.textContent = message;
  }

  orb.addEventListener("click", async () => {
    score += 1;
    scoreEl.textContent = String(score);
    if (score % 10 === 0) {
      try {
        const result = await Gamebase.submitScore(score);
        bestEl.textContent = String(result.score);
        if (result.unlocked && result.unlocked.length) {
          setStatus("Unlocked: " + result.unlocked.map((a) => a.title).join(", "));
        }
      } catch (error) {
        setStatus("Could not save score: " + error.message);
      }
    }
  });

  Gamebase.ready()
    .then(() => setStatus("Playing as " + Gamebase.player.handle))
    .catch((error) => setStatus("Offline: " + error.message));
})();
