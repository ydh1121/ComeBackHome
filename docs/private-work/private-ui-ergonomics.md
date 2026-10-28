# Private module usability closeout

Scope: household and injury screens. Schedule pages, schedule domain/provider code,
portable schedule components, database migrations and production data are unchanged.

## Changes

- Private iOS standalone routes use the same opaque status-edge treatment already
  accepted by the schedule shell. No extra title offset is introduced.
- Private dialogs have a fixed header, 44px close control, one vertical body scroller,
  viewport scroll locking/restoration, keyboard-aware height and native select fields.
  Initial focus reads the heading; keyboard focus indicators remain available.
- Session revalidation closes and hides dialog portals. Successful same-account
  verification retains the draft; identity change/logout discards it.
- Card artwork selection uses images and an accessible name, with photo changes in
  the card editor. Private device caching uses account/card/image IDs, 24h expiry,
  20 images/20MiB bounds, and clear/OFF/logout invalidation. Server auth/no-store remain.
- Notes use 16px inputs, optional recipient selection and completed-item removal.
  Recipients are stable account roles; absent legacy metadata means both accounts.
  Removal archives existing rows and suppresses pending reminders without deleting history.
- Injury materials separate input, stored items and connection settings. Expanded
  disclosures share consistent typography/spacing; native duplicate file controls
  are visually hidden while retaining keyboard accessibility.

## Validation

Run the existing private workflow, including:

- verify-household-domain / notifications / storage / cache
- verify-private-work-browser (isolated D1, expanded materials at five widths)
- verify-household-browser (two identities, cache, recipients, deletion, five widths)
- verify-private-sheet-browser (scroll, focus, authentication and draft retention)
- verify-household-card-art-browser (real IndexedDB in Chromium and WebKit)

All browser fixtures are synthetic and prohibit external provider traffic.
Native iPhone status-bar rendering and keyboard gestures require device confirmation;
Chromium/WebKit emulation does not establish native iPhone acceptance.

## Transit quota investigation (read-only)

The minute scheduler asks for an ETA on working days before checking notification
windows/settings. Its ETA source creates a new ProviderCommuteRepository for each
call, so the existing 60-second instance cache cannot span scheduler ticks.
Departure/arrival coordinate combinations multiply route requests. A conditional
one-person/one-pair example is 1,440 requests/day, not an observed usage measurement.
No persistent per-provider request counter currently attributes actual use.

Synthetic CI uses fixtures/mocks; ordinary visits to the live Today page can make
normal route requests. No live provider probes were used for this investigation.
Schedule and notification-planner behavior were intentionally left unchanged under
the user's explicit preservation instruction. GPT response verification is deferred.
