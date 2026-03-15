# tessdata (optional)

Put Tesseract language data files here for offline OCR.

## Format

Compressed `*.traineddata.gz` files (e.g., `eng.traineddata.gz`).

## Download

From https://github.com/tesseract-ocr/tessdata:

```bash
curl -LO https://github.com/naptha/tessdata/raw/gh-pages/4.0.0/eng.traineddata.gz
```

The library auto-detects local files and skips CDN fetch.
