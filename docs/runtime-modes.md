# ComeBackHome Runtime Modes

Status: PRODUCT COMPLETION

## Production

Production defaults to `VITE_CBH_RUNTIME=api` and `VITE_CBH_PROVIDER_RUNTIME=api` semantics even when a build-time value is absent.

API runtime:
- people, schedules, places, commute preferences/routes and presence state use same-origin `/api/*`;
- D1 is the persistent server store;
- Kakao/Seoul provider data is server-derived;
- Today/ETA overlays realtime provider observations on persisted route configuration;
- Excel and image/OCR imports run through production parsers and reviewed schedules commit through one D1 batch;
- Web Push subscription transport and notification delivery use the production software path;
- browser notification permission remains browser-local state.

The browser never receives provider secrets or a configurable external API base.

## Development

Mock runtime is development-only. It is loaded from `src/app/mockComposition.ts` only when `import.meta.env.DEV` is true and the runtime mode is explicitly mock.

Production composition does not import mock repositories, mock providers, or `MOCK_FIXTURE`.

## Provider-disabled API mode

Local integration may run API persistence with provider mode disabled. In that mode:
- persistence still uses same-origin API/D1;
- provider searches return no fake data;
- Today degrades to UNKNOWN/FALLBACK where provider evidence is unavailable;
- no fixture data is substituted.

Unsupported runtime combinations fail startup rather than silently falling back.
