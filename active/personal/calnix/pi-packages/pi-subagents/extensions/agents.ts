/**
 * Adapted from the pi-coding-agent subagent example:
 * examples/extensions/subagent/agents.ts
 *
 * Original concept and example by Mario Zechner and contributors.
 * This packaged variant adds bundled-agent discovery so the package works
 * without separate manual symlinks for the default agents.
 *
 * See ../NOTICE.md for attribution details.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export type AgentScope = "user" | "project" | "both";
export type AgentSource = "bundled" | "user" | "project";

export interface AgentConfig {
	name: string;
	description: string;
	tools?: string[];
	model?: string;
	systemPrompt: string;
	source: AgentSource;
	filePath: string;
}

export interface AgentDiscoveryResult {
	agents: AgentConfig[];
	bundledAgentsDir: string;
	projectAgentsDir: string | null;
}

export interface DiscoverAgentsOptions {
	bundledAgentsDir?: string;
	userAgentsDir?: string;
	projectAgentsDir?: string | null;
}

function defaultBundledAgentsDir(): string {
	return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "agents");
}

function defaultUserAgentsDir(): string {
	const base = process.env.PI_AGENT_DIR || path.join(os.homedir(), ".pi", "agent");
	return path.join(base, "agents");
}

function parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
	if (!content.startsWith("---\n")) {
		return { frontmatter: {}, body: content.trim() };
	}

	const end = content.indexOf("\n---\n", 4);
	if (end === -1) {
		return { frontmatter: {}, body: content.trim() };
	}

	const rawFrontmatter = content.slice(4, end).trim();
	const body = content.slice(end + 5).trim();
	const frontmatter: Record<string, string> = {};
	for (const line of rawFrontmatter.split("\n")) {
		const separator = line.indexOf(":");
		if (separator === -1) continue;
		const key = line.slice(0, separator).trim();
		const value = line.slice(separator + 1).trim();
		if (key) frontmatter[key] = value;
	}
	return { frontmatter, body };
}

function loadAgentsFromDir(dir: string, source: AgentSource): AgentConfig[] {
	const agents: AgentConfig[] = [];

	if (!fs.existsSync(dir)) {
		return agents;
	}

	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return agents;
	}

	for (const entry of entries) {
		if (!entry.name.endsWith(".md")) continue;
		if (!entry.isFile() && !entry.isSymbolicLink()) continue;

		const filePath = path.join(dir, entry.name);
		let content: string;
		try {
			content = fs.readFileSync(filePath, "utf-8");
		} catch {
			continue;
		}

		const { frontmatter, body } = parseFrontmatter(content);
		if (!frontmatter.name || !frontmatter.description) {
			continue;
		}

		const tools = frontmatter.tools
			?.split(",")
			.map((tool) => tool.trim())
			.filter(Boolean);

		agents.push({
			name: frontmatter.name,
			description: frontmatter.description,
			tools: tools && tools.length > 0 ? tools : undefined,
			model: frontmatter.model,
			systemPrompt: body,
			source,
			filePath,
		});
	}

	return agents;
}

function isDirectory(candidate: string): boolean {
	try {
		return fs.statSync(candidate).isDirectory();
	} catch {
		return false;
	}
}

function findNearestProjectAgentsDir(cwd: string): string | null {
	let currentDir = path.resolve(cwd);
	while (true) {
		const candidate = path.join(currentDir, ".pi", "agents");
		if (isDirectory(candidate)) return candidate;
		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) return null;
		currentDir = parentDir;
	}
}

export function discoverAgents(cwd: string, scope: AgentScope, options: DiscoverAgentsOptions = {}): AgentDiscoveryResult {
	const bundledAgentsDir = path.resolve(options.bundledAgentsDir ?? defaultBundledAgentsDir());
	const userAgentsDir = path.resolve(options.userAgentsDir ?? defaultUserAgentsDir());
	const projectAgentsDir = options.projectAgentsDir === undefined ? findNearestProjectAgentsDir(cwd) : options.projectAgentsDir;

	const bundledAgents = loadAgentsFromDir(bundledAgentsDir, "bundled");
	const userAgents = scope === "project" ? [] : loadAgentsFromDir(userAgentsDir, "user");
	const projectAgents = scope === "user" || !projectAgentsDir ? [] : loadAgentsFromDir(projectAgentsDir, "project");

	const precedence: AgentConfig[] =
		scope === "both"
			? [...bundledAgents, ...userAgents, ...projectAgents]
			: scope === "user"
				? [...bundledAgents, ...userAgents]
				: [...bundledAgents, ...projectAgents];

	const agentMap = new Map<string, AgentConfig>();
	for (const agent of precedence) {
		agentMap.set(agent.name, agent);
	}

	return {
		agents: Array.from(agentMap.values()),
		bundledAgentsDir,
		projectAgentsDir,
	};
}

export function formatAgentList(agents: AgentConfig[], maxItems: number): { text: string; remaining: number } {
	if (agents.length === 0) return { text: "none", remaining: 0 };
	const listed = agents.slice(0, maxItems);
	const remaining = agents.length - listed.length;
	return {
		text: listed.map((agent) => `${agent.name} (${agent.source}): ${agent.description}`).join("; "),
		remaining,
	};
}
