export default async function api(url, body, method) {
  const requestMethod = method || (body === undefined ? "GET" : "POST");
  const res = await fetch(
    "/api" + url,
    body !== undefined || requestMethod !== "GET"
      ? {
          method: requestMethod,
          headers: {
            "Content-Type": "application/json",
            "X-Requested-With": "Dayline",
          },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        }
      : undefined,
  );
  const data = await res.json();
  if (res.status === 401) window.dispatchEvent(new Event("session-expired"));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}
