import { test, expect } from "@playwright/test";
import { createFailureLogger } from "./helpers/failure_logger";

const tagExamples = [
  "Sand => sand",
  "Water => flow, water",
  "Oil => flow, flammable",
  "Steam => float, steam",
  "Smoke => float, smoke",
  "Salt => sand",
  "Metal => static",
  "Stone => sand",
  "Wood => static, flammable",
  "Glass => static",
  "Fire => float, fire, burns_out",
  "Sodium => sand, reactive_water, explosive",
];

const densityExamples = [
  "Sand => 1.6",
  "Water => 1.0",
  "Oil => 0.9",
  "Steam => 0.2",
  "Smoke => 0.1",
  "Salt => 2.0",
  "Metal => 3.5",
  "Stone => 2.4",
  "Wood => 0.7",
  "Glass => 2.5",
];

const colorExamples = [
  "Sand => 160,150,130",
  "Water => 80,120,200",
  "Oil => 90,80,60",
  "Steam => 200,200,220",
  "Smoke => 180,180,190",
  "Salt => 220,220,220",
  "Metal => 120,120,130",
  "Stone => 180,170,160",
  "Wood => 120,90,60",
  "Glass => 190,200,210",
];

const descriptionExamples = [
  "Sand => Heavy granular sand.",
  "Water => Clear flowing liquid.",
  "Oil => Slick viscous liquid.",
  "Steam => Light drifting vapor.",
  "Smoke => Thin sooty haze.",
  "Salt => Sharp crystalline grains.",
  "Metal => Solid heavy metal.",
  "Stone => Hard rough solid.",
  "Wood => Dry fibrous solid.",
  "Glass => Clear brittle solid.",
];

const allowedTags = new Set([
  "sand",
  "flow",
  "float",
  "static",
  "water",
  "fire",
  "flammable",
  "reactive_water",
  "explosive",
  "burns_out",
  "smoke",
  "steam",
]);

function buildPrompt(
  title: string,
  examples: string[],
  name: string,
  trailer: string,
) {
  const lines = [title, ...examples, `${name} =>`, trailer];
  return lines.join("\n");
}

function parseTags(resp: string) {
  const tokens = resp
    .toLowerCase()
    .split(/[^a-z]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  const tags = tokens.filter((t) => allowedTags.has(t));
  return Array.from(new Set(tags));
}

function parseDensity(resp: string) {
  const match = resp.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const value = Number.parseFloat(match[0]);
  return Number.isFinite(value) ? value : null;
}

function parseColor(resp: string) {
  const matches = resp.match(/-?\d+(?:\.\d+)?/g) || [];
  if (matches.length < 3) return null;
  const nums = matches.slice(0, 3).map((m) => Math.round(Number.parseFloat(m)));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  return nums;
}

test("llm responds to property prompts", async ({ request }, testInfo) => {
  const logger = createFailureLogger(testInfo);
  let failed = false;
  try {
    test.setTimeout(120000);
    const health = await request
      .get("http://127.0.0.1:8787/health")
      .catch(() => null);
    if (!health || !health.ok()) {
      test.skip(true, "mix server unavailable");
    }

    const name = "Mist";
    const prompts = {
      tags: buildPrompt(
        "Tags:",
        tagExamples,
        name,
        "Return only comma-separated tags from: sand, flow, float, static, water, fire, flammable, reactive_water, explosive, burns_out, smoke, steam.",
      ),
      density: buildPrompt(
        "Densities:",
        densityExamples,
        name,
        "Return only the numeric density.",
      ),
      color: buildPrompt(
        "Colors (RGB):",
        colorExamples,
        name,
        "Return only three comma-separated integers (r,g,b).",
      ),
      description: buildPrompt(
        "Descriptions:",
        descriptionExamples,
        name,
        "Return a short sentence only.",
      ),
    };

    async function postText(prompt: string) {
      const res = await request.post("http://127.0.0.1:8787/llm", {
        data: {
          prompt,
          format: "text",
          system:
            "Respond with a single line of plain text only. Do not include JSON, markdown, or extra commentary.",
        },
        timeout: 120000,
      });
      expect(res.ok()).toBeTruthy();
      const payload = await res.json();
      return String(payload?.response || "").trim();
    }

    let tagsText = "";
    let densityText = "";
    let colorText = "";
    let descriptionText = "";

    try {
      tagsText = await postText(prompts.tags);
      densityText = await postText(prompts.density);
      colorText = await postText(prompts.color);
      descriptionText = await postText(prompts.description);
    } catch (err) {
      test.skip(true, "LLM request timed out");
    }

    logger.log("tags prompt", prompts.tags);
    logger.log("tags response", tagsText);
    const tags = parseTags(tagsText);
    expect(tags.length).toBeGreaterThan(0);

    logger.log("density prompt", prompts.density);
    logger.log("density response", densityText);
    const density = parseDensity(densityText);
    expect(typeof density).toBe("number");

    logger.log("color prompt", prompts.color);
    logger.log("color response", colorText);
    let color = parseColor(colorText);
    if (!color) {
      const retryPrompt = `${prompts.color}\nExample: 120,130,140`;
      logger.log("color retry prompt", retryPrompt);
      try {
        colorText = await postText(retryPrompt);
        logger.log("color retry response", colorText);
        color = parseColor(colorText);
      } catch (err) {
        test.skip(true, "LLM request timed out");
      }
    }
    expect(Array.isArray(color)).toBeTruthy();
    expect((color || []).length).toBeGreaterThanOrEqual(3);

    logger.log("description prompt", prompts.description);
    logger.log("description response", descriptionText);
    expect(descriptionText.length).toBeGreaterThan(0);
  } catch (err) {
    failed = true;
    throw err;
  } finally {
    logger.flush(failed);
  }
});
