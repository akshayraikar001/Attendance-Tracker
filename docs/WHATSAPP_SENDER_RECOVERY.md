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
