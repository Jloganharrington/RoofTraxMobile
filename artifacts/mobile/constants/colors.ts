/**
 * AxiomRestore palette — sampled from the brand logo (navy roofline + orange
 * inspection lens). Deep navy surfaces for contrast, the logo's safety-
 * orange as the primary action color, and a clear amber vs. teal split for
 * insurance-workflow vs. retail-workflow pin accents so reps can tell the
 * two pin types apart at a glance.
 */

const colors = {
  light: {
    text: '#0f2244',
    tint: '#f2801f',

    background: '#f5f7fa',
    foreground: '#0f2244',

    card: '#ffffff',
    cardForeground: '#0f2244',

    primary: '#f2801f',
    primaryForeground: '#ffffff',

    secondary: '#132a4f',
    secondaryForeground: '#ffffff',

    muted: '#e7ebf0',
    mutedForeground: '#5b6b7d',

    accent: '#eef2f6',
    accentForeground: '#132a4f',

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
