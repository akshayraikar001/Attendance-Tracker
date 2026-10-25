import React, { useEffect, useRef, useState } from "react";
import {
  MapPin,
  Camera,
  Navigation,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import MapsSettings from "./MapsSettings.jsx";
import api from "../../services/api.js";
import { localDate, utcInstant } from "../../../../shared/location-time.js";
async function photoData(file) {
  if (!file) return null;
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw new Error("Choose a JPEG, PNG, or WebP photo.");
  if (file.size > 12 * 1024 * 1024)
    throw new Error("Choose a photo smaller than 12 MB.");
  const bitmap = await createImageBitmap(file);
  try {
    const ratio = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * ratio);
    canvas.height = Math.round(bitmap.height * ratio);
    canvas
      .getContext("2d")
      .drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL("image/jpeg", 0.75);
    if (data.length > 1400000)
      throw new Error("This photo is too large. Choose a smaller photo.");
    return data;
  } finally {
    bitmap.close();
  }
}
export default function LocationTracking({ admin = false }) {
  const [employees, setEmployees] = useState([]),
    [employeeId, setEmployeeId] = useState(""),
    [date, setDate] = useState(""),
    [areas, setAreas] = useState({}),
    [mapError, setMapError] = useState(false),
    [data, setData] = useState(null),
    [selectedId, setSelectedId] = useState(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false),
    [note, setNote] = useState(""),
    [photo, setPhoto] = useState(null),
    [revision, setRevision] = useState(0);
  const request = useRef(0),
    fileInput = useRef(null),
    selection = useRef(employeeId);
  selection.current = employeeId;
  useEffect(() => {
    if (admin)
      api("/employees")
        .then(setEmployees)
        .catch((e) => setError(e.message));
  }, [admin]);
  useEffect(() => {
    const token = ++request.current;
    setData(null);
    setSelectedId(null);
    setError("");
    if (admin && !employeeId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const params = new URLSearchParams({
      ...(date ? { date } : {}),
      ...(admin ? { employeeId } : {}),
    });
    api((admin ? "/locations" : "/me/locations") + "?" + params)
      .then((result) => {
        if (request.current === token) {
          setData(result);
          setSelectedId(result.records[0]?.id || null);
        }
      })
      .catch((e) => {
        if (request.current === token) setError(e.message);
      })
      .finally(() => {
        if (request.current === token) setLoading(false);
      });
    return () => {
      request.current++;
    };
  }, [admin, employeeId, date, revision]);
  useEffect(() => {
    setAreas({});
    if (!data?.areaNamesConfigured) return;
    let cancelled = false,
      index = 0;
    const records = data.records;
    async function worker() {
      while (!cancelled && index < records.length) {
        const row = records[index++];
        let result;
        try {
          result = await api("/location-areas/" + row.id);
        } catch {
          result = { areaName: null, status: "unavailable" };
        }
        if (!cancelled) setAreas((old) => ({ ...old, [row.id]: result }));
      }
    }
    for (let i = 0; i < Math.min(4, records.length); i++) worker();
    return () => {
      cancelled = true;
    };
  }, [data]);
  const areaLabel = (row) =>
    areas[row.id]?.areaName ||
    (data?.areaNamesConfigured && !areas[row.id]
      ? "Finding area…"
      : "Area name unavailable");
  useEffect(() => setMapError(false), [selectedId, data]);
  async function toggle() {
    setBusy(true);
    setError("");
    const id = employeeId;
    try {
      const result = await api(
        "/locations/employees/" + id,
        { enabled: !data.enabled },
        "PUT",
      );
      if (selection.current === id)
        setData((d) => (d ? { ...d, enabled: result.enabled } : d));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function submit(e) {
    e.preventDefault();
    setError("");
    setMessage("");
    setBusy(true);
    try {
      if (!window.isSecureContext)
        throw new Error(
          "Location needs HTTPS. Open this website using its secure HTTPS address.",
        );
      if (!navigator.geolocation)
        throw new Error("This device does not support location capture.");
      const image = await photoData(photo);
      setMessage(
        "Getting your current location… Please allow location access.",
      );
      const position = await new Promise((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: 20000,
        }),
      );
      await api("/me/locations", {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        capturedAt: new Date(position.timestamp).toISOString(),
        note,
        photo: image,
      });
      setNote("");
      setPhoto(null);
      if (fileInput.current) fileInput.current.value = "";
      setDate("");
      setRevision((n) => n + 1);
      setMessage("Location check-in saved.");
    } catch (e) {
      setMessage("");
      setError(
        e.code === 1
          ? "Location permission was denied. Allow location access in your browser and try again."
          : e.code === 2
            ? "Your location is unavailable. Turn on device location and try again."
            : e.code === 3
              ? "Location timed out. Try again outdoors or near a window."
              : e.message || "Could not save your location. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  const timeZone = data?.timeZone || "Asia/Kolkata";
  const displayTime = (value) =>
    utcInstant(value).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZone,
    });
  async function deleteEntry() {
    if (
      !selected ||
      busy ||
      !window.confirm(
        "Delete this check-in and its attached photo? This cannot be undone.",
      )
    )
      return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api("/locations/" + selected.id, undefined, "DELETE");
      setRevision((n) => n + 1);
      setMessage("Location check-in deleted.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const selected = data?.records.find((r) => r.id === selectedId);
  const coords = selected ? `${selected.latitude},${selected.longitude}` : "";
  const mapLink =
    "https://www.google.com/maps/search/?api=1&query=" +
    encodeURIComponent(coords);
  return (
    <section className="card location-module">
      <div className="card-heading">
        <div>
          <h2>Location tracking</h2>
          <p>
            {admin
              ? "Choose an employee and a day to review timestamped check-ins."
              : "Save a location timestamp for each visit. Your location is captured only when you tap save."}
          </p>
        </div>
        <MapPin size={24} />
      </div>
      {admin && <MapsSettings onSaved={() => setRevision((n) => n + 1)} />}
      <div className="location-controls">
        {admin && (
          <label>
            Employee
            <select
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              disabled={busy}
            >
              <option value="">Select employee</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Day
          <input
            type="date"
            value={date || data?.date || localDate(new Date(), timeZone)}
            disabled={busy}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </label>
        <button
          className="button"
          aria-label="Refresh locations"
          disabled={loading || busy || (admin && !employeeId)}
          onClick={() => setRevision((n) => n + 1)}
        >
          <RefreshCw size={16} />
        </button>
      </div>
      {error && (
        <p className="error-text location-message" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="location-message" role="status">
          {message}
        </p>
      )}
      {loading && (
        <p className="location-message" role="status">
          Loading locations…
        </p>
      )}
      {admin && !employeeId && (
        <div className="employee-empty">
          <MapPin size={30} />
          <h3>Select an employee</h3>
          <p>View their check-in history or enable location check-ins.</p>
        </div>
      )}
      {data && (
        <>
          {admin ? (
            <div className="location-permission">
              <div>
                <strong>Employee location check-ins</strong>
                <p>
                  {data.enabled
                    ? "Enabled · this employee can add current locations."
                    : "Disabled · existing history is kept."}
                </p>
              </div>
              <button
                className={data.enabled ? "button" : "primary"}
                disabled={busy}
                onClick={toggle}
              >
                {data.enabled ? "Disable check-ins" : "Enable check-ins"}
              </button>
            </div>
          ) : data.enabled ? (
            <form onSubmit={submit} className="location-checkin">
              <h3>
                <Navigation size={18} />
                Add current location
              </h3>
              <p>
                Each tap saves one location and timestamp. No background
                monitoring. Saved check-ins cannot be edited.
              </p>
              <div className="form-grid">
                <label>
                  Visit note (optional)
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    maxLength={500}
                    rows={2}
                    disabled={busy}
                  />
                </label>
                <label>
                  <span>
                    <Camera size={15} /> Photo (optional)
                  </span>
                  <input
                    ref={fileInput}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e) => setPhoto(e.target.files?.[0] || null)}
                    disabled={busy}
                  />
                  <small>
                    Choose or take a photo. It will be resized before upload.
                  </small>
                </label>
              </div>
              <button className="primary" disabled={busy}>
                <MapPin size={16} />
                {busy ? "Saving location…" : "Capture & save location"}
              </button>
            </form>
          ) : (
            <p className="location-message">
              Location check-ins are disabled. Contact your administrator.
            </p>
          )}
          <div className="location-results">
            <div className="location-history">
              <h3>
                {data.records.length} check-ins · {data.date}
              </h3>
              <p className="location-meta">
                Daily timeline · latest first · {timeZone}
              </p>
              {data.records.length === data.limit && (
                <p>Showing the latest {data.limit} entries.</p>
              )}
              {!data.records.length && (
                <p className="empty">No check-ins on this day.</p>
              )}
              {admin && !data.areaNamesConfigured && (
                <p className="location-meta">
                  Configure your provider’s area-name key in Map settings above.
                </p>
              )}
              {data.records.map((r) => (
                <button
                  key={r.id}
                  className={
                    "location-entry" + (selectedId === r.id ? " selected" : "")
                  }
                  disabled={busy}
                  onClick={() => setSelectedId(r.id)}
                  aria-pressed={selectedId === r.id}
                >
                  <span className="location-timeline-dot" aria-hidden="true" />
                  <span>
                    <time>{displayTime(r.capturedAt)}</time>
                    <strong>{areaLabel(r)}</strong>
                    {r.note && <small>{r.note}</small>}
                    <small>
                      Accuracy ±{Math.round(r.accuracy)} m{" "}
                      {r.hasPhoto ? "· Photo attached" : ""}
                    </small>
                  </span>
                </button>
              ))}
            </div>
            {selected && (
              <div className="location-detail">
                <div className="location-detail-heading">
                  <div>
                    <h3>{areaLabel(selected)}</h3>
                    <p className="location-meta">
                      {displayTime(selected.capturedAt)} · {timeZone}
                    </p>
                  </div>
                  <a
                    className="button"
                    href={mapLink}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Google Maps <ExternalLink size={14} />
                  </a>
                </div>
                {data.mapProvider === "geoapify" && data.mapsConfigured ? (
                  <div>
                    {!mapError ? (
                      <img
                        className="location-map location-static-map"
                        src={
                          "/api/location-maps/" +
                          selected.id +
                          "?revision=" +
                          revision
                        }
                        alt="Map showing this check-in location"
                        onError={() => setMapError(true)}
                      />
                    ) : (
                      <p role="alert" className="location-message">
                        Map preview unavailable. Check the Geoapify key, its
                        restrictions, and daily quota in Map settings.
                      </p>
                    )}
                    <p className="location-meta">
                      <a
                        href="https://www.geoapify.com/"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Powered by Geoapify
                      </a>{" "}
                      ·{" "}
                      <a
                        href="https://www.openstreetmap.org/copyright"
                        target="_blank"
                        rel="noreferrer"
                      >
                        © OpenStreetMap contributors
                      </a>
                    </p>
                  </div>
                ) : data.mapsKey ? (
                  <iframe
                    title="Check-in location on Google Maps"
                    className="location-map"
                    loading="lazy"
                    referrerPolicy="strict-origin-when-cross-origin"
                    allowFullScreen
                    src={
                      "https://www.google.com/maps/embed/v1/place?key=" +
                      encodeURIComponent(data.mapsKey) +
                      "&q=" +
                      encodeURIComponent(coords) +
                      "&zoom=16"
                    }
                  />
                ) : (
                  <div className="location-map-placeholder">
                    <MapPin size={32} />
                    <strong>{areaLabel(selected)}</strong>
                    <p>Open this location in Google Maps.</p>
                    {admin && (
                      <small>
                        Add the maps preview key under Map settings above.
                      </small>
                    )}
                    <a
                      className="button"
                      href={mapLink}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View map <ExternalLink size={14} />
                    </a>
                  </div>
                )}
                {admin && (
                  <button
                    className="button"
                    disabled={busy}
                    onClick={deleteEntry}
                  >
                    Delete check-in
                  </button>
                )}
                <dl className="location-facts">
                  <div>
                    <dt>Captured on device</dt>
                    <dd>{displayTime(selected.capturedAt)}</dd>
                  </div>
                  <div>
                    <dt>Received by server</dt>
                    <dd>{displayTime(selected.receivedAt)}</dd>
                  </div>
                  <div>
                    <dt>Reported accuracy</dt>
                    <dd>±{Math.round(selected.accuracy)} metres</dd>
                  </div>
                </dl>
                {selected.accuracy > 100 && (
                  <p className="location-message">
                    Low location accuracy. Treat this as an approximate
                    position.
                  </p>
                )}
                {selected.note && (
                  <p className="location-note">{selected.note}</p>
                )}
                {Boolean(selected.hasPhoto) && (
                  <a
                    href={"/api/location-photos/" + selected.id}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <img
                      className="location-photo"
                      src={"/api/location-photos/" + selected.id}
                      alt="Photo attached to this location check-in"
                      loading="lazy"
                    />
                  </a>
                )}
                {areas[selected.id]?.areaName && (
                  <p className="location-meta">
                    {data.mapProvider === "geoapify" ? (
                      <>
                        Area name provided by{" "}
                        <a
                          href="https://www.geoapify.com/"
                          target="_blank"
                          rel="noreferrer"
                        >
                          Geoapify
                        </a>{" "}
                        and OpenStreetMap.
                      </>
                    ) : (
                      "Area name provided by Google Maps."
                    )}
                  </p>
                )}
                <p className="location-meta">
                  Employee-submitted device location. This is not continuous
                  live tracking.
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
