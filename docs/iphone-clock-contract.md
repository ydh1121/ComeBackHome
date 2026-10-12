# iPhone Clock handoff (F09)

The web app exports `cbh-clock/v1` and passes it as text to the named shortcut using Apple's documented `shortcuts://run-shortcut` scheme. It never calls an iOS Clock API. `deviceApplied` is always false. Actual shortcut installation, alarm edits and ringing require owner approval and device acceptance.

## Receiver contract

- Require schema v1, a valid generation timestamp and expiry within five minutes, Seoul device time zone, a matching installation/person scope, unique target IDs/labels, and target timestamps strictly between now and 24 hours from generation. Stop on any failure.
- Only enabled shifts contribute start minus 90 minutes and end plus 30 minutes. Overnight end belongs to the following date. Clock alarms recur by time of day: do not materialize more distant dates. Synchronize daily and after changes; no background PWA execution is promised.
- Store a private creation ledger in Shortcuts' own file storage, scoped by installation and person. Keep app target ID, exact unique label and clock time only after creating an alarm successfully. These app IDs are NOT claimed to be iOS alarm UUIDs.
- Use Find Alarm to obtain actual alarm objects. Match exact label and time against that creation ledger. A label prefix alone is never proof of ownership. If lookup is ambiguous, stop for manual review; do not infer which alarm is owned. Existing personal alarms are outside this scope.
- Pass only individually resolved app-owned alarm objects to Delete Alarms. If there are none, skip the action entirely. Keep Apple's confirmation enabled. Never use a delete-all operation. Preserve matching alarms; recreate disabled or changed owned alarms only after reviewing the operation list.
- For each missing target, Create Alarm at `clockTime`, with exact target label and no repetition. Write its successful creation receipt to the ledger. If the operation fails, preserve the last successful ledger and stop. Re-running should retain matching targets without duplication.

`reconcileOwnedAlarms` is the software reference for a receiver adapter: its `id` is an opaque adapter handle, not an assumed property exposed by Shortcuts. Native Find Alarm object resolution and ledger persistence still require validation on the owner's iPhone. The in-app checkbox confirms that the separately configured receiver implements these guards; it is not a device-test PASS.

Official references checked 2026-10-12:
- https://support.apple.com/guide/shortcuts/run-a-shortcut-from-a-url-apd624386f42/ios
- https://support.apple.com/en-au/111098 (Find Alarm filtering and deletion of specified alarm objects)

Acceptance: web contract, ownership reference, scope isolation, OFF/overnight calculations and URL handoff are testable in CI. Native receiver installation and actual alarms remain UNVERIFIED / RELEASE HOLD.
