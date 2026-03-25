import type { GmailImage, GmailLink } from "@/lib/gmail";

const MAX_INLINE_LOGO_BYTES = 150 * 1024;

const PUBLIC_MAIL_PROVIDERS = new Set([
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "protonmail.com",
  "aol.com",
]);

const GENERIC_PLATFORM_HOST_HINTS = [
  "linkedin.com",
  "naukri.com",
  "indeed.com",
  "glassdoor.com",
  "wellfound.com",
  "lever.co",
  "greenhouse.io",
  "workday.com",
  "myworkday.com",
  "smartrecruiters.com",
  "icims.com",
  "bamboohr.com",
  "jazz.co",
  "recruitee.com",
  "breezy.hr",
  "hackerrank.com",
  "codesignal.com",
  "codility.com",
  "hackerearth.com",
  "testgorilla.com",
  "coderbyte.com",
];

const REJECT_IMAGE_HINTS = [
  "facebook",
  "twitter",
  "instagram",
  "linkedin",
  "youtube",
  "tiktok",
  "spacer",
  "pixel",
  "tracking",
  "avatar",
  "playstore",
  "appstore",
  "android",
  "ios",
  "social",
];

const LOW_VALUE_IMAGE_HINTS = [
  "banner",
  "hero",
  "header",
  "background",
  "gradient",
  "illustration",
  "marketing",
];

export type CompanyLogoSource =
  | "inline-email"
  | "remote-email"
  | "domain-favicon";

export interface CompanyBrandingSelection {
  normalizedName: string;
  inferredDomain: string | null;
  logoUrl: string | null;
  logoDataUrl: string | null;
  logoSource: CompanyLogoSource | null;
  diagnostics: {
    inferredDomain: string | null;
    domainCandidates: string[];
    logoCandidates: Array<{
      label: string;
      score: number;
      accepted: boolean;
      source: "inline-email" | "remote-email";
    }>;
    selectedLogoSource: CompanyLogoSource | null;
  };
}

type EmailLogoSource = Extract<CompanyLogoSource, "inline-email" | "remote-email">;

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripDecorators(value: string): string {
  return value
    .replace(/["'`]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}\s-]+/gu, " ")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getImageLabel(image: GmailImage): string {
  return normalizeWhitespace(
    [
      image.alt,
      image.filename,
      image.contentId,
      image.sourceUrl,
      image.mimeType,
    ]
      .filter(Boolean)
      .join(" | "),
  );
}

function getDomainRoot(hostname: string): string {
  const parts = hostname.toLowerCase().split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".");

  const maybeSecondLevel = parts[parts.length - 2];
  if (["co", "com", "org", "net"].includes(maybeSecondLevel) && parts.length >= 3) {
    return parts.slice(-3).join(".");
  }

  return parts.slice(-2).join(".");
}

function isGenericPlatformHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return GENERIC_PLATFORM_HOST_HINTS.some(
    (hint) => lower === hint || lower.endsWith(`.${hint}`),
  );
}

function extractHostCandidate(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function extractSenderDomain(from: string): string | null {
  const angleMatch = from.match(/<([^>]+)>/);
  const email =
    angleMatch?.[1] ||
    from.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ||
    "";
  const domain = email.split("@")[1]?.toLowerCase() || "";
  if (!domain || PUBLIC_MAIL_PROVIDERS.has(domain)) return null;
  return domain;
}

function getCompanyTokens(companyName: string): string[] {
  return stripDecorators(companyName)
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length >= 3);
}

function buildDomainFaviconUrl(domain: string): string {
  return `https://www.google.com/s2/favicons?domain_url=https://${domain}&sz=128`;
}

function isSupportedImageType(image: GmailImage): boolean {
  const lowerMime = (image.mimeType || "").toLowerCase();
  if (lowerMime) {
    return (
      lowerMime === "image/png" ||
      lowerMime === "image/jpeg" ||
      lowerMime === "image/jpg" ||
      lowerMime === "image/webp" ||
      lowerMime === "image/svg+xml"
    );
  }

  const lowerUrl = (image.sourceUrl || image.filename || "").toLowerCase();
  return [".png", ".jpg", ".jpeg", ".webp", ".svg"].some((ext) =>
    lowerUrl.includes(ext),
  );
}

function scoreImageCandidate(
  image: GmailImage,
  companyTokens: string[],
  inferredDomain: string | null,
): { score: number; accepted: boolean } {
  const metadata = getImageLabel(image).toLowerCase();
  const width = image.width || 0;
  const height = image.height || 0;
  const size = image.size || 0;

  if (!isSupportedImageType(image)) {
    return { score: -100, accepted: false };
  }

  if (size > MAX_INLINE_LOGO_BYTES && image.dataUrl) {
    return { score: -100, accepted: false };
  }

  if ((width && width < 24) || (height && height < 24)) {
    return { score: -100, accepted: false };
  }

  if (REJECT_IMAGE_HINTS.some((hint) => metadata.includes(hint))) {
    return { score: -100, accepted: false };
  }

  let score = 0;

  if (image.isInline) score += 18;
  if (metadata.includes("logo")) score += 42;
  if (metadata.includes("brand")) score += 18;
  if (metadata.includes("wordmark")) score += 12;
  if (LOW_VALUE_IMAGE_HINTS.some((hint) => metadata.includes(hint))) score -= 18;

  if (companyTokens.some((token) => metadata.includes(token))) {
    score += 34;
  }

  const host = image.sourceUrl ? extractHostCandidate(image.sourceUrl) : null;
  if (host && inferredDomain) {
    if (host === inferredDomain || host.endsWith(`.${inferredDomain}`)) {
      score += 26;
    } else if (getDomainRoot(host) === getDomainRoot(inferredDomain)) {
      score += 20;
    }
  }

  if (width && height) {
    const area = width * height;
    const aspectRatio = Math.max(width, height) / Math.max(1, Math.min(width, height));

    if (area >= 900 && area <= 50000) score += 14;
    if (area > 140000) score -= 18;
    if (aspectRatio <= 4) score += 10;
    if (aspectRatio > 6) score -= 18;
  }

  if ((image.mimeType || "").toLowerCase() === "image/svg+xml") {
    score += 10;
  }

  const accepted =
    score >= 24 &&
    (Boolean(image.dataUrl) || Boolean(image.sourceUrl)) &&
    (!image.dataUrl || size <= MAX_INLINE_LOGO_BYTES);

  return { score, accepted };
}

export function normalizeCompanyName(companyName: string): string {
  return stripDecorators(companyName).toLowerCase();
}

export function inferCompanyDomain(
  companyName: string,
  from: string,
  links: GmailLink[],
): { inferredDomain: string | null; candidates: string[] } {
  const companyTokens = getCompanyTokens(companyName);
  const senderDomain = extractSenderDomain(from);
  const candidates = new Map<string, number>();

  const addCandidate = (hostname: string | null, score: number) => {
    if (!hostname) return;
    const normalized = hostname.toLowerCase();
    if (PUBLIC_MAIL_PROVIDERS.has(normalized)) return;
    candidates.set(normalized, (candidates.get(normalized) || 0) + score);
  };

  if (senderDomain) {
    addCandidate(senderDomain, isGenericPlatformHost(senderDomain) ? 12 : 40);
  }

  for (const link of links) {
    const host = extractHostCandidate(link.href);
    if (!host) continue;

    let score = 8;
    const metadata = `${link.text || ""} ${link.href}`.toLowerCase();

    if (companyTokens.some((token) => metadata.includes(token) || host.includes(token))) {
      score += 28;
    }

    if (
      metadata.includes("career") ||
      metadata.includes("jobs") ||
      metadata.includes("application") ||
      metadata.includes("candidate") ||
      metadata.includes("action center")
    ) {
      score += 12;
    }

    if (isGenericPlatformHost(host)) {
      score -= 6;
    }

    addCandidate(host, score);
  }

  const ranked = Array.from(candidates.entries()).sort((a, b) => b[1] - a[1]);
  return {
    inferredDomain: ranked[0]?.[0] || null,
    candidates: ranked.map(([host]) => host),
  };
}

export function selectCompanyBranding(
  companyName: string,
  from: string,
  links: GmailLink[],
  images: GmailImage[],
): CompanyBrandingSelection {
  const normalizedName = normalizeCompanyName(companyName);
  const { inferredDomain, candidates } = inferCompanyDomain(companyName, from, links);
  const companyTokens = getCompanyTokens(companyName);

  const scoredCandidates = images
    .map((image) => {
      const source: EmailLogoSource = image.dataUrl
        ? "inline-email"
        : "remote-email";
      const result = scoreImageCandidate(image, companyTokens, inferredDomain);

      return {
        image,
        source,
        ...result,
        label: getImageLabel(image) || image.sourceUrl || image.filename || source,
      };
    })
    .sort((a, b) => b.score - a.score);

  const chosen = scoredCandidates.find((candidate) => candidate.accepted) || null;

  if (chosen) {
    return {
      normalizedName,
      inferredDomain,
      logoUrl: chosen.image.dataUrl ? null : chosen.image.sourceUrl,
      logoDataUrl: chosen.image.dataUrl,
      logoSource: chosen.source,
      diagnostics: {
        inferredDomain,
        domainCandidates: candidates,
        logoCandidates: scoredCandidates.map((candidate) => ({
          label: candidate.label,
          score: candidate.score,
          accepted: candidate.accepted,
          source: candidate.source,
        })),
        selectedLogoSource: chosen.source,
      },
    };
  }

  return {
    normalizedName,
    inferredDomain,
    logoUrl: inferredDomain ? buildDomainFaviconUrl(inferredDomain) : null,
    logoDataUrl: null,
    logoSource: inferredDomain ? "domain-favicon" : null,
    diagnostics: {
      inferredDomain,
      domainCandidates: candidates,
      logoCandidates: scoredCandidates.map((candidate) => ({
        label: candidate.label,
        score: candidate.score,
        accepted: candidate.accepted,
        source: candidate.source,
      })),
      selectedLogoSource: inferredDomain ? "domain-favicon" : null,
    },
  };
}
