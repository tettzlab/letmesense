# tessdata (optional)

Put Tesseract language data files here for offline OCR.

## Format differences

| Implementation | File format | Example |
|----------------|-------------|---------|
| TypeScript | Compressed | `eng.traineddata.gz` |
| Python | Uncompressed | `eng.traineddata` |

## Download

From https://github.com/tesseract-ocr/tessdata:

```bash
# TypeScript (compressed)
curl -LO https://github.com/naptha/tessdata/raw/gh-pages/4.0.0/eng.traineddata.gz

# Python (uncompressed)
curl -LO https://github.com/tesseract-ocr/tessdata/raw/main/eng.traineddata
```

The library auto-detects local files and skips CDN fetch.
