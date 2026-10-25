import test from "node:test";
import assert from "node:assert/strict";
import {
  areaNameFromResults,
  lookupArea,
  lookupGeoapifyArea,
  geoapifyMapUrl,
} from "../src/services/location-area.js";
const component = (name, type) => ({ long_name: name, types: [type] });
test("Area names prefer neighborhood and city, not street addresses", () => {
  assert.equal(
    areaNameFromResults([
      {
        address_components: [
          component("23", "street_number"),
          component("Example Street", "route"),
          component("Indiranagar", "sublocality_level_1"),
          component("Bengaluru", "locality"),
        ],
      },
    ]),
    "Indiranagar, Bengaluru",
  );
  assert.equal(
    areaNameFromResults([
      {
        address_components: [
          component("Soho", "neighborhood"),
          component("London", "postal_town"),
        ],
      },
    ]),
    "Soho, London",
  );
  assert.equal(
    areaNameFromResults([
      {
        address_components: [
          component("Berlin", "sublocality"),
          component("Berlin", "locality"),
        ],
      },
    ]),
    "Berlin",
  );
  assert.equal(areaNameFromResults([]), null);
});
test("Reverse geocoding handles disabled keys, provider errors and timeouts without exposing secrets", async () => {
  assert.equal(
    (await lookupArea(1, 2, "", () => assert.fail("No request without key")))
      .status,
    "unconfigured",
  );
  const valid = await lookupArea(1, 2, "test-private-key", async (url) => {
    assert.equal(url.origin, "https://maps.googleapis.com");
    assert.equal(url.searchParams.get("latlng"), "1,2");
    return {
      ok: true,
      json: async () => ({
        status: "OK",
        results: [{ address_components: [component("Town", "locality")] }],
      }),
    };
  });
  assert.deepEqual(valid, { areaName: "Town", status: "ok" });
  assert.deepEqual(
    await lookupArea(1, 2, "secret", async () => {
      throw new Error("URL includes secret");
    }),
    { areaName: null, status: "unavailable" },
  );
  assert.equal(
    (
      await lookupArea(1, 2, "secret", async () => ({
        ok: true,
        json: async () => ({ status: "ZERO_RESULTS" }),
      }))
    ).status,
    "notfound",
  );
});

test("Geoapify uses its own endpoints, area fields and longitude-first map coordinates", async () => {
  const result = await lookupGeoapifyArea(
    12.9,
    77.5,
    "private-key",
    async (url) => {
      assert.equal(url.hostname, "api.geoapify.com");
      assert.equal(url.searchParams.get("lat"), "12.9");
      return {
        ok: true,
        json: async () => ({
          features: [
            {
              properties: {
                suburb: "Indiranagar",
                city: "Bengaluru",
                address_line1: "Private street",
              },
            },
          ],
        }),
      };
    },
  );
  assert.deepEqual(result, {
    areaName: "Indiranagar, Bengaluru",
    status: "ok",
  });
  const url = geoapifyMapUrl(12.9, 77.5, "private-key");
  assert.equal(url.hostname, "maps.geoapify.com");
  assert.equal(url.searchParams.get("center"), "lonlat:77.5,12.9");
  assert.equal(
    (await lookupGeoapifyArea(1, 2, "x", async () => ({ ok: false }))).status,
    "unavailable",
  );
  assert.equal(
    (
      await lookupGeoapifyArea(1, 2, "x", async () => ({
        ok: true,
        json: async () => ({ features: [] }),
      }))
    ).status,
    "notfound",
  );
});
