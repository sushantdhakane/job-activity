import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { fetchJobEmails } from "@/lib/gmail";
import { classifyJobEmail, detectPlatform } from "@/lib/email-filter";
import { isMeaningfulApplicationValue } from "@/lib/application-quality";
import { extractJobData } from "@/lib/ai-extractor";

const SYNC_PROCESS_CONCURRENCY = 5;

interface SyncProcessResult {
  created: boolean;
  saved: boolean;
  skippedNotJob: boolean;
  failed: boolean;
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

    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    // 1. Fetch emails from Gmail
    const rawEmails = await fetchJobEmails(userId, threeMonthsAgo);

    if (rawEmails.length === 0) {
      // Log empty sync
      await prisma.syncLog.create({
        data: { userId, emailsProcessed: 0, newApplications: 0 },
      });
      return NextResponse.json({
        message: "No new emails found",
        emailsProcessed: 0,
        newApplications: 0,
      });
    }

    const existingInBatch = await prisma.jobApplication.findMany({
      where: {
        userId,
        gmailMessageId: { in: rawEmails.map((email) => email.id) },
      },
      select: { gmailMessageId: true },
    });
    const existingMessageIdSet = new Set(
      existingInBatch.map((item) => item.gmailMessageId)
    );

    // 2. Extract data with AI for every fetched email
    const results = await mapWithConcurrency(
      rawEmails,
      SYNC_PROCESS_CONCURRENCY,
      async (email): Promise<SyncProcessResult> => {
        try {
          const senderPlatform = detectPlatform(email.from);
          const classification = classifyJobEmail(
            email.from,
            email.subject,
            email.body
          );

          if (!classification.shouldProcess) {
            if (existingMessageIdSet.has(email.id)) {
              await prisma.jobApplication.deleteMany({
                where: { userId, gmailMessageId: email.id },
              });
            }

            return {
              created: false,
              saved: false,
              skippedNotJob: true,
              failed: false,
            };
          }

          const extracted = await extractJobData(
            email.subject,
            email.body,
            senderPlatform,
            email.from
          );
          const hasMeaningfulExtraction =
            isMeaningfulValue(extracted.company) ||
            isMeaningfulValue(extracted.role);
          const shouldPersist =
            classification.isHighConfidence ||
            (extracted.isJobRelated && hasMeaningfulExtraction);

          if (!shouldPersist) {
            if (existingMessageIdSet.has(email.id)) {
              await prisma.jobApplication.deleteMany({
                where: { userId, gmailMessageId: email.id },
              });
            }

            return {
              created: false,
              saved: false,
              skippedNotJob: true,
              failed: false,
            };
          }

          const updateData: {
            status: string;
            interviewRound: string | null;
            company?: string;
            role?: string;
            platform?: string | null;
            dateApplied?: Date;
            emailSubject?: string;
            emailDate?: Date;
            rawExtraction: Prisma.InputJsonValue;
          } = {
            status: extracted.status,
            interviewRound: extracted.interviewRound,
            rawExtraction: {
              extracted,
              classifier: classification,
            } as unknown as Prisma.InputJsonValue,
            emailSubject: email.subject,
            emailDate: safeDate(email.date),
          };

          if (isMeaningfulValue(extracted.company)) {
            updateData.company = extracted.company.trim();
          }
          if (isMeaningfulValue(extracted.role)) {
            updateData.role = extracted.role.trim();
          }
          if (extracted.platform) {
            updateData.platform = extracted.platform;
          }
          if (extracted.dateApplied) {
            updateData.dateApplied = new Date(extracted.dateApplied);
          }

          await prisma.jobApplication.upsert({
            where: { gmailMessageId: email.id },
            update: updateData,
            create: {
              userId,
              gmailMessageId: email.id,
              company: extracted.company,
              role: extracted.role,
              dateApplied: extracted.dateApplied
                ? new Date(extracted.dateApplied)
                : null,
              status: extracted.status,
              interviewRound: extracted.interviewRound,
              platform: extracted.platform,
              emailSubject: email.subject,
              emailDate: safeDate(email.date),
              rawExtraction: {
                extracted,
                classifier: classification,
              } as unknown as Prisma.InputJsonValue,
            },
          });

          return {
            created: !existingMessageIdSet.has(email.id),
            saved: true,
            skippedNotJob: false,
            failed: false,
          };
        } catch (err) {
          console.error(`Failed to process email ${email.id}:`, err);
          return {
            created: false,
            saved: false,
            skippedNotJob: false,
            failed: true,
          };
        }
      }
    );

    const newApplications = results.filter((r) => r.created).length;
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
      skippedNotJob,
      failed,
      scanned: rawEmails.length,
      filtered: rawEmails.length - skippedNotJob,
      syncDurationMs,
    });
  } catch (error) {
    console.error("Sync failed:", error);
    return NextResponse.json(
      { error: "Sync failed. Please try again." },
      { status: 500 }
    );
  }
}
