/**
 * RoofTrax palette — "storm sky over steel siding".
 *
 * A field-ops app used outdoors in bright sunlight and rain: deep storm-navy
 * surfaces for contrast, a high-visibility safety-orange primary action
 * color (the same hue as roofing tarps and hazard signage), and a clear
 * amber for insurance-workflow accents vs. a teal for retail-workflow
 * accents, so reps can tell the two pin types apart at a glance.
 */

const colors = {
  light: {
    text: '#0b1220',
    tint: '#ff6a1a',

    background: '#f5f7fa',
    foreground: '#0b1220',

    card: '#ffffff',
    cardForeground: '#0b1220',

    primary: '#ff6a1a',
    primaryForeground: '#ffffff',

    secondary: '#0f2440',
    secondaryForeground: '#ffffff',

    muted: '#e7ebf0',
    mutedForeground: '#5b6b7d',

    accent: '#eef2f6',
    accentForeground: '#0f2440',

    destructive: '#dc2626',
    destructiveForeground: '#ffffff',

    border: '#dde3ea',
    input: '#dde3ea',

    // Workflow accents
    insurance: '#d97706',
    retail: '#0f766e',
    success: '#16a34a',
  },

  radius: 12,
};

export default colors;
