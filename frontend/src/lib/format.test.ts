import { describe, expect, it } from "vitest";
import { fmtBytes, fmtDuration, fmtHz, fmtTime, shortHash } from "./format";

describe("format", () => {
  it("formats timeline timestamps", () => {
    expect(fmtTime(0)).toBe("00:00.00");
    expect(fmtTime(75.456)).toBe("01:15.46");
    expect(fmtTime(3725, false)).toBe("1:02:05");
    expect(fmtTime(null)).toBe("—");
  });
  it("formats durations, sizes and frequencies", () => {
    expect(fmtDuration(12.34)).toBe("12.3 s");
    expect(fmtDuration(125)).toBe("2 min 5 s");
    expect(fmtBytes(1536)).toBe("1.5 KB");
    expect(fmtHz(16000)).toBe("16 kHz");
    expect(fmtHz(7100)).toBe("7.1 kHz");
    expect(shortHash("abcdef0123456789", 6)).toBe("abcdef…");
  });
});
