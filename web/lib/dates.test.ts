import { describe, it, expect } from "vitest";
import { addDays, chip, heading, todayET, nowET } from "@/lib/dates";

describe("addDays", () => {
  it("adds within a month", () => {
    expect(addDays("2030-01-04", 3)).toBe("2030-01-07");
  });
  it("is a no-op for 0", () => {
    expect(addDays("2030-06-15", 0)).toBe("2030-06-15");
  });
  it("rolls over a month boundary", () => {
    expect(addDays("2030-01-31", 1)).toBe("2030-02-01");
  });
  it("rolls over a year boundary", () => {
    expect(addDays("2030-12-31", 1)).toBe("2031-01-01");
  });
  it("handles non-leap February", () => {
    expect(addDays("2030-02-28", 1)).toBe("2030-03-01");
    expect(addDays("2030-03-01", -1)).toBe("2030-02-28");
  });
  it("handles leap February", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });
});

describe("chip", () => {
  it("labels index 0 as Today and 1 as Tom", () => {
    expect(chip("2030-01-04", 0).dow).toBe("Today");
    expect(chip("2030-01-04", 1).dow).toBe("Tom");
  });
  it("uses the weekday abbreviation from index 2 on", () => {
    // 2030-01-01 is a Tuesday, so 2030-01-04 is a Friday
    expect(chip("2030-01-04", 2).dow).toBe("Fri");
  });
  it("formats the day as 'Mon D'", () => {
    expect(chip("2030-01-04", 0).day).toBe("Jan 4");
    expect(chip("2030-12-25", 2).day).toBe("Dec 25");
  });
  it("echoes the iso", () => {
    expect(chip("2030-07-09", 0).iso).toBe("2030-07-09");
  });
});

describe("heading", () => {
  it("says Tonight when the date is today", () => {
    expect(heading("2030-01-04", "2030-01-04")).toBe("Tonight");
  });
  it("gives the full weekday and date otherwise", () => {
    expect(heading("2030-01-04", "2030-01-01")).toBe("Friday, Jan 4");
  });
});

describe("todayET / nowET", () => {
  it("todayET is a YYYY-MM-DD string", () => {
    expect(todayET()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it("nowET is a YYYY-MM-DDTHH:MM:SS string starting with todayET", () => {
    const now = nowET();
    expect(now).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    expect(now.slice(0, 10)).toBe(todayET());
  });
  it("tomorrow sorts after today", () => {
    const today = todayET();
    expect(addDays(today, 1) > today).toBe(true);
  });
});
