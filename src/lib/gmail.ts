import { google } from "googleapis";
import { prisma } from "@/lib/prisma";

export interface GmailLink {
  href: string;
  text: string | null;
}

export interface GmailImage {
  mimeType: string | null;
  filename: string | null;
  contentId: string | null;
  contentDisposition: string | null;
  dataUrl: string | null;
  sourceUrl: string | null;
  alt: string | null;
  width: number | null;
  height: number | null;
  size: number | null;
  isInline: boolean;
}

export interface GmailMessage {
  id: string;
  subject: string;
  from: string;
  date: string;
  textBody: string;
  htmlBody: string;
  links: GmailLink[];
  images: GmailImage[];
}

interface GmailHeader {
  name?: string | null;
  value?: string | null;
}

interface GmailMessageRef {
  id?: string | null;
}

interface GmailPayloadBody {
  data?: string | null;
  attachmentId?: string | null;
  size?: number | null;
}

interface GmailPayload {
  mimeType?: string | null;
  filename?: string | null;
  body?: GmailPayloadBody | null;
  parts?: GmailPayload[] | null;
  headers?: GmailHeader[] | null;
}

interface HtmlImageReference {
  src: string;
  alt: string | null;
  width: number | null;
  height: number | null;
}

const MAX_EMAILS = 300;
const FETCH_CONCURRENCY = 8;
const MAX_TEXT_CONTEXT_CHARS = 12_000;
const MAX_REMOTE_LINKS = 20;
const MAX_IMAGE_HINTS = 12;

interface FetchJobEmailsOptions {
  sinceDate?: Date;
  excludeMessageIds?: Set<string>;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
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

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function decodeBase64UrlToBuffer(value: string): Buffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64");
}

function getHeader(headers: GmailHeader[] | null | undefined, name: string): string {
  const header = headers?.find(
    (item) => (item.name || "").toLowerCase() === name.toLowerCase(),
  );
  return header?.value || "";
}

function normalizeContentId(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.replace(/[<>]/g, "").trim().toLowerCase() || null;
}

function stripHtml(html: string): string {
  const cleaned = html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<\/(p|div|li|tr|table|section|article|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");

  return decodeHtmlEntities(cleaned)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[^\S\r\n]{2,}/g, " ")
    .trim();
}

function getAttribute(tag: string, attribute: string): string | null {
  const match = tag.match(
    new RegExp(`${attribute}\\s*=\\s*["']([^"']+)["']`, "i"),
  );
  return match?.[1] || null;
}

function parseDimension(value: string | null): number | null {
  if (!value) return null;
  const match = value.match(/\d+/);
  if (!match) return null;
  const parsed = Number.parseInt(match[0], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveUrl(url: string, baseDomain: string | null): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("cid:")) {
    return trimmed;
  }

  if (trimmed.startsWith("//")) {
    return `https:${trimmed}`;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  if (!baseDomain) return null;

  try {
    return new URL(trimmed, `https://${baseDomain}`).toString();
  } catch {
    return null;
  }
}

function extractSenderDomain(from: string): string | null {
  const emailMatch =
    from.match(/<([^>]+)>/) ||
    from.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const email = emailMatch?.[1] || emailMatch?.[0] || "";
  const domain = email.split("@")[1]?.toLowerCase() || "";
  return domain || null;
}

function extractHtmlLinks(html: string, baseDomain: string | null): GmailLink[] {
  const links: GmailLink[] = [];
  const regex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(regex)) {
    const href = resolveUrl(match[1] || "", baseDomain);
    if (!href) continue;

    const text = normalizeWhitespace(stripHtml(match[2] || "")) || null;
    links.push({ href, text });
  }

  return links.slice(0, MAX_REMOTE_LINKS);
}

function extractTextLinks(text: string): GmailLink[] {
  const matches = text.match(/https?:\/\/[^\s<>"')]+/gi) || [];
  return matches.slice(0, MAX_REMOTE_LINKS).map((href) => ({ href, text: null }));
}

function extractHtmlImages(html: string, baseDomain: string | null): HtmlImageReference[] {
  const images: HtmlImageReference[] = [];
  const regex = /<img\b[^>]*>/gi;

  for (const match of html.matchAll(regex)) {
    const tag = match[0] || "";
    const src = resolveUrl(getAttribute(tag, "src") || "", baseDomain);
    if (!src) continue;

    images.push({
      src,
      alt: normalizeWhitespace(decodeHtmlEntities(getAttribute(tag, "alt") || "")) || null,
      width: parseDimension(getAttribute(tag, "width")),
      height: parseDimension(getAttribute(tag, "height")),
    });
  }

  return images;
}

function replaceCidSources(html: string, images: GmailImage[]): string {
  let resolvedHtml = html;

  for (const image of images) {
    if (!image.dataUrl || !image.contentId) continue;

    const cidPattern = new RegExp(`cid:${image.contentId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "gi");
    resolvedHtml = resolvedHtml.replace(cidPattern, image.dataUrl);
  }

  return resolvedHtml;
}

function buildRemoteImage(
  reference: HtmlImageReference,
  sourceUrl: string,
): GmailImage {
  return {
    mimeType: null,
    filename: null,
    contentId: null,
    contentDisposition: null,
    dataUrl: null,
    sourceUrl,
    alt: reference.alt,
    width: reference.width,
    height: reference.height,
    size: null,
    isInline: false,
  };
}

async function getAttachmentBuffer(
  gmail: ReturnType<typeof google.gmail>,
  messageId: string,
  attachmentId: string,
): Promise<Buffer | null> {
  try {
    const response = await gmail.users.messages.attachments.get({
      userId: "me",
      messageId,
      id: attachmentId,
    });

    if (!response.data.data) return null;
    return decodeBase64UrlToBuffer(response.data.data);
  } catch (error) {
    console.error(`Failed to fetch attachment ${attachmentId}:`, error);
    return null;
  }
}

async function readPartBuffer(
  gmail: ReturnType<typeof google.gmail>,
  messageId: string,
  body: GmailPayloadBody | null | undefined,
): Promise<Buffer | null> {
  if (!body) return null;
  if (body.data) return decodeBase64UrlToBuffer(body.data);
  if (body.attachmentId) {
    return getAttachmentBuffer(gmail, messageId, body.attachmentId);
  }
  return null;
}

async function collectPayloadParts(
  gmail: ReturnType<typeof google.gmail>,
  messageId: string,
  payload: GmailPayload | null | undefined,
): Promise<{
  textParts: string[];
  htmlParts: string[];
  inlineImages: GmailImage[];
}> {
  const textParts: string[] = [];
  const htmlParts: string[] = [];
  const inlineImages: GmailImage[] = [];

  async function visit(part: GmailPayload | null | undefined): Promise<void> {
    if (!part) return;

    const mimeType = (part.mimeType || "").toLowerCase();
    const body = part.body;

    if (part.parts?.length) {
      for (const child of part.parts) {
        await visit(child);
      }
    }

    if (mimeType === "text/plain") {
      const buffer = await readPartBuffer(gmail, messageId, body);
      const text = buffer?.toString("utf-8").trim();
      if (text) textParts.push(text);
      return;
    }

    if (mimeType === "text/html") {
      const buffer = await readPartBuffer(gmail, messageId, body);
      const html = buffer?.toString("utf-8").trim();
      if (html) htmlParts.push(html);
      return;
    }

    if (mimeType.startsWith("image/")) {
      const buffer = await readPartBuffer(gmail, messageId, body);
      const size = body?.size || buffer?.length || null;

      inlineImages.push({
        mimeType: mimeType || null,
        filename: part.filename || null,
        contentId: normalizeContentId(getHeader(part.headers, "Content-Id")),
        contentDisposition: getHeader(part.headers, "Content-Disposition") || null,
        dataUrl:
          buffer && size !== null && size <= 150 * 1024
            ? `data:${mimeType};base64,${buffer.toString("base64")}`
            : null,
        sourceUrl: null,
        alt: null,
        width: null,
        height: null,
        size,
        isInline:
          (getHeader(part.headers, "Content-Disposition") || "")
            .toLowerCase()
            .includes("inline") || Boolean(getHeader(part.headers, "Content-Id")),
      });
    }
  }

  await visit(payload);

  return { textParts, htmlParts, inlineImages };
}

function dedupeLinks(links: GmailLink[]): GmailLink[] {
  const seen = new Set<string>();
  const deduped: GmailLink[] = [];

  for (const link of links) {
    const key = `${link.href}|${link.text || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(link);
  }

  return deduped.slice(0, MAX_REMOTE_LINKS);
}

function dedupeImages(images: GmailImage[]): GmailImage[] {
  const seen = new Set<string>();
  const deduped: GmailImage[] = [];

  for (const image of images) {
    const key = [
      image.contentId || "",
      image.sourceUrl || "",
      image.filename || "",
      image.alt || "",
      image.mimeType || "",
    ].join("|");

    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(image);
  }

  return deduped.slice(0, MAX_IMAGE_HINTS);
}

function mergeImages(
  inlineImages: GmailImage[],
  htmlImageReferences: HtmlImageReference[],
): GmailImage[] {
  const byContentId = new Map<string, GmailImage>();

  for (const image of inlineImages) {
    if (image.contentId) {
      byContentId.set(image.contentId, image);
    }
  }

  const merged: GmailImage[] = [];
  const usedInline = new Set<GmailImage>();

  for (const reference of htmlImageReferences) {
    if (reference.src.startsWith("cid:")) {
      const contentId = normalizeContentId(reference.src.replace(/^cid:/i, ""));
      const inline = contentId ? byContentId.get(contentId) : null;

      if (inline) {
        usedInline.add(inline);
        merged.push({
          ...inline,
          alt: reference.alt || inline.alt,
          width: reference.width || inline.width,
          height: reference.height || inline.height,
          sourceUrl: reference.src,
          isInline: true,
        });
      }

      continue;
    }

    merged.push(buildRemoteImage(reference, reference.src));
  }

  for (const inline of inlineImages) {
    if (!usedInline.has(inline)) {
      merged.push(inline);
    }
  }

  return dedupeImages(merged);
}

function combineTextBodies(textParts: string[], htmlText: string): string {
  const combined = textParts
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n\n");

  if (!combined) {
    return htmlText;
  }

  if (!htmlText) {
    return combined;
  }

  if (combined.includes(htmlText) || htmlText.includes(combined)) {
    return combined.length >= htmlText.length ? combined : htmlText;
  }

  return `${combined}\n\n${htmlText}`.trim();
}

function buildMessageFromPayload(
  id: string,
  subject: string,
  from: string,
  date: string,
  textBody: string,
  htmlBody: string,
  links: GmailLink[],
  images: GmailImage[],
): GmailMessage {
  return {
    id,
    subject,
    from,
    date,
    textBody,
    htmlBody,
    links,
    images,
  };
}

export function buildEmailTextContext(
  message: Pick<GmailMessage, "subject" | "textBody" | "links" | "images">,
  maxChars = MAX_TEXT_CONTEXT_CHARS,
): string {
  const linkContext = message.links
    .map((link) => [link.text, link.href].filter(Boolean).join(" -> "))
    .filter(Boolean)
    .join("\n");

  const imageContext = message.images
    .map((image) =>
      [image.alt, image.filename, image.sourceUrl, image.contentId]
        .filter(Boolean)
        .join(" | "),
    )
    .filter(Boolean)
    .join("\n");

  return normalizeWhitespace(
    [message.subject, message.textBody, linkContext, imageContext]
      .filter(Boolean)
      .join("\n\n"),
  ).slice(0, maxChars);
}

async function getGmailClient(userId: string) {
  const account = await prisma.account.findFirst({
    where: { userId, provider: "google" },
  });

  if (!account?.access_token) {
    throw new Error("No Google account found for user");
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
  );

  oauth2Client.setCredentials({
    access_token: account.access_token,
    refresh_token: account.refresh_token,
  });

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

  const fromClause = platformDomains.map((domain) => `from:${domain}`).join(" OR ");
  const careerSenderClause = careerSenderKeywords
    .map((keyword) => `from:${keyword}`)
    .join(" OR ");
  const subjectClause = subjectKeywords
    .map((keyword) => `subject:"${keyword}"`)
    .join(" OR ");

  const exclusionClause = [
    "-category:promotions",
    "-category:social",
    "-category:updates",
    "-category:forums",
    ...excludedSubjectKeywords.map((keyword) => `-subject:"${keyword}"`),
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

export async function fetchJobEmails(
  userId: string,
  options: FetchJobEmailsOptions = {},
): Promise<GmailMessage[]> {
  const { sinceDate, excludeMessageIds } = options;
  const gmail = await getGmailClient(userId);
  const query = buildSearchQuery(sinceDate);

  const messages: GmailMessage[] = [];
  let pageToken: string | undefined;
  let totalFetched = 0;

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
      .filter((message) => message.id)
      .filter((message) =>
        excludeMessageIds ? !excludeMessageIds.has(message.id as string) : true,
      )
      .slice(0, remainingSlots);

    const fetchedBatch = await mapWithConcurrency(
      messageRefs,
      FETCH_CONCURRENCY,
      async (message): Promise<GmailMessage | null> => {
        if (!message.id) return null;

        try {
          const full = await gmail.users.messages.get({
            userId: "me",
            id: message.id,
            format: "full",
          });

          const payload = full.data.payload as GmailPayload | undefined;
          const headers = payload?.headers || [];
          const subject = getHeader(headers, "Subject");
          const from = getHeader(headers, "From");
          const date = getHeader(headers, "Date");

          const { textParts, htmlParts, inlineImages } = await collectPayloadParts(
            gmail,
            message.id,
            payload,
          );

          const rawHtml = htmlParts.join("\n\n").trim();
          const baseDomain = extractSenderDomain(from);
          const htmlImageRefs = extractHtmlImages(rawHtml, baseDomain);
          const mergedImages = mergeImages(inlineImages, htmlImageRefs);
          const resolvedHtml = replaceCidSources(rawHtml, mergedImages);
          const htmlText = stripHtml(resolvedHtml);
          const textBody = combineTextBodies(textParts, htmlText);

          const links = dedupeLinks([
            ...extractHtmlLinks(resolvedHtml, baseDomain),
            ...extractTextLinks(textBody),
          ]);

          return buildMessageFromPayload(
            message.id,
            subject,
            from,
            date,
            textBody,
            resolvedHtml,
            links,
            mergedImages,
          );
        } catch (error) {
          console.error(`Failed to fetch message ${message.id}:`, error);
          return null;
        }
      },
    );

    for (const item of fetchedBatch) {
      if (!item) continue;
      messages.push(item);
      totalFetched += 1;
    }
  } while (pageToken && totalFetched < MAX_EMAILS);

  return messages;
}
