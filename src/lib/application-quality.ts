export interface ApplicationQualityInput {
  company?: string | null;
  role?: string | null;
  emailSubject?: string | null;
  platform?: string | null;
}

const PLACEHOLDER_VALUES = new Set([
  "",
  "unknown",
  "unknown company",
  "unknown role",
  "n/a",
  "na",
  "none",
  "null",
]);

const EMBEDDED_WORKFLOW_PATTERNS = [
  "application received",
  "thank you for applying",
  "thank you for your application",
  "we received your application",
  "application update",
  "application confirmation",
  "application submitted",
  "candidate home",
  "candidate portal",
  "we wanted to let you know",
  "for the time and effort",
];

const PROMOTIONAL_NOISE_PATTERNS = [
  "job alert",
  "recommended jobs",
  "jobs for you",
  "new jobs matching",
  "newsletter",
  "webinar",
  "podcast",
  "live:",
  "is live",
  "watch now",
  "started streaming",
  "new video",
  "premiere",
  "episode",
];

export function normalizeApplicationValue(
  value: string | null | undefined
): string {
  return (value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function isPlaceholderApplicationValue(
  value: string | null | undefined
): boolean {
  return PLACEHOLDER_VALUES.has(normalizeApplicationValue(value));
}

export function containsWorkflowCopy(
  value: string | null | undefined
): boolean {
  const normalized = normalizeApplicationValue(value);
  return EMBEDDED_WORKFLOW_PATTERNS.some((pattern) =>
    normalized.includes(pattern)
  );
}

export function containsPromotionalNoise(
  value: string | null | undefined
): boolean {
  const normalized = normalizeApplicationValue(value);
  return PROMOTIONAL_NOISE_PATTERNS.some((pattern) =>
    normalized.includes(pattern)
  );
}

export function isSuspiciousApplicationValue(
  value: string | null | undefined
): boolean {
  const normalized = normalizeApplicationValue(value);

  if (isPlaceholderApplicationValue(normalized)) {
    return true;
  }

  if (normalized.length > 140) {
    return true;
  }

  return (
    containsWorkflowCopy(normalized) || containsPromotionalNoise(normalized)
  );
}

export function isMeaningfulApplicationValue(
  value: string | null | undefined
): boolean {
  return !isSuspiciousApplicationValue(value);
}

export function isNeedsReviewApplicationRecord(
  record: ApplicationQualityInput
): boolean {
  const normalizedCompany = normalizeApplicationValue(record.company);
  const normalizedRole = normalizeApplicationValue(record.role);
  const normalizedSubject = normalizeApplicationValue(record.emailSubject);
  const hasPlatform = Boolean(record.platform?.trim());
  const unknownCompany = isPlaceholderApplicationValue(normalizedCompany);
  const unknownRole = isPlaceholderApplicationValue(normalizedRole);
  const roleMatchesSubject =
    Boolean(normalizedRole) &&
    Boolean(normalizedSubject) &&
    normalizedRole === normalizedSubject;

  return (
    isSuspiciousApplicationValue(normalizedCompany) ||
    isSuspiciousApplicationValue(normalizedRole) ||
    containsPromotionalNoise(normalizedSubject) ||
    unknownCompany ||
    unknownRole ||
    (unknownCompany && roleMatchesSubject) ||
    (!hasPlatform && unknownCompany)
  );
}
