export function sourceToolName(materialName: string) {
  return `${materialName} Source`;
}

function tint(color: number[], amount: number) {
  return color.map((n) => Math.max(0, Math.min(255, Math.round(n + (255 - n) * amount))));
}

export function buildSourceToolMaterial(mat: any) {
  if (!mat?.name) return null;
  const tags = Array.isArray(mat.tags) ? mat.tags.map((t: any) => String(t).toLowerCase()) : [];
  if (tags.includes("source") || tags.includes("drain")) return null;
  const baseColor = Array.isArray(mat.color) && mat.color.length >= 3 ? mat.color.slice(0, 3) : [100, 200, 255];
  return {
    type: "material",
    name: sourceToolName(mat.name),
    description: `Continuously emits ${mat.name}.`,
    color: tint(baseColor, 0.25),
    density: 10,
    tags: ["source"],
    emits: mat.name,
    burnoutRate: 0,
  };
}
