import { dateGroupLabel, formatBytes, groupByDate } from "./dates";

const NOW = new Date(2026, 9, 23, 15, 0, 0).getTime(); // Oct 23 2026, 3pm local
const DAY = 24 * 60 * 60 * 1000;

describe("dateGroupLabel", () => {
  it("buckets relative to now", () => {
    expect(dateGroupLabel(NOW - 60_000, NOW)).toBe("Today");
    expect(dateGroupLabel(NOW - DAY, NOW)).toBe("Yesterday");
    expect(dateGroupLabel(NOW - 3 * DAY, NOW)).toBe("Previous 7 days");
    expect(dateGroupLabel(NOW - 20 * DAY, NOW)).toBe("Previous 30 days");
  });

  it("uses month names for older items", () => {
    const older = new Date(2026, 1, 10).getTime();
    expect(dateGroupLabel(older, NOW)).toMatch(/February/);
    const lastYear = new Date(2025, 1, 10).getTime();
    expect(dateGroupLabel(lastYear, NOW)).toMatch(/2025/);
  });
});

describe("groupByDate", () => {
  it("groups consecutive items and preserves order", () => {
    const items = [NOW - 1000, NOW - 2000, NOW - DAY, NOW - 3 * DAY];
    const groups = groupByDate(items, (t) => t, NOW);
    expect(groups.map((g) => g.label)).toEqual(["Today", "Yesterday", "Previous 7 days"]);
    expect(groups[0]?.items).toEqual([NOW - 1000, NOW - 2000]);
  });
});

describe("formatBytes", () => {
  it("formats sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(5_200_000_000)).toBe("4.8 GB");
    expect(formatBytes(null)).toBe("");
  });
});
