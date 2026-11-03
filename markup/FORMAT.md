# The `.redline` file format (version 1)

A `.redline` file is a **UTF-8 JSON document** that stores the original images
of a markup *and* every annotation as editable vector objects. Reopening a file
restores everything exactly: you can move, restyle, re-word or delete any
arrow, note, cloud or dimension at any time. Flattened copies (PNG/JPG/PDF) are
produced by **Export** and are never needed to continue editing.

Why JSON:

- **Lossless and re-editable.** The source images are embedded unchanged
  (base64 data URLs), and annotations are kept as objects, not burned-in pixels.
- **Self-contained.** One file carries the images, all sheets, the scale
  calibration and the markup, so you can email it or put it in a PDM/PLM vault.
- **Durable and open.** Any language can read it, it diffs cleanly in version
  control (apart from the image strings), and it doesn't depend on this app.
- **Non-destructive crops.** A crop only moves the sheet frame (`bgX`/`bgY`,
  `width`/`height`); the full original image stays in the file.

## Top level

```jsonc
{
  "format": "redline",          // always "redline"
  "version": 1,                  // format version
  "generator": "Redline Markup Studio",
  "title": "BRK-1042 review",
  "created": "2026-11-03T15:00:00.000Z",
  "modified": "2026-11-03T15:42:10.000Z",
  "sheets": [ /* Sheet, … in page order */ ],
  "images": { "img_ab12cd": "data:image/png;base64,…" }   // sheet backgrounds and image annotations
}
```

## Sheet

| field        | type            | meaning |
|--------------|-----------------|---------|
| `id`         | string          | unique id |
| `name`       | string          | shown in the sheet tray; used for export file names |
| `width`, `height` | number     | canvas size in pixels (the exported image size at 100%) |
| `background` | string \| null  | key into `images`; `null` for a blank sheet |
| `bgX`, `bgY` | number          | where the image's top-left sits on the canvas (changed by crop / add margin) |
| `bgColor`    | `#rrggbb`       | canvas color behind / around the image |
| `dpi`        | number          | pixels per inch of the sheet; sets PDF page size on export (PDF imports use 150) |
| `scale`      | object \| null  | `{ "factor": <real units per pixel>, "unit": "mm"\|"cm"\|"m"\|"in"\|"ft"\|"ft-in" }` (`ft-in` stores inches) |
| `objects`    | Annotation[]    | painted in order; last is on top |

## Annotations

Every annotation has `id`, `type` and `opacity` (0–1). Coordinates are sheet
pixels, origin top-left. Colors are CSS colors; `"none"` means no fill. Line
`dash` is `solid` \| `dashed` \| `center` \| `dotted`.

| `type`      | geometry fields | style / content fields |
|-------------|-----------------|------------------------|
| `line`      | `x1 y1 x2 y2` | `stroke width dash heads` (`none`\|`end`\|`start`\|`both`; arrows are lines with heads) |
| `rect`      | `x y w h` | `stroke fill width dash radius` |
| `ellipse`   | `x y w h` (bounding box) | `stroke fill width dash` |
| `cloud`     | `x y w h` | `stroke fill width arc` (scallop size): revision cloud |
| `pen`       | `points: [[x,y],…]` | `stroke width` |
| `highlight` | `points: [[x,y],…]` | `stroke width` (drawn with multiply blending) |
| `text`      | `x y` (top-left) | `text stroke` (text color) `fill` (background) `fontSize bold border` |
| `callout`   | `x y w h` (note box), `tx ty` (leader tip) | `text stroke fill width dash fontSize bold tipEnd` (`arrow`\|`dot`\|`none`) |
| `balloon`   | `cx cy r`, `tx ty` (leader tip or `null`) | `label shape` (`circle`\|`triangle`\|`hexagon`\|`square`\|`diamond`) `stroke fill width tipEnd` |
| `dimension` | `x1 y1 x2 y2` (measured points), `offset` (perpendicular offset of the dimension line) | `stroke fill width fontSize precision text` (empty means it's measured live from the sheet `scale`) |
| `stamp`     | `x y` (top-left) | `text sub` (second line, e.g. date) `stroke fill width fontSize` |
| `blur`      | `x y w h` | `mode` (`pixelate`\|`redact`) `block fill` |
| `image`     | `x y w h` (unrotated box) | `src` (key into top-level `images`) `natW natH` (original pixel size) `stroke width` (border; 0 = none) `shadow` |

**Rotation.** `text`, `stamp` and `image` may carry `rotation` in degrees
(clockwise, −180…180). It turns the object about the center of its unrotated
box; the stored geometry is always the unrotated box.

**Nested images.** An `image` annotation places a picture (a photo or detail
view, for example) on top of a sheet. Its pixels live in the shared `images`
table, exactly like sheet backgrounds, so several objects or sheets can reuse
one image without storing it twice.

Readers should ignore unknown fields and skip unknown `type`s so that files
from newer versions still open. Writers should keep the `version` number and
bump it only for incompatible changes.

## Minimal example

```json
{
  "format": "redline", "version": 1,
  "sheets": [{
    "id": "sheet_1", "name": "Sheet 1", "width": 800, "height": 500,
    "background": null, "bgX": 0, "bgY": 0, "bgColor": "#ffffff",
    "dpi": 96, "scale": { "factor": 0.5, "unit": "mm" },
    "objects": [
      { "id": "a", "type": "line", "x1": 100, "y1": 400, "x2": 300, "y2": 200,
        "stroke": "#e53935", "width": 3, "dash": "solid", "heads": "end", "opacity": 1 },
      { "id": "b", "type": "dimension", "x1": 100, "y1": 100, "x2": 500, "y2": 100, "offset": -30,
        "stroke": "#1565c0", "fill": "none", "width": 1.5, "fontSize": 16, "precision": 1, "text": "", "opacity": 1 }
    ]
  }],
  "images": {}
}
```

The dimension above reads **200.0 mm** (400 px × 0.5 mm/px).
