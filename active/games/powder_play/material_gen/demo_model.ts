// Simple deterministic demo model generator used for local testing.
export function generateDemoModel(intent: string) {
  // Map some keywords to behavior with tag-based materials.
  const lower = (intent || "").toLowerCase();
  const name = "demo_" + (lower.split(/\s+/)[0] || "x");
  if (lower.includes("water")) {
    return {
      type: "material",
      name,
      description: intent,
      tags: ["flow"],
      density: 1.0,
      color: [60, 140, 220],
    };
  }
  // default: simple falling dust
  return {
    type: "material",
    name,
    description: intent,
    tags: ["sand"],
    density: 1.5,
    color: [190, 180, 140],
  };
}
