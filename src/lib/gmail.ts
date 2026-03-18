import { google } from "googleapis";
import { prisma } from "@/lib/prisma";
import { isNeedsReviewApplicationRecord } from "@/lib/application-quality";

interface GmailMessage {
  id: string;
  subject: string;
  from: string;
  date: string;
  body: string;
}

interface GmailHeader {
  name?: string | null;
  value?: string | null;
}

interface GmailMessageRef {
  id?: string | null;
}

interface GmailPayload {
  mimeType?: string | null;
  body?: {
    data?: string | null;
  } | null;
  parts?: GmailPayload[] | null;
  headers?: GmailHeader[] | null;
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

      if (currentIndex >= items.length) {
        break;
      }

      results[currentIndex] = await worker(items[currentIndex]);
    }
  }

  const workerCount = Math.min(Math.max(concurrency, 1), items.length);
  await Promise.all(Array.from({ length: workerCount }, () => runner()));

  return results;
}

/**
 * Get an authenticated Gmail client for a user
 */
async function getGmailClient(userId: string) {
  const account = await prisma.account.findFirst({
    where: { userId, provider: "google" },
  });

  if (!account?.access_token) {
    throw new Error("No Google account found for user");
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );

  oauth2Client.setCredentials({
    access_token: account.access_token,
    refresh_token: account.refresh_token,
  });

  // Handle token refresh
  oauth2Client.on("tokens", async (tokens) => {
    if (tokens.access_token) {
      await prisma.account.update({
        where: { id: account.id },
        data: {
          access_token: tokens.access_token,
          expires_at: tokens.expiry_date
            ? Math.floor(tokens.expiry_date / 1000)
            : undefined,
        },
      });
    }
  });

  return google.gmail({ version: "v1", auth: oauth2Client });
}

/**
 * Build the Gmail search query for job-related emails
 */
function buildSearchQuery(sinceDate?: Date): string {
  const platformDomains = [
    "linkedin.com",
    "naukri.com",
    "indeed.com",
    "glassdoor.com",
    "wellfound.com",
    "lever.co",
    "greenhouse.io",
    "workday.com",
    "smartrecruiters.com",
    "icims.com",
    "myworkday.com",
    "bamboohr.com",
    "jazz.co",
    "recruitee.com",
    "breezy.hr",
    "hire.lever.co",
    "boards.greenhouse.io",
    "hackerrank.com",
    "codesignal.com",
    "codility.com",
    "hackerearth.com",
    "testgorilla.com",
    "coderbyte.com",
  ];

  const subjectKeywords = [
    "application received",
    "application update",
    "application submitted",
    "application confirmation",
    "thank you for applying",
    "thank you for your application",
    "interview scheduled",
    "interview invitation",
    "schedule your interview",
    "invite you to interview",
    "offer letter",
    "we received your application",
    "regret to inform",
    "your candidacy",
    "assessment",
    "online assessment",
    "complete your assessment",
    "coding challenge",
    "phone screen",
    "not moving forward",
    "candidate portal",
    "candidate home",
    "your application for",
    "you applied for",
  ];

  const careerSenderKeywords = [
    "careers",
    "recruiting",
    "talent",
    "hiring",
    "candidate",
    "applicant",
  ];

  const excludedSubjectKeywords = [
    "job alert",
    "recommended jobs",
    "jobs for you",
    "new jobs matching",
     "jobs like this",
     "job recommendations",
     "matched jobs",
     "based on your profile",
    "newsletter",
    "career advice",
    "resume tips",
    "interview tips",
    "daily job digest",
    "weekly job digest",
    "top jobs",
    "featured jobs",
     "recommended for you",
     "discover jobs",
  ];

  const fromClause = platformDomains.map((d) => `from:${d}`).join(" OR ");
  const careerSenderClause = careerSenderKeywords
    .map((k) => `from:${k}`)
    .join(" OR ");
  const subjectClause = subjectKeywords
    .map((k) => `subject:"${k}"`)
    .join(" OR ");

  const exclusionClause = [
    "-category:promotions",
    "-category:social",
     "-category:updates",
     "-category:forums",
    ...excludedSubjectKeywords.map((k) => `-subject:"${k}"`),
  ].join(" ");

  let query = `(${fromClause} OR ${careerSenderClause} OR ${subjectClause}) ${exclusionClause}`;

  if (sinceDate) {
    const dateStr = `${sinceDate.getFullYear()}/${sinceDate.getMonth() + 1}/${sinceDate.getDate()}`;
    query += ` after:${dateStr}`;
  } else {
    query += " newer_than:90d";
  }

  return query;
}

/**
 * Extract text content from a Gmail message payload
 */
function extractBody(payload: GmailPayload | null | undefined): string {
  if (!payload) return "";

  // Simple text body
  if (payload.body?.data) {
    return Buffer.from(payload.body.data, "base64").toString("utf-8");
  }

  // Multipart message
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return Buffer.from(part.body.data, "base64").toString("utf-8");
      }
    }
    // Fallback to HTML if no plain text
    for (const part of payload.parts) {
      if (part.mimeType === "text/html" && part.body?.data) {
        const html = Buffer.from(part.body.data, "base64").toString("utf-8");
        return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
      }
    }
    // Recurse into nested parts
    for (const part of payload.parts) {
      const nested = extractBody(part);
      if (nested) return nested;
    }
  }

  return "";
}

/**
 * Get header value from a Gmail message
 */
function getHeader(headers: GmailHeader[] | null | undefined, name: string): string {
  const header = headers?.find(
    (h) => (h.name || "").toLowerCase() === name.toLowerCase()
  );
  return header?.value || "";
}

/**
 * Fetch job-related emails from Gmail
 */
export async function fetchJobEmails(
  userId: string,
  sinceDate?: Date
): Promise<GmailMessage[]> {
  const gmail = await getGmailClient(userId);
  const query = buildSearchQuery(sinceDate);

  // Skip already-processed messages unless prior extraction looked incomplete.
  const existingApps = await prisma.jobApplication.findMany({
    where: { userId },
    select: {
      gmailMessageId: true,
      company: true,
      role: true,
      emailSubject: true,
      platform: true,
    },
  });
  const existingIdSet = new Set(existingApps.map((e) => e.gmailMessageId));
  const reprocessIdSet = new Set(
    existingApps
      .filter((app) => isNeedsReviewApplicationRecord(app))
      .map((app) => app.gmailMessageId)
  );

  const messages: GmailMessage[] = [];
  let pageToken: string | undefined;

  // Paginate through results (higher cap for 3-month backfill syncs).
  let totalFetched = 0;
  const MAX_EMAILS = 300;
  const FETCH_CONCURRENCY = 8;

  do {
    const listResponse = await gmail.users.messages.list({
      userId: "me",
      q: query,
      maxResults: 50,
      pageToken,
    });

    const messageIds = (listResponse.data.messages || []) as GmailMessageRef[];
    pageToken = listResponse.data.nextPageToken || undefined;

    const remainingSlots = Math.max(MAX_EMAILS - totalFetched, 0);
    const messageRefs = messageIds
      .filter((msg) => msg.id)
      .filter(
        (msg) =>
          !existingIdSet.has(msg.id as string) ||
          reprocessIdSet.has(msg.id as string)
      )
      .slice(0, remainingSlots);

    const fetchedBatch = await mapWithConcurrency(
      messageRefs,
      FETCH_CONCURRENCY,
      async (msg): Promise<GmailMessage | null> => {
        if (!msg.id) return null;

        try {
          const full = await gmail.users.messages.get({
            userId: "me",
            id: msg.id,
            format: "full",
          });

          const payload = full.data.payload as GmailPayload | undefined;
          const headers = payload?.headers || [];
          const subject = getHeader(headers, "Subject");
          const from = getHeader(headers, "From");
          const date = getHeader(headers, "Date");
          const body = extractBody(payload);

          return {
            id: msg.id,
            subject,
            from,
            date,
            body: body.substring(0, 2000),
          };
        } catch (err) {
          console.error(`Failed to fetch message ${msg.id}:`, err);
          return null;
        }
      }
    );

    for (const item of fetchedBatch) {
      if (!item) continue;
      messages.push(item);
      totalFetched++;
    }
  } while (pageToken && totalFetched < MAX_EMAILS);

  return messages;
}
