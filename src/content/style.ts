/**
 * Réglages de style d'un template (couleurs, polices, tailles, fond, logo,
 * marges). Ils sont appliqués au rendu sous forme de variables CSS posées sur
 * la diapo (voir public/css/message.css) : écran, miniatures et aperçus
 * partagent ainsi exactement le même rendu.
 *
 * Toutes les valeurs sont validées strictement (couleurs #rrggbb, nombres
 * bornés, listes fermées, fichiers connus) car elles finissent dans un
 * attribut style.
 */
import type { Db } from '../db/index.js';
import { MEDIA_FILE_RE } from './media.js';

export type Align = 'left' | 'center' | 'right';

export interface TemplateStyle {
  bg: string;
  /** Seconde couleur pour un dégradé, '' pour un fond uni. */
  bg2: string;
  /** Image de fond (fichier média), '' pour aucune. */
  bgImage: string;
  text: string;
  heading: string;
  marker: string;
  muted: string;
  frameColor: string;
  /** Épaisseur du filet en em, 0 pour aucun. */
  frameWidth: number;
  fontHeading: string;
  fontBody: string;
  headingSize: number;
  headingWeight: 400 | 700;
  headingUpper: boolean;
  headingAlign: Align;
  bodySize: number;
  bodyAlign: Align;
  sigSize: number;
  sigAlign: Align;
  /** 'interfas' ou un fichier média (logo envoyé). */
  logo: string;
  logoSize: number;
  logoPos: 'left' | 'right';
  padX: number;
  padY: number;
}

/** Polices libres (SIL OFL) servies en local depuis public/fonts. */
export const BUILTIN_FONTS = [
  { key: 'sora', label: 'Sora (charte)', css: "'Sora', system-ui, sans-serif" },
  { key: 'inter', label: 'Inter', css: "'Inter', system-ui, sans-serif" },
  { key: 'montserrat', label: 'Montserrat', css: "'Montserrat', system-ui, sans-serif" },
  { key: 'lato', label: 'Lato', css: "'Lato', system-ui, sans-serif" },
  { key: 'open-sans', label: 'Open Sans', css: "'Open Sans', system-ui, sans-serif" },
  { key: 'oswald', label: 'Oswald (étroite)', css: "'Oswald', 'Arial Narrow', sans-serif" },
  { key: 'roboto-slab', label: 'Roboto Slab (empattements)', css: "'Roboto Slab', Georgia, serif" },
  { key: 'merriweather', label: 'Merriweather (empattements)', css: "'Merriweather', Georgia, serif" },
  { key: 'playfair-display', label: 'Playfair Display (élégante)', css: "'Playfair Display', Georgia, serif" },
] as const;

export interface CustomFont {
  id: number;
  name: string;
  file: string;
  created_at: string;
  usage_count?: number;
}

export const FONT_NAME_MAX = 40;
const FONT_NAME_RE = /^[\p{L}\p{N} _-]+$/u;

export function listFonts(db: Db): CustomFont[] {
  const fonts = db.prepare('SELECT * FROM fonts ORDER BY name COLLATE NOCASE, id').all() as CustomFont[];
  const styles = (db.prepare('SELECT style_json FROM templates').all() as { style_json: string }[]).map((r) => readRawStyle(r.style_json));
  for (const f of fonts) {
    const key = `custom-${f.id}`;
    f.usage_count = styles.filter((s) => s.fontHeading === key || s.fontBody === key).length;
  }
  return fonts;
}

export function validFontName(raw: unknown): string | null {
  const name = String(raw ?? '').trim().replace(/\s+/g, ' ');
  return name && name.length <= FONT_NAME_MAX && FONT_NAME_RE.test(name) ? name : null;
}

/** Liste des polices proposées dans le formulaire (embarquées puis envoyées). */
export function fontChoices(db: Db) {
  return [
    ...BUILTIN_FONTS.map((f) => ({ key: f.key as string, label: f.label as string, css: f.css as string })),
    ...(db.prepare('SELECT id, name FROM fonts ORDER BY name COLLATE NOCASE, id').all() as { id: number; name: string }[]).map((f) => ({
      key: `custom-${f.id}`,
      label: `${f.name} (envoyée)`,
      css: fontCss(`custom-${f.id}`),
    })),
  ];
}

/** Règles @font-face des polices envoyées (fichiers servis par /media). */
export function fontFacesCss(db: Db): string {
  const rows = db.prepare('SELECT id, file FROM fonts').all() as { id: number; file: string }[];
  return rows
    .filter((r) => MEDIA_FILE_RE.test(r.file))
    .map((r) => `@font-face{font-family:'tpl-font-${r.id}';src:url(/media/${r.file});font-display:swap;}`)
    .join('\n');
}

function fontCss(key: string): string {
  const builtin = BUILTIN_FONTS.find((f) => f.key === key);
  if (builtin) return builtin.css;
  const m = /^custom-(\d+)$/.exec(key);
  if (m) return `'tpl-font-${m[1]}', system-ui, sans-serif`;
  return BUILTIN_FONTS[0].css;
}

/* --- Valeurs de départ, reprises des trois thèmes de la charte --- */

const COMMON = {
  bg2: '',
  bgImage: '',
  fontHeading: 'sora',
  fontBody: 'sora',
  headingSize: 1.9,
  headingWeight: 700 as const,
  headingUpper: true,
  headingAlign: 'left' as Align,
  bodySize: 1,
  bodyAlign: 'left' as Align,
  sigSize: 0.8,
  sigAlign: 'right' as Align,
  logo: 'interfas',
  logoSize: 3.6,
  logoPos: 'left' as const,
  padX: 2.2,
  padY: 1.6,
};

export const THEME_COLORS = {
  light: { bg: '#E7E3D8', text: '#221B13', heading: '#DE3619', marker: '#DE3619', muted: '#5C574F' },
  dark: { bg: '#221B13', text: '#FFFFFF', heading: '#FFFFFF', marker: '#DE3619', muted: '#E7E3D8' },
  red: { bg: '#DE3619', text: '#FFFFFF', heading: '#FFFFFF', marker: '#FFFFFF', muted: '#FFFFFF' },
} as const;

export const FRAME_PRESETS = {
  none: { frameColor: '#7F776C', frameWidth: 0 },
  greige: { frameColor: '#7F776C', frameWidth: 0.45 },
  red: { frameColor: '#DE3619', frameWidth: 0.45 },
} as const;

type ThemeKey = keyof typeof THEME_COLORS;
type FrameKey = keyof typeof FRAME_PRESETS;

/** Style équivalent au rendu d'un thème et d'un cadre de la charte. */
export function presetStyle(theme: string, frame: string): TemplateStyle {
  const colors = THEME_COLORS[(theme in THEME_COLORS ? theme : 'light') as ThemeKey];
  const fr = FRAME_PRESETS[(frame in FRAME_PRESETS ? frame : 'none') as FrameKey];
  return { ...COMMON, ...colors, ...fr };
}

/* --- Validation --- */

const COLOR_RE = /^#[0-9a-f]{6}$/i;
const ALIGNS: Align[] = ['left', 'center', 'right'];

export const LIMITS = {
  frameWidth: [0, 1.5],
  headingSize: [1, 4],
  bodySize: [0.6, 1.6],
  sigSize: [0.5, 1.4],
  logoSize: [2, 8],
  padX: [0, 5],
  padY: [0, 5],
} as const;

const color = (v: unknown, fallback: string) => (typeof v === 'string' && COLOR_RE.test(v.trim()) ? v.trim().toUpperCase() : fallback);
const optColor = (v: unknown) => (typeof v === 'string' && COLOR_RE.test(v.trim()) ? v.trim().toUpperCase() : '');
function num(v: unknown, [min, max]: readonly [number, number], fallback: number) {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(',', '.'));
  if (!Number.isFinite(n) || String(v ?? '').trim() === '') return fallback;
  return Math.round(Math.min(max, Math.max(min, n)) * 100) / 100;
}
const align = (v: unknown, fallback: Align) => (ALIGNS.includes(v as Align) ? (v as Align) : fallback);
const bool = (v: unknown, fallback: boolean) => (v === true || v === 'on' || v === '1' ? true : v === false || v === '' || v === '0' ? false : fallback);

/**
 * Valide un style (formulaire ou JSON enregistré). Toute valeur absente ou
 * invalide reprend celle de `base`. Les fichiers et polices inconnus sont
 * écartés grâce aux fonctions de vérification fournies.
 */
export function normalizeStyle(
  raw: Record<string, unknown>,
  base: TemplateStyle,
  known: { media?: (file: string) => boolean; font?: (key: string) => boolean } = {},
): TemplateStyle {
  const fontOk = (k: unknown): k is string =>
    typeof k === 'string' && (BUILTIN_FONTS.some((f) => f.key === k) || (/^custom-\d+$/.test(k) && (known.font ? known.font(k) : true)));
  const fileOk = (f: unknown): f is string => typeof f === 'string' && MEDIA_FILE_RE.test(f) && !/\.(mp4|webm|woff2?|ttf|otf)$/.test(f) && (known.media ? known.media(f) : true);
  const has = (k: string) => Object.prototype.hasOwnProperty.call(raw, k);
  return {
    bg: color(raw.bg, base.bg),
    bg2: has('bg2') ? optColor(raw.bg2) : base.bg2,
    bgImage: has('bgImage') ? (fileOk(raw.bgImage) ? raw.bgImage : '') : base.bgImage,
    text: color(raw.text, base.text),
    heading: color(raw.heading, base.heading),
    marker: color(raw.marker, base.marker),
    muted: color(raw.muted, base.muted),
    frameColor: color(raw.frameColor, base.frameColor),
    frameWidth: num(raw.frameWidth, LIMITS.frameWidth, base.frameWidth),
    fontHeading: fontOk(raw.fontHeading) ? raw.fontHeading : base.fontHeading,
    fontBody: fontOk(raw.fontBody) ? raw.fontBody : base.fontBody,
    headingSize: num(raw.headingSize, LIMITS.headingSize, base.headingSize),
    headingWeight: String(raw.headingWeight) === '400' ? 400 : String(raw.headingWeight) === '700' ? 700 : base.headingWeight,
    headingUpper: has('headingUpper') ? bool(raw.headingUpper, base.headingUpper) : base.headingUpper,
    headingAlign: align(raw.headingAlign, base.headingAlign),
    bodySize: num(raw.bodySize, LIMITS.bodySize, base.bodySize),
    bodyAlign: align(raw.bodyAlign, base.bodyAlign),
    sigSize: num(raw.sigSize, LIMITS.sigSize, base.sigSize),
    sigAlign: align(raw.sigAlign, base.sigAlign),
    logo: raw.logo === 'interfas' ? 'interfas' : fileOk(raw.logo) ? raw.logo : base.logo,
    logoSize: num(raw.logoSize, LIMITS.logoSize, base.logoSize),
    logoPos: raw.logoPos === 'right' ? 'right' : raw.logoPos === 'left' ? 'left' : base.logoPos,
    padX: num(raw.padX, LIMITS.padX, base.padX),
    padY: num(raw.padY, LIMITS.padY, base.padY),
  };
}

function readRawStyle(json: string | null | undefined): Record<string, unknown> {
  try {
    const v = JSON.parse(json || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/** Style effectif d'un template : réglages enregistrés, sinon ceux de son thème. */
export function effectiveStyle(json: string | null | undefined, theme: string, frame: string): TemplateStyle {
  return normalizeStyle(readRawStyle(json), presetStyle(theme, frame));
}

/** Vrai si le template a des réglages personnalisés enregistrés. */
export function hasCustomStyle(json: string | null | undefined): boolean {
  return Object.keys(readRawStyle(json)).length > 0;
}

/* --- Rendu --- */

const JUSTIFY: Record<Align, string> = { left: 'start', center: 'center', right: 'end' };
const ITEMS: Record<Align, string> = { left: 'flex-start', center: 'center', right: 'center' };

/** Variables CSS à poser sur la diapo pour un style donné. */
export function styleVars(s: TemplateStyle): string {
  const bgImage = s.bgImage ? `url(/media/${s.bgImage})` : s.bg2 ? `linear-gradient(135deg, ${s.bg}, ${s.bg2})` : 'none';
  return [
    `--slide-bg:${s.bg}`,
    `--tpl-bg-image:${bgImage}`,
    `--slide-text:${s.text}`,
    `--slide-heading:${s.heading}`,
    `--slide-marker:${s.marker}`,
    `--slide-muted:${s.muted}`,
    `--frame-c:${s.frameColor}`,
    `--frame-w:${s.frameWidth}em`,
    `--tpl-font-heading:${fontCss(s.fontHeading)}`,
    `--tpl-font-body:${fontCss(s.fontBody)}`,
    `--tpl-heading-size:${s.headingSize}em`,
    `--tpl-heading-weight:${s.headingWeight}`,
    `--tpl-heading-transform:${s.headingUpper ? 'uppercase' : 'none'}`,
    `--tpl-heading-align:${s.headingAlign}`,
    // Le titre occupe toute la ligne s'il est centré, à droite, ou si le logo est à droite.
    `--tpl-heading-flex:${s.headingAlign === 'left' && s.logoPos === 'left' ? '0 1 auto' : '1'}`,
    `--tpl-body-size:${s.bodySize}em`,
    `--tpl-body-align:${s.bodyAlign}`,
    // Texte centré ou à droite : la liste est placée en bloc, ses lignes restent alignées entre elles.
    `--tpl-list-display:${s.bodyAlign === 'left' ? 'block' : 'inline-block'}`,
    `--tpl-sig-size:${s.sigSize}em`,
    `--tpl-sig-justify:${JUSTIFY[s.sigAlign]}`,
    `--tpl-sig-items:${ITEMS[s.sigAlign]}`,
    `--tpl-logo-size:${s.logoSize}em`,
    `--tpl-pad-x:${s.padX}em`,
    `--tpl-pad-y:${s.padY}em`,
  ].join(';');
}

export const INTERFAS_LOGO = '/public/img/logo-interfas.png';

/**
 * Éléments de rendu d'une diapo pour son template : attribut style, source du
 * logo et classe de position. Un template sans réglages garde le rendu du
 * thème (aucune variable posée).
 */
export function slideLook(json: string | null | undefined, theme: string, frame: string) {
  if (!hasCustomStyle(json)) return { css: '', logoSrc: INTERFAS_LOGO, logoRight: false, customLogo: false };
  const s = effectiveStyle(json, theme, frame);
  return {
    css: styleVars(s),
    logoSrc: s.logo === 'interfas' ? INTERFAS_LOGO : `/media/${s.logo}`,
    logoRight: s.logoPos === 'right',
    customLogo: s.logo !== 'interfas',
  };
}

/** Fichiers médias utilisés par un style (logo, fond) : à garder lors de la purge. */
export function styleFiles(json: string | null | undefined): string[] {
  const raw = readRawStyle(json);
  return [raw.logo, raw.bgImage].filter((f): f is string => typeof f === 'string' && MEDIA_FILE_RE.test(f));
}

/* --- Libellés (historique) --- */

const ALIGN_LABELS: Record<Align, string> = { left: 'gauche', center: 'centré', right: 'droite' };
export function fontLabel(db: Db | null, key: string): string {
  const b = BUILTIN_FONTS.find((f) => f.key === key);
  if (b) return b.label;
  const m = /^custom-(\d+)$/.exec(key);
  const row = m && db ? (db.prepare('SELECT name FROM fonts WHERE id = ?').get(Number(m[1])) as { name: string } | undefined) : undefined;
  return row ? row.name : key;
}

export function styleSpecs(db: Db | null) {
  const em = (v: unknown) => `${String(v).replace('.', ',')} em`;
  const al = (v: unknown) => ALIGN_LABELS[v as Align] ?? String(v);
  const file = (v: unknown) => (v ? 'image envoyée' : 'aucune');
  const font = (v: unknown) => fontLabel(db, String(v));
  const specs: { key: keyof TemplateStyle; label: string; format?: (v: unknown) => string }[] = [
    { key: 'bg', label: 'Couleur de fond' },
    { key: 'bg2', label: 'Dégradé', format: (v) => (v ? String(v) : 'aucun') },
    { key: 'bgImage', label: 'Image de fond', format: file },
    { key: 'text', label: 'Couleur du texte' },
    { key: 'heading', label: 'Couleur du titre' },
    { key: 'marker', label: 'Couleur des puces' },
    { key: 'muted', label: 'Couleur de la fonction' },
    { key: 'frameColor', label: 'Couleur du filet' },
    { key: 'frameWidth', label: 'Épaisseur du filet', format: em },
    { key: 'fontHeading', label: 'Police du titre', format: font },
    { key: 'fontBody', label: 'Police du texte', format: font },
    { key: 'headingSize', label: 'Taille du titre', format: em },
    { key: 'headingWeight', label: 'Titre en gras', format: (v) => (Number(v) === 700 ? 'oui' : 'non') },
    { key: 'headingUpper', label: 'Titre en majuscules', format: (v) => (v ? 'oui' : 'non') },
    { key: 'headingAlign', label: 'Alignement du titre', format: al },
    { key: 'bodySize', label: 'Taille du texte', format: (v) => `${Math.round(Number(v) * 100)} %` },
    { key: 'bodyAlign', label: 'Alignement du texte', format: al },
    { key: 'sigSize', label: 'Taille de la signature', format: em },
    { key: 'sigAlign', label: 'Position de la signature', format: al },
    { key: 'logo', label: 'Logo', format: (v) => (v === 'interfas' ? 'Interfas' : 'logo envoyé') },
    { key: 'logoSize', label: 'Taille du logo', format: em },
    { key: 'logoPos', label: 'Position du logo', format: al },
    { key: 'padX', label: 'Marge gauche et droite', format: em },
    { key: 'padY', label: 'Marge haut et bas', format: em },
  ];
  return specs;
}
