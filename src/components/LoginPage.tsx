"use client";

import { signIn } from "next-auth/react";

export function LoginPage() {
  return (
    <div className="login-hero">
      <div
        style={{
          position: "relative",
          zIndex: 1,
          textAlign: "center",
          maxWidth: 540,
          padding: "0 24px",
        }}
      >
        {/* Logo / Icon */}
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: 18,
            background:
              "linear-gradient(135deg, var(--accent), var(--purple))",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 32px",
            fontSize: 32,
            boxShadow: "0 8px 40px rgba(99, 102, 241, 0.3)",
          }}
        >
          📋
        </div>

        <h1
          style={{
            fontSize: 44,
            fontWeight: 800,
            letterSpacing: "-0.04em",
            lineHeight: 1.1,
            marginBottom: 16,
          }}
        >
          Track Every
          <br />
          <span
            style={{
              background:
                "linear-gradient(135deg, var(--accent), var(--purple))",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            Job Application
          </span>
        </h1>

        <p
          style={{
            fontSize: 17,
            color: "var(--text-secondary)",
            lineHeight: 1.6,
            marginBottom: 40,
          }}
        >
          Connect your Gmail and let AI automatically find, categorize, and
          track all your job applications. No more spreadsheets.
        </p>

        <button
          onClick={() => signIn("google", { callbackUrl: "/" })}
          className="btn-primary"
          style={{
            padding: "14px 32px",
            fontSize: 16,
            borderRadius: 14,
          }}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
              fill="#4285F4"
            />
            <path
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              fill="#34A853"
            />
            <path
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              fill="#FBBC05"
            />
            <path
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              fill="#EA4335"
            />
          </svg>
          Sign in with Google
        </button>

        <p
          style={{
            fontSize: 13,
            color: "var(--text-muted)",
            marginTop: 20,
          }}
        >
          We only read your emails — never send, delete, or modify anything.
        </p>

        {/* Feature cards */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 16,
            marginTop: 60,
          }}
        >
          {[
            {
              icon: "🔍",
              title: "Auto-Detect",
              desc: "Scans 15+ job platforms",
            },
            {
              icon: "🤖",
              title: "AI-Powered",
              desc: "Gemini extracts details",
            },
            {
              icon: "📊",
              title: "Dashboard",
              desc: "Visual status tracking",
            },
          ].map((f) => (
            <div
              key={f.title}
              className="glass-card"
              style={{ padding: 20, textAlign: "center" }}
            >
              <div style={{ fontSize: 28, marginBottom: 8 }}>{f.icon}</div>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  marginBottom: 4,
                }}
              >
                {f.title}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                {f.desc}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
