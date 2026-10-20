# Visual and appearance regression acceptance

This corrective release addresses the October 20, 2026 mobile PWA and desktop feedback. It does not change database migrations, OCR recognition, notification delivery, or the scheduler.

## Changed behavior

- Page transitions use opacity without a blur or transformed ancestor around fixed navigation.
- Initial loading skeletons share the page's layout, appear only after 180 ms, and disappear when loading completes. Same-person background refresh keeps the current content.
- The person picker uses a modal dialog with an X button, backdrop and Escape dismissal, downward drag, focus restoration, and scroll unlocking.
- Import and schedule spacing, desktop floating navigation, active pill visibility, birthday/phone alignment, cake SVG, and subway station-name line colors are corrected.
- Settings offers system, light, and dark appearance. The theme is applied before React renders, persists per device, follows system changes in system mode, and updates across tabs.
- Service worker shell cache v5 precaches the theme bootstrap. Existing cache controls, data invalidation, and Push behavior remain intact.

## Required verification

The existing Phase B real-product runner invokes `scripts/verify-visual-theme-product.mjs` against isolated local D1 in Chromium and WebKit. It covers:

- 13 product routes in both themes at 390×844 and 1440×960, plus a six-week month at 360×740;
- first-paint theme bootstrap, persistence, system preference changes, and readable text contrast;
- title and navigation geometry, no residual blur, aligned birthday/phone and line colors;
- person-picker close paths, focus restoration, and body scroll restoration;
- delayed initial skeleton layout and no loader replay on warm navigation;
- synthetic XLSX matching, review, and time editing without an approval write.

`verify:pwa` also exercises the actual theme bootstrap in a VM, including unavailable storage and cross-tab changes. `verify:daily-life` checks service worker cache invalidation and late responses.

The complete required CI gate must pass on the final PR head before merging. The canonical deployment workflow then waits for the exact merged revision and checks Chromium/WebKit screens without product-data mutations.

## Evidence and limits

The first PR #95 run, [39375964212](https://github.com/ydh1121/ComeBackHome/actions/runs/39375964212), passed its real Chromium/WebKit UI tests and 11 of 12 required jobs. The remaining job correctly rejected a stale cache-v4 assertion after the implementation moved to v5. That assertion was updated to v5 with an additional theme-bootstrap precache check; this initial failure is retained as evidence rather than relabeled as a pass.

Final head, full CI and deployment outcomes are recorded on PR #95 and the project's four durable records. Browser emulation does not establish physical iPhone standalone-PWA acceptance. No real phone alarms or test Push messages are sent by these checks. All committed fixtures and screenshots are synthetic.
