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

export function summarizeVariant(variant) {
	const lines = [];
	if (variant.summary) lines.push(variant.summary);
	if (variant.artifactPaths?.length) lines.push(`Artifacts: ${variant.artifactPaths.join(", ")}`);
	if (variant.imagePaths?.length) lines.push(`Preview images: ${variant.imagePaths.join(", ")}`);
	return lines.join("\n").trim();
}
