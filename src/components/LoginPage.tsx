"use client";

import { signIn } from "next-auth/react";
import {
  ArrowRightIcon,
  BotIcon,
  BriefcaseBusinessIcon,
  CheckCircle2Icon,
  MailSearchIcon,
  SparklesIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

function GoogleMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23Z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09A6.96 6.96 0 0 1 5.49 12c0-.73.13-1.43.35-2.09V7.07H2.18A11.92 11.92 0 0 0 1 12c0 1.78.43 3.45 1.18 4.93l2.85-2.22.8-.62Z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53Z"
        fill="#EA4335"
      />
    </svg>
  );
}

const highlights = [
  {
    icon: MailSearchIcon,
    title: "Inbox triage",
    description:
      "Surface the right confirmation, assessment, or rejection email without digging through threads.",
  },
  {
    icon: BotIcon,
    title: "AI extraction",
    description:
      "Pull company, role, round, and platform details out of noisy application mail automatically.",
  },
  {
    icon: BriefcaseBusinessIcon,
    title: "Review-first workflow",
    description:
      "Keep uncertain records visible so you can correct weak data before it reaches the pipeline.",
  },
];

const previewColumns = [
  { label: "Wishlist", value: 2, tone: "border-primary/20 bg-primary/10 text-primary" },
  { label: "Interviewing", value: 1, tone: "border-info/20 bg-info/10 text-info" },
  { label: "Offers", value: 0, tone: "border-success/25 bg-success/10 text-success" },
];

export function LoginPage() {
  return (
    <div className="relative min-h-screen overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.18),transparent_32%),radial-gradient(circle_at_85%_10%,rgba(15,23,42,0.08),transparent_22%),radial-gradient(circle_at_bottom,rgba(148,163,184,0.16),transparent_30%)]"
      />

      <main className="relative z-10 mx-auto grid min-h-screen w-full max-w-7xl gap-8 px-5 py-6 sm:px-8 lg:grid-cols-[1.03fr_0.97fr] lg:gap-10 lg:px-10 lg:py-8">
        <section className="flex flex-col justify-center gap-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="rounded-full px-3 py-1">
              Gmail sync + Gemini extraction
            </Badge>
            <Badge variant="secondary" className="rounded-full px-3 py-1">
              Light editorial shell
            </Badge>
          </div>

          <div className="flex flex-col gap-4">
            <h1 className="max-w-3xl text-5xl font-semibold tracking-tight text-balance text-foreground sm:text-6xl lg:text-7xl">
              A cleaner way to track applications from inbox to offer.
            </h1>
            <p className="max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
              Connect Gmail once, let the tracker read the signal, and keep the
              whole pipeline organized in a calm workspace that feels closer to
              a portfolio than a spreadsheet.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="lg"
              onClick={() => signIn("google", { callbackUrl: "/" })}
              className="rounded-full px-5"
            >
              <span data-icon="inline-start" className="inline-flex">
                <GoogleMark />
              </span>
              Sign in with Google
              <ArrowRightIcon data-icon="inline-end" className="size-4" />
            </Button>
            <Badge variant="secondary" className="rounded-full px-3 py-1">
              Read-only inbox access
            </Badge>
          </div>

          <p className="max-w-xl text-sm leading-6 text-muted-foreground">
            We only read relevant mail and never send, delete, or modify your
            inbox. The goal is signal clarity, not inbox takeover.
          </p>

          <div className="grid gap-3 sm:grid-cols-3">
            {previewColumns.map((item) => (
              <Card key={item.label} size="sm" className="border-border/70">
                <CardContent className="flex flex-col gap-2 py-4">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-foreground">{item.label}</p>
                    <Badge variant="outline" className={`rounded-full border ${item.tone}`}>
                      {item.value}
                    </Badge>
                  </div>
                  <p className="text-xs leading-5 text-muted-foreground">
                    Clean status buckets for a quick read on where each job sits.
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <section className="flex items-center">
          <Card className="w-full border-border/70 bg-card/90 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur-sm">
            <CardHeader className="gap-3 border-b border-border/70 px-5 py-5 sm:px-6">
              <Badge variant="secondary" className="w-fit rounded-full px-3 py-1">
                What happens after you connect
              </Badge>
              <CardTitle className="text-2xl font-semibold tracking-tight sm:text-3xl">
                From raw inbox to clean pipeline
              </CardTitle>
              <CardDescription className="max-w-xl text-sm leading-6 text-muted-foreground">
                The interface stays centered on the exact workflow that matters:
                sync, classify, review, and update status without losing the
                thread.
              </CardDescription>
            </CardHeader>

            <CardContent className="flex flex-col gap-5 px-5 py-5 sm:px-6">
              <div className="grid gap-3 sm:grid-cols-3">
                {[
                  { label: "Signals found", value: "15+", tone: "text-foreground" },
                  { label: "Review queue", value: "Low", tone: "text-info" },
                  { label: "Inbox access", value: "Read only", tone: "text-success" },
                ].map((stat) => (
                  <div
                    key={stat.label}
                    className="rounded-2xl border border-border/70 bg-surface/80 p-4"
                  >
                    <p className={`text-2xl font-semibold tracking-tight ${stat.tone}`}>
                      {stat.value}
                    </p>
                    <p className="mt-1 text-xs uppercase tracking-[0.24em] text-muted-foreground">
                      {stat.label}
                    </p>
                  </div>
                ))}
              </div>

              <Separator />

              <div className="flex flex-col gap-4">
                {highlights.map((item) => {
                  const Icon = item.icon;

                  return (
                    <div
                      key={item.title}
                      className="flex items-start gap-4 rounded-2xl border border-border/70 bg-surface/70 p-4"
                    >
                      <div className="rounded-full border border-primary/15 bg-primary/10 p-2 text-primary">
                        <Icon className="size-4" />
                      </div>
                      <div className="flex flex-col gap-1">
                        <p className="font-medium text-foreground">{item.title}</p>
                        <p className="text-sm leading-6 text-muted-foreground">
                          {item.description}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="rounded-3xl border border-success/20 bg-success/10 p-4 sm:p-5">
                <div className="flex items-start gap-3">
                  <div className="rounded-full border border-success/20 bg-success/10 p-2 text-success">
                    <SparklesIcon className="size-4" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <p className="font-medium text-foreground">
                      Designed for the messy inbox
                    </p>
                    <p className="text-sm leading-6 text-muted-foreground">
                      False positives, duplicate-looking threads, and weak extractions
                      stay visible instead of getting buried.
                    </p>
                  </div>
                  <CheckCircle2Icon className="ml-auto size-4 shrink-0 text-success" />
                </div>
              </div>
            </CardContent>
          </Card>
        </section>
      </main>
    </div>
  );
}
