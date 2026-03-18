interface EmailData {
  id: string;
  subject: string;
  from: string;
  date: string;
  body: string;
}

const JOB_PLATFORM_DOMAINS = [
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
  "hackerrank.com",
  "codesignal.com",
  "codility.com",
  "hackerearth.com",
  "testgorilla.com",
  "coderbyte.com",
];

const CAREER_SITE_DOMAIN_HINTS = [
  "careers.",
  ".careers",
  "jobs.",
  ".jobs",
  "myworkdayjobs",
  "workdayjobs",
  "workday",
  "greenhouse",
  "lever",
  "recruitee",
  "smartrecruiters",
  "icims",
  "jobvite",
  "ashbyhq",
  "bamboohr",
  "talent",
  "recruit",
];

const STRONG_JOB_KEYWORDS = [
  "application received",
  "we received your application",
  "your application has been submitted",
  "submitted your application",
  "thank you for applying",
  "thank you for your application",
  "application update",
  "application confirmation",
  "interview scheduled",
  "interview invitation",
  "invite you to interview",
  "schedule your interview",
  "online assessment",
  "complete your assessment",
  "coding challenge",
  "phone screen",
  "next round",
  "offer letter",
  "pleased to offer",
  "regret to inform",
  "not moving forward",
  "your candidacy",
  "application status",
  "move forward",
  "candidate home",
  "candidate portal",
];

const WEAK_JOB_KEYWORDS = [
  "application",
  "interview",
  "assessment",
  "shortlisted",
  "offer",
  "candidacy",
  "next steps",
  "phone screen",
  "coding challenge",
  "thank you for applying",
  "application submitted",
];

const LIFECYCLE_SIGNAL_PATTERNS = [
  "received your application",
  "application received",
  "application submitted",
  "submitted your application",
  "thank you for applying",
  "application update",
  "your application for",
  "interview",
  "assessment",
  "schedule your interview",
  "complete your assessment",
  "offer",
  "regret to inform",
  "not moving forward",
  "candidacy",
  "next steps",
];

const HIGH_CONFIDENCE_LIFECYCLE_PATTERNS = [
  "application received",
  "we received your application",
  "your application has been submitted",
  "submitted your application",
  "thank you for applying",
  "thank you for your application",
  "application confirmation",
  "interview scheduled",
  "interview invitation",
  "invite you to interview",
  "schedule your interview",
  "online assessment",
  "complete your assessment",
  "coding challenge",
  "phone screen",
  "offer letter",
  "pleased to offer",
  "regret to inform",
  "not moving forward",
  "your candidacy",
  "candidate home",
  "candidate portal",
];

const REJECTION_PATTERNS = [
  "unsubscribe from job alerts",
  "job alert digest",
  "new jobs matching",
  "jobs you might be interested",
  "similar jobs",
  "recommended jobs",
  "daily job digest",
  "weekly job digest",
  "job recommendations",
  "jobs for you",
  "career advice",
  "resume tips",
  "interview tips",
  "newsletter",
  "sponsored",
  "people viewed your profile",
  "connection request",
  "inmail",
  "premium",
  "top jobs",
  "featured jobs",
  "recommended for you",
  "discover jobs",
  "jobs like this",
  "based on your profile",
  "matched jobs",
];

const RECRUITING_SENDER_HINTS = [
  "careers@",
  "jobs@",
  "recruiting@",
  "recruiter@",
  "talent@",
  "hiring@",
  "candidate@",
  "applicant@",
  "no-reply@",
  "noreply@",
];

const RECIPIENT_SPECIFIC_PATTERNS = [
  "your application",
  "we received your application",
  "your application has been submitted",
  "thank you for applying",
  "thank you for your application",
  "you applied for",
  "your candidacy",
  "candidate portal",
  "candidate home",
  "schedule your interview",
  "interview invitation",
  "interview scheduled",
  "invite you to interview",
  "complete your assessment",
  "online assessment",
  "phone screen",
  "offer letter",
  "pleased to offer",
  "regret to inform",
  "not moving forward",
];

const LIVE_EVENT_NOISE_PATTERNS = [
  "live:",
  "is live",
  "going live",
  "started streaming",
  "watch now",
  "new video",
  "premiere",
  "webinar",
  "podcast",
  "masterclass",
  "livestream",
  "streaming now",
];

const BLOCKED_SENDER_DOMAINS = [
  "youtube.com",
  "substack.com",
  "medium.com",
  "eventbrite.com",
  "meetup.com",
];

export interface JobEmailClassification {
  shouldProcess: boolean;
  isHighConfidence: boolean;
  hasTrustedSender: boolean;
  hasLifecycleSignal: boolean;
  hasRecipientContext: boolean;
  positives: string[];
  negatives: string[];
}

function normalizeText(subject: string, body: string): string {
  return `${subject} ${body.slice(0, 1200)}`.toLowerCase();
}

function extractDomain(fromField: string): string {
  const emailMatch =
    fromField.match(/<([^>]+)>/) || fromField.match(/[\w.-]+@([\w.-]+)/);

  if (emailMatch) {
    const email = emailMatch[1] || emailMatch[0];
    const parts = email.split("@");
    return parts[parts.length - 1].toLowerCase();
  }

  return "";
}

function isFromJobPlatform(from: string): boolean {
  const domain = extractDomain(from);
  return JOB_PLATFORM_DOMAINS.some(
    (platformDomain) =>
      domain === platformDomain || domain.endsWith(`.${platformDomain}`)
  );
}

function isCareerSiteSender(from: string): boolean {
  const domain = extractDomain(from);
  if (!domain) return false;

  const lowerFrom = from.toLowerCase();
  return CAREER_SITE_DOMAIN_HINTS.some(
    (hint) => domain.includes(hint) || lowerFrom.includes(hint)
  );
}

function isBlockedSender(from: string): boolean {
  const domain = extractDomain(from);
  return BLOCKED_SENDER_DOMAINS.some(
    (blockedDomain) =>
      domain === blockedDomain || domain.endsWith(`.${blockedDomain}`)
  );
}

function hasRecruitingSenderHint(from: string): boolean {
  const lowerFrom = from.toLowerCase();
  return RECRUITING_SENDER_HINTS.some((hint) => lowerFrom.includes(hint));
}

function hasStrongJobKeywords(subject: string, body: string): boolean {
  const text = normalizeText(subject, body);
  return STRONG_JOB_KEYWORDS.some((keyword) =>
    text.includes(keyword.toLowerCase())
  );
}

function hasWeakJobKeywords(subject: string, body: string): boolean {
  const text = normalizeText(subject, body);
  return WEAK_JOB_KEYWORDS.some((keyword) =>
    text.includes(keyword.toLowerCase())
  );
}

function hasLifecycleSignals(subject: string, body: string): boolean {
  const text = normalizeText(subject, body);
  return LIFECYCLE_SIGNAL_PATTERNS.some((pattern) =>
    text.includes(pattern.toLowerCase())
  );
}

function hasRecipientSpecificContext(subject: string, body: string): boolean {
  const text = normalizeText(subject, body);
  return RECIPIENT_SPECIFIC_PATTERNS.some((pattern) =>
    text.includes(pattern.toLowerCase())
  );
}

function hasLiveEventNoise(subject: string, body: string): boolean {
  const text = normalizeText(subject, body);
  return LIVE_EVENT_NOISE_PATTERNS.some((pattern) =>
    text.includes(pattern.toLowerCase())
  );
}

function isJobAlertDigest(subject: string, body: string): boolean {
  const text = normalizeText(subject, body);
  return REJECTION_PATTERNS.some((pattern) =>
    text.includes(pattern.toLowerCase())
  );
}

export function isPromotionalOrDigestEmail(
  subject: string,
  body: string
): boolean {
  return isJobAlertDigest(subject, body) || hasLiveEventNoise(subject, body);
}

export function hasHighConfidenceLifecycleSignal(
  subject: string,
  body: string
): boolean {
  const text = normalizeText(subject, body);
  return HIGH_CONFIDENCE_LIFECYCLE_PATTERNS.some((pattern) =>
    text.includes(pattern)
  );
}

export function classifyJobEmail(
  from: string,
  subject: string,
  body: string
): JobEmailClassification {
  const positives: string[] = [];
  const negatives: string[] = [];

  const fromPlatform = isFromJobPlatform(from);
  const fromCareerSite = isCareerSiteSender(from);
  const recruitingSender = hasRecruitingSenderHint(from);
  const blockedSender = isBlockedSender(from);
  const promotionalOrDigest = isJobAlertDigest(subject, body);
  const liveEventNoise = hasLiveEventNoise(subject, body);
  const highConfidenceLifecycle = hasHighConfidenceLifecycleSignal(
    subject,
    body
  );
  const lifecycleSignal = hasLifecycleSignals(subject, body);
  const recipientContext = hasRecipientSpecificContext(subject, body);
  const strongKeywords = hasStrongJobKeywords(subject, body);
  const weakKeywords = hasWeakJobKeywords(subject, body);

  if (fromPlatform) positives.push("known-platform-sender");
  if (fromCareerSite) positives.push("career-site-sender");
  if (recruitingSender) positives.push("recruiting-mailbox");
  if (highConfidenceLifecycle) positives.push("high-confidence-lifecycle");
  if (recipientContext) positives.push("recipient-specific-context");
  if (strongKeywords) positives.push("strong-keyword-match");

  if (blockedSender) negatives.push("blocked-sender-domain");
  if (promotionalOrDigest) negatives.push("promotional-or-digest");
  if (liveEventNoise && !highConfidenceLifecycle) {
    negatives.push("live-event-noise");
  }

  const hasTrustedSender = fromPlatform || fromCareerSite || recruitingSender;
  const shouldReject =
    blockedSender || promotionalOrDigest || (liveEventNoise && !recipientContext);

  const shouldProcess =
    !shouldReject &&
    (highConfidenceLifecycle ||
      (hasTrustedSender && recipientContext) ||
      (hasTrustedSender && lifecycleSignal && strongKeywords) ||
      (hasTrustedSender && lifecycleSignal && weakKeywords && recipientContext));

  const isHighConfidence =
    shouldProcess &&
    (highConfidenceLifecycle ||
      ((fromPlatform || fromCareerSite) && recipientContext && lifecycleSignal));

  return {
    shouldProcess,
    isHighConfidence,
    hasTrustedSender,
    hasLifecycleSignal: lifecycleSignal || highConfidenceLifecycle,
    hasRecipientContext: recipientContext,
    positives,
    negatives,
  };
}

export function detectPlatform(from: string): string | null {
  const domain = extractDomain(from);
  if (domain.includes("linkedin")) return "LinkedIn";
  if (domain.includes("naukri")) return "Naukri";
  if (domain.includes("indeed")) return "Indeed";
  if (domain.includes("glassdoor")) return "Glassdoor";
  if (domain.includes("wellfound")) return "Wellfound";
  if (domain.includes("lever")) return "Lever";
  if (domain.includes("greenhouse")) return "Greenhouse";
  if (domain.includes("workday")) return "Workday";
  if (domain.includes("smartrecruiters")) return "SmartRecruiters";
  if (domain.includes("icims")) return "iCIMS";
  if (domain.includes("hackerrank")) return "HackerRank";
  if (domain.includes("codesignal")) return "CodeSignal";
  if (domain.includes("codility")) return "Codility";
  if (domain.includes("hackerearth")) return "HackerEarth";
  if (domain.includes("testgorilla")) return "TestGorilla";
  if (domain.includes("coderbyte")) return "Coderbyte";
  if (isCareerSiteSender(from)) return "Career Site";
  return null;
}

export function filterJobEmails(emails: EmailData[]): EmailData[] {
  return emails.filter((email) =>
    classifyJobEmail(email.from, email.subject, email.body).shouldProcess
  );
}
