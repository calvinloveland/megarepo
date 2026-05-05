export const SUBAGENT_IMAGE_SAFETY_PROMPT = `Subagent safety rules:
- Prefer text artifacts, diff JSON, OCR output, and other structured summaries over reading image files directly.
- Reading multiple large images into one subagent conversation can trigger provider 413 request errors.
- Never read more than one image in the same turn unless the task explicitly requires it and you have already summarized prior image findings.
- For screenshot-diff work, inspect *.json, README, tests, and source files first; only read a single image when there is no text artifact that answers the question.`;

export function buildChildPiArgs({ model, tools = [], appendSystemPromptPath } = {}) {
	const args = ["--mode", "json", "-p", "--no-session", "--no-extensions", "--no-skills"];
	if (model) args.push("--model", model);
	if (tools.length > 0) args.push("--tools", tools.join(","));
	if (appendSystemPromptPath) args.push("--append-system-prompt", appendSystemPromptPath);
	return args;
}
