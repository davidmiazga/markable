/**
 * Link colors that stay readable on a note background.
 *
 * A theme's own `--link-color` is kept when it clears the background.
 * Otherwise the built-in default for that background is used.
 */

/** Default on light note backgrounds. Matches `:root` in styles.css. */
export const DEFAULT_LINK_ON_LIGHT = "hsl(212, 95%, 40%)";

/** Default on dark note backgrounds. Matches `[data-theme="dark"]` in styles.css. */
export const DEFAULT_LINK_ON_DARK = "hsl(212, 92%, 60%)";

/** WCAG AA body-text floor. Below this a link disappears into the note. */
export const MIN_LINK_BACKGROUND_CONTRAST = 4.5;

/** Floor so a built-in link is not the same color as the body text. */
export const MIN_LINK_TEXT_CONTRAST = 2;

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function rgb(r: number, g: number, b: number): Rgb {
  return { r: clampChannel(r), g: clampChannel(g), b: clampChannel(b) };
}

/** Parse `#rgb`, `#rrggbb`, `rgb()`, or `hsl()`. Returns null for anything else. */
export function parseCssColor(input: string): Rgb | null {
  const value = input.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(value);
  if (hex) {
    const raw = hex[1];
    const full = raw.length === 3
      ? raw.split("").map((ch) => ch + ch).join("")
      : raw;
    return rgb(
      parseInt(full.slice(0, 2), 16),
      parseInt(full.slice(2, 4), 16),
      parseInt(full.slice(4, 6), 16),
    );
  }

  const rgbMatch = /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)/.exec(value);
  if (rgbMatch) {
    return rgb(Number(rgbMatch[1]), Number(rgbMatch[2]), Number(rgbMatch[3]));
  }

  const hslMatch = /^hsla?\(\s*([0-9.]+)\s*,\s*([0-9.]+)%\s*,\s*([0-9.]+)%/.exec(value);
  if (hslMatch) {
    return hslToRgb(Number(hslMatch[1]), Number(hslMatch[2]), Number(hslMatch[3]));
  }

  return null;
}

function hslToRgb(h: number, s: number, l: number): Rgb {
  const sat = s / 100;
  const light = l / 100;
  const a = sat * Math.min(light, 1 - light);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = light - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return 255 * color;
  };
  return rgb(channel(0), channel(8), channel(4));
}

function linearize(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(color: Rgb): number {
  return 0.2126 * linearize(color.r) + 0.7152 * linearize(color.g) + 0.0722 * linearize(color.b);
}

/** WCAG contrast ratio. Unparseable colors return 1 (no contrast). */
export function contrastRatio(a: string, b: string): number {
  const left = parseCssColor(a);
  const right = parseCssColor(b);
  if (!left || !right) return 1;
  const l1 = relativeLuminance(left);
  const l2 = relativeLuminance(right);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Dark blue on a light note, light blue on a dark note. */
export function defaultLinkColor(background: string): string {
  const parsed = parseCssColor(background);
  if (!parsed) return DEFAULT_LINK_ON_LIGHT;
  return relativeLuminance(parsed) > 0.4 ? DEFAULT_LINK_ON_LIGHT : DEFAULT_LINK_ON_DARK;
}

/**
 * Theme link color when it stays readable on `background`, otherwise the default.
 * An unparseable theme color falls back to the default.
 */
export function readableLinkColor(themeLink: string, background: string): string {
  const fallback = defaultLinkColor(background);
  if (!parseCssColor(themeLink) || !parseCssColor(background)) return fallback;
  if (contrastRatio(themeLink, background) >= MIN_LINK_BACKGROUND_CONTRAST) return themeLink;
  return fallback;
}

/**
 * After a theme is applied, keep its `--link-color` when the color stays
 * readable on the note background. Otherwise set the built-in default.
 * Other theme tokens are left alone.
 */
export function applyReadableLinkColor(root: HTMLElement = document.documentElement): void {
  root.style.removeProperty("--link-color");
  const style = getComputedStyle(root);
  const link = style.getPropertyValue("--link-color").trim();
  const background = style.getPropertyValue("--bg-primary").trim();
  if (!link || !background) return;
  const next = readableLinkColor(link, background);
  if (next !== link) root.style.setProperty("--link-color", next);
}
