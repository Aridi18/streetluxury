import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "./api";

afterEach(() => vi.restoreAllMocks());

describe("api client", () => {
  it("sends the CSRF header and surfaces server error details", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: "Incorrect email or password." }), { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(api.login("a@b.co", "x")).rejects.toMatchObject({ status: 401, message: "Incorrect email or password." });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers["X-Requested-With"]).toBe("AudioSentinel");
    expect(init.credentials).toBe("same-origin");
  });
  it("throws ApiError on non-JSON failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("oops", { status: 502 })));
    await expect(api.system()).rejects.toBeInstanceOf(ApiError);
  });
});
