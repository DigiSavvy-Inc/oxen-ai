import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, type SessionUser } from "../lib/api";

type AuthState = {
  user: SessionUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  setHasOxenKey: (value: boolean) => void;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api.me();
      setUser(data.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await api.logout();
    setUser(null);
  }, []);

  const setHasOxenKey = useCallback((value: boolean) => {
    setUser((prev) => (prev ? { ...prev, hasOxenKey: value } : prev));
  }, []);

  const value = useMemo(
    () => ({ user, loading, refresh, logout, setHasOxenKey }),
    [user, loading, refresh, logout, setHasOxenKey],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
