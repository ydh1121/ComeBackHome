# ComeBackHome Local OCR Distribution Smoke — Phase 5Y

Status: LOCAL BUILD + SAME-ORIGIN SERVE VERIFIED / OCR APPLICATION ACTIVATION DISABLED

Phase 5Y proves that the Phase 5X OCR runtime bundle can survive an actual Vite build and can be served back from the same local origin without external redirects or runtime downloads.

This is a verification-only path. It does not alter the normal production build or enable image OCR in the application composition.

## Verification flow

npm run verify:ocr-distribution

The verifier:

1. creates an isolated temporary workspace;
2. copies the existing public directory into a temporary public directory;
3. runs scripts/prepare-ocr-assets.mjs into the temporary public/ocr runtime tree;
4. runs a real Vite build with that temporary public directory;
5. verifies every built OCR runtime file against the staged manifest bytes + SHA-256;
6. starts a local Vite preview server on 127.0.0.1;
7. fetches manifest.json from the local origin;
8. fetches every staged worker/core/language/license file from the same local origin;
9. verifies every HTTP response byte length + SHA-256;
10. confirms no served URL leaves the local origin;
11. closes the preview server and deletes the temporary workspace.

## Runtime scope

Runtime ID:

tesseract-7.0.0-data-1.0.0

The same package/runtime contract from Phase 5X remains authoritative.

The verifier does not download OCR packages itself. npm dependency installation occurs before the test in CI, and runtime staging reads only installed package files.

## Why this matters

Phase 5X proved that the runtime files can be generated correctly.

Phase 5Y proves the next boundary:

generated package files -> Vite public copy -> dist -> local HTTP response

This catches failures such as:

- files omitted during Vite public copying;
- path mismatches between runtime config and built output;
- corrupted binary copying;
- unexpected redirects;
- wrong same-origin paths;
- missing large WASM or traineddata assets.

## Production boundary

The normal build remains:

tsc -b && vite build

The OCR staging script is not attached to that build.

src/app/composition.ts still does not instantiate TesseractScheduleImageTextExtractor.

Therefore Phase 5Y still does not make image OCR available to the user.

## Privacy and safety

Phase 5Y uses no workplace screenshot.

It verifies static runtime distribution only.

Current boundary:

- external screenshot upload = 0
- external OCR API = 0
- OCR credential = 0
- remote OCR runtime fetch inside verification = 0
- production OCR composition activation = 0
- remote D1/Cron/deploy changes = 0

## Next gate

A later phase may build a private/local browser OCR evaluation harness that uses user-supplied screenshots without committing them.

That evaluation must measure:

- Korean labels/names;
- date recognition;
- decimal-time punctuation;
- bbox topology;
- latency;
- memory;
- adaptive layout parser result quality.

No result may bypass explicit review, and no sample workplace layout becomes a permanent parser assumption.
