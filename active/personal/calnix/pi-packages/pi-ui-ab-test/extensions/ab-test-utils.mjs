import { basename, extname, isAbsolute, resolve } from "node:path";
import { readFile } from "node:fs/promises";

const IMAGE_MIME_TYPES = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
};

export function resolveArtifactPaths(paths = [], cwd = process.cwd()) {
	return [...new Set(paths.filter(Boolean).map((p) => (isAbsolute(p) ? p : resolve(cwd, p))))];
}

export function getImageMimeType(filePath) {
	return IMAGE_MIME_TYPES[extname(filePath).toLowerCase()] ?? null;
}

export async function loadImagePreview(filePath, cwd = process.cwd()) {
	const absolutePath = isAbsolute(filePath) ? filePath : resolve(cwd, filePath);
	const mimeType = getImageMimeType(absolutePath);
	if (!mimeType) {
		throw new Error(`Unsupported preview image type for ${filePath}. Use png, jpg, jpeg, gif, or webp.`);
	}
	const data = await readFile(absolutePath, "base64");
	return {
		path: absolutePath,
		name: basename(absolutePath),
		mimeType,
		data,
	};
}

export async function loadImagePreviews(paths = [], cwd = process.cwd()) {
	const resolved = resolveArtifactPaths(paths, cwd);
	return await Promise.all(resolved.map((path) => loadImagePreview(path, cwd)));
}

export function describePreviewImageSelection(variant, previewIndex = 0) {
	if (!variant?.images?.length) return null;
	const boundedIndex = Math.max(0, Math.min(previewIndex, variant.images.length - 1));
	const preview = variant.images[boundedIndex];
	return `${preview.name} (${boundedIndex + 1}/${variant.images.length})`;
}

export function summarizeVariant(variant) {
	const lines = [];
	if (variant.summary) lines.push(variant.summary);
	if (variant.artifactPaths?.length) lines.push(`Artifacts: ${variant.artifactPaths.join(", ")}`);
	if (variant.imagePaths?.length) lines.push(`Preview images: ${variant.imagePaths.join(", ")}`);
	return lines.join("\n").trim();
}

export function normalizeRationaleInput(value) {
	if (value === undefined || value === null) return null;
	const trimmed = `${value}`.trim();
	return trimmed ? trimmed : null;
}

export function buildChoiceEntry({ title, choice, selected, rationale, timestamp = new Date().toISOString() }) {
	const normalizedRationale = normalizeRationaleInput(rationale);
	return {
		title,
		choice,
		label: selected.label,
		summary: selected.summary,
		artifactPaths: selected.artifactPaths ?? [],
		imagePaths: selected.imagePaths ?? [],
		rationale: normalizedRationale,
		timestamp,
	};
}
