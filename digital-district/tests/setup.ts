import { vi } from "vitest";

// next/headers is only available inside a Next.js request; services under test receive identities explicitly.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers(),
}));
