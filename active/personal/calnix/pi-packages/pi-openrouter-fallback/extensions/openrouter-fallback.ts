/**
 * OpenRouter model scoping + 403 -> openrouter/free auto-resubmit
 *
 * Behavior:
 * - Replaces the OpenRouter model list with a curated subset so /model only
 *   shows the models you care about.
 * - On HTTP 403, immediately switches to openrouter/free and re-sends the
 *   last prompt as a follow-up.
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

export default function (pi: ExtensionAPI) {
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
		ctx.ui.notify("403 hit — switched to openrouter/free and retrying.", "warning");

		if (lastPrompt) {
			pi.sendUserMessage(lastPrompt, { deliverAs: "followUp" });
		}
	});

	pi.on("model_select", async (event, ctx) => {
		const id = `${event.model.provider}/${event.model.id}`;
		if (id === `${PROVIDER}/${FREE_MODEL_ID}` || event.model.id === FREE_MODEL_ID) {
			ctx.ui.setStatus("models", "⚠️ Using openrouter/free");
		} else {
			ctx.ui.setStatus("models", "🔒 OpenRouter scoped");
		}
	});
}
