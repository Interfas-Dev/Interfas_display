import sanitizeHtml from 'sanitize-html';

/** Tailles autorisées, en em : relatives à la taille de base de l'écran. */
export const FONT_SIZES = ['0.75em', '1em', '1.25em', '1.5em', '2em', '3em', '4em'] as const;

const COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i;
const SIZE = new RegExp(`^(${FONT_SIZES.map((s) => s.replace('.', '\\.')).join('|')})$`);
const ALIGN = /^(left|center|right|justify)$/;

/**
 * Nettoie le HTML produit par l'éditeur avant de l'enregistrer : seules les
 * balises et styles de mise en forme proposés par l'éditeur sont conservés.
 */
export function sanitizeContent(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ['p', 'h1', 'h2', 'h3', 'strong', 'em', 'u', 's', 'ul', 'ol', 'li', 'br', 'span', 'mark', 'blockquote', 'hr'],
    allowedAttributes: {
      '*': ['style'],
    },
    allowedStyles: {
      '*': {
        color: [COLOR],
        'background-color': [COLOR],
        'font-size': [SIZE],
        'text-align': [ALIGN],
      },
    },
    disallowedTagsMode: 'discard',
  }).trim();
}

/** Vrai si le contenu ne contient aucun texte visible. */
export function isEmptyContent(html: string): boolean {
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} }).trim() === '';
}
