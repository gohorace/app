# Market map — warm parchment basemap style (HOR-370)

The `/market` hero map applies its warm cartography **inline in code** via the
`styles` option on the Google Map — see `HORACE_MAP_STYLE` in
`apps/web/src/components/properties/properties-map.tsx` (that constant is the
source of truth; this doc is a human-readable twin + rationale).

## Why inline, not a Cloud Map ID

Google's two basemap-styling paths are mutually exclusive:

- **Cloud style** — requires a registered **Map ID** (Console → Map Management);
  with a `mapId` set, Google **ignores** the inline `styles` array. A `mapId` is
  also what `AdvancedMarkerElement` needs.
- **Inline `styles`** — works with **no `mapId`**, but then you can't use
  `AdvancedMarkerElement`.

We took the inline path (no Map ID / no console setup, renders on the preview
immediately, fully version-controlled). Consequence: pins render as custom
`OverlayView` DOM instead of Advanced Markers (same look + hover/label/selection
+ keyboard a11y), and `MarkerClusterer` is dropped — replaced by a top-N
(`MAX_PINS`) intensity cap with a visible "showing strongest N" note. Re-add a
clusterer (OverlayView grid) if dense markets need drill-in.

## The style (what it does)

- **Land** flat parchment `#EFE7D7`; **roads** white/cream with a thin stone
  casing; **water** muted tan `#CFC3B0` (not blue); **parks** soft sage.
- **POIs, transit, and Google's own admin/locality labels are off** — only our
  editorial Playfair suburb labels + pin address chips read. Parks kept as a wash.
- `road.local` labels off (street-name clutter); arterial/highway labels stay,
  muted stone.
- The terracotta "wash" in the design is the app's HeatmapLayer, **not** the
  basemap. If it reads too tight at neighbourhood zoom, tune `heatRadiusForZoom`
  / `heatOpacity` in `properties-map.tsx`.

To change the palette, edit `HORACE_MAP_STYLE` in code (it's a plain
`google.maps.MapTypeStyle[]`).
