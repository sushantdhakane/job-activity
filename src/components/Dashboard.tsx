"use client";

import { useCallback, useEffect, useState } from "react";
import { signOut } from "next-auth/react";
import {
  BriefcaseBusinessIcon,
  CalendarDaysIcon,
  GhostIcon,
  LoaderCircleIcon,
  LogOutIcon,
  MailCheckIcon,
  SearchIcon,
  SendIcon,
  SparklesIcon,
  TargetIcon,
  TriangleAlertIcon,
  XCircleIcon,
} from "lucide-react";

import { isNeedsReviewApplicationRecord } from "@/lib/application-quality";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

interface JobApplication {
  id: string;
  company: string;
  role: string | null;
  dateApplied: string | null;
  status: string;
  interviewRound: string | null;
  platform: string | null;
  emailSubject: string;
  emailDate: string;
  createdAt: string;
  companyProfile?: {
    id: string;
    displayName: string;
    logoUrl: string | null;
    logoDataUrl: string | null;
    logoSource: string | null;
  } | null;
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
  applied: {
    label: "Applied",
    icon: SendIcon,
    badgeTone: "border-sky-200 bg-sky-50 text-sky-700",
  },
  interviewing: {
    label: "Interviewing",
    icon: TargetIcon,
    badgeTone: "border-amber-200 bg-amber-50 text-amber-700",
  },
  offered: {
    label: "Offered",
    icon: SparklesIcon,
    badgeTone: "border-emerald-200 bg-emerald-50 text-emerald-700",
  },
  rejected: {
    label: "Rejected",
    icon: XCircleIcon,
    badgeTone: "border-rose-200 bg-rose-50 text-rose-700",
  },
  ghosted: {
    label: "Ghosted",
    icon: GhostIcon,
    badgeTone: "border-slate-200 bg-slate-100 text-slate-600",
  },
} as const;

const PIPELINE_COLUMNS = [
  {
    key: "wishlist",
    label: "Wishlist",
    description: "Fresh applications and recent sends.",
    accentClass: "bg-slate-900",
    emptyLabel: "New applications land here first.",
  },
  {
    key: "recruiter-call",
    label: "Recruiter call",
    description: "Screens, intros, and first replies.",
    accentClass: "bg-sky-500",
    emptyLabel: "Intro calls and phone screens show up here.",
  },
  {
    key: "portfolio-review",
    label: "Portfolio review",
    description: "Portfolio deep-dives and case reviews.",
    accentClass: "bg-violet-500",
    emptyLabel: "Portfolio review stages are still open.",
  },
  {
    key: "assignment",
    label: "Assignment / Whiteboard",
    description: "Take-homes, exercises, and whiteboards.",
    accentClass: "bg-amber-500",
    emptyLabel: "No assignments are active right now.",
  },
  {
    key: "product-culture",
    label: "Product & culture",
    description: "Panel, team, final, and culture rounds.",
    accentClass: "bg-emerald-500",
    emptyLabel: "Later-stage interviews will collect here.",
  },
  {
    key: "not-selected",
    label: "Not selected",
    description: "Rejections and long-tail ghosting.",
    accentClass: "bg-rose-500",
    emptyLabel: "Nothing closed out in this view.",
  },
  {
    key: "offer-received",
    label: "Offer received",
    description: "Live offers worth comparing carefully.",
    accentClass: "bg-teal-500",
    emptyLabel: "Offers will stay isolated here.",
  },
] as const;

const SORT_OPTIONS = [
  { value: "emailDate:desc", label: "Newest activity" },
  { value: "emailDate:asc", label: "Oldest activity" },
  { value: "company:asc", label: "Company A-Z" },
  { value: "company:desc", label: "Company Z-A" },
  { value: "status:asc", label: "Status A-Z" },
];

const ALL_PLATFORMS_VALUE = "__all-platforms__";

type PipelineColumnKey = (typeof PIPELINE_COLUMNS)[number]["key"];

function getInitials(value: string | null | undefined): string {
  const cleaned = (value || "").trim();
  if (!cleaned) return "JT";

  const parts = cleaned.split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() || "").join("") || "JT";
}

function getGreeting(name: string | null | undefined): string {
  const firstName = name?.trim().split(/\s+/)[0] || "there";
  const hour = new Date().getHours();

  if (hour < 12) return `Good morning, ${firstName}`;
  if (hour < 18) return `Good afternoon, ${firstName}`;
  return `Good evening, ${firstName}`;
}

function formatDate(dateStr: string | null): string {
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
}

function formatTime(dateStr: string | null): string {
  if (!dateStr) return "—";

  try {
    return new Date(dateStr).toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function getApplicationSource(platform: string | null): string {
  return platform?.trim() || "Company careers page";
}

function getPipelineColumn(app: JobApplication): PipelineColumnKey {
  if (app.status === "offered") {
    return "offer-received";
  }

  if (app.status === "rejected" || app.status === "ghosted") {
    return "not-selected";
  }

  if (app.status === "interviewing") {
    const round = (app.interviewRound || "").toLowerCase();

    if (round.includes("portfolio")) {
      return "portfolio-review";
    }

    if (
      round.includes("assignment") ||
      round.includes("whiteboard") ||
      round.includes("take home") ||
      round.includes("take-home") ||
      round.includes("case study")
    ) {
      return "assignment";
    }

    if (
      round.includes("culture") ||
      round.includes("final") ||
      round.includes("panel") ||
      round.includes("onsite") ||
      round.includes("team") ||
      round.includes("manager")
    ) {
      return "product-culture";
    }

    return "recruiter-call";
  }

  return "wishlist";
}
function SummaryCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: number;
  hint: string;
}) {
  return (
    <div className="rounded-[24px] border border-[#e7e3d8] bg-white p-5">
      <p className="text-4xl font-semibold tracking-tight text-slate-900">
        {value}
      </p>
      <p className="mt-2 text-sm font-medium text-slate-900">{label}</p>
      <p className="mt-1 text-sm text-[#667085]">{hint}</p>
    </div>
  );
}

function ApplicationCard({
  app,
}: {
  app: JobApplication;
}) {
  return (
    <article className="flex h-[178px] flex-col rounded-[22px] border border-[#e7e3d8] bg-white p-4 shadow-[0_10px_30px_rgba(15,23,42,0.04)] transition-transform duration-200 hover:-translate-y-0.5">
      <div className="flex items-start gap-3">
        <Avatar className="size-11 rounded-2xl">
          <AvatarImage
            src={
              app.companyProfile?.logoDataUrl ||
              app.companyProfile?.logoUrl ||
              undefined
            }
            alt={app.company}
            className="rounded-2xl object-contain bg-white p-1"
          />
          <AvatarFallback className="rounded-2xl bg-[#f3efe4] text-sm font-semibold text-slate-700">
            {getInitials(app.company)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 pt-0.5">
          <p className="truncate text-base font-semibold text-slate-900">
            {app.company}
          </p>
        </div>
      </div>

      <div className="mt-5 flex flex-1 flex-col justify-between">
        <p
          className="line-clamp-2 min-h-[52px] text-[17px] leading-6 font-medium text-[#344054]"
          title={app.role || "Role pending review"}
        >
          {app.role || "Role pending review"}
        </p>
        <p
          className="line-clamp-1 text-sm text-[#667085]"
          title={getApplicationSource(app.platform)}
        >
          {getApplicationSource(app.platform)}
        </p>
      </div>
    </article>
  );
}

function PipelineColumn({
  column,
  applications,
}: {
  column: (typeof PIPELINE_COLUMNS)[number];
  applications: JobApplication[];
}) {
  return (
    <section className="flex w-[290px] flex-col rounded-[28px] border border-[#e7e3d8] bg-[#f3efe4] p-3">
      <div className="rounded-[22px] bg-white/85 p-4">
        <div className="flex items-center gap-3">
          <span className={cn("size-3 rounded-full", column.accentClass)} />
          <div>
            <p className="text-lg font-semibold text-slate-900">{column.label}</p>
            <p className="mt-1 text-sm leading-6 text-[#667085]">
              {column.description}
            </p>
          </div>
        </div>
        <div className="mt-4 inline-flex rounded-full bg-[#f6f2e8] px-3 py-1 text-sm font-medium text-slate-700">
          {applications.length}
        </div>
      </div>

      <div className="mt-3 flex flex-1 flex-col gap-3">
        {applications.length > 0 ? (
          applications.map((app) => <ApplicationCard key={app.id} app={app} />)
        ) : (
          <div className="flex flex-1 items-center rounded-[22px] border border-dashed border-[#d7d2c3] bg-[#faf8f2] px-4 py-10 text-center text-sm leading-6 text-[#667085]">
            {column.emptyLabel}
          </div>
        )}
      </div>
    </section>
  );
}

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
  const [searchInput, setSearchInput] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);

    try {
      const params = new URLSearchParams();
      if (filter) params.set("status", filter);
      if (platform) params.set("platform", platform);
      if (search) params.set("search", search);
      params.set("sortBy", sortBy);
      params.set("sortOrder", sortOrder);

      const res = await fetch(`/api/applications?${params.toString()}`);
      if (res.ok) {
        const json = (await res.json()) as DashboardData;
        setData(json);
      }
    } catch (err) {
      console.error("Failed to fetch applications:", err);
    } finally {
      setLoading(false);
    }
  }, [filter, platform, search, sortBy, sortOrder]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
    }, 250);

    return () => window.clearTimeout(timer);
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
        console.error("Sync failed:", json);
      }
    } catch (err) {
      console.error("Sync failed:", err);
    } finally {
      setSyncing(false);
    }
  };

  const clearFilters = () => {
    setFilter("");
    setPlatform("");
    setSearch("");
    setSearchInput("");
    setShowNeedsReview(false);
  };

  const totalApps = data
    ? Object.values(data.stats).reduce((sum, count) => sum + count, 0)
    : 0;

  const activeApplications =
    (data?.stats.applied || 0) + (data?.stats.interviewing || 0);

  const reviewCount = (data?.applications || []).filter((app) =>
    isNeedsReviewApplicationRecord(app)
  ).length;

  const displayedApplications = (data?.applications || []).filter((app) =>
    showNeedsReview ? isNeedsReviewApplicationRecord(app) : true
  );

  const uniquePlatforms = Array.from(
    new Set(
      (data?.applications || [])
        .map((application) => application.platform)
        .filter((value): value is string => Boolean(value))
    )
  ).sort((a, b) => a.localeCompare(b));

  const currentSortValue = `${sortBy}:${sortOrder}`;
  const selectedPlatformValue = platform || ALL_PLATFORMS_VALUE;
  const hasActiveFilters = Boolean(filter || platform || search || showNeedsReview);

  const pipelineColumns = PIPELINE_COLUMNS.map((column) => ({
    ...column,
    applications: displayedApplications.filter(
      (application) => getPipelineColumn(application) === column.key
    ),
  }));

  const lastSyncLabel = data?.lastSyncAt
    ? `${formatDate(data.lastSyncAt)} at ${formatTime(data.lastSyncAt)}`
    : "No sync has been run yet";

  return (
    <div className="min-h-screen bg-[#f7f4ec] text-slate-900">
      <header className="border-b border-[#e7e3d8] bg-[#fcfbf7]/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[1700px] flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-2xl bg-slate-900 text-white">
                <BriefcaseBusinessIcon className="size-4" />
              </div>
              <div>
                <p className="text-sm font-semibold tracking-tight">
                  Job Application Tracker
                </p>
                <p className="text-xs text-[#667085]">
                  Clean pipeline view from your inbox
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setShowNeedsReview(false)}
                className={cn(
                  "inline-flex cursor-pointer items-center rounded-full border px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20",
                  !showNeedsReview
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-[#d7d2c3] bg-white text-slate-700 hover:bg-[#f8f5ec]"
                )}
              >
                All pipeline
              </button>
              <button
                type="button"
                onClick={() => setShowNeedsReview(true)}
                className={cn(
                  "inline-flex cursor-pointer items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20",
                  showNeedsReview
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-[#d7d2c3] bg-white text-slate-700 hover:bg-[#f8f5ec]"
                )}
              >
                Review queue
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-xs",
                    showNeedsReview
                      ? "bg-white/15 text-white"
                      : "bg-[#f3efe4] text-slate-700"
                  )}
                >
                  {reviewCount}
                </span>
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <p className="hidden text-sm text-[#667085] xl:block">
              Last sync: {lastSyncLabel}
            </p>
            <Button
              onClick={handleSync}
              disabled={syncing}
              size="lg"
              className="rounded-full px-4"
            >
              {syncing ? (
                <>
                  <LoaderCircleIcon
                    data-icon="inline-start"
                    className="animate-spin"
                  />
                  Syncing inbox
                </>
              ) : (
                <>
                  <MailCheckIcon data-icon="inline-start" />
                  Sync Gmail
                </>
              )}
            </Button>
            <div className="flex items-center gap-2 rounded-full border border-[#ddd6c7] bg-white px-2 py-1.5">
              <Avatar size="sm">
                <AvatarImage
                  src={user.image || undefined}
                  alt={user.name || "User"}
                />
                <AvatarFallback>{getInitials(user.name || user.email)}</AvatarFallback>
              </Avatar>
              <span className="max-w-[160px] truncate pr-1 text-sm font-medium text-slate-700">
                {user.name || user.email || "Your account"}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => signOut()}
                className="rounded-full"
              >
                <LogOutIcon data-icon="inline-start" />
                Sign out
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1700px] flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <section className="rounded-[32px] border border-[#e7e3d8] bg-white p-6 sm:p-8">
          <Badge
            variant="outline"
            className="rounded-full border-[#d7d2c3] bg-[#f8f5ec] px-3 py-1 text-[#5b6474]"
          >
            Board-first application tracker
          </Badge>
          <div className="mt-4 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-slate-900 sm:text-4xl">
                {getGreeting(user.name || user.email)}
              </h1>
              <p className="mt-3 max-w-3xl text-base leading-7 text-[#667085] sm:text-lg">
                See every application stage at a glance, keep Gmail syncs close,
                and update statuses directly from the board without dropping
                into a spreadsheet.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className="h-auto rounded-full border-[#d7d2c3] bg-[#f8f5ec] px-3 py-1.5 text-[#5b6474]"
              >
                {displayedApplications.length} visible
              </Badge>
              <Badge
                variant="outline"
                className="h-auto rounded-full border-[#d7d2c3] bg-[#f8f5ec] px-3 py-1.5 text-[#5b6474]"
              >
                {totalApps} total tracked
              </Badge>
              <Badge
                variant="outline"
                className="h-auto rounded-full border-[#d7d2c3] bg-[#f8f5ec] px-3 py-1.5 text-[#5b6474]"
              >
                Last sync: {lastSyncLabel}
              </Badge>
            </div>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard
            label="Total applications"
            value={totalApps}
            hint="Every tracked application email in the system."
          />
          <SummaryCard
            label="Active applications"
            value={activeApplications}
            hint="Applied plus interviewing roles still in motion."
          />
          <SummaryCard
            label="Needs review"
            value={reviewCount}
            hint="Records with weak extraction signals to double-check."
          />
          <SummaryCard
            label="Offers received"
            value={data?.stats.offered || 0}
            hint="Offers you can compare without losing the pipeline."
          />
        </section>

        <section className="rounded-[32px] border border-[#e7e3d8] bg-white px-6 py-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <p className="text-xl font-semibold tracking-tight text-slate-900">
                Responses take time in early stages
              </p>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-[#667085]">
                Keep syncing Gmail, surface weak records before they pollute the
                board, and move each application into the correct stage so the
                pipeline stays calm and trustworthy.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {syncSummary ? (
                <>
                  <Badge
                    variant="outline"
                    className="h-auto rounded-full border-sky-200 bg-sky-50 px-3 py-1.5 text-sky-700"
                  >
                    Saved {syncSummary.emailsProcessed}
                  </Badge>
                  <Badge
                    variant="outline"
                    className="h-auto rounded-full border-emerald-200 bg-emerald-50 px-3 py-1.5 text-emerald-700"
                  >
                    New {syncSummary.newApplications}
                  </Badge>
                  <Badge
                    variant="outline"
                    className="h-auto rounded-full border-rose-200 bg-rose-50 px-3 py-1.5 text-rose-700"
                  >
                    Failed {syncSummary.failed || 0}
                  </Badge>
                </>
              ) : (
                <Badge
                  variant="outline"
                  className="h-auto rounded-full border-[#d7d2c3] bg-[#f8f5ec] px-3 py-1.5 text-[#5b6474]"
                >
                  Run a sync to refresh Gmail-backed application data.
                </Badge>
              )}
              <Button
                variant={showNeedsReview ? "default" : "outline"}
                size="lg"
                onClick={() => setShowNeedsReview((value) => !value)}
                className="rounded-full px-4"
              >
                <TriangleAlertIcon data-icon="inline-start" />
                {showNeedsReview ? "Exit review queue" : "Review weak records"}
              </Button>
            </div>
          </div>
        </section>

        <section className="rounded-[32px] border border-[#e7e3d8] bg-white p-6">
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-xs font-medium tracking-[0.24em] text-[#98a2b3] uppercase">
                  Application pipeline
                </p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">
                  Your application pipeline
                </h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-[#667085]">
                  Search by company, role, source, or email subject, then move
                  each card through the same board where you review the rest of
                  your process.
                </p>
              </div>
              {hasActiveFilters ? (
                <Button
                  variant="ghost"
                  size="lg"
                  onClick={clearFilters}
                  className="w-full rounded-full lg:w-auto"
                >
                  Clear filters
                </Button>
              ) : null}
            </div>

            <div className="grid gap-3 lg:grid-cols-[1.4fr_0.8fr_0.8fr]">
              <div className="relative">
                <SearchIcon className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-[#98a2b3]" />
                <Input
                  type="text"
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder="Search company, role, subject, or platform"
                  className="h-12 rounded-2xl border-[#ddd6c7] bg-[#fcfbf7] pl-11"
                />
              </div>

              <Select
                value={selectedPlatformValue}
                onValueChange={(value) => {
                  setPlatform(
                    value && value !== ALL_PLATFORMS_VALUE ? value : ""
                  );
                }}
              >
                <SelectTrigger className="h-12 w-full rounded-2xl border-[#ddd6c7] bg-[#fcfbf7]">
                  <SelectValue placeholder="All platforms" />
                </SelectTrigger>
                <SelectContent align="start">
                  <SelectGroup>
                    <SelectItem value={ALL_PLATFORMS_VALUE}>
                      All platforms
                    </SelectItem>
                    {uniquePlatforms.map((platformOption) => (
                      <SelectItem key={platformOption} value={platformOption}>
                        {platformOption}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>

              <Select
                value={currentSortValue}
                onValueChange={(value) => {
                  if (!value) return;
                  const [nextSortBy, nextSortOrder] = value.split(":");
                  setSortBy(nextSortBy);
                  setSortOrder(nextSortOrder as "asc" | "desc");
                }}
              >
                <SelectTrigger className="h-12 w-full rounded-2xl border-[#ddd6c7] bg-[#fcfbf7]">
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent align="start">
                  <SelectGroup>
                    {SORT_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setFilter("")}
                className={cn(
                  "inline-flex cursor-pointer items-center rounded-full border px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20",
                  filter === ""
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-[#d7d2c3] bg-[#fcfbf7] text-slate-700 hover:bg-[#f8f5ec]"
                )}
              >
                All statuses
              </button>
              {Object.entries(STATUS_CONFIG).map(([status, config]) => {
                const Icon = config.icon;

                return (
                  <button
                    key={status}
                    type="button"
                    onClick={() => setFilter(status)}
                    className={cn(
                      "inline-flex cursor-pointer items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20",
                      filter === status
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-[#d7d2c3] bg-[#fcfbf7] text-slate-700 hover:bg-[#f8f5ec]"
                    )}
                  >
                    <Icon className="size-3.5" />
                    {config.label}
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        {loading ? (
          <section className="overflow-x-auto pb-3">
            <div className="grid min-w-max grid-flow-col gap-4">
              {PIPELINE_COLUMNS.map((column) => (
                <div
                  key={column.key}
                  className="flex w-[290px] flex-col rounded-[28px] border border-[#e7e3d8] bg-[#f3efe4] p-3"
                >
                  <div className="rounded-[22px] bg-white/85 p-4">
                    <Skeleton className="h-5 w-28 rounded-full bg-white" />
                    <Skeleton className="mt-3 h-4 w-40 rounded-full bg-white" />
                  </div>
                  <div className="mt-3 space-y-3">
                    {Array.from({ length: 3 }).map((_, index) => (
                      <div
                        key={index}
                        className="h-[178px] rounded-[22px] border border-[#e7e3d8] bg-white p-4"
                      >
                        <Skeleton className="h-5 w-24 rounded-full" />
                        <Skeleton className="mt-7 h-12 rounded-2xl" />
                        <Skeleton className="mt-8 h-4 w-32 rounded-full" />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : displayedApplications.length === 0 ? (
          <section className="rounded-[32px] border border-[#e7e3d8] bg-white p-12 text-center">
            <p className="text-2xl font-semibold tracking-tight text-slate-900">
              No applications match this view
            </p>
            <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-[#667085]">
              {hasActiveFilters
                ? "Adjust the filters or clear the review queue to widen the results."
                : "Run a Gmail sync to pull fresh application emails into the board."}
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              {hasActiveFilters ? (
                <Button
                  variant="outline"
                  size="lg"
                  onClick={clearFilters}
                  className="rounded-full px-4"
                >
                  Clear filters
                </Button>
              ) : null}
              <Button
                onClick={handleSync}
                disabled={syncing}
                size="lg"
                className="rounded-full px-4"
              >
                {syncing ? (
                  <>
                    <LoaderCircleIcon
                      data-icon="inline-start"
                      className="animate-spin"
                    />
                    Syncing inbox
                  </>
                ) : (
                  <>
                    <MailCheckIcon data-icon="inline-start" />
                    Sync Gmail now
                  </>
                )}
              </Button>
            </div>
          </section>
        ) : (
          <section className="overflow-x-auto pb-3">
            <div className="grid min-w-max grid-flow-col gap-4">
              {pipelineColumns.map((column) => (
                <PipelineColumn
                  key={column.key}
                  column={column}
                  applications={column.applications}
                />
              ))}
            </div>
          </section>
        )}

        <footer className="flex flex-wrap items-center justify-between gap-3 rounded-[28px] border border-[#e7e3d8] bg-white px-5 py-4 text-sm text-[#667085]">
          <div className="flex items-center gap-2">
            <BriefcaseBusinessIcon className="size-4" />
            Built to manage real application volume, not just a demo table.
          </div>
          <div className="flex items-center gap-2">
            <CalendarDaysIcon className="size-4" />
            {data?.lastSyncAt
              ? `Last inbox refresh ${formatDate(data.lastSyncAt)}`
              : "Waiting for your first inbox sync"}
          </div>
        </footer>
      </main>
    </div>
  );
}
