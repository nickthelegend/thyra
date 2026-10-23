import '@fontsource/host-grotesk/400.css';
import '@fontsource/host-grotesk/500.css';
import '@fontsource/host-grotesk/600.css';
import '@fontsource/ubuntu-sans-mono/400.css';
import '@fontsource/ubuntu-sans-mono/500.css';

/** BRANDS.md Themes v3 row (Thyra, carried over from Tobira). */
export const BRAND = {
  plaster: '#ece7de',
  sumi: '#171614',
  lime: '#c8f03c',
  grey: '#8a857c',
  setup: '#ffb547',
  error: '#ff6b5b',
  sans: '"Host Grotesk", system-ui, sans-serif',
  mono: '"Ubuntu Sans Mono", ui-monospace, monospace',
} as const;

/** Canvas text needs the web fonts decoded first. */
export async function loadBrandFonts(): Promise<void> {
  try {
    await Promise.all([
      document.fonts.load(`500 48px ${BRAND.sans}`),
      document.fonts.load(`600 48px ${BRAND.sans}`),
      document.fonts.load(`400 48px ${BRAND.sans}`),
      document.fonts.load(`400 32px ${BRAND.mono}`),
      document.fonts.load(`500 32px ${BRAND.mono}`),
    ]);
  } catch {
    // Fall back to system fonts; layout still works.
  }
}
