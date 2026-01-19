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
  const socketRef = useRef<Socket | null>(null);
  const disableSocket = import.meta.env.MODE === "test";

  const socket = useMemo(() => io({ autoConnect: false }), []);

  useEffect(() => {
    if (disableSocket) {
      return undefined;
    }
    socketRef.current = socket;
    socket.connect();

    const bootstrap = async () => {
      const lobbyResponse = await emitWithAck<{ lobby_id: string }>(socket, "create_lobby", {
        seed: 7,
      });
      setLobbyId(lobbyResponse.lobby_id);
      const joinResponse = await emitWithAck<{ player_id: number }>(socket, "join_lobby", {
        lobby_id: lobbyResponse.lobby_id,
      });
      setPlayerId(joinResponse.player_id);
      const initial = await emitWithAck<{ state: GameState }>(socket, "get_state", {
        lobby_id: lobbyResponse.lobby_id,
      });
      setState(initial.state);
    };

    bootstrap();

    return () => {
      socket.disconnect();
    };
  }, [socket]);

  useEffect(() => {
    if (!lobbyId || disableSocket) return undefined;
    const interval = window.setInterval(async () => {
      const response = await emitWithAck<{ state: GameState }>(socket, "step", {
        lobby_id: lobbyId,
        steps: 1,
      });
      setState(response.state);
    }, 200);
    return () => window.clearInterval(interval);
  }, [disableSocket, lobbyId, socket]);

  const castBaseline = useCallback(async () => {
    if (!lobbyId) return;
    const response = await emitWithAck<{ state: GameState }>(socket, "cast_baseline", {
      lobby_id: lobbyId,
    });
    setState(response.state);
  }, [lobbyId, socket]);

  const researchSpell = useCallback(async () => {
    if (!lobbyId || !prompt.trim()) return;
    const response = await emitWithAck<{ spell_id: number; spec: SpellEntry["spec"] }>(
      socket,
      "research_spell",
      {
        lobby_id: lobbyId,
        prompt,
      }
    );
    setSpells((current) => [...current, { spell_id: response.spell_id, spec: response.spec }]);
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
          <button onClick={castBaseline}>Cast Flying Monkey</button>
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
          <button onClick={researchSpell}>Research Spell</button>
        </div>
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
                <button onClick={() => castSpell(index)}>Cast</button>
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
