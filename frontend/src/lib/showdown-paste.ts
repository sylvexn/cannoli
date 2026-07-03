/**
 * Set-detail lines in a Showdown/PokePaste export ("Ability: Levitate",
 * "EVs: 252 Spe", …). Matched as an explicit keyword list instead of a
 * blanket "contains a colon" check so the one species with a colon in its
 * name — "Type: Null" — still parses as a species line.
 */
const DETAIL_LINE =
  /^(?:Ability|EVs|IVs|Level|Shiny|Happiness|Tera Type|Gigantamax|Dynamax Level|Hidden Power|Nature):/i;

/** Parse a Showdown/PokePaste team export into Pokemon names */
export function parseShowdownPaste(text: string): string[] {
  const names: string[] = [];
  const lines = text.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('-') || trimmed.startsWith('=') ||
        DETAIL_LINE.test(trimmed) || /^\w+ Nature$/.test(trimmed)) continue;

    // Pokemon line: "Nickname (Species) @ Item" or "Species @ Item" or just "Species"
    let name = trimmed;
    // Remove item
    const atIdx = name.lastIndexOf(' @ ');
    if (atIdx > 0) name = name.substring(0, atIdx);
    // Remove gender
    name = name.replace(/\s*\(M\)\s*$/, '').replace(/\s*\(F\)\s*$/, '');
    // If has parentheses, extract species: "Nickname (Species)" → "Species"
    const parenMatch = name.match(/\(([^)]+)\)/);
    if (parenMatch) {
      name = parenMatch[1].trim();
    }
    name = name.trim();
    if (name && !name.startsWith('=') && !DETAIL_LINE.test(name)) {
      names.push(name);
    }
  }
  return names;
}
