import { afterEach, describe, expect, it } from "vitest";
import {
  closeMinutes,
  easterSunday,
  etWallTimeToUtc,
  holidayOn,
  isTradingDay,
  isoWeekKey,
  lastCompletedSession,
  marketStatus,
  nextTradingDay,
  nyseHolidays,
  previousTradingDay,
  toEt,
} from "@/lib/time/marketCalendar";

describe("NYSE holidays", () => {
  it("computes the 2026 calendar", () => {
    expect(nyseHolidays(2026).map((h) => h.date)).toEqual([
      "2026-01-01",
      "2026-01-19",
      "2026-02-16",
      "2026-04-03",
      "2026-05-25",
      "2026-06-19",
      "2026-07-03", // July 4 is a Saturday -> observed Friday
      "2026-09-07",
      "2026-11-26",
      "2026-12-25",
    ]);
  });
  it("does not observe New Year's Day falling on a Saturday", () => {
    // Jan 1 2028 is a Saturday: Dec 31 2027 stays a trading day.
    expect(isTradingDay("2027-12-31")).toBe(true);
    expect(nyseHolidays(2028).some((h) => h.name === "New Year's Day")).toBe(false);
    // Christmas 2027 is a Saturday -> observed Friday Dec 24.
    expect(holidayOn("2027-12-24")?.name).toBe("Christmas Day");
  });
  it("computes Easter correctly", () => {
    expect(easterSunday(2024)).toBe("2024-03-31");
    expect(easterSunday(2026)).toBe("2026-04-05");
    expect(easterSunday(2027)).toBe("2027-03-28");
  });
  it("has no Juneteenth before 2022", () => {
    expect(nyseHolidays(2021).some((h) => h.name.startsWith("Juneteenth"))).toBe(false);
  });
});

describe("trading days & early closes", () => {
  afterEach(() => {
    delete process.env.MARKET_EXTRA_CLOSURES;
  });
  it("skips weekends and holidays", () => {
    expect(isTradingDay("2026-10-03")).toBe(false); // Saturday
    expect(isTradingDay("2026-11-26")).toBe(false); // Thanksgiving
    expect(previousTradingDay("2026-10-05")).toBe("2026-10-02");
    expect(nextTradingDay("2026-11-25")).toBe("2026-11-27");
    expect(previousTradingDay("2026-01-20")).toBe("2026-01-16"); // over MLK day
  });
  it("knows the 1 pm early closes", () => {
    expect(closeMinutes("2026-11-27")).toBe(780);
    expect(closeMinutes("2026-12-24")).toBe(780);
    expect(closeMinutes("2025-07-03")).toBe(780);
    expect(closeMinutes("2026-07-03")).toBeNull(); // holiday in 2026
    expect(closeMinutes("2026-10-02")).toBe(960);
  });
  it("supports configured unscheduled closures", () => {
    process.env.MARKET_EXTRA_CLOSURES = "2025-01-09";
    expect(isTradingDay("2025-01-09")).toBe(false);
  });
});

describe("timezone & DST", () => {
  it("converts New York wall time across DST changes", () => {
    expect(etWallTimeToUtc("2026-03-06", 9, 30).toISOString()).toBe("2026-03-06T14:30:00.000Z"); // EST
    expect(etWallTimeToUtc("2026-03-09", 9, 30).toISOString()).toBe("2026-03-09T13:30:00.000Z"); // EDT
    expect(etWallTimeToUtc("2026-11-02", 16, 0).toISOString()).toBe("2026-11-02T21:00:00.000Z"); // EST again
  });
  it("reads ET dates near midnight UTC", () => {
    // 02:15 UTC Saturday = 22:15 ET Friday (EDT)
    const et = toEt(new Date("2026-10-03T02:15:00Z"));
    expect(et.date).toBe("2026-10-02");
    expect(et.hour).toBe(22);
    expect(et.weekday).toBe(5);
  });
  it("determines the last completed session", () => {
    expect(lastCompletedSession(new Date("2026-10-02T19:00:00Z"))).toBe("2026-10-01"); // 3 pm ET, still open
    expect(lastCompletedSession(new Date("2026-10-02T20:30:00Z"))).toBe("2026-10-02"); // 4:30 pm ET
    expect(lastCompletedSession(new Date("2026-10-04T15:00:00Z"))).toBe("2026-10-02"); // Sunday
    expect(lastCompletedSession(new Date("2026-11-27T18:30:00Z"))).toBe("2026-11-27"); // 1:30 pm ET early close
  });
  it("labels market status", () => {
    expect(marketStatus(new Date("2026-10-02T14:00:00Z")).status).toBe("open");
    expect(marketStatus(new Date("2026-10-02T12:00:00Z")).status).toBe("pre_market");
    expect(marketStatus(new Date("2026-11-26T15:00:00Z")).label).toContain("Thanksgiving");
  });
  it("builds ISO week keys", () => {
    expect(isoWeekKey("2026-10-03")).toBe("2026-W40");
    expect(isoWeekKey("2027-01-01")).toBe("2026-W53");
  });
});
