import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fetchJobEmails } from "@/lib/gmail";
import { classifyJobEmail, detectPlatform } from "@/lib/email-filter";
import {
  normalizeCompanyName,
  selectCompanyBranding,
  type CompanyLogoSource,
} from "@/lib/company-branding";
import { isMeaningfulApplicationValue } from "@/lib/application-quality";
import { extractJobData } from "@/lib/ai-extractor";

const BACKFILL_LOOKBACK_MONTHS = 18;
const INCREMENTAL_LOOKBACK_MONTHS = 3;
const BACKFILL_EXISTING_APP_THRESHOLD = 25;
const SYNC_PROCESS_CONCURRENCY = 5;
const LOGO_SOURCE_PRIORITY: Record<CompanyLogoSource, number> = {
  "domain-favicon": 1,
  "remote-email": 2,
  "inline-email": 3,
};

interface SyncProcessResult {
  created: boolean;
  saved: boolean;
  skippedNotJob: boolean;
  failed: boolean;
  updated: boolean;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];

  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function runner() {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= items.length) break;

      results[currentIndex] = await worker(items[currentIndex]);
    }
  }

  const workerCount = Math.min(Math.max(concurrency, 1), items.length);
  await Promise.all(Array.from({ length: workerCount }, () => runner()));

  return results;
}

function isMeaningfulValue(value: string | null | undefined): value is string {
  return Boolean(value) && isMeaningfulApplicationValue(value);
}

function safeDate(value: string | null | undefined): Date {
  if (!value) return new Date();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function monthsAgo(months: number): Date {
  const date = new Date();
  date.setMonth(date.getMonth() - months);
  return date;
}

function getLogoPriority(source: string | null | undefined): number {
  if (!source) return 0;
  return LOGO_SOURCE_PRIORITY[source as CompanyLogoSource] || 0;
}

async function upsertCompanyProfile(
  companyName: string,
  branding: ReturnType<typeof selectCompanyBranding>
) {
  const normalizedName = normalizeCompanyName(companyName);
  const existing = await prisma.companyProfile.findUnique({
    where: { normalizedName },
  });

  if (!existing) {
    return prisma.companyProfile.create({
      data: {
        displayName: companyName,
        normalizedName,
        domain: branding.inferredDomain,
        logoUrl: branding.logoUrl,
        logoDataUrl: branding.logoDataUrl,
        logoSource: branding.logoSource,
      },
      select: { id: true },
    });
  }

  const currentPriority = getLogoPriority(existing.logoSource);
  const nextPriority = getLogoPriority(branding.logoSource);
  const shouldUpdateLogo =
    nextPriority > currentPriority ||
    (!existing.logoUrl && !existing.logoDataUrl && nextPriority > 0);

  return prisma.companyProfile.update({
    where: { id: existing.id },
    data: {
      displayName: companyName,
      domain: branding.inferredDomain || existing.domain,
      ...(shouldUpdateLogo
        ? {
            logoUrl: branding.logoUrl,
            logoDataUrl: branding.logoDataUrl,
            logoSource: branding.logoSource,
          }
        : {}),
    },
    select: { id: true },
  });
}

const PROMOTIONAL_SUBJECT_PATTERNS = [
  "job alert",
  "recommended jobs",
  "jobs for you",
  "new jobs matching",
  "jobs like this",
  "matched jobs",
  "based on your profile",
  "daily job digest",
  "weekly job digest",
  "newsletter",
  "career advice",
  "resume tips",
  "job recommendations",
  "featured jobs",
  "top jobs",
  "recommended for you",
  "discover jobs",
  "people viewed your profile",
  "connection request",
  "inmail",
  "premium",
  "live:",
  "watch now",
  "started streaming",
  "new video",
  "webinar",
  "podcast",
];

export async function POST() {
  try {
    const syncStartedAt = Date.now();

    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = session.user.id;

    // Cleanup noisy promotional entries from previous sync runs.
    await prisma.jobApplication.deleteMany({
      where: {
        userId,
        OR: PROMOTIONAL_SUBJECT_PATTERNS.map((pattern) => ({
          emailSubject: {
            contains: pattern,
            mode: "insensitive",
          },
        })),
      },
    });

    const existingApps = await prisma.jobApplication.findMany({
      where: { userId },
      select: { gmailMessageId: true },
    });
    const existingIdSet = new Set(existingApps.map((app) => app.gmailMessageId));
    const shouldBackfillHistory =
      existingApps.length < BACKFILL_EXISTING_APP_THRESHOLD;
    const sinceDate = monthsAgo(
      shouldBackfillHistory
        ? BACKFILL_LOOKBACK_MONTHS
        : INCREMENTAL_LOOKBACK_MONTHS
    );

    // 1. Fetch emails from Gmail
    const rawEmails = await fetchJobEmails(userId, {
      sinceDate,
      excludeMessageIds: shouldBackfillHistory ? undefined : existingIdSet,
    });

    if (rawEmails.length === 0) {
      // Log empty sync
      await prisma.syncLog.create({
        data: { userId, emailsProcessed: 0, newApplications: 0 },
      });
      return NextResponse.json({
        message: "No matching emails found",
        emailsProcessed: 0,
        newApplications: 0,
        updatedApplications: 0,
      });
    }

    // 2. Extract data with AI for every fetched email
    const results = await mapWithConcurrency(
      rawEmails,
      SYNC_PROCESS_CONCURRENCY,
      async (email): Promise<SyncProcessResult> => {
        try {
          const existedBefore = existingIdSet.has(email.id);
          const senderPlatform = detectPlatform(email.from);
          const classification = classifyJobEmail(email);

          if (!classification.shouldProcess) {
            return {
              created: false,
              saved: false,
              skippedNotJob: true,
              failed: false,
              updated: false,
            };
          }

          const extractionResult = await extractJobData(email, senderPlatform);
          const extracted = extractionResult.extracted;
          const hasMeaningfulExtraction =
            isMeaningfulValue(extracted.company) ||
            isMeaningfulValue(extracted.role);
          const shouldPersist =
            classification.isHighConfidence ||
            (extracted.isJobRelated && hasMeaningfulExtraction);

          if (!shouldPersist) {
            return {
              created: false,
              saved: false,
              skippedNotJob: true,
              failed: false,
              updated: false,
            };
          }

          let companyProfileId: string | undefined;
          let branding:
            | ReturnType<typeof selectCompanyBranding>
            | null = null;

          if (isMeaningfulValue(extracted.company)) {
            branding = selectCompanyBranding(
              extracted.company.trim(),
              email.from,
              email.links,
              email.images
            );

            const profile = await upsertCompanyProfile(
              extracted.company.trim(),
              branding
            );
            companyProfileId = profile.id;
          }

          const updateData: {
            status: string;
            interviewRound: string | null;
            company?: string;
            role?: string | null;
            platform?: string | null;
            dateApplied?: Date;
            emailSubject?: string;
            emailDate?: Date;
            companyProfileId?: string;
            rawExtraction: Prisma.InputJsonValue;
          } = {
            status: extracted.status,
            interviewRound: extracted.interviewRound,
            rawExtraction: {
              extracted,
              classifier: classification,
              diagnostics: extractionResult.diagnostics,
              branding,
            } as unknown as Prisma.InputJsonValue,
            emailSubject: email.subject,
            emailDate: safeDate(email.date),
          };

          if (isMeaningfulValue(extracted.company)) {
            updateData.company = extracted.company.trim();
          }
          updateData.role = extracted.role?.trim() || null;
          if (extracted.platform) {
            updateData.platform = extracted.platform;
          }
          if (extracted.dateApplied) {
            updateData.dateApplied = new Date(extracted.dateApplied);
          }
          if (companyProfileId) {
            updateData.companyProfileId = companyProfileId;
          }

          await prisma.jobApplication.upsert({
            where: { gmailMessageId: email.id },
            update: updateData,
            create: {
              userId,
              gmailMessageId: email.id,
              company: extracted.company,
              role: extracted.role?.trim() || null,
              dateApplied: extracted.dateApplied
                ? new Date(extracted.dateApplied)
                : null,
              status: extracted.status,
              interviewRound: extracted.interviewRound,
              platform: extracted.platform,
              emailSubject: email.subject,
              emailDate: safeDate(email.date),
              companyProfileId,
              rawExtraction: {
                extracted,
                classifier: classification,
                diagnostics: extractionResult.diagnostics,
                branding,
              } as unknown as Prisma.InputJsonValue,
            },
          });

          return {
            created: !existedBefore,
            saved: true,
            skippedNotJob: false,
            failed: false,
            updated: existedBefore,
          };
        } catch (err) {
          console.error(`Failed to process email ${email.id}:`, err);
          return {
            created: false,
            saved: false,
            skippedNotJob: false,
            failed: true,
            updated: false,
          };
        }
      }
    );

    const newApplications = results.filter((r) => r.created).length;
    const updatedApplications = results.filter((r) => r.updated).length;
    const savedApplications = results.filter((r) => r.saved).length;
    const skippedNotJob = results.filter((r) => r.skippedNotJob).length;
    const failed = results.filter((r) => r.failed).length;
    const syncDurationMs = Date.now() - syncStartedAt;

    // Log sync
    await prisma.syncLog.create({
      data: {
        userId,
        emailsProcessed: savedApplications,
        newApplications,
      },
    });

    return NextResponse.json({
      message: "Sync completed",
      emailsProcessed: savedApplications,
      newApplications,
      updatedApplications,
      skippedNotJob,
      failed,
      scanned: rawEmails.length,
      filtered: rawEmails.length - skippedNotJob,
      syncDurationMs,
      syncMode: shouldBackfillHistory ? "backfill" : "incremental",
    });
  } catch (error) {
    console.error("Sync failed:", error);
    return NextResponse.json(
      { error: "Sync failed. Please try again." },
      { status: 500 }
    );
  }
}
