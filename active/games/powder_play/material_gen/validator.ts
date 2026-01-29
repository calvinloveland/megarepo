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

// Lightweight validator to avoid heavy dependency during early prototyping.
export async function validateMaterial(
  ast: any,
): Promise<{ ok: boolean; errors?: any[] }> {
  const errors: any[] = [];
  if (!ast || typeof ast !== "object")
    return { ok: false, errors: [{ message: "ast must be object" }] };
  if (ast.type !== "material")
    errors.push({ message: 'type must be "material"' });
  if (typeof ast.name !== "string" || !ast.name)
    errors.push({ message: "name required" });
  if (ast.primitives !== undefined)
    errors.push({ message: "primitives are no longer supported" });
  if (ast.budgets !== undefined)
    errors.push({ message: "budgets are no longer supported" });
  if (!Array.isArray(ast.tags) || ast.tags.length === 0) {
    errors.push({ message: "tags must be non-empty array" });
  } else {
    for (const tag of ast.tags) {
      if (typeof tag !== "string" || !allowedTags.has(tag))
        errors.push({ message: "invalid tag" });
    }
  }
  if (ast.color === undefined) {
    errors.push({ message: "color required" });
  } else {
    const c = ast.color;
    const isHex = typeof c === "string";
    const isArray =
      Array.isArray(c) &&
      c.length >= 3 &&
      c.length <= 4 &&
      c.every((v: any) => typeof v === "number" && v >= 0 && v <= 255);
    if (!isHex && !isArray)
      errors.push({ message: "color must be hex string or [r,g,b] array" });
  }
  if (
    ast.density === undefined ||
    typeof ast.density !== "number" ||
    ast.density < 0
  ) {
    errors.push({ message: "density must be non-negative number" });
  }
  if (ast.reactions !== undefined) {
    if (!Array.isArray(ast.reactions))
      errors.push({ message: "reactions must be array" });
    else {
      for (const r of ast.reactions) {
        if (!r || typeof r !== "object") {
          errors.push({ message: "reaction must be object" });
          continue;
        }
        if (typeof r.with !== "string" || !r.with)
          errors.push({ message: "reaction.with required" });
        if (typeof r.result !== "string" || !r.result)
          errors.push({ message: "reaction.result required" });
        if (r.byproduct !== undefined && typeof r.byproduct !== "string")
          errors.push({ message: "reaction.byproduct must be string" });
        if (
          r.probability !== undefined &&
          (typeof r.probability !== "number" ||
            r.probability < 0 ||
            r.probability > 1)
        )
          errors.push({ message: "reaction.probability must be 0..1" });
        if (r.priority !== undefined && typeof r.priority !== "number")
          errors.push({ message: "reaction.priority must be number" });
      }
    }
  }
  if (ast.condense !== undefined) {
    const c = ast.condense;
    if (!c || typeof c !== "object")
      errors.push({ message: "condense must be object" });
    else {
      if (c.at !== "top") errors.push({ message: 'condense.at must be "top"' });
      if (typeof c.result !== "string" || !c.result)
        errors.push({ message: "condense.result required" });
      if (
        c.probability !== undefined &&
        (typeof c.probability !== "number" ||
          c.probability < 0 ||
          c.probability > 1)
      )
        errors.push({ message: "condense.probability must be 0..1" });
    }
  }
  return {
    ok: errors.length === 0,
    errors: errors.length ? errors : undefined,
  };
}
