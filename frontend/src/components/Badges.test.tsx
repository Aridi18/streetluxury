import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VerdictBadge } from "./Badges";
import { VERDICT_TEXT } from "@/lib/verdict";

describe("VerdictBadge", () => {
  it("uses the four result categories verbatim", () => {
    expect(VERDICT_TEXT.none).toBe("No significant manipulation indicators detected");
    expect(VERDICT_TEXT.possible).toBe("Possible manipulation detected");
    expect(VERDICT_TEXT.strong).toBe("Strong indicators of synthetic or manipulated audio");
    expect(VERDICT_TEXT.inconclusive).toBe("Inconclusive — more evidence required");
    expect(VERDICT_TEXT.not_configured).toBe("Detection model not configured");
  });
  it("renders long labels", () => {
    render(<VerdictBadge status="not_configured" long />);
    expect(screen.getByText("Detection model not configured")).toBeTruthy();
  });
});
