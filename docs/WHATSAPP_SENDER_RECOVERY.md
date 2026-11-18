# WhatsApp history sender recovery

Some WhatsApp history messages store the author in `message.participant`, rather than `message.key.participant`. Chatery previously substituted the group address in that case, so Attendance could not match an employee. Its Retry action then reconstructed an invalid LID from the saved `unresolved` marker.

The connector fix reads both author locations and explicit participant alternates, resolves LIDs through the existing identity map, and never exposes a group or LID as a phone number. The Attendance fix refreshes unresolved messages on Retry, persists recovered identity, and allows a rescan to recover identity while respecting auto-approval and manual-entry protection.

## Deploying the connector fix

The running managed connector was patched in `/root/projects/Test/chatery_whatsapp`. The portable patch is [chatery-sender-recovery.patch](chatery-sender-recovery.patch). Include it when deploying Attendance to another installation or replacing/upgrading Chatery:

```sh
git -C "$CHATERY_MANAGED_PATH" apply --check /path/to/Attendance-Tracker/docs/chatery-sender-recovery.patch
git -C "$CHATERY_MANAGED_PATH" apply /path/to/Attendance-Tracker/docs/chatery-sender-recovery.patch
```

Restart the connector and Attendance after deploying the changes. Do not delete the connector's sessions or identity store. If the patch is already applied or upstream changes conflict, inspect the formatter before applying it again.

For an existing unresolved review entry, **Fetch sender** retrieves the original message by its ID and group (up to 2,000 messages per attempt). A normal rescan can also recover it. Auto-approval off leaves rescanned attendance pending approval. If WhatsApp no longer retains the message or genuinely supplies no author, the entry stays in review; the application never guesses which employee sent it.

## Regression checks

```sh
node --test server/test/whatsapp.test.js
npm run test:whatsapp
npm run test:whatsapp:ui
```

The managed connector also has `test/message-formatter.test.js`; run it with `node --test test/message-formatter.test.js` in its directory.

## Catching up after a disconnected evening

Normal sync scans at least the whole previous calendar day in the configured WhatsApp timezone, while respecting the group's original import start. This catches delayed messages even after today's IN advances the checkpoint. A rolling 24-hour cutoff could stop on an ordinary chat message before reaching yesterday's attendance. Existing fetch progress is widened on resume; selected-date sync remains limited to the chosen dates.

Reconnect WhatsApp and run sync. Large backlogs continue across sync batches and are applied oldest first. Messages must be available from the connector; this change does not recover history WhatsApp has not supplied. Existing approval, deduplication, and manual-edit protection still apply. Validate with `npm run test:whatsapp` and `npm test`.

## Phone history recovery and pagination

The connector also needs [chatery-history-recovery.patch](chatery-history-recovery.patch). The previous implementation passed a cursor wrapper and chat ID to `fetchMessageHistory`, expected an immediate message array instead of a request ID, and never stored `messaging-history.set`. This meant changing Attendance's cutoff alone could not recover messages absent from the connector cache. Filtering protocol messages also incorrectly shortened pages and ended pagination early.

The repair stores asynchronous history without replaying live-message webhooks, uses actual message keys and millisecond timestamps, and requests at most 50 messages from the phone per page. Pagination follows raw messages. Manual Attendance sync requests phone history; automatic sync continues reading cached/live messages without requiring the phone. Pending recovery leaves the scan checkpoint unchanged and reports that the linked phone needs to remain online. An unanswered request is not evidence that all messages have been imported.

The patch is installed in the managed connector. For another installation, inspect/apply it and restart both services while retaining the existing session store:

```sh
git -C "$CHATERY_MANAGED_PATH" apply --check /path/to/Attendance-Tracker/docs/chatery-history-recovery.patch
git -C "$CHATERY_MANAGED_PATH" apply /path/to/Attendance-Tracker/docs/chatery-history-recovery.patch
cd "$CHATERY_MANAGED_PATH" && node --test test/history-recovery.test.js test/message-formatter.test.js
```

The [Baileys history documentation](https://github.com/WhiskeySockets/docs/blob/main/advanced/history-sync.mdx) describes asynchronous delivery through `messaging-history.set`. Recovery still depends on the linked phone returning its retained messages. Keep WhatsApp open on that phone and retry the selected date when recovery is pending; do not delete pairing data or reset attendance.

### October 26 live verification

A follow-up check confirmed nine IN events and one OUT event for October 26, 2026; this is incomplete according to the user's group history. The phone did return ON_DEMAND notifications. Downloading and decoding the received payloads produced the selected attendance group with zero messages. A request anchored at October 27's first IN also received a matching empty history response. Testing the alternate raw timestamp convention did not recover additional messages; the documented millisecond request was retained. The empty result must not be described as successful recovery of the missing OUT times or attributed simply to an offline phone. Existing attendance was preserved. Recovery remains unverified; a group-chat export with original timestamps is an alternative source if the connector continues returning no messages.

### Durable retry and cache persistence

Pending manual recovery now saves its fetch cursor and recovery intent before returning. The background worker retries that pending job every 15 seconds so a slow phone response does not require another manual click. Regression coverage checks that the automatic retry keeps phone recovery enabled and leaves the checkpoint unchanged until processing succeeds.

The connector serializer previously used one global WeakSet, treating shared objects in separate maps as cycles. This could replace a cached message or identity alias with null during restart persistence. It now detects ancestor cycles only and preserves shared references as separate JSON values. A roundtrip regression verifies a message shared by chat metadata and the message map, plus identity aliases. Older null message entries and identity aliases are tolerated on restore. These fixes do not prove that all missing October 26 messages have been recovered.

### Clear a stuck sync (November 4, 2026)

In WhatsApp attendance, click **Clear stuck sync**, then **Sync latest messages**.
Clearing pauses background imports until that explicit Sync. Attendance, pairing,
message review history, duplicate protection, queued messages and checkpoints are
preserved. The next scan starts from the newest cached messages without requesting
phone history; normal automatic sync resumes afterward. If an older request is
still finishing, wait a few seconds and click Sync again. A revision change
prevents its late response from restoring the old job.

The admin-only endpoint is `POST /api/whatsapp/sync/clear`. This does not recover
messages absent from the connector or resolve missing clock-ins. Explicit history
sync remains available afterward. No schema migration or dependency is needed.
