function wrapPlainText(text, width) {
	const clean = `${text ?? ""}`.trim();
	if (!clean) return [];
	const targetWidth = Math.max(12, width);
	const words = clean.split(/\s+/);
	const lines = [];
	let current = "";
	for (const word of words) {
		const next = current ? `${current} ${word}` : word;
		if (next.length <= targetWidth) {
			current = next;
			continue;
		}
		if (current) lines.push(current);
		if (word.length <= targetWidth) {
			current = word;
			continue;
		}
		let remaining = word;
		while (remaining.length > targetWidth) {
			lines.push(remaining.slice(0, targetWidth - 1) + "…");
			remaining = remaining.slice(targetWidth - 1);
		}
		current = remaining;
	}
	if (current) lines.push(current);
	return lines;
}

function pad(text, width) {
	const raw = `${text ?? ""}`;
	return raw.length >= width ? raw.slice(0, width) : raw + " ".repeat(width - raw.length);
}

export function buildVariantPanelLines(variant, { columnWidth, active, shortcut }) {
	const panelWidth = Math.max(28, columnWidth);
	const innerWidth = panelWidth - 4;
	const border = "─".repeat(innerWidth + 2);
	const title = `${active ? "▶" : " "} ${variant.key} — ${variant.label}`;
	const choose = active ? `Enter chooses this • Press ${shortcut}` : `Press ${shortcut} to choose`;
	const counts = `${variant.artifactPaths?.length ?? 0} artifact(s) • ${variant.imagePaths?.length ?? 0} preview(s)`;
	const summaryLines = wrapPlainText(variant.summary || "No summary provided.", innerWidth);
	const body = [title, choose, counts, ...summaryLines].map((line) => `│ ${pad(line, innerWidth)} │`);
	return [`┌${border}┐`, ...body, `└${border}┘`];
}

export function joinPanelColumns(leftLines, rightLines, { columnWidth, gap = 3 }) {
	const total = Math.max(leftLines.length, rightLines.length);
	const spacer = " ".repeat(gap);
	const rows = [];
	for (let index = 0; index < total; index += 1) {
		rows.push(`${pad(leftLines[index] ?? "", columnWidth)}${spacer}${pad(rightLines[index] ?? "", columnWidth)}`.trimEnd());
	}
	return rows;
}
