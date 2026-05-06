export function parseFrontmatter(content) {
  const normalized = String(content ?? "").replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n")) {
    return { frontmatter: {}, body: normalized };
  }

  const endMarker = normalized.indexOf("\n---\n", 4);
  if (endMarker === -1) {
    return { frontmatter: {}, body: normalized };
  }

  const rawFrontmatter = normalized.slice(4, endMarker);
  const body = normalized.slice(endMarker + 5);
  const frontmatter = {};

  for (const line of rawFrontmatter.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf(":");
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    frontmatter[key] = value;
  }

  return { frontmatter, body };
}
