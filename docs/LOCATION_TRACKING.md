# Location check-ins

Run `npm run db:setup` before restarting the server. Existing employees default to disabled. The migration preserves existing records.

1. Admin: open **Location tracking**, select an employee, and choose **Enable check-ins**.
2. Employee: refresh the dashboard to show **Location tracking** in the sidebar. Add an optional visit note/photo, then tap **Capture & save location** and allow browser location access.
3. Admin: select the employee and day, then select a check-in for coordinates, accuracy, capture time, server receipt time, and any attached photo.

Employees can submit multiple locations per day (up to 100). The server always uses the signed-in employee's identity. Saved entries cannot be edited. Admins can select a check-in and choose **Delete check-in**, with confirmation. Deletion removes the entry and attached photo; an audit record is retained. Employees and staff cannot delete entries. Disabling check-ins prevents new submissions and retains the history. Only administrators and the owning employee can access records and photos; staff cannot.

This is voluntary, button-triggered device location capture, not background/live tracking. Browser location requires HTTPS on employee phones (localhost is allowed for development), device location enabled, and browser permission. Denials, timeouts and unavailable location produce retry guidance. No manual coordinate entry or draggable pin is provided. Device spoofing cannot be fully prevented by a website. Reported accuracy is shown; positions over 100 metres accuracy are labelled approximate. Capture timestamps must be within the previous two minutes, allowing 30 seconds of future clock skew. Submission requires an internet connection; no offline queue is included.

The **Day** selector shows one local day based on device capture time. Times use the attendance timezone (`attendanceTimeZone`, falling back to WhatsApp `timeZone`, then `Asia/Kolkata`), newest first. The timezone is labelled beside the timeline. UTC storage is preserved; local midnight boundaries, including daylight saving changes, are applied when filtering. Each item shows its device capture time and area name; no background monitoring occurs. At most 500 entries are returned.

Photos are optional. The browser resizes JPEG, PNG and WebP inputs (up to 12 MB) to JPEG, removes original metadata by drawing to canvas, and uploads at most 1 MB. The server restricts photo formats and size, stores bytes privately in MySQL, and serves them only through an authenticated ownership-checked endpoint. Include `location_checkins` in database backups. Locations and photos are retained until an administrator deletes the check-in; this version has no retention scheduler.

## Map settings (API keys)

Open **Admin → Location tracking → Map settings · API keys**. No employee selection is required to configure a provider.

### Geoapify (free plan)

Select **Geoapify (free plan)**, paste your **Geoapify API key**, and click **Save map settings**. One key powers both the map preview and area names. Create a key at https://myprojects.geoapify.com/. Requests are sent by your server, so any key restrictions must allow your server rather than relying on browser referrers. No Google key is needed. The optional `GEOAPIFY_API_KEY` environment variable supplies a fallback after selecting Geoapify.

The preview is a static map image with a marker, with Geoapify and OpenStreetMap attribution. The API key is kept on the server; authenticated map-image endpoints enforce employee ownership. Provider errors show a friendly retry/configuration message. The external Google Maps link opens the point without a Google API key; the embedded Google iframe is never used when Geoapify is selected.

Geoapify's free plan has daily credit limits; viewing maps and resolving area names use those credits. The service is not unlimited. Documentation: https://apidocs.geoapify.com/docs/maps/static/ and https://apidocs.geoapify.com/docs/geocoding/reverse-geocoding/.

### Google Maps (optional)

Select **Google Maps** to use the existing two-key configuration:

- **Maps preview API key:** enable Maps Embed API in Google Cloud, with billing configured. Restrict the key to your website's HTTP referrers and Maps Embed API.
- **Area names API key:** enable Geocoding API. Use a separate server key restricted to your server's public IP and Geocoding API.

Keys from Google and Geoapify are not interchangeable. Saved keys for the inactive provider are preserved when switching. Blank fields keep existing keys. The explicit **Remove saved key** checkbox disables that key, including any environment fallback. Settings apply immediately and are stored in `location_config`; include that table in protected backups. Key values are never written to audit details.

`GOOGLE_MAPS_EMBED_API_KEY` and `GOOGLE_MAPS_GEOCODING_API_KEY` remain supported as fallbacks. Admin-saved settings take precedence.

Area labels use neighborhood/suburb and city components rather than coordinates or full street addresses. Names are resolved on demand, including historical check-ins. If a key is missing, the provider fails, or no area is found, the app displays **Area name unavailable**. Check-ins save independently of map/geocoding availability.
