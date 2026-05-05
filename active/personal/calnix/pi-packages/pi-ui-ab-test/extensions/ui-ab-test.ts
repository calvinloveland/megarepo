import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
	allocateImageId,
	deleteKittyImage,
	getCapabilities,
	Image,
	Key,
	matchesKey,
	truncateToWidth,
	wrapTextWithAnsi,
} from "@mariozechner/pi-tui";
import { Type } from "typebox";
import { buildVariantPanelLines, joinPanelColumns } from "./ab-test-layout.mjs";
import {
	buildChoiceEntry,
	describePreviewImageSelection,
	loadImagePreviews,
	normalizeRationaleInput,
	resolveArtifactPaths,
	summarizeVariant,
} from "./ab-test-utils.mjs";

const TOOL_NAME = "ab_test_visuals";
const CHOICE_ENTRY_TYPE = "ui-ab-test-choice";

const VARIANT_SCHEMA = Type.Object({
	label: Type.String({ description: "Short label for this variant, e.g. 'Minimal cards' or 'Bold gradient hero'." }),
	summary: Type.String({ description: "What makes this variant visually distinct." }),
	artifactPaths: Type.Optional(
		Type.Array(Type.String({ description: "Relevant UI artifact paths such as changed HTML/CSS files or screenshots." })),
	),
	imagePaths: Type.Optional(
		Type.Array(Type.String({ description: "Preview image paths relative to cwd or absolute paths." })),
	),
});

const TOOL_PARAMS = Type.Object({
	title: Type.String({ description: "Title shown to the user for this A/B test." }),
	question: Type.Optional(Type.String({ description: "Short question shown above the picker." })),
	captureRationale: Type.Optional(
		Type.Boolean({ description: "When true, ask the user for a short optional rationale after they pick A or B." }),
	),
	rationalePrompt: Type.Optional(
		Type.String({ description: "Optional follow-up prompt shown when captureRationale is true." }),
	),
	optionA: VARIANT_SCHEMA,
	optionB: VARIANT_SCHEMA,
});

type VariantInput = {
	label: string;
	summary: string;
	artifactPaths?: string[];
	imagePaths?: string[];
};

type LoadedVariant = VariantInput & {
	key: "A" | "B";
	artifactPaths: string[];
	imagePaths: string[];
	images: Array<{ path: string; name: string; mimeType: string; data: string }>;
};

class AbChoiceComponent {
	private selectedIndex = 0;
	private previewIndices: [number, number] = [0, 0];
	private previewImageIds: Array<number | undefined> = [undefined, undefined];
	private previewImages: Array<Image | undefined> = [undefined, undefined];
	private previewImageKeys: Array<string | undefined> = [undefined, undefined];
	private previewNeedsFullRender = false;

	constructor(
		private readonly tui: any,
		private readonly theme: any,
		private readonly title: string,
		private readonly question: string | undefined,
		private readonly variants: [LoadedVariant, LoadedVariant],
		private readonly done: (result: "A" | "B" | undefined) => void,
	) {}

	private get selected(): LoadedVariant {
		return this.variants[this.selectedIndex];
	}

	private panelLines(width: number): string[] {
		if (width < 72) {
			const stacked: string[] = [];
			for (const [index, variant] of this.variants.entries()) {
				const rawLines = buildVariantPanelLines(variant, {
					columnWidth: width,
					active: index === this.selectedIndex,
					shortcut: variant.key === "A" ? "1 / A" : "2 / B",
				});
				const lines = index === this.selectedIndex ? rawLines.map((line) => this.theme.fg("accent", line)) : rawLines;
				stacked.push(...lines);
				if (index !== this.variants.length - 1) stacked.push("");
			}
			return stacked;
		}

		const gap = 3;
		const columnWidth = Math.max(32, Math.floor((width - gap) / 2));
		const leftRaw = buildVariantPanelLines(this.variants[0], {
			columnWidth,
			active: this.selectedIndex === 0,
			shortcut: "1 / A",
		});
		const rightRaw = buildVariantPanelLines(this.variants[1], {
			columnWidth,
			active: this.selectedIndex === 1,
			shortcut: "2 / B",
		});
		const left = this.selectedIndex === 0 ? leftRaw.map((line) => this.theme.fg("accent", line)) : leftRaw;
		const right = this.selectedIndex === 1 ? rightRaw.map((line) => this.theme.fg("accent", line)) : rightRaw;
		return joinPanelColumns(left, right, { columnWidth, gap });
	}

	private clearPreviewImage(slotIndex: number, deleteFromTerminal = true): void {
		const imageId = this.previewImageIds[slotIndex];
		if (deleteFromTerminal && imageId && getCapabilities().images === "kitty") {
			process.stdout.write(deleteKittyImage(imageId));
		}
		this.previewImages[slotIndex] = undefined;
		this.previewImageKeys[slotIndex] = undefined;
		this.previewImageIds[slotIndex] = undefined;
	}

	private clearAllPreviewImages(deleteFromTerminal = true): void {
		for (let index = 0; index < this.variants.length; index += 1) {
			this.clearPreviewImage(index, deleteFromTerminal);
		}
	}

	private previewComponent(slotIndex: number, width: number): Image | undefined {
		const variant = this.variants[slotIndex];
		if (variant.images.length === 0) {
			this.clearPreviewImage(slotIndex);
			return undefined;
		}
		const previewIndex = this.previewIndices[slotIndex] ?? 0;
		const preview = variant.images[previewIndex];
		if (!this.previewImages[slotIndex] || this.previewImageKeys[slotIndex] !== preview.path) {
			this.clearPreviewImage(slotIndex);
			// Kitty-compatible terminals were dropping follow-up previews when we tried
			// to reuse a single image ID across multiple assets. Treat each on-screen
			// variant preview as its own slot, but back slot refreshes with a fresh
			// terminal image ID each time a different asset is shown.
			const imageId = getCapabilities().images === "kitty" ? allocateImageId() : undefined;
			this.previewImages[slotIndex] = new Image(preview.data, preview.mimeType, this.theme, {
				filename: preview.name,
				imageId,
				maxWidthCells: Math.max(22, Math.min(64, width - 4)),
				maxHeightCells: 12,
			});
			this.previewImageIds[slotIndex] = imageId;
			this.previewImageKeys[slotIndex] = preview.path;
			this.previewNeedsFullRender = true;
		}
		return this.previewImages[slotIndex];
	}

	private finish(result: "A" | "B" | undefined): void {
		this.clearAllPreviewImages();
		this.done(result);
	}

	private setSelected(index: number): void {
		this.selectedIndex = index;
		this.tui.requestRender();
	}

	invalidate(): void {
		for (const image of this.previewImages) {
			image?.invalidate();
		}
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.left) || matchesKey(data, Key.shift("tab"))) {
			this.setSelected(this.selectedIndex === 0 ? 1 : 0);
			return;
		}
		if (matchesKey(data, Key.right) || matchesKey(data, Key.tab)) {
			this.setSelected(this.selectedIndex === 0 ? 1 : 0);
			return;
		}
		if (matchesKey(data, Key.up) && this.selected.images.length > 1) {
			this.previewIndices[this.selectedIndex] =
				((this.previewIndices[this.selectedIndex] ?? 0) + this.selected.images.length - 1) % this.selected.images.length;
			this.clearPreviewImage(this.selectedIndex);
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, Key.down) && this.selected.images.length > 1) {
			this.previewIndices[this.selectedIndex] = ((this.previewIndices[this.selectedIndex] ?? 0) + 1) % this.selected.images.length;
			this.clearPreviewImage(this.selectedIndex);
			this.tui.requestRender();
			return;
		}
		if (data === "1" || data.toLowerCase?.() === "a") {
			this.finish("A");
			return;
		}
		if (data === "2" || data.toLowerCase?.() === "b") {
			this.finish("B");
			return;
		}
		if (matchesKey(data, Key.enter)) {
			this.finish(this.selected.key);
			return;
		}
		if (matchesKey(data, Key.escape)) {
			this.finish(undefined);
		}
	}

	render(width: number): string[] {
		const lines: string[] = [];
		const pushWrapped = (text: string, style?: (value: string) => string) => {
			for (const line of wrapTextWithAnsi(text, Math.max(20, width))) {
				lines.push(style ? style(line) : line);
			}
		};
		pushWrapped(this.title, (line) => this.theme.bold(this.theme.fg("accent", line)));
		if (this.question) pushWrapped(this.question, (line) => this.theme.fg("muted", line));
		pushWrapped("Choose with 1 / A or 2 / B · Enter confirms highlighted option · Esc cancels", (line) =>
			this.theme.bold(this.theme.fg("accent", line)),
		);
		pushWrapped("←/→ or Tab switches focus · ↑/↓ cycles multiple preview images for the focused option", (line) =>
			this.theme.fg("dim", line),
		);
		lines.push("");

		for (const panelLine of this.panelLines(width)) {
			lines.push(panelLine);
		}
		lines.push("");

		pushWrapped("Preview images", (line) => this.theme.bold(this.theme.fg("accent", line)));
		pushWrapped("Both options stay visible for screenshot-based debugging; ↑/↓ cycles the focused option when it has multiple previews.", (line) =>
			this.theme.fg("dim", line),
		);
		lines.push("");

		for (const [index, variant] of this.variants.entries()) {
			const isActive = index === this.selectedIndex;
			pushWrapped(`[${variant.key}] ${variant.label}${isActive ? " ← focused" : ""}`, (line) =>
				isActive ? this.theme.bold(this.theme.fg("accent", line)) : this.theme.bold(line),
			);
			const previewDescription = describePreviewImageSelection(variant, this.previewIndices[index] ?? 0);
			if (previewDescription) {
				lines.push(this.theme.fg("dim", truncateToWidth(previewDescription, width)));
				const image = this.previewComponent(index, width);
				if (image) lines.push(...image.render(width));
			} else {
				lines.push(this.theme.fg("dim", "No preview images attached for this option."));
			}
			if (index !== this.variants.length - 1) lines.push("");
		}

		if (this.previewNeedsFullRender) {
			this.previewNeedsFullRender = false;
			// Inline image rows depend on the cursor being at the bottom of the image
			// block. Differential updates can skip those spacer rows, so ask pi-tui for
			// one immediate full redraw after any preview image is (re)created.
			queueMicrotask(() => this.tui.requestRender(true));
		}

		return lines;
	}
}

async function loadVariant(key: "A" | "B", variant: VariantInput, cwd: string): Promise<LoadedVariant> {
	const artifactPaths = resolveArtifactPaths(variant.artifactPaths ?? [], cwd);
	const imagePaths = resolveArtifactPaths(variant.imagePaths ?? [], cwd);
	const images = await loadImagePreviews(imagePaths, cwd);
	return {
		key,
		label: variant.label,
		summary: variant.summary,
		artifactPaths,
		imagePaths,
		images,
	};
}

export default function uiAbTestExtension(pi: ExtensionAPI) {
	pi.on("before_agent_start", async (event) => {
		return {
			systemPrompt:
				event.systemPrompt +
				"\n\nFor UI, styling, visual design, layout, and image-look requests where the user is choosing a direction, prefer creating two concrete variants (A and B) and then use the ab_test_visuals tool so the user can pick a preferred look before you finalize the winning option. When knowing why the user picked a variant will help later polish or follow-up work, set captureRationale=true so the tool asks for a short rationale after the choice.",
		};
	});

	pi.registerTool({
		name: TOOL_NAME,
		label: "A/B test visuals",
		description:
			"Present two visual variants to the user, optionally with preview images and artifact paths, and collect which look they prefer.",
		promptSnippet: "Present two UI or image variants and ask the user to pick the preferred look.",
		promptGuidelines: [
			"Use ab_test_visuals when you have two concrete visual alternatives and the user should choose a preferred look before you finalize implementation.",
			"Include preview image paths when available so ab_test_visuals can display the alternatives visually.",
			"When the user's reasoning will help you refine the winning design, set captureRationale to true and optionally customize rationalePrompt.",
		],
		parameters: TOOL_PARAMS,
		async execute(_toolCallId, params: any, _signal, _onUpdate, ctx) {
			const variants: [LoadedVariant, LoadedVariant] = [
				await loadVariant("A", params.optionA, ctx.cwd),
				await loadVariant("B", params.optionB, ctx.cwd),
			];

			if (!ctx.hasUI) {
				const rationaleRequested = Boolean(params.captureRationale);
				return {
					content: [
						{
							type: "text",
							text: `A/B test '${params.title}' is not interactive in this mode.\n\nOption A — ${params.optionA.label}\n${summarizeVariant(variants[0])}\n\nOption B — ${params.optionB.label}\n${summarizeVariant(variants[1])}${rationaleRequested ? "\n\nRationale capture was requested but is only available in interactive UI mode." : ""}`,
						},
					],
					details: { interactive: false, rationaleRequested, variants },
				};
			}

			const choice = await ctx.ui.custom<"A" | "B" | undefined>(
				(tui, theme, _kb, done) => new AbChoiceComponent(tui, theme, params.title, params.question, variants, done),
			);

			if (!choice) {
				return {
					content: [{ type: "text", text: `A/B test '${params.title}' was cancelled by the user.` }],
					details: { cancelled: true, variants },
				};
			}

			const selected = variants.find((variant) => variant.key === choice)!;
			const rationaleRequested = Boolean(params.captureRationale);
			const rationalePrompt = params.rationalePrompt || `Why did you choose option ${choice}?`;
			const rationale = rationaleRequested
				? normalizeRationaleInput(await ctx.ui.input(rationalePrompt, "Optional — press Enter to skip"))
				: null;
			const entry = buildChoiceEntry({
				title: params.title,
				choice,
				selected,
				rationale,
			});
			pi.appendEntry(CHOICE_ENTRY_TYPE, entry);

			return {
				content: [
					{
						type: "text",
						text: `User selected variant ${choice}: ${selected.label}. ${selected.summary}${rationale ? ` Rationale: ${rationale}` : rationaleRequested ? " No rationale provided." : ""}`,
					},
				],
				details: {
					choice,
					selected,
					rationaleRequested,
					rationale,
					entry,
					variants,
				},
			};
		},
	});
}
