# WhatsApp attendance and leave

Follow the [README setup steps](../README.md#5-connect-whatsapp-through-chatery) first. Dayline uses a separate Chatery service; cloning Dayline alone does not install it or copy your paired phone.

## What happens to a message

1. Chatery receives messages for the linked phone and keeps the available history.
2. Dayline checks the selected group at the configured interval or when you click Sync.
3. Dayline matches the sender's phone to an active employee. Set the employee's number including country code, for example `+919999999999`. An unresolved WhatsApp identity may still require explicit linking.
4. Recognized attendance messages are applied automatically only when auto-approval is enabled. Otherwise they wait for manual approval. Unknown senders, unsupported times and conflicting entries require review.
5. If leave collection is enabled, recognized leave/half-day messages become pending requests. They never auto-approve.

Attendance/leave syncing sends no replies. The separate **Reports → Send Emp Report** action can send a monthly PDF/Excel privately to selected employees after administrator confirmation. It uses their saved phone numbers, not the attendance group, and never runs automatically. See the README for formats, sent tracking and uncertain-delivery handling.

## Attendance options

| Option | Effect |
| --- | --- |
| Enable automatic attendance/import | Allows the attendance importer to run. Save a group and timezone first. |
| Allow edited messages | Allows manual approval of edited WhatsApp messages. Off by default; edits remain visible but cannot be approved. Edits never auto-approve. |
| Auto-approve attendance | Allows recognized messages to update attendance during sync. When off, new messages wait for manual approval even if the employee has no saved time. |
| Allow auto-approval to replace existing times | Allows automatic replacement of conflicting saved times when auto-approval is also enabled. Leave it off to preserve existing times. |

Manual **Approve and overwrite** is an explicit replacement action independent of automatic overwrite permission. Check employee, date and message time before using it.

## Message examples

Labels are case-insensitive: `out Time`, `out time` and `Out time` are equivalent. Supported examples include:

| Message | Meaning |
| --- | --- |
| `In time 10:50` | In time at 10:50 AM under the office-hours interpretation. |
| `In time 2:05` | In time at 2:05 PM under the office-hours interpretation. |
| `Out time 6:55` | Out time at 6:55 PM under the office-hours interpretation. |
| `In 9:30 AM` | Explicit 9:30 AM In time. |
| `Out 18:15` | Explicit 6:15 PM Out time. |
| `IN` / `OUT` | Uses the WhatsApp message timestamp in the selected timezone. |

Explicit times without AM/PM are resolved using the existing 9 AM–8 PM office window and message timestamp; unsupported or unresolved inputs remain for review. Changing shift settings does not replace the parser's office-hours interpretation. Dot-separated clock times, spaces around dots/colons, mixed capitalization and joined labels are supported: `In time 9. 40`, `IN TIME 10.25`, `oUt TiMe 6 . 55` and `Intime 9.36`. Invalid minutes and extra unrelated text still require review. Hour-only values also work: `In time 10` → 10:00 AM, `Out time 7` → 7:00 PM, and `OUT 8 PM` → 8:00 PM. The existing office-hours/AM-PM rules remain. This is rule-based parsing, not unrestricted natural-language understanding.

Explicit @mentions (names or numeric tags) are hidden in the attendance and leave message lists and ignored by the parsers. Original messages remain stored. Employee matching still uses the actual WhatsApp sender, never a mentioned person.

## Sync limits and history

- **Messages per sync:** 1–2,000; default 200. This is a batch size, not a lifetime limit or daily allowance.
- **Auto-sync interval:** 1–1,440 minutes; default 5 minutes. The server checks whether a sync is due every 15 seconds, so execution can be slightly after the selected interval.
- Both the automatic timer and manual Sync use the same importer. Manual Sync bypasses waiting for the next interval, but still respects the configured batch size.
- With 450 available messages and a batch of 200, history takes multiple syncs. The saved queue/cursor lets subsequent runs continue. Some scans need later runs to finish applying the queued messages.
- History is scanned and applied chronologically so Out time can follow the corresponding In time. Successfully imported IDs prevent duplicate processing.
- Recent Out messages extend the history search up to 48 hours before their message timestamp to find an earlier In, including overnight shifts. Out messages already waiting for an In also widen the next search. The saved cursor/cutoff continues across batch limits; once the In is applied, the waiting Out is retried. Employee matching, manual approval, import boundaries and the today/yesterday automatic-change limit still apply. An In absent from Chatery's available history cannot be recovered by this search.
- Closing Dayline pauses its background work. After reopening, it can catch up on eligible messages **that Chatery has available**, including messages sent while Dayline was closed.
- Each device/group keeps its original import boundary. History from before its first enable is excluded. Switching groups does not intentionally reset that group's boundary.
- Messages are grouped by full calendar date in the group timezone. Today is expanded; older days start collapsed. Each expanded day loads 100 messages at a time; Load more messages shows the rest. Day counts include the entire day.
- Sync today, Sync date, Sync day and Sync selected days scan only the chosen message dates. Sync all history scans available history since the group import boundary. Both use saved pagination/batch limits, so large scans continue over subsequent syncs. Finish an active job before starting a new selection. A selected-day job does not advance the normal incremental checkpoint.
- Day checkboxes support bulk sync and clear. Clear day/selected days archives all messages on those dates, including unloaded pages, without changing attendance. The top navigation shows Sync: WhatsApp connected/disconnected/unavailable, refreshed every 15 seconds for administrators. Its dot is green when connected and red when disconnected/unavailable. The WhatsApp panel keeps the Connection/Import line and batch progress details.
- Clear moves the current device/group messages to cleared history. Duplicate protection and saved attendance remain intact. Select Show cleared history to review them by day.
- Automatic approval and overwrite can only change today or yesterday in the group timezone, including after an offline catch-up. Older messages stay available for manual approval; explicit manual overwrite is still allowed.

The configured interval does not guarantee delivery while the backend, database, Chatery, phone connection or network is unavailable. A sync can only read history supplied by Chatery.

## Leave Approval

Enable **Allow Leave Approval** in the Leave Approval module. It uses the same device, group, timezone and sync settings as attendance; leave collection can run independently of attendance importing.

Examples:

- `@Bharat sir I will be on leave from 8 to 10 Oct`
- `@Bharat sir I will be on leave tomorrow`
- `Today I am on a half day`
- `I need leave today and tommorw`
- `Leave on 15,16` (consecutive dates in the message month)
- `Leave Friday and Saturday` (those dates in the message's Monday–Sunday week)
- `Half day this Fri & Sat` (same weekday rule)

Weekdays use the original message date and group timezone, even if synced later. Separate nonconsecutive weekdays, mixed dates, exclusions and explicit next/last-week requests stay for manual review. No leave is approved automatically.

Relative dates use the message date in the selected timezone. Missing/ambiguous dates, tentative wording and unknown senders need review. Confirm the employee, type and date range in the request. Approving leave marks Absent; approving a half day marks Half day. Existing attendance is retained unless you explicitly approve an overwrite. Approval and rejection are manual only.

## Device lifecycle and moving machines

A green dot means connected; red means disconnected. Device logout requires confirmation and pauses imports. Keep Chatery's `sessions/` directory for normal restarts. On a fresh laptop, install both services and link the phone again unless you deliberately migrate the session credentials securely. Never put that directory or API keys in Git.

An existing shared Chatery server can serve a relocated Dayline backend when its URL, API key and saved session ID match. You do not need a separate Chatery installation on every employee's laptop.

Pending requests saved with missing dates are re-parsed on listing, using their original message timestamp and the selected timezone. The suggested dates prefill both approval inputs. This does not approve the request or change decided requests. Nonconsecutive dates still require manual review.

Direct status changes, including approved leave with explicit replacement, keep existing In/Out times and measured hours. The chosen status stays authoritative. Clear times in the attendance editor only when you intend to remove them; reset attendance still removes the whole entry.

## Edited messages and corrections

When the connector returns changed text for the same message ID, Dayline updates its review entry and marks it Edited. Already saved attendance stays unchanged until manual approval. **Allow edited messages** must be saved before approving edits. New edits clear older corrections and require review again.

Use **Edit entry** on a pending/error message to choose employee, date, In/Out and time, then **Approve entry**. Select **Overwrite existing attendance** only when replacement is intended. The original message text is preserved; the correction is stored separately. A failed correction remains pending and cannot be applied by automatic sync. Selecting an employee here does not change permanent sender links.

Run `npm run db:setup` after updating Dayline. The migration adds review metadata without changing existing attendance. Restart Dayline afterward.

The Chatery connector must expose Baileys edited-message wrappers as text and preserve original timestamps. Apply `docs/chatery-edited-messages.patch` from this repository to the configured Chatery checkout (after any existing history/sender patches):

```bash
cd /path/to/chatery_whatsapp
git apply --check /path/to/Attendance-Tracker/docs/chatery-edited-messages.patch
git apply /path/to/Attendance-Tracker/docs/chatery-edited-messages.patch
```

Restart Chatery without deleting its auth/session folders. The patch is already applied to this machine's connector. Edit detection uses the history returned by Chatery; use the original message's date or Sync all history for older edits. Edits not delivered by WhatsApp to the connector cannot be reconstructed.

## Group message review and edit recovery

WhatsApp → All group messages scans all available messages from the configured group, without attendance-pattern filtering or the automatic attendance import boundary. Scan pages are saved separately in whatsapp_group_messages; whatsapp_group_scans retains progress. The view fetches on first opening and provides Fetch all messages, Pause/Resume scan, day selection and 100-message display pages. Phone history can remain pending or unavailable; complete phone history cannot be guaranteed. There are no attachment downloads.

In time and Out time are display hints extracted anywhere in message text/captions. They never filter the scan or approve attendance. Messages with no detected times, invalid times, ordinary conversation and media remain visible.

Clear day and Clear all messages archive only this separate view. Show cleared group messages reveals them. Rescans update the same IDs and retain their cleared state. Clearing invalidates an outstanding scan page, and never deletes source WhatsApp messages, attendance events, leave requests or attendance records.

Select for review fetches the current source message when available, falling back to the saved scan if the connector has evicted it. It never adds attendance automatically. The correction dialog lets an administrator choose employee, date, In/Out and time, then approve. Edited messages still require Allow edited messages. Selection is idempotent and cannot select from a stale/different group. The manualOnly flag prevents automatic retries from approving selected entries.

Connector recovery preserves edited text across history and upsert replays, holds edits arriving before originals, and replays retained protocol edit events when restoring its cache. Original message timestamps remain unchanged. Edits never received by the connector and absent from recovered phone history cannot be reconstructed.

After the earlier sender/history/edited-message patches, apply:
```sh
cd /path/to/chatery_whatsapp
git apply --check /path/to/Attendance-Tracker/docs/chatery-group-review.patch
git apply /path/to/Attendance-Tracker/docs/chatery-group-review.patch
cd /path/to/Attendance-Tracker
npm run db:setup
node scripts/check-chatery-edits.cjs /path/to/chatery_whatsapp
```
Restart the API and connector. The additive schema upgrades add whatsapp_events.manualOnly plus whatsapp_group_messages and whatsapp_group_scans; no attendance rewrite is required.
