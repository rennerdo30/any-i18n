# Tesseract.js (vendored)

[Tesseract.js](https://github.com/naptha/tesseract.js) (Apache-2.0) with its WebAssembly core, used by
`offscreen/offscreen.js` for the built-in image OCR. The files are the unmodified `dist` builds of
`tesseract.js` and `tesseract.js-core`.

They are vendored because Manifest V3 forbids remotely hosted code. Language data
(`*.traineddata`) is not code. It is downloaded on first use from the tessdata CDN and cached by the
browser.
