# iPhone Clock handoff (F09)

The web app exports `cbh-clock/v1` through Apple's documented `shortcuts://run-shortcut` text input. It never calls an iOS Clock API. `deviceApplied` remains false. The complete Korean action-by-action setup is [the in-app guide](../public/guides/iphone-clock-setup.html), linked from AlarmPage. It specifies action names, variables, conditions, loops, exact local file location, cancellation and interrupted-action recovery.

## Executable receiver reference

`src/features/alarms/clock-receiver.ts` implements the pure validation and mutation planning reference for that native recipe. It is not an installed iOS shortcut and does not edit alarms. `npm run verify:clock-receiver` covers invalid/expired data, scope isolation, duplicate sync, changed schedules, OFF, midnight/year boundaries, overnight end, disabled owned alarms, missing ledger, ambiguous labels, personal alarms and interrupted creation. Required product CI includes this command; Chromium/WebKit test the setup link and mobile guide.

- Pin one installation/person scope during setup. Require schema v1, generation/expiry within five minutes, Seoul time zone, unique exact target IDs/labels, minute-aligned times strictly after now and before 24 hours from generation. Recheck expiry before applying. Reject invalid schedules instead of emitting an invalid plan.
- Enabled shifts contribute start minus 90 minutes and end plus 30 minutes; overnight end belongs to the next date. No arbitrary future-date Clock capability is assumed. Synchronize daily and after changes; no background PWA execution is promised.
- Save `clock-ledger.json` only under **On My iPhone/ComeBackHome**, never a shared iCloud directory. Ledger schema is `cbh-clock-ledger/v1`, with pinned `scope`, `receipts`, and `pending`. Each receipt records targetId, exact label, clockTime and fireAt. App IDs are not native alarm UUIDs.
- Resolve actual Find Alarm objects using exact ledger label AND matching time/non-repetition. A prefix alone is not ownership. A duplicate label, manually changed time/repetition, missing/corrupt ledger or pending operation stops the run. A matching target with no creation receipt is not adopted.
- Review the complete operation list. Delete only individually resolved owned objects, retaining Apple's confirmation. Skip Delete Alarms entirely for an empty list. Keep unchanged targets; explicitly **Turn On**, not toggle, a matching disabled owned alarm. Ignore personal alarms.
- Persist/read back pending CREATE or DELETE before the respective Clock action. Verify its actual result before replacing receipts and clearing pending. An interruption requires owner review; do not clear pending or reset a ledger automatically. No claim of transactional native Clock+Files operations or concurrent-run safety is made. Run one sync at a time.
- Recreating a manually deleted alarm replaces the same-label receipt instead of appending a duplicate. Before every native action recheck input expiry; before create/enable also recheck that fireAt is still future. Cancel a delayed native confirmation and recalculate instead of allowing a past clock time to become tomorrow's alarm.

`reconcileOwnedAlarms` is retained for the pre-existing web adapter contract; new native adapters must implement the stricter `prepareClockReceiver`/`recordClockCreation` protocol. Handles in the reference are opaque objects supplied by Find Alarm, not fabricated UUIDs.

## Native handoff status

The source reference and complete manual recipe are ready for review. There is no Apple-signed `.shortcut` artifact or iCloud installation link from this Linux environment. Do not rename JSON as an installable shortcut. The owner's iOS action/property availability, translation, file permissions, recipe execution, actual Clock changes and ringing remain **UNVERIFIED**. If required Label/Time/Is Enabled/Repeat properties are unavailable, stop; do not substitute personal alarm selections. Specific alarm sounds are not promised by the recipe; inspect sound in Clock after approved setup and after recreation.

The guide's device matrix covers first sync, repeat sync, edits, OFF, midnight/overnight, expiry, scope mismatch, duplicate labels, file errors, interruptions and preservation of all personal alarms. No installation or actual alarm change was executed. **RELEASE HOLD** remains until owner approval and separate device acceptance.

Official references checked 2026-10-15:
- https://support.apple.com/guide/shortcuts/run-a-shortcut-from-a-url-apd624386f42/ios
- https://support.apple.com/en-au/111098 (Find Alarm filtering, Delete Alarms on specified objects)
- https://support.apple.com/guide/shortcuts/use-if-actions-apd83dcd1b51/ios
- https://support.apple.com/guide/shortcuts/use-repeat-actions-apdc11deb2c1/ios
- https://support.apple.com/guide/shortcuts/custom-date-formats-apd8d9b19184/ios
- https://support.apple.com/en-ca/guide/shortcuts/apdf01f8c054/ios (Apple-validated shortcut export)
