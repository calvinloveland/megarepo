import { spawn } from "node:child_process";

const labelPort = process.env.LABEL_SERVER_PORT ?? "5175";

const labelServer = spawn("node", ["scripts/label_server.mjs"], {
  stdio: "inherit",
  env: { ...process.env, LABEL_SERVER_PORT: labelPort }
});

const vite = spawn("npm", ["run", "dev"], {
  stdio: "inherit",
  env: {
    ...process.env,
    VITE_LABELS_ENDPOINT: `http://127.0.0.1:${labelPort}/api/labels`
  }
});

const shutdown = () => {
  labelServer.kill("SIGINT");
  vite.kill("SIGINT");
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

vite.on("exit", (code) => {
  labelServer.kill("SIGINT");
  process.exit(code ?? 0);
});
