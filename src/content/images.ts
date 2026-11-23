import { MEDIA_FILE_RE } from './media.js';

/** Image posée librement sur la diapo. x, y, w en % de la diapo. */
export interface SlideImage {
  file: string;
  x: number;
  y: number;
  w: number;
  layer: 'front' | 'back';
}

export const IMAGES_MAX = 8;
export const IMAGE_W_MIN = 3;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const round = (v: number) => Math.round(v * 100) / 100;

/**
 * Valide la liste envoyée par le formulaire (JSON). Les entrées invalides ou
 * qui pointent vers une image inconnue sont ignorées ; les coordonnées sont
 * bornées pour que l'image reste au moins en partie sur la diapo.
 */
export function parseImages(raw: unknown, exists: (file: string) => boolean): { images: SlideImage[]; error?: string } {
  if (raw === undefined || raw === null || raw === '') return { images: [] };
  let data: unknown;
  try {
    data = JSON.parse(String(raw));
  } catch {
    return { images: [], error: 'Les images n’ont pas pu être lues.' };
  }
  if (!Array.isArray(data)) return { images: [], error: 'Les images n’ont pas pu être lues.' };

  const images: SlideImage[] = [];
  for (const item of data) {
    if (!item || typeof item !== 'object') continue;
    const { file, x, y, w, layer } = item as Record<string, unknown>;
    if (typeof file !== 'string' || !MEDIA_FILE_RE.test(file) || !exists(file)) continue;
    const nx = Number(x), ny = Number(y), nw = Number(w);
    if (![nx, ny, nw].every(Number.isFinite)) continue;
    const width = round(clamp(nw, IMAGE_W_MIN, 100));
    images.push({
      file,
      w: width,
      x: round(clamp(nx, -width + 2, 98)),
      y: round(clamp(ny, -50, 98)),
      layer: layer === 'back' ? 'back' : 'front',
    });
  }
  if (images.length > IMAGES_MAX) return { images: images.slice(0, IMAGES_MAX), error: `${IMAGES_MAX} images au maximum par message.` };
  return { images };
}

/** Lecture tolérante de la colonne images_json pour le rendu. */
export function readImages(json: string | null | undefined): SlideImage[] {
  return parseImages(json ?? '[]', () => true).images;
}
