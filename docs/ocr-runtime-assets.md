# ComeBackHome Same-Origin OCR Runtime Assets — Phase 5X

Status: CONTRACT + REPRODUCIBLE LOCAL STAGING IMPLEMENTED / OCR PRODUCTION ACTIVATION DISABLED

Phase 5X defines how the Tesseract.js runtime can be served from the same origin without using its default CDN paths. It does not activate schedule-image OCR in the application composition.

## Runtime identity

Runtime ID:

tesseract-7.0.0-data-1.0.0

Pinned package inputs:

- tesseract.js 7.0.0
- tesseract.js-core 7.0.0
- @tesseract.js-data/kor 1.0.0
- @tesseract.js-data/eng 1.0.0

The Korean and English packages provide the 4.0.0_best_int traineddata used by the current LSTM-only prototype.

## Why same-origin assets are required

Tesseract.js can use CDN defaults for worker, WebAssembly core and language data. ComeBackHome does not allow that implicit runtime path.

The OCR worker factory requires root-relative paths and rejects external origins. The schedule screenshot itself must remain inside the browser. Fetching static OCR runtime files from the ComeBackHome origin is not the same as uploading the screenshot to an OCR provider.

## Staging command

Run:

npm run prepare:ocr-assets

The script reads only already-installed npm package files. It does not download runtime assets itself.

Default generated tree:

public/ocr/tesseract-7.0.0-data-1.0.0/

The generated tree contains:

- worker/worker.min.js
- the complete installed tesseract.js-core browser runtime file set
- lang/kor.traineddata.gz
- lang/eng.traineddata.gz
- available package license files
- manifest.json

The public runtime paths are:

- /ocr/tesseract-7.0.0-data-1.0.0/worker/worker.min.js
- /ocr/tesseract-7.0.0-data-1.0.0/core/
- /ocr/tesseract-7.0.0-data-1.0.0/lang/

## Manifest contract

manifest.json records:

- schema version
- runtime ID
- exact package versions
- root-relative public paths
- each staged file path
- byte length
- SHA-256
- source package

A package-version mismatch, missing language model, incomplete core runtime set or file-hash mismatch is a hard failure.

## Generated asset Git policy

public/ocr/ is ignored by Git during Phase 5X.

Reason:

- worker/core/traineddata are generated third-party binaries;
- they should not be accidentally committed to the repository;
- OCR is not yet active in production;
- the activation phase must explicitly decide whether deployment prepares these files during CI/build or stores approved static artifacts by another reviewed mechanism.

The normal production build remains:

tsc -b && vite build

Phase 5X intentionally does not add prepare:ocr-assets as a build hook.

## Verification

npm run verify:ocr-assets

The verifier stages the runtime into a temporary directory and checks:

- exact pinned package versions;
- required worker/core/Korean/English files;
- SHA-256 and byte length for every staged file;
- same-origin root-relative public paths;
- no CDN fallback string in the OCR extractor;
- production composition still does not activate the OCR extractor;
- normal production build is unchanged;
- staging reports zero external downloads;
- generated public/ocr assets remain ignored by Git.

The temporary verification runtime is deleted after the test.

## Licensing

Tesseract.js and tesseract.js-core are Apache-2.0.

The traineddata package/source licensing and notices must remain preserved when runtime assets are distributed. The staging script copies license files that are present in installed packages. A later production-activation step must complete the final third-party notice review for the exact deployed asset bundle.

## Privacy boundary

Phase 5X authorizes no schedule-image transmission to an external OCR/AI service.

Current state:

- external screenshot upload = 0
- cloud OCR API = 0
- OCR credential = 0
- default CDN OCR runtime path in adapter = 0
- production OCR composition activation = 0
- remote D1/Cron/deploy changes = 0

## Next activation gate

Before OCR can be wired into the actual import UI, a later phase must:

1. choose the deployment-time same-origin asset preparation mechanism;
2. verify the generated runtime files are actually reachable from the PWA origin;
3. measure iPhone/PWA load time, memory and OCR latency;
4. run private screenshot accuracy tests without committing those screenshots;
5. preserve adaptive layout parsing and explicit human review;
6. complete third-party notice review.

Phase 5X does not authorize deployment or production activation.
