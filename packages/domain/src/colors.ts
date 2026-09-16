/** Parse #rgb / #rrggbb / rgb() / rgba() into RGB channels. */
export function parseColor(input: string): [number, number, number] | null {
  if (!input) return null;
  const value = input.trim();
  if (value.startsWith("#")) {
    let hex = value.slice(1);
    if (hex.length === 3) hex = hex.split("").map((part) => `${part}${part}`).join("");
    if (!/^[0-9a-f]{6}$/i.test(hex)) return null;
    const parsed = Number.parseInt(hex, 16);
    return [(parsed >> 16) & 255, (parsed >> 8) & 255, parsed & 255];
  }
  const rgb = value.match(/^rgba?\(([^)]+)\)$/i);
  if (!rgb) return null;
  const channels = rgb[1].split(",").slice(0, 3).map((part) => Number.parseFloat(part));
  if (channels.length !== 3 || channels.some((channel) => !Number.isFinite(channel))) return null;
  return channels.map((channel) => Math.max(0, Math.min(255, channel))) as [number, number, number];
}

/** WCAG relative luminance of a solid color. */
export function relativeLuminance(color: string): number | null {
  const rgb = parseColor(color);
  if (!rgb) return null;
  const linear = rgb.map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

/** WCAG contrast ratio between two solid colors, or null if either is unparseable. */
export function contrastRatio(left: string, right: string): number | null {
  const a = relativeLuminance(left);
  const b = relativeLuminance(right);
  if (a === null || b === null) return null;
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const DARK_INK = "#1f2937";

/**
 * Select a dark or white foreground with the stronger WCAG contrast.
 *
 * The old form compared luminance against a fixed 0.179 threshold, which is a
 * proxy for the real question and gets it wrong near the crossover: at exactly
 * 0.179 both candidates sit at ~4.6:1, but a few points either side the
 * threshold and the true ratios diverge while the answer does not move.
 * Measuring both candidates is the same amount of work and cannot disagree with
 * the contrast a checker reports.
 */
export function readableTextColor(background: string, fallback = "#ffffff"): string {
  const dark = contrastRatio(background, DARK_INK);
  const light = contrastRatio(background, "#ffffff");
  if (dark === null || light === null) return fallback;
  if (dark >= light) return DARK_INK;
  // The caller's fallback is the configured calendar text colour; honour it when
  // it is at least as readable as plain white.
  const configured = contrastRatio(background, fallback);
  return configured !== null && configured >= light ? fallback : "#ffffff";
}

export function colorWithOpacity(color: string | undefined, opacityHex = "66", fallback = "#3b82f6"): string {
  const safeOpacity = /^[0-9a-f]{2}$/i.test(opacityHex) ? opacityHex : "66";
  if (!color || !/^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(color)) return `${fallback.slice(0, 7)}${safeOpacity}`;
  return `${color.slice(0, 7)}${safeOpacity}`;
}

export function hexToRgba(color: string | undefined, alpha: number, fallback = "#3b82f6"): string {
  const rgb = parseColor(color ?? fallback) ?? parseColor(fallback) ?? [59, 130, 246];
  const boundedAlpha = Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : 1;
  return `rgba(${Math.round(rgb[0])}, ${Math.round(rgb[1])}, ${Math.round(rgb[2])}, ${boundedAlpha})`;
}
