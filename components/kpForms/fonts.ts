import { Tinos, Arimo } from 'next/font/google';
import type { KpFonts } from './documents';

/**
 * The typefaces of the printed forms: Times New Roman (KP 7, 8, 16, 18, 19)
 * and Arial (KP 9). Where a computer lacks them, Tinos and Arimo - drawn to
 * the same widths - are loaded instead, so the lines break in the same places
 * and the PDF (captured from the page) matches the preview.
 */
const tinos = Tinos({ subsets: ['latin', 'latin-ext'], weight: ['400', '700'], style: ['normal', 'italic'], display: 'block' });
const arimo = Arimo({ subsets: ['latin', 'latin-ext'], weight: ['400', '700'], style: ['normal', 'italic'], display: 'block' });

export const KP_FONTS: KpFonts = {
  serif: `"Times New Roman", ${tinos.style.fontFamily}, Times, serif`,
  sans: `Arial, ${arimo.style.fontFamily}, Helvetica, sans-serif`,
};
