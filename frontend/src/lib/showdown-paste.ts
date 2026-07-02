/** Parse a Showdown/PokePaste team export into Pokemon names */
export function parseShowdownPaste(text: string): string[] {
  const names: string[] = [];
  const lines = text.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('-') || trimmed.startsWith('Ability:') ||
        trimmed.startsWith('EVs:') || trimmed.startsWith('IVs:') ||
        trimmed.startsWith('Level:') || trimmed.startsWith('Shiny:') ||
        trimmed.startsWith('Tera Type:') || trimmed.startsWith('Happiness:') ||
        /^\w+ Nature$/.test(trimmed)) continue;

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
    if (name && !name.includes(':') && !name.startsWith('=')) {
      names.push(name);
    }
  }
  return names;
}
