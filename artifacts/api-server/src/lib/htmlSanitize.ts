/**
 * HTML sanitizer for user-supplied template content (rich allowlist — permits
 * links, images, and full heading range).
 *
 * Four sanitization allowlists exist across the codebase — all are listed here
 * so new surfaces are added intentionally rather than inline ad-hoc:
 *
 *  1. sanitizeTemplateHtml() — THIS FILE.
 *     User-supplied HTML (templates, uploaded content).
 *     Allowlist: full heading range, block/inline elements, table, a, img.
 *     Schemes: http, https, mailto.
 *
 *  2. sanitizeSectionHtml() — lib/sectionGeneration.ts
 *     LLM-generated section fragment HTML.
 *     Allowlist: headings, p, br, strong, em, b, i, u, s, ul, ol, li, table,
 *     span, div, blockquote, pre, code, hr.  NO <a>/<img> — LLM output only.
 *
 *  3. sanitizeReportFragment() — routes/inspections.ts (~line 5063)
 *     LLM-generated compiled-report fragment HTML.
 *     Same as (2) but also excludes <section>/<article>/<header>/<footer>/<main>.
 *     NO <a>/<img>.
 *
 *  4. Inline attestation-HTML call — routes/inspections.ts (~line 11412)
 *     Supplement compile: attestation paragraph sanitized inline.
 *     Allowlist: p, strong, em, br only.  No attributes.
 *
 * Five additional inline sanitizeHtml({allowedTags:[],allowedAttributes:{}}) calls
 * appear in inspections.ts for caption fields (strip-everything, no allowlist).
 * Those are not enumerated here because they allow nothing by design.
 */
import sanitizeHtml from 'sanitize-html';

/**
 * Sanitizes user-supplied HTML (templates, uploaded content).
 * Strips scripts, event handlers, iframes, javascript: URLs, and unknown tags.
 * Permits links and images — those are valid in user-authored templates.
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
        'border-radius': [/^[\d.]+(%|px|em|rem)$/],
        opacity: [/^[\d.]+$/],
        display: [/^(block|inline|flex|grid|table|table-row|table-cell|none)$/],
        'vertical-align': [/^(top|middle|bottom|baseline)$/],
      },
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    disallowedTagsMode: 'discard',
  });
}
