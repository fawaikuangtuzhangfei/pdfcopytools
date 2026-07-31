# PDF Copy Tools — Copy Clean

> [中文说明见 README.md](./README.md)

A Chrome extension that **takes over PDF rendering and restores paragraph line-wraps on copy**. Select text in a PDF → `Ctrl/⌘+C` → paste, and you get clean text with no mid-paragraph hard breaks — no more manual re-flowing.

## Why

A PDF has no concept of a "paragraph" — only the coordinates of each glyph. When you copy from Chrome's built-in viewer, paragraphs get shredded: soft wraps become hard newlines, bullets and paragraph boundaries are lost. Worse, the built-in viewer runs in an isolated PDFium context that content scripts / userscripts cannot inject into. **The only way to make "copy-clean" actually work is to take over rendering with a pdf.js viewer** — so we control the text layer and the copy event, and rebuild paragraphs from coordinates.

## Install (unpacked, developer mode)

1. Open `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and select this `pdfcopytools/` directory.
3. **Required for local files (`file://` PDFs):** enable **Allow access to file URLs** on the extension card. Otherwise local PDFs won't enter our viewer (online PDFs don't need this).

Once installed, opening any `*.pdf` (online or local) drops into our viewer automatically.

> **How local files work:** Chrome's declarativeNetRequest does not intercept `file://` navigations, so online PDFs are redirected via DNR while local PDFs are redirected via a `webNavigation` listener + `tabs.update`. Both require "Allow access to file URLs" for local files to work.

## Usage

- Select text → `Ctrl/⌘+C` → paste clean; a small toast "已整理换行" (line-wraps tidied) appears bottom-right.
- **Paragraph quick-copy:** hover a paragraph and a "⧉ 复制整段" (copy whole paragraph) chip appears — one click copies the entire cleaned paragraph, no precise selection needed. Toggle in settings.
- **Want the raw text?** Hold `Alt` while copying (configurable to Shift, or off).
- The toolbar popup toggles the extension on/off; **More settings** exposes CJK/Latin spacing, de-hyphenation, bullet preservation, toast, paragraph quick-copy, and the raw-copy modifier.

## Project layout

```
manifest.json          MV3 manifest (DNR redirect / host_permissions / CSP)
background.js          service worker: DNR for http(s), webNavigation for file://, → viewer.html?file=
src/reflow.js          ★ pure paragraph-rebuild (coordinates → clean text; reflow + segmentParagraphs, no DOM)
src/copy-handler.js    hooks the copy event inside the viewer: selection geometry → reflow → clipboard
src/paragraph-copy.js  hover a paragraph → "copy whole paragraph" chip → whole paragraph to clipboard
src/toast.js           bottom-right toast
options/ popup/        settings page & toolbar popup
viewer/                vendored Mozilla pdf.js prebuilt viewer (Apache-2.0)
  web/viewer.html      injects src/copy-handler.js
  web/viewer.mjs       validateFileURL patched to skip same-origin check (cross-origin load inside extension)
tools/generate-icons.mjs  zero-dependency icon generation
test/reflow.test.js    unit tests for reflow
```

### Paragraph-rebuild heuristics (src/reflow.js)

After grouping glyphs into visual lines by `y`, geometric signals decide whether two adjacent lines are a **soft wrap (join)** or a **paragraph break (newline)**:

- **Break:** next line is first-line-indented / the line gap is clearly larger than normal / the previous line is short (under justification) / the line starts with a bullet or number.
- **Join:** CJK↔CJK with no space; Latin word↔Latin word with a space; English `-\n` de-hyphenated back into one word; CJK↔Latin no space by default (configurable).

## Development

```bash
npm test                       # run reflow unit tests (node --test)
node tools/generate-icons.mjs  # regenerate icons/*.png
```

Upgrading pdf.js: download `pdfjs-<ver>-legacy-dist.zip` from https://github.com/mozilla/pdf.js/releases, unzip into `viewer/`, then re-apply the two patches —
① inject `<script src="../../src/copy-handler.js" type="module">` into `viewer/web/viewer.html`;
② add `return;` as the first line of `validateFileURL` in `viewer/web/viewer.mjs`.

## Known limitations (MVP)

- Only `.pdf`-suffixed URLs are redirected; content-type-only PDFs without the suffix fall back to Chrome's native viewer.
- Two redirect paths: **clean `.pdf`** URLs (no `?`/`#`) go through DNR, redirected raw with no flicker; **URLs with a query/fragment** (e.g. signed links `?sig=..&exp=..`) and **local files** go through `webNavigation` + `encodeURIComponent`, so params are no longer lost, at the cost of a brief flicker.
- Local files depend on the user manually enabling "Allow access to file URLs".
- Paragraph rebuild is heuristic; complex multi-column / table / formula layouts can misfire. The MVP targets single-column body text.
- Cross-page selections treat the page margin as a paragraph break (usually acceptable).

## License

MIT (see `LICENSE`). The bundled pdf.js under `viewer/` is licensed separately under Apache-2.0 (see `viewer/LICENSE`).
