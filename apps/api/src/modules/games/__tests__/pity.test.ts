import { describe, it, expect } from "bun:test";
import { hsrAdapter } from "../hsr";
import type { NormalizedPull } from "@gacha-tracker/shared";

function createMockPulls(ids: string[], startId = 1): NormalizedPull[] {
  return ids.map((id, index) => ({
    pullId: String(startId + index),
    gameUid: "100001",
    bannerType: "11",
    itemId: id,
    itemName: id === "1003" ? "Himeko" : id === "1006" ? "Silver Wolf" : id === "1214" ? "Clara" : "3-star item",
    itemType: id.startsWith("1") ? "Character" : "Light Cone",
    rarity: ["1003", "1006", "1214"].includes(id) ? 5 : 3,
    pulledAt: new Date(),
    pityAtPull: 0,
    wasGuaranteed: false,
  }));
}

describe("Pity System (HSR Adapter)", () => {
  it("tracks basic pity correctly until a 5-star", () => {
    const mockPulls = createMockPulls(["1", "2", "1006", "3"]);
    const computed = hsrAdapter.computePity(mockPulls, "11");

    expect(computed[0].pityAtPull).toBe(1);
    expect(computed[1].pityAtPull).toBe(2);
    expect(computed[2].pityAtPull).toBe(3);
    expect(computed[2].wasGuaranteed).toBe(false);

    expect(computed[3].pityAtPull).toBe(1);
  });

  it("sets the guarantee flag after losing a 50/50", () => {
    const mockPulls = createMockPulls(["1", "1003", "2", "1006"]);
    const computed = hsrAdapter.computePity(mockPulls, "11");

    expect(computed[1].pityAtPull).toBe(2);
    expect(computed[1].wasGuaranteed).toBe(false);

    expect(computed[2].pityAtPull).toBe(1);
    expect(computed[2].wasGuaranteed).toBe(true);

    expect(computed[3].pityAtPull).toBe(2);
    expect(computed[3].wasGuaranteed).toBe(true);
  });

  it("handles consecutive 5-stars properly with guarantees", () => {
    const mockPulls = createMockPulls(["1003", "1006", "1214", "1006"]);
    const computed = hsrAdapter.computePity(mockPulls, "11");

    expect(computed[0].wasGuaranteed).toBe(false);
    expect(computed[0].pityAtPull).toBe(1);

    expect(computed[1].wasGuaranteed).toBe(true);
    expect(computed[1].pityAtPull).toBe(1);

    expect(computed[2].wasGuaranteed).toBe(false);
    expect(computed[2].pityAtPull).toBe(1);

    expect(computed[3].wasGuaranteed).toBe(true);
    expect(computed[3].pityAtPull).toBe(1);
  });

  it("does not trigger guarantee for standard banners", () => {
    const mockPulls = createMockPulls(["1", "1003", "2", "1006"]);
    const computed = hsrAdapter.computePity(mockPulls, "1");

    expect(computed[1].wasGuaranteed).toBe(false);
    expect(computed[2].wasGuaranteed).toBe(false);
    expect(computed[3].wasGuaranteed).toBe(false);
  });
});
