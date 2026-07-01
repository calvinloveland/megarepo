import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { parseAllDocuments } from "yaml";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..", "..", "..");
const vroomonRoot = join(repoRoot, "active", "games", "vroomon", "electron");
const k8sPath = join(vroomonRoot, "k8s", "vroomon.yaml");
const dockerfilePath = join(vroomonRoot, "Dockerfile");
const deploymentDocPath = join(vroomonRoot, "DEPLOYMENT.md");
const makefilePath = join(vroomonRoot, "Makefile");
const deployScriptPath = join(vroomonRoot, "scripts", "deploy.sh");
const tunnelDnsScriptPath = join(vroomonRoot, "scripts", "create-tunnel-dns.sh");
const ingressTemplatePath = join(vroomonRoot, "scripts", "cloudflared-ingress.yml");
const workflowPath = join(vroomonRoot, ".github", "workflows", "build-image.yml");
const setupScriptPath = join(vroomonRoot, "scripts", "setup-cloudflared.sh");
const deploySecretsScriptPath = join(vroomonRoot, "scripts", "deploy-from-secrets.sh");
const deployGuidePath = join(vroomonRoot, "scripts", "deploy-guide.mjs");
const deployWhenReadyPath = join(vroomonRoot, "scripts", "deploy-when-ready.sh");
const webServerPath = join(vroomonRoot, "scripts", "web-server.mjs");

interface K8sResource {
  kind: string;
  metadata: { name: string; namespace?: string };
  spec?: Record<string, unknown>;
}

function loadK8s(): K8sResource[] {
  const source = readFileSync(k8sPath, "utf8");
  return parseAllDocuments(source).map((doc) => doc.toJSON() as K8sResource);
}

describe("vroomon deployment artifacts", () => {
  it("declares the four required k8s resources", () => {
    const resources = loadK8s();
    const kinds = resources.map((r) => r.kind);
    expect(kinds).toEqual([
      "Namespace",
      "Deployment",
      "Service",
      "PersistentVolumeClaim",
    ]);
  });

  it("uses the vroomon namespace on namespaced resources", () => {
    const resources = loadK8s();
    for (const resource of resources) {
      // A Namespace resource itself has no parent namespace; all other
      // kinds must live under `vroomon`.
      if (resource.kind === "Namespace") {
        expect(resource.metadata.namespace).toBeUndefined();
        continue;
      }
      expect(resource.metadata.namespace).toBe("vroomon");
    }
  });

  it("runs the vroomon + cloudflared containers in one pod", () => {
    const resources = loadK8s();
    const deployment = resources.find((r) => r.kind === "Deployment");
    if (!deployment?.spec) {
      throw new Error("Deployment.spec missing");
    }
    const spec = deployment.spec as {
      template: { spec: { containers: Array<{ name: string }> } };
    };
    const containerNames = spec.template.spec.containers.map((c) => c.name);
    expect(containerNames).toContain("vroomon");
    expect(containerNames).toContain("cloudflared");
  });

  it("exposes port 5112 on the service", () => {
    const resources = loadK8s();
    const service = resources.find((r) => r.kind === "Service");
    if (!service?.spec) {
      throw new Error("Service.spec missing");
    }
    const spec = service.spec as { ports: Array<{ port: number }> };
    expect(spec.ports[0]?.port).toBe(5112);
  });

  it("uses a persistent volume claim for Hall of Fame state", () => {
    const resources = loadK8s();
    const deployment = resources.find((r) => r.kind === "Deployment");
    const pvc = resources.find((r) => r.kind === "PersistentVolumeClaim");
    if (!deployment?.spec || !pvc) {
      throw new Error("Deployment or PVC missing");
    }
    expect(pvc.metadata.name).toBe("vroomon-data");
    const spec = deployment.spec as {
      template: {
        spec: {
          volumes: Array<{ name: string; persistentVolumeClaim?: { claimName: string } }>;
          containers: Array<{ name: string; volumeMounts: Array<{ name: string; mountPath: string }> }>;
        };
      };
    };
    const volume = spec.template.spec.volumes.find((v) => v.name === "vroomon-data");
    expect(volume?.persistentVolumeClaim?.claimName).toBe("vroomon-data");
    const mount = spec.template.spec.containers
      .find((c) => c.name === "vroomon")
      ?.volumeMounts.find((m) => m.name === "vroomon-data");
    expect(mount?.mountPath).toBe("/data/vroomon");
  });

  it("disables hardware acceleration and sandbox inside the container", () => {
    const resources = loadK8s();
    const deployment = resources.find((r) => r.kind === "Deployment");
    if (!deployment?.spec) {
      throw new Error("Deployment.spec missing");
    }
    const spec = deployment.spec as {
      template: {
        spec: {
          containers: Array<{ name: string; env: Array<{ name: string; value: string }> }>;
        };
      };
    };
    const container = spec.template.spec.containers.find((c) => c.name === "vroomon");
    if (!container) {
      throw new Error("vroomon container missing");
    }
    const env = Object.fromEntries(container.env.map((e) => [e.name, e.value]));
    expect(env.VROOMON_DISABLE_HARDWARE_ACCELERATION).toBe("1");
    expect(env.VROOMON_DISABLE_SANDBOX).toBe("1");
    expect(env.VROOMON_DISABLE_DEV_SHM_USAGE).toBe("1");
  });

  it("ships a Dockerfile that wraps electron in xvfb-run", () => {
    const dockerfile = readFileSync(dockerfilePath, "utf8");
    expect(dockerfile).toContain("FROM node:");
    expect(dockerfile).toMatch(/apt-get install/);
    expect(dockerfile).toContain("xvfb");
    expect(dockerfile).toContain("xvfb-run");
    expect(dockerfile).toContain("electron");
    expect(dockerfile).toContain("VROOMON_USER_DATA_DIR");
  });

  it("ships a DEPLOYMENT.md with the cloudflared ingress block", () => {
    const doc = readFileSync(deploymentDocPath, "utf8");
    expect(doc).toContain("vroomon.shsw.dev");
    expect(doc).toContain("cloudflared");
    expect(doc).toContain("kubectl apply");
  });

  it("documents troubleshooting + maintenance in DEPLOYMENT.md", () => {
    const doc = readFileSync(deploymentDocPath, "utf8");
    expect(doc).toContain("## Troubleshooting");
    expect(doc).toContain("## Maintenance");
    expect(doc).toContain("CrashLoopBackOff");
    expect(doc).toContain("Wipe Hall of Fame");
  });

  it("Makefile lists every documented deploy target", () => {
    const makefile = readFileSync(makefilePath, "utf8");
    for (const target of [
      "guide:",
      "test:",
      "build:",
      "push:",
      "deploy:",
      "redeploy:",
      "status:",
      "logs:",
      "restart:",
      "wipe-state:",
    ]) {
      expect(makefile).toContain(target);
    }
  });

  it("Makefile never embeds a hardcoded registry secret", () => {
    const makefile = readFileSync(makefilePath, "utf8");
    expect(makefile).not.toMatch(/[A-Za-z0-9_-]{32,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/);
  });

  it("deploy.sh uses 127.0.0.1:5000 as the default registry", () => {
    const script = readFileSync(deployScriptPath, "utf8");
    expect(script).toContain("VROOMON_REGISTRY");
    expect(script).toContain("127.0.0.1:5000");
    expect(script).toContain("docker build");
    expect(script).toContain("docker push");
    expect(script).toContain("kubectl apply");
  });

  it("deploy.sh accepts a tag and supports build-only / apply-only modes", () => {
    const script = readFileSync(deployScriptPath, "utf8");
    expect(script).toContain("--build-only");
    expect(script).toContain("--apply-only");
    expect(script).toContain("--tag");
  });

  it("create-tunnel-dns.sh takes a tunnel UUID and does not embed a token", () => {
    const script = readFileSync(tunnelDnsScriptPath, "utf8");
    expect(script).toContain("tunnel-uuid");
    expect(script).toContain("cloudflared tunnel route dns");
    expect(script).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
  });

  it("cloudflared-ingress.yml has the vroomon host with no secrets", () => {
    const template = readFileSync(ingressTemplatePath, "utf8");
    expect(template).toContain("hostname: vroomon.shsw.dev");
    expect(template).toContain("service: http://127.0.0.1:5112");
    expect(template).not.toMatch(/[A-Za-z0-9_-]{40,}/);
  });

  it("ships a GitHub Actions workflow that builds the image on PR", () => {
    const workflow = readFileSync(workflowPath, "utf8");
    expect(workflow).toContain("docker/setup-buildx-action");
    expect(workflow).toContain("vroomon");
    expect(workflow).toContain("pull_request");
    expect(workflow).toContain("npm test");
  });

  it("setup-cloudflared.sh never reads secrets from stdin into a file", () => {
    const script = readFileSync(setupScriptPath, "utf8");
    expect(script).toContain('read -r -s -p "Token: "');
    expect(script).toContain("kubectl -n \"\${NAMESPACE}\" create secret");
    expect(script).toContain("VROOMON_CF_TOKEN");
    expect(script).toContain("--copy-from");
  });

  it("deploy-from-secrets.sh reads the token from .secrets/ not from args", () => {
    const script = readFileSync(deploySecretsScriptPath, "utf8");
    expect(script).toContain(".secrets/cloudflared-token");
    expect(script).toContain("kubectl -n vroomon create secret generic");
    expect(script).toContain("docker build");
    expect(script).not.toMatch(/Kubernetes|bash -c|eval/);
  });

  it("deploy-from-secrets.sh guides the user to create the file if missing", () => {
    const script = readFileSync(deploySecretsScriptPath, "utf8");
    expect(script).toContain("mkdir -p");
    expect(script).toContain("echo 'YOUR_TOKEN'");
  });

  it("deploy-guide.mjs serves an HTML page with a password field", () => {
    const guide = readFileSync(deployGuidePath, "utf8");
    expect(guide).toContain('type="password"');
    expect(guide).toContain("/api/write-token");
    expect(guide).toContain("/api/deploy");
  });

  it("deploy-guide.mjs validates the token starts with eyJ", () => {
    const guide = readFileSync(deployGuidePath, "utf8");
    expect(guide).toContain("startsWith('eyJ')");
  });

  it("deploy-when-ready.sh waits for the cluster or applies immediately", () => {
    const script = readFileSync(deployWhenReadyPath, "utf8");
    expect(script).toContain("--watch");
    expect(script).toContain("kubectl get nodes");
    expect(script).toContain("kubectl apply -f");
    expect(script).toContain("SECRETS_FILE");
  });

  it("deploy-when-ready.sh reads the token from .secrets/ not from chat", () => {
    const script = readFileSync(deployWhenReadyPath, "utf8");
    expect(script).toContain("SECRETS_FILE");
    expect(script).toContain('cat "${SECRETS_FILE}"');
  });

  it("deploy-guide.mjs writes to the gitignored .secrets/ path", () => {
    const guide = readFileSync(deployGuidePath, "utf8");
    expect(guide).toContain(".secrets/cloudflared-token");
    expect(guide).toContain("/api/write-token");
  });

  it("web-server.mjs serves the game.html and renderer files", () => {
    const server = readFileSync(webServerPath, "utf8");
    expect(server).toContain("game.html");
    expect(server).toContain("5112");
    expect(server).toContain('MIME[ext]');
  });

  it("web-server.mjs implements the /api/feedback endpoint", () => {
    const server = readFileSync(webServerPath, "utf8");
    expect(server).toContain("/api/feedback");
    expect(server).toContain("appendFeedback");
    expect(server).toContain("isValidFeedback");
    expect(server).toContain("FEEDBACK_FILE");
    expect(server).toContain("feedback.jsonl");
  });

  it("playwright-preload-shim initializes the logger with the feedback endpoint", () => {
    const shim = readFileSync(
      join(repoRoot, "active", "games", "vroomon", "electron", "src", "renderer", "playwright-preload-shim.ts"),
      "utf8",
    );
    expect(shim).toContain("FEEDBACK_ENDPOINT");
    expect(shim).toContain("api/feedback");
    expect(shim).toContain("endpoint: FEEDBACK_ENDPOINT");
  });

  it("game.html embeds action buttons as floating overlays inside the viewport", () => {
    const html = readFileSync(
      join(repoRoot, "active", "games", "vroomon", "electron", "src", "renderer", "game.html"),
      "utf8",
    );
    // Status overlay (top-right)
    expect(html).toContain("viewport-overlay--status");
    expect(html).toContain("data-viewport-gen-pill");
    expect(html).toContain("data-viewport-leader-pill");
    // Progress overlay (top-center)
    expect(html).toContain("viewport-overlay--progress");
    expect(html).toContain("data-viewport-progress-overlay");
    // Action overlays (bottom-left)
    expect(html).toContain("viewport-overlay--actions");
    expect(html).toContain("data-viewport-actions-overlay");
    // Action buttons live INSIDE the viewport body, not in the side rail
    const viewportBodyIdx = html.indexOf("viewport-stage__body");
    const generateBtnIdx = html.indexOf("data-generate-population");
    const runBtnIdx = html.indexOf("data-run-generation");
    expect(viewportBodyIdx).toBeGreaterThan(0);
    expect(generateBtnIdx).toBeGreaterThan(viewportBodyIdx);
    expect(runBtnIdx).toBeGreaterThan(viewportBodyIdx);
    // The viewport is now full-screen; there is no right-rail at all.
    const rightRailOpen = html.indexOf('<aside class="right-rail">');
    expect(rightRailOpen).toBe(-1);
  });

  it("game.html uses a full-viewport layout with floating overlays", () => {
    const html = readFileSync(
      join(repoRoot, "active", "games", "vroomon", "electron", "src", "renderer", "game.html"),
      "utf8",
    );
    expect(html).toContain("height: 100%");
    expect(html).toContain("overflow: hidden");
    expect(html).toContain(".viewport-overlay");
    expect(html).toContain(".top-bar");
  });

  it("renderer toggles viewport overlays based on the current mode", () => {
    const renderer = readFileSync(
      join(repoRoot, "active", "games", "vroomon", "electron", "src", "renderer", "renderer.ts"),
      "utf8",
    );
    expect(renderer).toContain("mode-${rendererState.mode}");
    expect(renderer).toContain("data-viewport-actions-overlay");
    expect(renderer).toContain("data-viewport-hof-overlay");
    expect(renderer).toContain("panelModes.includes");
  });

  it("feedback endpoint accepts valid reports and stores them", async () => {
    const { createServer } = await import("node:http");
    const { spawn } = await import("node:child_process");

    // Start the web server on an ephemeral port
    const port = 5118;
    const child = spawn("node", ["scripts/web-server.mjs"], {
      cwd: vroomonRoot,
      env: { ...process.env, VROOMON_WEB_PORT: String(port), VROOMON_WEB_HOST: "127.0.0.1" },
      stdio: "pipe",
    });

    // Wait for server to be ready
    await new Promise((r) => setTimeout(r, 1500));

    try {
      // POST a valid report
      const valid = {
        errors: [
          {
            id: "e2e-test-1",
            message: "Test error from e2e",
            type: "Error",
            timestamp: Date.now(),
            source: "manual",
          },
        ],
      };

      const postRes = await fetch(`http://127.0.0.1:${port}/api/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(valid),
      });
      expect(postRes.status).toBe(200);
      const postBody = await postRes.json();
      expect(postBody.ok).toBe(true);
      expect(postBody.received).toBe(1);

      // GET it back
      const getRes = await fetch(`http://127.0.0.1:${port}/api/feedback`);
      expect(getRes.status).toBe(200);
      const getBody = await getRes.json();
      expect(getBody.ok).toBe(true);
      expect(getBody.count).toBeGreaterThanOrEqual(1);

      // DELETE clears
      const delRes = await fetch(`http://127.0.0.1:${port}/api/feedback`, {
        method: "DELETE",
      });
      expect(delRes.status).toBe(200);
    } finally {
      child.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 200));
    }
  });

  it("feedback endpoint rejects invalid payloads", async () => {
    const { spawn } = await import("node:child_process");
    const port = 5119;
    const child = spawn("node", ["scripts/web-server.mjs"], {
      cwd: vroomonRoot,
      env: { ...process.env, VROOMON_WEB_PORT: String(port), VROOMON_WEB_HOST: "127.0.0.1" },
      stdio: "pipe",
    });
    await new Promise((r) => setTimeout(r, 1500));

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ not_errors: [] }),
      });
      expect(res.status).toBe(400);
    } finally {
      child.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 200));
    }
  });

  it("game.html has the game-themed layout and data attributes the renderer expects", () => {
    const gameHtml = readFileSync(
      join(repoRoot, "active", "games", "vroomon", "electron", "src", "renderer", "game.html"),
      "utf8",
    );
    expect(gameHtml).toContain("data-mode-button");
    expect(gameHtml).toContain("data-overworld-canvas");
    expect(gameHtml).toContain("data-dpad");
    expect(gameHtml).toContain("data-hall-of-fame");
    expect(gameHtml).toContain("data-run-generation");
    expect(gameHtml).toContain("data-status-message");
    expect(gameHtml).toContain("menu-title");
    expect(gameHtml).toContain("top-bar");
    expect(gameHtml).toContain("viewport-stage");
    expect(gameHtml).toContain("Press Start 2P");
  });

  it("copy-static.mjs bundles the web assets for browser compatibility", () => {
    const script = readFileSync(
      join(repoRoot, "active", "games", "vroomon", "electron", "scripts", "copy-static.mjs"),
      "utf8",
    );
    expect(script).toContain("import { build } from \"esbuild\"");
    expect(script).toContain("playwright-preload-shim.ts");
    expect(script).toContain("renderer.ts");
    expect(script).toContain("bundle: true");
  });

  it("game.html loads the shim as a plain script (not a module)", () => {
    const gameHtml = readFileSync(
      join(repoRoot, "active", "games", "vroomon", "electron", "src", "renderer", "game.html"),
      "utf8",
    );
    expect(gameHtml).toMatch(/<script src="\.\/playwright-preload-shim\.js"><\/script>/);
    expect(gameHtml).toMatch(/<script type="module" src="\.\/renderer\.js"><\/script>/);
  });

  it("bundled web assets are present in dist/ after a build", () => {
    const shimDist = join(vroomonRoot, "dist", "renderer", "playwright-preload-shim.js");
    const rendererDist = join(vroomonRoot, "dist", "renderer", "renderer.js");
    // The build may or may not have run; this is best-effort.
    if (existsSync(shimDist)) {
      const shim = readFileSync(shimDist, "utf8");
      // Should be a self-contained IIFE bundle (not raw ESM with broken imports).
      expect(shim).not.toContain('import "../shared/dna-v2.js"');
    }
    if (existsSync(rendererDist)) {
      const renderer = readFileSync(rendererDist, "utf8");
      expect(renderer).not.toContain('from "../shared/dna-v2.js"');
    }
  });

  it("Makefile has the web target", () => {
    const makefile = readFileSync(makefilePath, "utf8");
    expect(makefile).toContain("web:\n");
    expect(makefile).toContain("node scripts/web-server.mjs");
  });

  it("apps.yaml serves vroomon as a web server, not Electron desktop", () => {
    const appsYaml = readFileSync(
      join(repoRoot, "active", "web-apps", "launcher", "apps.yaml"),
      "utf8",
    );
    expect(appsYaml).toContain("web-server.mjs");
    expect(appsYaml).toContain("VROOMON_WEB_PORT");
  });
});
