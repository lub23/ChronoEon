import { afterEach, describe, expect, it, vi } from "vitest";
import { formatPlaceLabel, reverseGeocode, type ReversePlace } from "./location";

function place(overrides: Partial<ReversePlace>): ReversePlace {
  return { province: "", city: "", locality: "", country: "", ...overrides };
}

describe("device location labels", () => {
  it("preserves administrative levels and de-duplicates municipalities", () => {
    expect(formatPlaceLabel(place({ province: "甘肃省", city: "陇南市", locality: "西和县" }), "zh")).toBe("甘肃省陇南市西和县");
    expect(formatPlaceLabel(place({ province: "北京市", city: "北京市", locality: "海淀区" }), "zh")).toBe("北京市海淀区");
  });

  it("falls back through city and country when a district is missing", () => {
    expect(formatPlaceLabel(place({ province: "广东省", city: "深圳市" }), "zh")).toBe("广东省深圳市");
    expect(formatPlaceLabel(place({ country: "Singapore" }), "zh")).toBe("Singapore");
  });

  it("prefers a concrete native address over administrative names", () => {
    expect(formatPlaceLabel(place({ province: "北京市", locality: "海淀区", address: "北京市海淀区清华园 1 号" }), "zh")).toBe("北京市海淀区清华园 1 号");
  });

  it("reads district, province for English", () => {
    expect(formatPlaceLabel(place({ province: "Beijing", city: "Beijing", locality: "Haidian" }), "en")).toBe("Haidian, Beijing");
    expect(formatPlaceLabel(place({ city: "Haidian", country: "China" }), "en")).toBe("Haidian");
  });
});

describe("reverse geocoding", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("requests Simplified Chinese rather than the provider's ambiguous zh locale", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ principalSubdivision: "北京市", city: "北京市", locality: "东城区", countryName: "中华人民共和国" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await reverseGeocode({ latitude: 39.9042, longitude: 116.4074 }, "zh");
    expect(fetchMock.mock.calls[0][0]).toContain("localityLanguage=zh-Hans");
  });
});
