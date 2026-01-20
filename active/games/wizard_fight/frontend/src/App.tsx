import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";

interface WizardState {
  health: number;
  mana: number;
}

interface UnitState {
  unit_id: number;
  owner_id: number;
  position: number;
  hp: number;
  speed: number;
  damage: number;
  target: string;
}

interface GameState {
  time_seconds: number;
  wizards: Record<number, WizardState>;
  units: UnitState[];
  environment?: Array<{ type: string; magnitude: number; remaining_duration: number }>;
}

interface SpellEntry {
  spell_id: number;
  spec: {
    name: string;
  } & Record<string, unknown>;
}

const ARENA_LENGTH = 100;

const emitWithAck = <T,>(socket: Socket, event: string, payload: Record<string, unknown>) =>
  new Promise<T>((resolve) => {
    socket.emit(event, payload, (response: T) => resolve(response));
  });

export default function App() {
  const [lobbyId, setLobbyId] = useState<string | null>(null);
  const [playerId, setPlayerId] = useState<number | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const [prompt, setPrompt] = useState("");
  const [spells, setSpells] = useState<SpellEntry[]>([]);
  const [researchRemaining, setResearchRemaining] = useState<number | null>(null);
  const [spectatorLobby, setSpectatorLobby] = useState("");
  const [mode, setMode] = useState<"player" | "spectator">("player");
  const socketRef = useRef<Socket | null>(null);
  const disableSocket = import.meta.env.MODE === "test";

  const socketUrl = import.meta.env.VITE_SOCKET_URL as string | undefined;
  const socket = useMemo(
    () => io(socketUrl ?? undefined, { autoConnect: false }),
    [socketUrl]
  );

  useEffect(() => {
    if (disableSocket) {
      return undefined;
    }
    socketRef.current = socket;
    socket.connect();

    const bootstrap = async () => {
      if (mode !== "player") {
        return;
      }
      const lobbyResponse = await emitWithAck<{ lobby_id: string }>(socket, "create_lobby", {
        seed: 7,
      });
      setLobbyId(lobbyResponse.lobby_id);
      const joinResponse = await emitWithAck<{ player_id: number }>(socket, "join_lobby", {
        lobby_id: lobbyResponse.lobby_id,
      });
      setPlayerId(joinResponse.player_id);
      const initial = await emitWithAck<{ state: GameState; researching?: Record<number, number> }>(
        socket,
        "get_state",
        {
        lobby_id: lobbyResponse.lobby_id,
        }
      );
      setState(initial.state);
      if (typeof initial.researching?.[joinResponse.player_id] === "number") {
        setResearchRemaining(initial.researching[joinResponse.player_id]);
      }
    };

    bootstrap();

    return () => {
      socket.disconnect();
    };
  }, [mode, socket]);

  useEffect(() => {
    if (!lobbyId || disableSocket || mode !== "player") return undefined;
    const interval = window.setInterval(async () => {
      const response = await emitWithAck<{
        state: GameState;
        new_spells?: SpellEntry[];
        researching?: Record<number, number>;
      }>(socket, "step", {
        lobby_id: lobbyId,
        steps: 1,
      });
      setState(response.state);
      if (response.new_spells && response.new_spells.length > 0) {
        setSpells((current) => [...current, ...response.new_spells]);
      }
      if (playerId !== null && response.researching) {
        setResearchRemaining(response.researching[playerId] ?? null);
      }
    }, 200);
    return () => window.clearInterval(interval);
  }, [disableSocket, lobbyId, mode, socket]);

  const castBaseline = useCallback(async () => {
    if (!lobbyId) return;
    const response = await emitWithAck<{ state: GameState }>(socket, "cast_baseline", {
      lobby_id: lobbyId,
    });
    setState(response.state);
  }, [lobbyId, socket]);

  const researchSpell = useCallback(async () => {
    if (!lobbyId || !prompt.trim()) return;
    await emitWithAck<{ status: string }>(socket, "research_spell", {
      lobby_id: lobbyId,
      prompt,
    });
    setPrompt("");
  }, [lobbyId, prompt, socket]);

  const castSpell = useCallback(
    async (index: number) => {
      if (!lobbyId) return;
      const response = await emitWithAck<{ state: GameState }>(socket, "cast_spell", {
        lobby_id: lobbyId,
        spell_index: index,
      });
      setState(response.state);
    },
    [lobbyId, socket]
  );

  const startSpectating = useCallback(async () => {
    if (!spectatorLobby.trim()) return;
    setMode("spectator");
    setLobbyId(spectatorLobby.trim());
    const response = await emitWithAck<{ state: GameState }>(socket, "get_state", {
      lobby_id: spectatorLobby.trim(),
    });
    setState(response.state);
  }, [socket, spectatorLobby]);

  useEffect(() => {
    if (!lobbyId || disableSocket || mode !== "spectator") return undefined;
    const interval = window.setInterval(async () => {
      const response = await emitWithAck<{ state: GameState }>(socket, "get_state", {
        lobby_id: lobbyId,
      });
      setState(response.state);
    }, 500);
    return () => window.clearInterval(interval);
  }, [disableSocket, lobbyId, mode, socket]);

  useEffect(() => {
    if (!state) return;
    const canvas = document.getElementById("arena") as HTMLCanvasElement | null;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#1b1d2a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = "#3d4160";
    ctx.beginPath();
    ctx.moveTo(0, canvas.height / 2);
    ctx.lineTo(canvas.width, canvas.height / 2);
    ctx.stroke();

    const wizardPositions = [20, canvas.width - 20];
    [0, 1].forEach((wizardId) => {
      ctx.fillStyle = wizardId === 0 ? "#7f8cff" : "#ff7f8c";
      ctx.beginPath();
      ctx.arc(wizardPositions[wizardId], canvas.height / 2, 10, 0, Math.PI * 2);
      ctx.fill();
    });

    state.units.forEach((unit) => {
      const ratio = unit.position / ARENA_LENGTH;
      const x = 30 + ratio * (canvas.width - 60);
      ctx.fillStyle = unit.owner_id === 0 ? "#ffd66e" : "#6effd6";
      ctx.beginPath();
      ctx.arc(x, canvas.height / 2, 6, 0, Math.PI * 2);
      ctx.fill();
    });
  }, [state]);

  return (
    <div className="app">
      <header>
        <h1>Wizard Fight</h1>
        <p>Lobby: {lobbyId ?? "creating..."}</p>
        <p>Player: {playerId ?? "joining..."}</p>
      </header>
      <section className="hud">
        <div>
          <h2>Wizard 0</h2>
          <p>HP: {state?.wizards?.[0]?.health?.toFixed(1) ?? "-"}</p>
          <p>Mana: {state?.wizards?.[0]?.mana?.toFixed(1) ?? "-"}</p>
        </div>
        <div>
          <h2>Wizard 1</h2>
          <p>HP: {state?.wizards?.[1]?.health?.toFixed(1) ?? "-"}</p>
          <p>Mana: {state?.wizards?.[1]?.mana?.toFixed(1) ?? "-"}</p>
        </div>
        <div>
          <h2>Actions</h2>
          <button onClick={castBaseline} disabled={mode !== "player"}>
            Cast Flying Monkey
          </button>
        </div>
      </section>
      <section className="spectator">
        <h2>Spectate Lobby</h2>
        <div className="research-row">
          <input
            value={spectatorLobby}
            onChange={(event) => setSpectatorLobby(event.target.value)}
            placeholder="paste lobby id"
          />
          <button onClick={startSpectating}>Spectate</button>
        </div>
      </section>
      <section className="research">
        <h2>Study Spells About</h2>
        <div className="research-row">
          <input
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="wind, frost, or shield magic"
          />
          <button onClick={researchSpell} disabled={!!researchRemaining || mode !== "player"}>
            {researchRemaining ? "Researching..." : "Research Spell"}
          </button>
        </div>
        {researchRemaining ? (
          <p>Research completes in {researchRemaining.toFixed(1)}s</p>
        ) : null}
      </section>
      <section className="spellbook">
        <h2>Spellbook</h2>
        {spells.length === 0 ? (
          <p>No researched spells yet.</p>
        ) : (
          <ul>
            {spells.map((spell, index) => (
              <li key={spell.spell_id}>
                <span>{spell.spec.name}</span>
                <button onClick={() => castSpell(index)} disabled={mode !== "player"}>
                  Cast
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <canvas id="arena" width={720} height={220} />
      <section className="log">
        <p>Time: {state?.time_seconds?.toFixed(2) ?? "-"}s</p>
        <p>Units: {state?.units?.length ?? 0}</p>
      </section>
    </div>
  );
}
