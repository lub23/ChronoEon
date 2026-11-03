import { describe, expect, it } from "vitest";
import { wgs84ToGcj02 } from "@chronoeon/domain";
import { parseGeocodeResponse, parseNearbyPlaces } from "./geocode";
describe("geocoder coordinate boundary", () => {
  it("rejects empty coordinates instead of interpreting them as zero", () => {
    expect(parseGeocodeResponse("apihz", { code: 200, lng: "", lat: "", score: 100 }).ok).toBe(false);
  });
  it("converts nearby POIs to WGS84 and drops distant results", () => {
    const point = { lng: 116.32, lat: 40 }, gcj = wgs84ToGcj02(point);
    const places = parseNearbyPlaces({ status: "1", regeocode: { pois: [{ name: "Cafe", location: `${gcj.lng},${gcj.lat}` }, { name: "Far", location: "117,40" }, { name: "Unreadable", location: "" }] } }, point);
    expect(places).toHaveLength(1);
    expect(places[0].lng).toBeCloseTo(point.lng, 4);
    expect(places[0].lat).toBeCloseTo(point.lat, 4);
  });
});
