"use client";

import { useState, useEffect, useCallback } from "react";
import { signOut } from "next-auth/react";
import { isNeedsReviewApplicationRecord } from "@/lib/application-quality";

interface JobApplication {
  id: string;
  company: string;
  role: string;
  dateApplied: string | null;
  status: string;
  interviewRound: string | null;
  platform: string | null;
  emailSubject: string;
  emailDate: string;
  createdAt: string;
}

interface DashboardData {
  applications: JobApplication[];
  stats: Record<string, number>;
  totalCount: number;
  lastSyncAt: string | null;
}

interface SyncSummary {
  message: string;
  emailsProcessed: number;
  newApplications: number;
  skippedNotJob?: number;
  failed?: number;
  scanned?: number;
  filtered?: number;
  syncDurationMs?: number;
}

interface DashboardProps {
  user: {
    id?: string;
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
}

const STATUS_CONFIG = {
  applied: { color: "var(--info)", label: "Applied", icon: "📤" },
  interviewing: {
    color: "var(--warning)",
    label: "Interviewing",
    icon: "🎯",
  },
  offered: { color: "var(--success)", label: "Offered", icon: "🎉" },
  rejected: { color: "var(--danger)", label: "Rejected", icon: "❌" },
  ghosted: { color: "var(--purple)", label: "Ghosted", icon: "👻" },
};

export function Dashboard({ user }: DashboardProps) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [filter, setFilter] = useState("");
  const [platform, setPlatform] = useState("");
  const [search, setSearch] = useState("");
  const [showNeedsReview, setShowNeedsReview] = useState(false);
  const [sortBy, setSortBy] = useState("emailDate");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [syncSummary, setSyncSummary] = useState<SyncSummary | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filter) params.set("status", filter);
      if (platform) params.set("platform", platform);
      if (search) params.set("search", search);
      params.set("sortBy", sortBy);
      params.set("sortOrder", sortOrder);

      const res = await fetch(`/api/applications?${params}`);
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch (err) {
      console.error("Failed to fetch:", err);
    } finally {
      setLoading(false);
    }
  }, [filter, platform, search, sortBy, sortOrder]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Debounced search
  const [searchInput, setSearchInput] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const json = (await res.json()) as SyncSummary;
      if (res.ok) {
        setSyncSummary(json);
        await fetchData();
      } else {
        console.error("Sync error:", json);
      }
    } catch (err) {
      console.error("Sync failed:", err);
    } finally {
      setSyncing(false);
    }
  };

  const handleStatusChange = async (id: string, newStatus: string) => {
    try {
      const res = await fetch("/api/applications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status: newStatus }),
      });
      if (res.ok) {
        setEditingId(null);
        await fetchData();
      }
    } catch (err) {
      console.error("Update failed:", err);
    }
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "—";
    try {
      return new Date(dateStr).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
    } catch {
      return "—";
    }
  };

  const totalApps = data
    ? Object.values(data.stats).reduce((a, b) => a + b, 0)
    : 0;

  const uniquePlatforms = Array.from(
    new Set(
      (data?.applications || [])
        .map((app) => app.platform)
        .filter((value): value is string => Boolean(value))
    )
  ).sort((a, b) => a.localeCompare(b));

  const isLowQualityRecord = (app: JobApplication) =>
    isNeedsReviewApplicationRecord(app);

  const displayedApplications = (data?.applications || []).filter((app) =>
    showNeedsReview ? isLowQualityRecord(app) : true
  );

  return (
    <div style={{ minHeight: "100vh", padding: "24px" }}>
      {/* Header */}
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 32,
          maxWidth: 1200,
          margin: "0 auto 32px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              background:
                "linear-gradient(135deg, var(--accent), var(--purple))",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 20,
            }}
          >
            📋
          </div>
          <div>
            <h1
              style={{
                fontSize: 20,
                fontWeight: 700,
                letterSpacing: "-0.02em",
                margin: 0,
              }}
            >
              Job Tracker
            </h1>
            <p
              style={{
                fontSize: 13,
                color: "var(--text-muted)",
                margin: 0,
              }}
            >
              {user.email}
            </p>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="btn-primary"
          >
            {syncing ? (
              <>
                <span className="animate-pulse-subtle">⟳</span> Syncing…
              </>
            ) : (
              <>⟳ Sync Gmail</>
            )}
          </button>
          <button
            onClick={() => signOut()}
            className="btn-ghost"
            style={{ padding: "8px 14px" }}
          >
            Sign Out
          </button>
        </div>
      </header>

      <main style={{ maxWidth: 1200, margin: "0 auto" }}>
        {/* Stats Row */}
        <div
          className="animate-fade-in"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
            gap: 16,
            marginBottom: 32,
          }}
        >
          {/* Total */}
          <div className="stat-card">
            <div className="stat-value">{loading ? "—" : totalApps}</div>
            <div className="stat-label">Total Applications</div>
          </div>
          {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
            <div
              key={key}
              className="stat-card"
              style={{ cursor: "pointer" }}
              onClick={() => setFilter(filter === key ? "" : key)}
            >
              <div className="stat-value" style={{ color: cfg.color }}>
                {loading ? "—" : data?.stats[key] || 0}
              </div>
              <div className="stat-label">
                {cfg.icon} {cfg.label}
              </div>
            </div>
          ))}
        </div>

        {/* Filters & Search */}
        <div
          className="glass-card"
          style={{
            display: "flex",
            gap: 12,
            marginBottom: 18,
            flexWrap: "wrap",
            alignItems: "center",
            padding: 14,
          }}
        >
          <input
            type="text"
            placeholder="Search company or role…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="input-field"
            style={{ maxWidth: 320, minWidth: 220 }}
          />
          <select
            className="input-field"
            value={platform}
            onChange={(e) => setPlatform(e.target.value)}
            style={{ width: 180 }}
          >
            <option value="">All Platforms</option>
            {uniquePlatforms.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>

          <select
            className="input-field"
            value={`${sortBy}:${sortOrder}`}
            onChange={(e) => {
              const [nextSortBy, nextSortOrder] = e.target.value.split(":");
              setSortBy(nextSortBy);
              setSortOrder(nextSortOrder as "asc" | "desc");
            }}
            style={{ width: 210 }}
          >
            <option value="emailDate:desc">Newest Email First</option>
            <option value="emailDate:asc">Oldest Email First</option>
            <option value="company:asc">Company A-Z</option>
            <option value="company:desc">Company Z-A</option>
            <option value="status:asc">Status A-Z</option>
          </select>

          <button
            className={`btn-ghost ${showNeedsReview ? "active" : ""}`}
            onClick={() => setShowNeedsReview((prev) => !prev)}
          >
            {showNeedsReview ? "Showing Needs Review" : "Needs Review Only"}
          </button>

          <div style={{ display: "flex", gap: 8 }}>
            <button
              className={`btn-ghost ${!filter ? "active" : ""}`}
              onClick={() => setFilter("")}
            >
              All
            </button>
            {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
              <button
                key={key}
                className={`btn-ghost ${filter === key ? "active" : ""}`}
                onClick={() => setFilter(filter === key ? "" : key)}
              >
                {cfg.icon} {cfg.label}
              </button>
            ))}
          </div>
        </div>

        {/* Last sync info */}
        {data?.lastSyncAt && (
          <div
            className="glass-card"
            style={{
              padding: "12px 14px",
              marginBottom: 16,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <p
              style={{
                fontSize: 12,
                color: "var(--text-muted)",
                margin: 0,
              }}
            >
              Last synced: {formatDate(data.lastSyncAt)}{" "}
              {new Date(data.lastSyncAt).toLocaleTimeString("en-IN", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </p>
            {syncSummary && (
              <div
                style={{
                  display: "flex",
                  gap: 10,
                  flexWrap: "wrap",
                  fontSize: 12,
                }}
              >
                <span className="badge badge-applied">
                  Saved: {syncSummary.emailsProcessed}
                </span>
                <span className="badge badge-offered">
                  New: {syncSummary.newApplications}
                </span>
                <span className="badge badge-ghosted">
                  Skipped: {syncSummary.skippedNotJob || 0}
                </span>
                <span className="badge badge-rejected">
                  Failed: {syncSummary.failed || 0}
                </span>
                {syncSummary.syncDurationMs !== undefined && (
                  <span className="badge badge-interviewing">
                    Sync: {(syncSummary.syncDurationMs / 1000).toFixed(1)}s
                  </span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="skeleton" style={{ height: 64 }} />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && displayedApplications.length === 0 && (
          <div
            className="glass-card animate-fade-in"
            style={{ padding: 60, textAlign: "center" }}
          >
            <div style={{ fontSize: 48, marginBottom: 16 }}>📭</div>
            <h2
              style={{
                fontSize: 20,
                fontWeight: 600,
                marginBottom: 8,
              }}
            >
              No applications found
            </h2>
            <p
              style={{
                fontSize: 14,
                color: "var(--text-secondary)",
                marginBottom: 24,
              }}
            >
              {filter || search
                ? "Try adjusting your filters or search."
                : 'Click "Sync Gmail" to scan your inbox for job-related emails.'}
            </p>
            {!filter && !search && (
              <button
                onClick={handleSync}
                disabled={syncing}
                className="btn-primary"
              >
                ⟳ Sync Gmail Now
              </button>
            )}
          </div>
        )}

        {/* Applications list */}
        {!loading && displayedApplications.length > 0 && (
          <div className="glass-card animate-fade-in" style={{ overflow: "hidden" }}>
            {/* Header row */}
            <div
              className="app-row"
              style={{
                fontWeight: 600,
                fontSize: 12,
                color: "var(--text-muted)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                borderBottom: "1px solid var(--border)",
                background: "rgba(255,255,255,0.02)",
              }}
            >
              <div>Company & Role</div>
              <div>Platform</div>
              <div>Date</div>
              <div>Status</div>
              <div>Round</div>
            </div>

            {displayedApplications.map((app, i) => (
              <div
                key={app.id}
                className="app-row animate-fade-in"
                style={{ animationDelay: `${i * 30}ms` }}
              >
                {/* Company & Role */}
                <div>
                  <div
                    style={{
                      fontWeight: 600,
                      fontSize: 14,
                      marginBottom: 2,
                    }}
                    title={app.company}
                  >
                    {app.company}
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      color: "var(--text-secondary)",
                    }}
                    title={app.role}
                  >
                    {app.role}
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--text-muted)",
                      marginTop: 4,
                    }}
                    title={app.emailSubject}
                  >
                    {app.emailSubject || "No subject"}
                  </div>
                  {isLowQualityRecord(app) && (
                    <div style={{ marginTop: 6 }}>
                      <span className="badge badge-ghosted">Needs Review</span>
                    </div>
                  )}
                </div>

                {/* Platform */}
                <div>
                  <span
                    style={{
                      fontSize: 13,
                      color: "var(--text-secondary)",
                    }}
                  >
                    {app.platform || "—"}
                  </span>
                </div>

                {/* Date */}
                <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                  {formatDate(app.dateApplied || app.emailDate)}
                </div>

                {/* Status */}
                <div>
                  {editingId === app.id ? (
                    <select
                      className="input-field"
                      style={{ padding: "6px 10px", fontSize: 12 }}
                      value={app.status}
                      onChange={(e) =>
                        handleStatusChange(app.id, e.target.value)
                      }
                      onBlur={() => setEditingId(null)}
                      autoFocus
                    >
                      {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
                        <option key={key} value={key}>
                          {cfg.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span
                      className={`badge badge-${app.status}`}
                      onClick={() => setEditingId(app.id)}
                      style={{ cursor: "pointer" }}
                      title="Click to change status"
                    >
                      {STATUS_CONFIG[app.status as keyof typeof STATUS_CONFIG]
                        ?.icon || "•"}{" "}
                      {app.status}
                    </span>
                  )}
                </div>

                {/* Round */}
                <div style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                  {app.interviewRound || "—"}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Footer */}
        <footer
          style={{
            textAlign: "center",
            padding: "32px 0",
            fontSize: 12,
            color: "var(--text-muted)",
          }}
        >
          Powered by Gemini AI · Made for job seekers ❤️
        </footer>
      </main>
    </div>
  );
}
