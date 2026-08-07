/**
 * HTML sanitizer for user-supplied template content (rich allowlist — permits
 * links, images, and full heading range).
 *
 * NOT used for LLM output.  Section generation uses sanitizeSectionHtml()
 * in sectionGeneration.ts; compiled-report fragments use sanitizeReportFragment()
 * in inspections.ts.  Those two intentionally exclude <a>/<img> and external
 * schemes because they sanitize LLM-generated HTML, not user-controlled content.
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
