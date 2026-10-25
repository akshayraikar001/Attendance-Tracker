// Use neighborhood/area components, never a street address or user-supplied label.
export function areaNameFromResults(results = []) {
  const components = results.flatMap((r) => r.address_components || []);
  const find = (type) =>
    components.find((c) => c.types?.includes(type))?.long_name;
  const area =
    find("neighborhood") || find("sublocality_level_1") || find("sublocality");
  const city =
    find("locality") ||
    find("postal_town") ||
    find("administrative_area_level_2");
  return (
    [...new Set([area, city].filter(Boolean))].join(", ") ||
    find("administrative_area_level_1") ||
    null
  );
}
export async function lookupArea(latitude, longitude, key, fetcher = fetch) {
  if (!key) return { areaName: null, status: "unconfigured" };
  try {
    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.search = new URLSearchParams({
      latlng: `${latitude},${longitude}`,
      key,
      language: "en",
    });
    const response = await fetcher(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return { areaName: null, status: "unavailable" };
    const result = await response.json();
    if (result.status !== "OK")
      return {
        areaName: null,
        status: result.status === "ZERO_RESULTS" ? "notfound" : "unavailable",
      };
    const areaName = areaNameFromResults(result.results);
    return { areaName, status: areaName ? "ok" : "notfound" };
  } catch {
    // Never surface provider errors: they can contain credentials or request URLs.
    return { areaName: null, status: "unavailable" };
  }
}

export function geoapifyAreaName(properties = {}) {
  const area =
    properties.neighbourhood || properties.suburb || properties.district;
  const city =
    properties.city ||
    properties.town ||
    properties.village ||
    properties.county;
  return (
    [...new Set([area, city].filter(Boolean))].join(", ") ||
    properties.state ||
    null
  );
}
export async function lookupGeoapifyArea(
  latitude,
  longitude,
  key,
  fetcher = fetch,
) {
  if (!key) return { areaName: null, status: "unconfigured" };
  try {
    const url = new URL("https://api.geoapify.com/v1/geocode/reverse");
    url.search = new URLSearchParams({
      lat: String(latitude),
      lon: String(longitude),
      apiKey: key,
      lang: "en",
    });
    const response = await fetcher(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return { areaName: null, status: "unavailable" };
    const result = await response.json();
    const areaName = geoapifyAreaName(result.features?.[0]?.properties);
    return { areaName, status: areaName ? "ok" : "notfound" };
  } catch {
    return { areaName: null, status: "unavailable" };
  }
}
export function geoapifyMapUrl(latitude, longitude, key) {
  const url = new URL("https://maps.geoapify.com/v1/staticmap");
  url.search = new URLSearchParams({
    style: "osm-carto",
    width: "800",
    height: "400",
    format: "png",
    center: `lonlat:${longitude},${latitude}`,
    zoom: "15",
    marker: `lonlat:${longitude},${latitude};color:#27734e;size:medium`,
    apiKey: key,
  });
  return url;
}
