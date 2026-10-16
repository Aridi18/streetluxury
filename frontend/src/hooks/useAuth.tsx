import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, type ReactNode } from "react";
import { api, ApiError } from "@/lib/api";
import type { User } from "@/lib/types";

interface AuthCtx {
  user: User | null | undefined; // undefined while loading
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name?: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => void;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return await api.me();
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60_000,
    retry: false,
  });

  useEffect(() => {
    const onUnauthorized = () => qc.setQueryData(["me"], null);
    window.addEventListener("as:unauthorized", onUnauthorized);
    return () => window.removeEventListener("as:unauthorized", onUnauthorized);
  }, [qc]);

  const login = useCallback(async (email: string, password: string) => {
    const u = await api.login(email, password);
    qc.clear();
    qc.setQueryData(["me"], u);
  }, [qc]);
  const register = useCallback(async (email: string, password: string, name?: string) => {
    const u = await api.register(email, password, name);
    qc.clear();
    qc.setQueryData(["me"], u);
  }, [qc]);
  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      qc.clear();
      qc.setQueryData(["me"], null);
    }
  }, [qc]);

  return (
    <Ctx.Provider value={{ user: isLoading ? undefined : (data ?? null), login, register, logout, refresh: () => qc.invalidateQueries({ queryKey: ["me"] }) }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth outside AuthProvider");
  return c;
}
