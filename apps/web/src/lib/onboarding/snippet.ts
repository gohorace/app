/**
 * The tracking-snippet template that agents paste before </head>.
 *
 * Pulled out of step-script.tsx so the agentic Turn 2 + any future
 * help-paths render the same shape. Don't drift these by hand — both
 * surfaces are the customer's first impression of "what Horace asks
 * me to install", so they must match character-for-character.
 */
export function trackingSnippet(snippetKey: string, appUrl: string): string {
  return `<!-- Horace -->
<script>
  window.RIQ = {
    key: '${snippetKey}',
    apiUrl: '${appUrl}/api',
    propertyPattern: '/property/'
  };
</script>
<script src="${appUrl}/tracker.min.js" defer></script>`
}
