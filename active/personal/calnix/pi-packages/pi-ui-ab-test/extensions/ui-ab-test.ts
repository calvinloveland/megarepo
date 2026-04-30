import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Container, Image, Key, Text, matchesKey, truncateToWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui";
import { Type } from "typebox";
import { loadImagePreviews, resolveArtifactPaths, summarizeVariant } from "./ab-test-utils.mjs";

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
	private previewIndex = 0;

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

	private setSelected(index: number): void {
		this.selectedIndex = index;
		this.previewIndex = 0;
		this.tui.requestRender();
	}

	invalidate(): void {}

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
			this.previewIndex = (this.previewIndex + this.selected.images.length - 1) % this.selected.images.length;
			this.tui.requestRender();
			return;
		}
		if (matchesKey(data, Key.down) && this.selected.images.length > 1) {
			this.previewIndex = (this.previewIndex + 1) % this.selected.images.length;
			this.tui.requestRender();
			return;
		}
		if (data === "1" || data.toLowerCase?.() === "a") {
			this.done("A");
			return;
		}
		if (data === "2" || data.toLowerCase?.() === "b") {
			this.done("B");
			return;
		}
		if (matchesKey(data, Key.enter)) {
			this.done(this.selected.key);
			return;
		}
		if (matchesKey(data, Key.escape)) {
			this.done(undefined);
		}
	}

	render(width: number): string[] {
		const container = new Container();
		container.addChild(new Text(this.theme.bold(this.theme.fg("accent", this.title)), 0, 0));
		if (this.question) container.addChild(new Text(this.theme.fg("muted", this.question), 0, 0));
		container.addChild(
			new Text(this.theme.fg("dim", "←/→ or Tab switch · ↑/↓ cycle preview images · Enter choose · Esc cancel"), 0, 0),
		);
		container.addChild(new Text("", 0, 0));

		for (const [idx, variant] of this.variants.entries()) {
			const active = idx === this.selectedIndex;
			const marker = active ? this.theme.fg("accent", "▶") : this.theme.fg("muted", " ");
			const heading = `${marker} [${variant.key}] ${variant.label}`;
			container.addChild(new Text(active ? this.theme.bold(this.theme.fg("accent", heading)) : heading, 0, 0));
			for (const line of wrapTextWithAnsi(variant.summary, Math.max(20, width - 2))) {
				container.addChild(new Text(`  ${line}`, 0, 0));
			}
			if (variant.artifactPaths.length > 0) {
				const artifactLine = `Artifacts: ${variant.artifactPaths.join(", ")}`;
				for (const line of wrapTextWithAnsi(this.theme.fg("dim", artifactLine), Math.max(20, width - 2))) {
					container.addChild(new Text(`  ${line}`, 0, 0));
				}
			}
			if (variant.images.length > 0) {
				container.addChild(
					new Text(this.theme.fg("dim", `  ${variant.images.length} preview image${variant.images.length === 1 ? "" : "s"}`), 0, 0),
				);
			}
			container.addChild(new Text("", 0, 0));
		}

		container.addChild(
			new Text(this.theme.bold(this.theme.fg("accent", `Preview [${this.selected.key}] ${this.selected.label}`)), 0, 0),
		);
		const selectedSummary = summarizeVariant(this.selected);
		for (const line of wrapTextWithAnsi(selectedSummary || "No summary provided.", Math.max(20, width))) {
			container.addChild(new Text(line, 0, 0));
		}
		container.addChild(new Text("", 0, 0));

		if (this.selected.images.length > 0) {
			const preview = this.selected.images[this.previewIndex];
			container.addChild(
				new Text(
					this.theme.fg(
						"dim",
						truncateToWidth(
							`${preview.name} (${this.previewIndex + 1}/${this.selected.images.length})`,
							width,
						),
					),
					0,
					0,
				),
			);
			container.addChild(
				new Image(preview.data, preview.mimeType, this.theme, {
					maxWidthCells: Math.max(20, Math.min(80, width - 2)),
					maxHeightCells: 24,
				}),
			);
		} else {
			container.addChild(new Text(this.theme.fg("dim", "No preview images attached for this option."), 0, 0));
		}

		return container.render(width);
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
				"\n\nFor UI, styling, visual design, layout, and image-look requests where the user is choosing a direction, prefer creating two concrete variants (A and B) and then use the ab_test_visuals tool so the user can pick a preferred look before you finalize the winning option.",
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
		],
		parameters: TOOL_PARAMS,
		async execute(_toolCallId, params: any, _signal, _onUpdate, ctx) {
			const variants: [LoadedVariant, LoadedVariant] = [
				await loadVariant("A", params.optionA, ctx.cwd),
				await loadVariant("B", params.optionB, ctx.cwd),
			];

			if (!ctx.hasUI) {
				return {
					content: [
						{
							type: "text",
							text: `A/B test '${params.title}' is not interactive in this mode. Option A: ${params.optionA.label}. Option B: ${params.optionB.label}.`,
						},
					],
					details: { interactive: false, variants },
				};
			}

			const choice = await ctx.ui.custom<"A" | "B" | undefined>(
				(tui, theme, _kb, done) => new AbChoiceComponent(tui, theme, params.title, params.question, variants, done),
				{ overlay: true },
			);

			if (!choice) {
				return {
					content: [{ type: "text", text: `A/B test '${params.title}' was cancelled by the user.` }],
					details: { cancelled: true, variants },
				};
			}

			const selected = variants.find((variant) => variant.key === choice)!;
			pi.appendEntry(CHOICE_ENTRY_TYPE, {
				title: params.title,
				choice,
				label: selected.label,
				artifactPaths: selected.artifactPaths,
				imagePaths: selected.imagePaths,
				timestamp: new Date().toISOString(),
			});

			return {
				content: [
					{ type: "text", text: `User selected variant ${choice}: ${selected.label}. ${selected.summary}` },
				],
				details: {
					choice,
					selected,
					variants,
				},
			};
		},
	});
}
