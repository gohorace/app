# Market map — warm parchment basemap style (HOR-370)

The `/market` hero map uses a Google Map with **`mapId: 'horace-properties-map'`**
(required for the Advanced Markers that draw the pins + clusters). **When a
`mapId` is set, Google ignores the inline `styles` array** — so the basemap
palette can't be set in code. It must be a **Cloud-based map style** attached to
that Map ID in the Google Cloud Console.

This file is the **version-controlled source of truth** for that style (the
cloud copy is the live one; keep them in sync — same drift-guard rationale as
the gnaf exposed-schema note). The design intent: flat warm parchment land, white
streets, POIs/transit stripped, muted parks + water, and **Google's own
locality labels off** (we render editorial Playfair suburb labels ourselves, so
the basemap must not double them up). The terracotta "wash" in the design is the
app's HeatmapLayer, not the basemap.

## How to apply (one-time, ~5 min, no redeploy)

1. Google Cloud Console → **Google Maps Platform → Map Styles** (in the project
   that owns `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`).
2. **Create Map Style** → start blank/Standard → **Import JSON** → paste the JSON
   below → Save (name it e.g. `Horace Market — Parchment`).
3. **Map Management → `horace-properties-map`** → associate the new style with
   the Map ID (or, from the style page, add the Map ID under its associations).
4. Publish. Live within a minute — hard-refresh `/market`; no deploy needed.

> If `horace-properties-map` isn't yet a registered JS Map ID, create it under
> Map Management (type: JavaScript, raster or vector) and set
> `mapId` to match — but markers already render, so it exists.

## Style JSON

```json
[
  { "elementType": "geometry", "stylers": [{ "color": "#EFE7D7" }] },
  { "elementType": "labels.icon", "stylers": [{ "visibility": "off" }] },
  { "elementType": "labels.text.fill", "stylers": [{ "color": "#8C7B6B" }] },
  { "elementType": "labels.text.stroke", "stylers": [{ "color": "#EFE7D7" }, { "weight": 2 }] },

  { "featureType": "administrative", "elementType": "geometry", "stylers": [{ "visibility": "off" }] },
  { "featureType": "administrative.land_parcel", "stylers": [{ "visibility": "off" }] },
  { "featureType": "administrative.neighborhood", "elementType": "labels", "stylers": [{ "visibility": "off" }] },
  { "featureType": "administrative.locality", "elementType": "labels", "stylers": [{ "visibility": "off" }] },
  { "featureType": "administrative.province", "elementType": "labels", "stylers": [{ "visibility": "off" }] },
  { "featureType": "administrative.country", "elementType": "labels", "stylers": [{ "visibility": "off" }] },

  { "featureType": "poi", "stylers": [{ "visibility": "off" }] },
  { "featureType": "poi.park", "elementType": "geometry", "stylers": [{ "color": "#C9D2BD" }, { "visibility": "on" }] },
  { "featureType": "poi.park", "elementType": "labels.text.fill", "stylers": [{ "color": "#7C8A72" }] },

  { "featureType": "landscape.natural", "elementType": "geometry", "stylers": [{ "color": "#EFE7D7" }] },
  { "featureType": "landscape.man_made", "elementType": "geometry", "stylers": [{ "color": "#EFE7D7" }] },

  { "featureType": "road", "elementType": "geometry.fill", "stylers": [{ "color": "#FBF8F3" }] },
  { "featureType": "road", "elementType": "geometry.stroke", "stylers": [{ "color": "#E2D8C8" }] },
  { "featureType": "road", "elementType": "labels.text.fill", "stylers": [{ "color": "#9C8E7D" }] },
  { "featureType": "road", "elementType": "labels.text.stroke", "stylers": [{ "color": "#FBF8F3" }, { "weight": 2 }] },
  { "featureType": "road.highway", "elementType": "geometry.fill", "stylers": [{ "color": "#FFFFFF" }] },
  { "featureType": "road.highway", "elementType": "geometry.stroke", "stylers": [{ "color": "#E2D8C8" }] },
  { "featureType": "road.local", "elementType": "labels", "stylers": [{ "visibility": "off" }] },
  { "featureType": "road.arterial", "elementType": "labels.icon", "stylers": [{ "visibility": "off" }] },

  { "featureType": "transit", "stylers": [{ "visibility": "off" }] },

  { "featureType": "water", "elementType": "geometry", "stylers": [{ "color": "#CFC3B0" }] },
  { "featureType": "water", "elementType": "labels.text.fill", "stylers": [{ "color": "#9C8E7D" }] },
  { "featureType": "water", "elementType": "labels.text.stroke", "stylers": [{ "color": "#CFC3B0" }, { "weight": 2 }] }
]
```

## Tuning notes

- `road.local` labels are **off** (street-name clutter); arterial/highway labels
  stay, muted stone. Flip on if more orientation is wanted.
- All `administrative` + `poi` (non-park) labels off so only our editorial suburb
  labels + pin address labels read. Parks kept as a soft sage wash.
- Water is muted tan (`#CFC3B0`), not blue — matches the design river/ocean.
- If the heat wash reads too tight at neighbourhood zoom after the style lands,
  bump `heatRadiusForZoom` / `heatOpacity` in `properties-map.tsx`.
