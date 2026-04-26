import test from "node:test";
import assert from "node:assert/strict";
import {
  parseDateToUTC,
  parseDateToLocal,
  formatDateForStorage,
  getCurrentDateString,
  resolveDateOrToday,
  validateDateString,
  resolveDateTimeRangeBound,
  hasTimeComponent,
  getDatePart,
  isSameDateSafe,
  isBeforeDateSafe,
} from "../../dist/date.js";

function utcDate(y, m, d) {
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0));
}

test("date conformance: parse/format/compare matrix", async (t) => {
  const validDateOnly = [
    "1970-01-01",
    "1999-12-31",
    "2000-02-29",
    "2004-02-29",
    "2016-02-29",
    "2020-02-29",
    "2024-02-29",
    "2026-01-01",
    "2026-01-31",
    "2026-03-31",
    "2026-04-30",
    "2026-06-30",
    "2026-09-30",
    "2026-11-30",
    "2030-07-15",
    "2040-10-10",
    "2050-12-01",
    "2096-02-29",
  ];

  const validDateTime = [
    "2026-02-20T00:00:00Z",
    "2026-02-20T12:34:56Z",
    "2026-02-20T23:59:59Z",
    "2026-02-20T00:00:00+00:00",
    "2026-02-20T01:00:00+01:00",
    "2026-02-19T23:00:00-01:00",
    "2026-07-15T09:30:00+05:30",
    "2026-07-15T09:30:00-05:30",
    "2026-12-31T23:59:59+14:00",
    "2026-01-01T00:00:00-12:00",
    "2030-01-01T10:00:00.000Z",
    "2030-01-01T10:00:00.123Z",
  ];

  const invalidDateStrings = [
    "",
    " ",
    "not-a-date",
    "2026-00-01",
    "2026-13-01",
    "2026-01-00",
    "2026-01-32",
    "2026-02-29",
    "2025-02-29",
    "1900-02-29",
    "2026-2-1",
    "2026/02/01",
    "26-02-01",
    "20260201",
    "2026-02-20T24:00:00Z",
    "2026-02-20T23:60:00Z",
    "2026-02-20T23:59:60Z",
    "2026-02-20T99:99:99Z",
    "2026-02-20T10:00:00+99:00",
    "2026-02-20T10:00:00+ab:cd",
    "2026-02-20T10:00:00+00",
    "2026-02-20T10:00",
    "2026-02-20T",
    "-2026-02-20",
  ];

  for (const value of validDateOnly) {
    await t.test(`parseDateToUTC accepts date-only: ${value}`, () => {
      const parsed = parseDateToUTC(value);
      assert.ok(parsed instanceof Date);
      assert.equal(Number.isNaN(parsed.getTime()), false);
      assert.equal(parsed.toISOString().slice(0, 10), value);
      assert.equal(formatDateForStorage(parsed), value);
    });

    await t.test(`parseDateToLocal accepts date-only: ${value}`, () => {
      const parsed = parseDateToLocal(value);
      assert.ok(parsed instanceof Date);
      assert.equal(Number.isNaN(parsed.getTime()), false);
      assert.equal(parsed.getFullYear(), Number(value.slice(0, 4)));
      assert.equal(parsed.getMonth() + 1, Number(value.slice(5, 7)));
      assert.equal(parsed.getDate(), Number(value.slice(8, 10)));
    });
  }

  for (const value of validDateTime) {
    await t.test(`parseDateToUTC accepts datetime: ${value}`, () => {
      const parsed = parseDateToUTC(value);
      assert.ok(parsed instanceof Date);
      assert.equal(Number.isNaN(parsed.getTime()), false);
      assert.match(parsed.toISOString(), /^\d{4}-\d{2}-\d{2}T/);
    });

    await t.test(`parseDateToLocal accepts datetime: ${value}`, () => {
      const parsed = parseDateToLocal(value);
      assert.ok(parsed instanceof Date);
      assert.equal(Number.isNaN(parsed.getTime()), false);
    });
  }

  for (const value of invalidDateStrings) {
    await t.test(`parseDateToUTC rejects invalid date: ${JSON.stringify(value)}`, () => {
      assert.throws(() => parseDateToUTC(value));
    });

    await t.test(`parseDateToLocal rejects invalid date: ${JSON.stringify(value)}`, () => {
      assert.throws(() => parseDateToLocal(value));
    });

    await t.test(`validateDateString rejects invalid date: ${JSON.stringify(value)}`, () => {
      assert.throws(() => validateDateString(value));
    });
  }

  const datePartCases = [
    ["2026-02-20", "2026-02-20"],
    ["2026-02-20T00:00:00Z", "2026-02-20"],
    ["2026-02-20T23:59:59Z", "2026-02-20"],
    ["2026-02-20T12:34:56+05:30", "2026-02-20"],
    ["2026-02-20T12:34", "2026-02-20"],
    [" 2026-02-20 ", "2026-02-20"],
    ["2030-01-01T10:00:00.000Z", "2030-01-01"],
    ["2030-12-31T10:00:00.123Z", "2030-12-31"],
    ["2040-10-10T08:00:00-03:00", "2040-10-10"],
    ["1970-01-01T00:00:00+14:00", "1970-01-01"],
  ];

  for (const [input, expected] of datePartCases) {
    await t.test(`getDatePart extracts date portion: ${input}`, () => {
      assert.equal(getDatePart(input), expected);
    });
  }

  const timeCases = [
    [undefined, false],
    ["", false],
    ["2026-02-20", false],
    ["2026-02-20T00:00:00Z", true],
    ["2026-02-20T23:59:59+00:00", true],
    ["2026-02-20 10:00:00", false],
    ["T10:00", true],
    ["2026-02-20T10:00", true],
    ["textT10:00", true],
    ["2026-02-20T1:00", false],
    ["2026-02-20T10:0", false],
    ["2026-02-20T10:00:00", true],
  ];

  for (const [input, expected] of timeCases) {
    await t.test(`hasTimeComponent(${String(input)}) -> ${expected}`, () => {
      assert.equal(hasTimeComponent(input), expected);
    });
  }

  const sameDateCases = [
    ["2026-02-20", "2026-02-20", true],
    ["2026-02-20", "2026-02-21", false],
    ["2026-02-20T00:00:00Z", "2026-02-20", true],
    ["2026-02-20T23:59:59Z", "2026-02-20", true],
    ["2026-02-20T23:59:59+00:00", "2026-02-20", true],
    ["2026-02-20T00:00:00-10:00", "2026-02-20", true],
    ["invalid", "2026-02-20", false],
    ["2026-02-20", "invalid", false],
    ["", "2026-02-20", false],
    ["2026-02-20", "", false],
    ["2024-02-29", "2024-02-29", true],
    ["2024-02-29", "2024-03-01", false],
    ["2030-01-01T10:00:00Z", "2030-01-01", true],
    ["2030-01-01T10:00:00Z", "2030-01-02", false],
  ];

  for (const [a, b, expected] of sameDateCases) {
    await t.test(`isSameDateSafe(${a}, ${b}) -> ${expected}`, () => {
      assert.equal(isSameDateSafe(a, b), expected);
    });
  }

  const beforeDateCases = [
    ["2026-02-19", "2026-02-20", true],
    ["2026-02-20", "2026-02-20", false],
    ["2026-02-21", "2026-02-20", false],
    ["2026-02-20T00:00:00Z", "2026-02-21", true],
    ["2026-02-20T23:59:59Z", "2026-02-20", false],
    ["2026-02-20", "2026-02-20T00:00:00Z", false],
    ["2024-02-29", "2024-03-01", true],
    ["2024-03-01", "2024-02-29", false],
    ["invalid", "2026-02-20", false],
    ["2026-02-20", "invalid", false],
    ["", "2026-02-20", false],
    ["2026-02-20", "", false],
  ];

  for (const [a, b, expected] of beforeDateCases) {
    await t.test(`isBeforeDateSafe(${a}, ${b}) -> ${expected}`, () => {
      assert.equal(isBeforeDateSafe(a, b), expected);
    });
  }

  await t.test("resolveDateOrToday returns explicit valid date", () => {
    assert.equal(resolveDateOrToday("2026-02-20"), "2026-02-20");
  });

  await t.test("resolveDateOrToday throws for invalid explicit date", () => {
    assert.throws(() => resolveDateOrToday("2026-02-30"));
  });

  await t.test("resolveDateOrToday returns today in YYYY-MM-DD when omitted", () => {
    const result = resolveDateOrToday(undefined);
    assert.match(result, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(validateDateString(result), result);
  });

  await t.test("getCurrentDateString returns YYYY-MM-DD", () => {
    const current = getCurrentDateString();
    assert.match(current, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(validateDateString(current), current);
  });

  await t.test("formatDateForStorage returns empty string for invalid date object", () => {
    const invalid = new Date("not-a-date");
    assert.equal(formatDateForStorage(invalid), "");
  });

  await t.test("formatDateForStorage uses UTC date fields", () => {
    assert.equal(formatDateForStorage(utcDate(2026, 2, 20)), "2026-02-20");
  });

  await t.test("resolveDateTimeRangeBound accepts local date-only ranges", () => {
    assert.equal(
      resolveDateTimeRangeBound("2026-02-22", "from").getTime(),
      new Date(2026, 1, 22, 0, 0, 0, 0).getTime(),
    );
    assert.equal(
      resolveDateTimeRangeBound("2026-02-22", "to").getTime(),
      new Date(2026, 1, 22, 23, 59, 59, 999).getTime(),
    );
  });

  await t.test("resolveDateTimeRangeBound accepts minute-precision datetime ranges", () => {
    assert.equal(
      resolveDateTimeRangeBound("2026-02-22 21:11", "from").getTime(),
      new Date(2026, 1, 22, 21, 11, 0, 0).getTime(),
    );
    assert.equal(
      resolveDateTimeRangeBound("2026-02-22T21:11", "to").getTime(),
      new Date(2026, 1, 22, 21, 11, 59, 999).getTime(),
    );
  });

  await t.test("resolveDateTimeRangeBound accepts timezone datetime ranges", () => {
    assert.equal(
      resolveDateTimeRangeBound("2026-02-22T21:11:30Z", "to").toISOString(),
      "2026-02-22T21:11:30.999Z",
    );
  });

  await t.test("resolveDateTimeRangeBound rejects invalid ranges", () => {
    assert.throws(() => resolveDateTimeRangeBound("2026-02-29 21:11", "from"));
    assert.throws(() => resolveDateTimeRangeBound("2026-02-22 24:00", "from"));
    assert.throws(() => resolveDateTimeRangeBound("not a date", "to"));
  });
});
