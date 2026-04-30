/**
 * OpenRouter model scoping + 403 -> openrouter/free auto-resubmit + cost display
 *
 * Behavior:
 * - Replaces the OpenRouter model list with a curated subset so /model only
 *   shows the models you care about.
 * - On HTTP 403, immediately switches to openrouter/free and re-sends the
 *   last prompt as a follow-up.
 * - Shows the model pricing rate in the footer for OpenRouter models.
 * - No custom slash commands.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const PROVIDER = "openrouter";
const FREE_MODEL_ID = "openrouter/free";
const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const OPENROUTER_API_TYPE = "openai-completions";
const OPENROUTER_API_KEY_ENV = "OPENROUTER_API_KEY";

const ALLOWED_MODEL_IDS = [
	"moonshotai/kimi-k2.6",
	"moonshotai/kimi-k2.5",
	"deepseek/deepseek-v4-flash",
	"deepseek/deepseek-v3.2",
	"google/gemini-2.5-pro",
	"bytedance-seed/seed-1.6",
	"openrouter/free",
] as const;

let lastPrompt: string | null = null;
let retryQueued = false;
let providerScoped = false;

function formatCost(model: any): string {
	if (!model?.cost) return "";
	const c = model.cost;
	const parts: string[] = [];
	const fmt = (dollarsPerM: number): string => {
		if (dollarsPerM === 0) return "$0";
		if (Math.abs(dollarsPerM) >= 0.01) return `$${dollarsPerM.toFixed(2)}/M`;
		return `$${dollarsPerM.toFixed(4)}/M`;
	};
	if (c.input > 0) parts.push(`in ${fmt(c.input)}`);
	else if (c.input < 0) parts.push(`in -${fmt(-c.input)}`);
	if (c.output > 0) parts.push(`out ${fmt(c.output)}`);
	else if (c.output < 0) parts.push(`out -${fmt(-c.output)}`);
	return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

export default function (pi: ExtensionAPI) {
	function updateCostFooter(ctx: any): void {
		if (!ctx.model || ctx.model.provider !== PROVIDER) return;
		const costText = formatCost(ctx.model);
		ctx.ui.setStatus("openrouter-cost", costText);
	}

	pi.on("session_start", async (_event, ctx) => {
		lastPrompt = null;
		retryQueued = false;

		if (!providerScoped) {
			const available = await (ctx.modelRegistry as any).getAvailable?.();
			if (Array.isArray(available)) {
				const filtered = available
					.filter((m: any) => m.provider === PROVIDER && ALLOWED_MODEL_IDS.includes(m.id))
					.map((m: any) => ({
						id: m.id,
						name: m.name,
						api: m.api,
						reasoning: m.reasoning,
						input: m.input,
						cost: m.cost,
						contextWindow: m.contextWindow,
						maxTokens: m.maxTokens,
						compat: m.compat,
						headers: m.headers,
					}));

				if (filtered.length > 0) {
					pi.registerProvider(PROVIDER, {
						baseUrl: OPENROUTER_BASE_URL,
						apiKey: OPENROUTER_API_KEY_ENV,
						api: OPENROUTER_API_TYPE as any,
						models: filtered,
					} as any);
					providerScoped = true;
				}
			}
		}

		ctx.ui.setStatus("models", "🔒 OpenRouter scoped");
		updateCostFooter(ctx);
	});

	pi.on("before_agent_start", async (event, _ctx) => {
		lastPrompt = event.prompt;
		retryQueued = false;
	});

	pi.on("after_provider_response", async (event, ctx) => {
		if (event.status !== 403) return;
		if (retryQueued) return;

		const currentId = ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : "";
		if (currentId === `${PROVIDER}/${FREE_MODEL_ID}` || currentId === FREE_MODEL_ID) {
			ctx.ui.setStatus("models", "⚠️ openrouter/free failed");
			return;
		}

		const freeModel = ctx.modelRegistry.find(PROVIDER, FREE_MODEL_ID);
		if (!freeModel) {
			ctx.ui.notify("403 hit, but openrouter/free is not available in the scoped model list.", "error");
			return;
		}

		const ok = await pi.setModel(freeModel);
		if (!ok) {
			ctx.ui.notify("403 hit, but switching to openrouter/free failed.", "error");
			return;
		}

		retryQueued = true;
		ctx.ui.setStatus("models", "⚠️ Using openrouter/free");
		updateCostFooter(ctx);
		ctx.ui.notify("403 hit — switched to openrouter/free and retrying.", "warning");

		if (lastPrompt) {
			pi.sendUserMessage(lastPrompt, { deliverAs: "followUp" });
		}
	});

	pi.on("model_select", async (event, ctx) => {
		const id = `${event.model.provider}/${event.model.id}`;
		if (event.model.provider === PROVIDER) {
			if (id === `${PROVIDER}/${FREE_MODEL_ID}` || event.model.id === FREE_MODEL_ID) {
				ctx.ui.setStatus("models", "⚠️ Using openrouter/free");
			} else {
				ctx.ui.setStatus("models", "🔒 OpenRouter scoped");
			}
			updateCostFooter(ctx);
		} else {
			ctx.ui.setStatus("openrouter-cost", undefined);
		}
	});

	pi.on("agent_end", async (_event, ctx) => {
		updateCostFooter(ctx);
	});
}
