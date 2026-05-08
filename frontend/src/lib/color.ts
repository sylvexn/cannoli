/** Mix two #RRGGBB hex colors at the given ratio (0 = a, 1 = b). */
export function blendHex(a: string, b: string, ratio = 0.5): string {
  const parse = (h: string): [number, number, number] => {
    const x = h.replace('#', '');
    if (x.length !== 6) return [0, 0, 0];
    return [
      parseInt(x.slice(0, 2), 16),
      parseInt(x.slice(2, 4), 16),
      parseInt(x.slice(4, 6), 16),
    ];
  };
  const [ar, ag, ab] = parse(a);
  const [br, bg, bb] = parse(b);
  const r = Math.round(ar + (br - ar) * ratio);
  const g = Math.round(ag + (bg - ag) * ratio);
  const bl = Math.round(ab + (bb - ab) * ratio);
  const toHex = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(bl)}`.toUpperCase();
}
