# WhatsApp attendance and leave

Follow the [README setup steps](../README.md#5-connect-whatsapp-through-chatery) first. Dayline uses a separate Chatery service; cloning Dayline alone does not install it or copy your paired phone.

## What happens to a message

1. Chatery receives messages for the linked phone and keeps the available history.
2. Dayline checks the selected group at the configured interval or when you click Sync.
3. Dayline matches the sender's phone to an active employee. Set the employee's number including country code, for example `+919999999999`. An unresolved WhatsApp identity may still require explicit linking.
4. Recognized attendance messages are applied automatically only when auto-approval is enabled. Otherwise they wait for manual approval. Unknown senders, unsupported times and conflicting entries require review.
5. If leave collection is enabled, recognized leave/half-day messages become pending requests. They never auto-approve.

No outbound messages are sent by Dayline.

## The three attendance options

| Option | Effect |
| --- | --- |
| Enable automatic attendance/import | Allows the attendance importer to run. Save a group and timezone first. |
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

Explicit times without AM/PM are resolved using the existing 9 AM–8 PM office window and message timestamp; unsupported or unresolved inputs remain for review. Changing shift settings does not replace the parser's office-hours interpretation. Dot-separated clock times and joined labels such as `Intime 9.36` are supported. This is rule-based parsing, not unrestricted natural-language understanding.

## Sync limits and history

- **Messages per sync:** 1–2,000; default 200. This is a batch size, not a lifetime limit or daily allowance.
- **Auto-sync interval:** 1–1,440 minutes; default 5 minutes. The server checks whether a sync is due every 15 seconds, so execution can be slightly after the selected interval.
- Both the automatic timer and manual Sync use the same importer. Manual Sync bypasses waiting for the next interval, but still respects the configured batch size.
- With 450 available messages and a batch of 200, history takes multiple syncs. The saved queue/cursor lets subsequent runs continue. Some scans need later runs to finish applying the queued messages.
- History is scanned and applied chronologically so Out time can follow the corresponding In time. Successfully imported IDs prevent duplicate processing.
- Closing Dayline pauses its background work. After reopening, it can catch up on eligible messages **that Chatery has available**, including messages sent while Dayline was closed.
- Each device/group keeps its original import boundary. History from before its first enable is excluded. Switching groups does not intentionally reset that group's boundary.
- The screen shows only the latest 100 attendance messages; that display limit is separate from the sync batch size.
- Clear removes stored attendance-message history for that group. This also removes deduplication records, so a later history scan can see those messages again. It does not reset saved attendance; use Attendance → Reset attendance for that.

The configured interval does not guarantee delivery while the backend, database, Chatery, phone connection or network is unavailable. A sync can only read history supplied by Chatery.

## Leave Approval

Enable **Allow Leave Approval** in the Leave Approval module. It uses the same device, group, timezone and sync settings as attendance; leave collection can run independently of attendance importing.

Examples:

- `@Bharat sir I will be on leave from 8 to 10 Oct`
- `@Bharat sir I will be on leave tomorrow`
- `Today I am on a half day`

Relative dates use the message date in the selected timezone. Missing/ambiguous dates, tentative wording and unknown senders need review. Confirm the employee, type and date range in the request. Approving leave marks Absent; approving a half day marks Half day. Existing attendance is retained unless you explicitly approve an overwrite. Approval and rejection are manual only.

## Device lifecycle and moving machines

A green dot means connected; red means disconnected. Device logout requires confirmation and pauses imports. Keep Chatery's `sessions/` directory for normal restarts. On a fresh laptop, install both services and link the phone again unless you deliberately migrate the session credentials securely. Never put that directory or API keys in Git.

An existing shared Chatery server can serve a relocated Dayline backend when its URL, API key and saved session ID match. You do not need a separate Chatery installation on every employee's laptop.
