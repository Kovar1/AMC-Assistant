import { describe, it, expect } from "vitest";
import {
  addDays,
  chip,
  heading,
  todayET,
  nowET,
  todayInZone,
  nowInZone,
  nextWeekday,
  weekdayFromName,
  dayLabel,
  minutesBetweenLocal,
} from "@/lib/dates";

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

describe("nextWeekday", () => {
  it("returns today when the weekday already matches", () => {
    // 2026-08-26 is a Wednesday (3).
    expect(nextWeekday("2026-08-26", 3)).toBe("2026-08-26");
  });
  it("advances to the next occurrence within the week", () => {
    expect(nextWeekday("2026-08-26", 5)).toBe("2026-08-28"); // Wed -> Fri
  });
  it("wraps across a week boundary", () => {
    expect(nextWeekday("2026-08-26", 1)).toBe("2026-08-31"); // Wed -> next Mon
  });
  it("wraps across a month boundary", () => {
    expect(nextWeekday("2026-08-30", 6)).toBe("2026-09-05"); // Sun -> Sat
  });
});

describe("weekdayFromName", () => {
  it("accepts short and long names, any case", () => {
    expect(weekdayFromName("fri")).toBe(5);
    expect(weekdayFromName("Friday")).toBe(5);
    expect(weekdayFromName("SUN")).toBe(0);
  });
  it("rejects a non-weekday", () => {
    expect(weekdayFromName("today")).toBeNull();
    expect(weekdayFromName("")).toBeNull();
  });
});

describe("dayLabel", () => {
  it("formats a quotable label", () => {
    expect(dayLabel("2026-08-26")).toBe("Wed Aug 26");
  });
  it("ignores a time suffix", () => {
    expect(dayLabel("2026-12-01T19:30:00")).toBe("Tue Dec 1");
  });
});

describe("minutesBetweenLocal", () => {
  it("measures forward", () => {
    expect(minutesBetweenLocal("2026-08-26T19:00:00", "2026-08-26T19:45:00")).toBe(45);
  });
  it("is negative for a time already passed", () => {
    expect(minutesBetweenLocal("2026-08-26T21:00:00", "2026-08-26T19:00:00")).toBe(-120);
  });
  it("crosses midnight", () => {
    expect(minutesBetweenLocal("2026-08-26T23:30:00", "2026-08-27T00:15:00")).toBe(45);
  });
});

describe("zone-aware helpers", () => {
  it("todayInZone can differ across zones at the same instant", () => {
    // Both must be valid dates; they may or may not differ depending on the hour.
    expect(todayInZone("America/New_York")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(todayInZone("Pacific/Honolulu")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it("nowInZone returns a wall-clock timestamp", () => {
    expect(nowInZone("America/Chicago")).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
  });
  it("todayET and nowET still agree with the Eastern zone", () => {
    expect(todayET()).toBe(todayInZone("America/New_York"));
    expect(nowET().slice(0, 10)).toBe(todayET());
  });
});
