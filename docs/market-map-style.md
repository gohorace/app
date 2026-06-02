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
immediately, fully version-controlled). Consequence: pins render as legacy
`google.maps.Marker`s (which, unlike `AdvancedMarkerElement`, don't need a
mapId) so we keep `MarkerClusterer` — a workspace with thousands of properties
clusters into density instead of dropping pins. Tier visuals are SVG icons;
hover/selection swap to a ringed icon + a shared address-chip overlay. Trade-off
vs Advanced Markers / OverlayView: legacy markers aren't keyboard-focusable DOM,
so per-pin keyboard nav (HOR-220) regresses — flagged, revisit if needed.

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
