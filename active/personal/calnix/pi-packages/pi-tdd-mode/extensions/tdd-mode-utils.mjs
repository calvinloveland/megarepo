import { isAbsolute, resolve } from "node:path";
import { stat } from "node:fs/promises";

export function resolvePaths(paths = [], cwd = process.cwd()) {
	return [...new Set(paths.filter(Boolean).map((value) => (isAbsolute(value) ? value : resolve(cwd, value))))];
}

export function truncateOutput(text = "", maxChars = 4000) {
	const normalized = `${text ?? ""}`.trim();
	if (normalized.length <= maxChars) return normalized;
	const head = normalized.slice(0, Math.floor(maxChars / 2));
	const tail = normalized.slice(-Math.floor(maxChars / 2));
	return `${head}\n…\n${tail}`;
}

export async function inspectTestFiles(testFiles = [], cwd = process.cwd(), turnStartedAt = 0) {
	const resolved = resolvePaths(testFiles, cwd);
	const existing = [];
	const missing = [];
	const changedThisRun = [];

	for (const filePath of resolved) {
		try {
			const info = await stat(filePath);
			existing.push(filePath);
			if (info.mtimeMs >= turnStartedAt - 1000) {
				changedThisRun.push(filePath);
			}
		} catch {
			missing.push(filePath);
		}
	}

	return {
		resolved,
		existing,
		missing,
		changedThisRun,
		ok: missing.length === 0 && changedThisRun.length > 0,
	};
}
