# Redline Markup Studio

A browser-based image annotation tool in the spirit of SnagIt's editor, built
for **marking up screenshots and engineering drawings**.

- **Editable files.** Work is saved as a `.redline` document (open JSON, see
  [FORMAT.md](FORMAT.md)). It embeds the original images and keeps every
  annotation as a vector object you can edit later.
- **Standard exports.** Flatten to **PNG**, **JPG** or multi-page **PDF**, or
  copy the image to the clipboard. PDFs are written at the sheet's real
  resolution, so an imported drawing goes back out at its original paper size.
- **No install, works offline.** It's plain HTML/JS with no build step. PDF
  import uses a bundled copy of PDF.js (`lib/pdfjs`, Apache-2.0).

## Run it

Open `index.html` in Chrome, Edge or Firefox. You can double-click it from
disk, or serve the folder:

```bash
cd markup && python3 -m http.server 8000   # then open http://localhost:8000
```

When it's published with GitHub Pages it lives at `/markup/` on the site.

## Features

| Area | What you get |
|------|--------------|
| Input | Open PNG/JPG/GIF/WebP/BMP, **multi-page PDF drawing sets** (one sheet per page, at 150 DPI), drag and drop, blank sheets, built-in sample drawing |
| Images in images | **Paste (Ctrl+V), drop or insert (`I`) an image onto the current sheet** as an object: move, resize (corners keep the aspect ratio, Shift for free), rotate, border, drop shadow, opacity, reset to original size. Ctrl+Shift+V, or dropping on the sheet tray, adds it as a new sheet instead |
| Markup tools | Arrow, line, rectangle, ellipse, **revision cloud**, pen, highlighter, text, **callout note with leader**, **numbered balloons / revision triangles** (auto-increment), **calibrated dimensions**, **stamps** (APPROVED, REVISED, AS-BUILT, NOT FOR CONSTRUCTION…), blur/redact |
| Engineering | Scale calibration from a known length or from paper DPI and drawing scale (1:N), in mm/cm/m/in/ft/ft-in; live cursor coordinates in real units; center-line and hidden-line dash styles |
| Editing | Select, multi-select (Shift / box select), move, resize handles, leader tips, **rotate text, stamps and images** (round handle or a degree value; Shift snaps to 15°), Shift to snap lines to 15°, arrange order, duplicate, copy/paste, nudge, unlimited undo/redo, double-click to edit text |
| Canvas | Non-destructive crop, **extend the canvas** (crop outside the image, or *Add margin*) to make room for notes, background color |
| Sheets | Multi-sheet documents with a thumbnail tray: add, duplicate, reorder, rename, delete |
| Safety | Unsaved-changes guard, automatic crash-recovery snapshot (IndexedDB), remembers your tool styles |

With the File System Access API (Chrome/Edge), **Save** writes back to the same
`.redline` file. Other browsers download the file instead.

## Keyboard

`V` select · `H`/Space pan · `A` arrow · `L` line · `R` rect · `E` ellipse ·
`K` cloud · `P` pen · `G` highlighter · `T` text · `C` callout · `B` balloon ·
`D` dimension · `S` stamp · `U` blur · `I` insert image · `X` crop · `M` calibrate ·
`Ctrl+S` save · `Ctrl+E` export · `Ctrl+Z/Y` undo/redo · `Ctrl+wheel` zoom ·
`Ctrl+0` fit · `F1` all shortcuts.

## Code layout

```
markup/
├── index.html          UI shell
├── css/app.css
├── js/shapes.js        annotation types: draw, hit-test, bounds, handles
├── js/pdfwriter.js     dependency-free PDF writer (JPEG pages)
├── js/sample.js        generates the sample drawing
├── js/app.js           document model, tools, panel, sheets, I/O, export
├── lib/pdfjs/          PDF.js 3.11.174 (PDF import only)
└── FORMAT.md           .redline specification
```
