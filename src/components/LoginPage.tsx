import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { Loader } from "./Loader";

export function LoginPage() {
  const { loading } = useAuth();
  const [mode, setMode] = useState<"oauth" | "local" | null>(null);
  const [org, setOrg] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/auth/config")
      .then((res) => res.json() as Promise<{ mode: "oauth" | "local"; org?: string | null }>)
      .then((data) => {
        setMode(data.mode);
        setOrg(data.org?.trim() || null);
      })
      .catch(() => setMode("oauth"));
  }, []);

  if (loading) {
    return (
      <div className="loading-screen">
        <Loader size="lg" label="Loading…" />
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="brand" style={{ marginBottom: 18 }}>
          <img className="brand-mark-img" src="/favicon.svg" alt="" />
          <div className="brand-copy">
            <strong>DS Studio</strong>
            <span>Image &amp; video generation</span>
          </div>
        </div>
        <h1>Sign in to generate</h1>
        <p>
          {org ? (
            <>
              Access is limited to <strong>{org}</strong> org members and allowlisted GitHub
              users.
            </>
          ) : (
            <>Access is limited to allowlisted GitHub users.</>
          )}{" "}
          Each account uses its own Oxen API key.
        </p>
        {mode === "local" ? (
          <p>
            No GitHub OAuth app is configured yet, so this signs you in with the
            GitHub account already logged in on this machine.
          </p>
        ) : null}
        <a className="primary-btn" href="/api/auth/github">
          {mode === "local" ? "Continue with this machine’s GitHub" : "Continue with GitHub"}
        </a>
      </div>
    </div>
  );
}
