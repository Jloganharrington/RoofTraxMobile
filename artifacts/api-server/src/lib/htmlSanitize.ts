/**
 * Shared HTML sanitizer — reused by section generation, compiled reports,
 * and the templates upload pipeline.  A single place so the allowlist stays
 * consistent.
 */
import sanitizeHtml from 'sanitize-html';

/**
 * Strict allowlist sanitizer for LLM-generated and user-supplied HTML.
 * Strips scripts, event handlers, iframes, and all unknown tags/attributes.
 */
export function sanitizeTemplateHtml(raw: string): string {
  return sanitizeHtml(raw, {
    allowedTags: [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'p', 'br', 'strong', 'em', 'b', 'i', 'u', 's',
      'ul', 'ol', 'li',
      'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
      'span', 'div', 'section', 'article', 'header', 'footer', 'main',
      'blockquote', 'pre', 'code',
      'a', 'img',
      'hr',
    ],
    allowedAttributes: {
      '*': ['class', 'id', 'style'],
      'td': ['colspan', 'rowspan'],
      'th': ['colspan', 'rowspan', 'scope'],
      'a': ['href', 'target', 'rel'],
      'img': ['src', 'alt', 'width', 'height'],
    },
    allowedStyles: {
      '*': {
        color: [/^[a-zA-Z0-9#(), .%]+$/],
        'background-color': [/^[a-zA-Z0-9#(), .%]+$/],
        'font-size': [/^[\d.]+(%|px|em|rem|pt)$/],
        'font-weight': [/^(bold|normal|\d+)$/],
        'text-align': [/^(left|right|center|justify)$/],
        padding: [/^[\d. px%]+$/],
        margin: [/^[\d. px%]+$/],
        border: [/^[\d. pxsolid#a-zA-Z]+$/],
      },
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    disallowedTagsMode: 'discard',
  });
}
