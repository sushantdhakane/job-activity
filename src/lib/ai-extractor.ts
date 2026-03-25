import { GoogleGenerativeAI } from "@google/generative-ai";
import type { GmailMessage } from "@/lib/gmail";
import { buildEmailTextContext } from "@/lib/gmail";

export interface ExtractedJobData {
  isJobRelated: boolean;
  company: string;
  role: string | null;
  dateApplied: string | null;
  status: "applied" | "interviewing" | "offered" | "rejected" | "ghosted";
  interviewRound: string | null;
  platform: string | null;
}

export interface JobExtractionDiagnostics {
  aiUsed: boolean;
  aiSucceeded: boolean;
  companySource: string;
  roleSource: string | null;
  ambiguousRole: boolean;
  roleCandidates: Array<{
    value: string;
    source: string;
    priority: number;
  }>;
  rejectedRoleCandidates: string[];
  normalizedContextLength: number;
}

export interface JobExtractionResult {
  extracted: ExtractedJobData;
  diagnostics: JobExtractionDiagnostics;
}

type GeminiModel = ReturnType<GoogleGenerativeAI["getGenerativeModel"]>;

interface SubjectHints {
  company: string | null;
  role: string | null;
}

interface RoleCandidate {
  value: string;
  source: string;
  priority: number;
}

interface ResolvedRole {
  role: string | null;
  source: string | null;
  candidates: RoleCandidate[];
  rejectedCandidates: string[];
  ambiguous: boolean;
}

interface InferredCompany {
  company: string;
  source: string;
}

const MODEL_NAME = "gemini-2.0-flash";
const AI_TIMEOUT_MS = 8000;
const GEMINI_QUOTA_COOLDOWN_MS = 60_000;

let cachedApiKey: string | null = null;
let cachedModel: GeminiModel | null = null;
let geminiQuotaCooldownUntil = 0;
let lastGeminiQuotaWarningAt = 0;

const VALID_STATUSES: ExtractedJobData["status"][] = [
  "applied",
  "interviewing",
  "offered",
  "rejected",
  "ghosted",
];

const KNOWN_PLATFORM_NAMES = [
  "linkedin",
  "naukri",
  "indeed",
  "glassdoor",
  "wellfound",
  "lever",
  "greenhouse",
  "workday",
  "smartrecruiters",
  "icims",
  "bamboohr",
  "jazzhr",
  "recruitee",
  "breezy",
  "hackerrank",
  "codesignal",
  "codility",
  "hackerearth",
  "testgorilla",
  "coderbyte",
];

const PROMOTIONAL_PATTERNS = [
  "job alert",
  "recommended jobs",
  "jobs for you",
  "new jobs matching",
  "newsletter",
  "resume tips",
  "career advice",
  "daily digest",
  "weekly digest",
  "people viewed your profile",
  "connection request",
  "premium",
  "sponsored",
  "live:",
  "is live",
  "going live",
  "watch now",
  "started streaming",
  "new video",
  "webinar",
  "podcast",
  "premiere",
  "masterclass",
];

const TRANSACTIONAL_JOB_PATTERNS = [
  "application received",
  "received your application",
  "thank you for applying",
  "thank you for your application",
  "application submitted",
  "application confirmation",
  "interview scheduled",
  "interview invitation",
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
  "move forward",
  "application status",
  "job number",
  "req id",
  "requisition id",
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
  "job number",
];

const COMPANY_STOP_PHRASES = [
  "application received",
  "application update",
  "application confirmation",
  "application submitted",
  "thank you for applying",
  "thank you for your application",
  "we received your application",
  "your application has",
  "interview invitation",
  "interview scheduled",
  "invitation to",
  "online assessment",
  "offer letter",
  "regret to inform",
  "not moving forward",
  "we wanted to let you know",
  "for the time and effort",
  "candidate portal",
  "candidate home",
];

const ROLE_STOP_PHRASES = [
  "thank you for applying",
  "thank you for your application",
  "application received",
  "application update",
  "application confirmation",
  "application submitted",
  "we received your application",
  "your application",
  "we wanted to let you know",
  "for the time and effort",
  "candidate portal",
  "candidate home",
  "click here",
  "view your profile",
  "action center",
  "job number",
  "req id",
  "requisition id",
  "check back frequently",
  "career at",
];

const GENERIC_ROLE_TOKENS = new Set([
  "application",
  "interview",
  "assessment",
  "candidate",
  "offer",
  "job",
  "position",
  "role",
  "update",
  "thank you",
  "application status",
  "candidate portal",
  "candidate home",
]);

const ROLE_PATTERNS: Array<{
  regex: RegExp;
  source: string;
  priority: number;
}> = [
  {
    regex:
      /submit(?:ting|ted)?(?: the time)? to submit your application for\s+([A-Za-z0-9/&,+.()\- ]{3,120}?)(?=\s*\((?:job|req|requisition)|[.!?\n,]| at\b| with\b)/gi,
    source: "body-submit-application-for",
    priority: 100,
  },
  {
    regex:
      /(?:received|reviewing|process(?:ing)?)\s+(?:your\s+)?application\s+for\s+([A-Za-z0-9/&,+.()\- ]{3,120}?)(?=\s*\((?:job|req|requisition)|[.!?\n,]| at\b| with\b)/gi,
    source: "body-application-for",
    priority: 100,
  },
  {
    regex:
      /([A-Za-z0-9/&,+.()\- ]{3,120}?)\s*\((?:job|req|requisition)\s*(?:number|id)?[:#]?\s*[A-Za-z0-9-]+\)/gi,
    source: "body-role-with-job-id",
    priority: 98,
  },
  {
    regex:
      /(?:role|position|job title|title)\s*[:\-]\s*([A-Za-z0-9/&,+.()\- ]{3,120})/gi,
    source: "body-role-label",
    priority: 94,
  },
  {
    regex:
      /(?:you applied for|applied for(?: the)?|application for|for the)\s+([A-Za-z0-9/&,+.()\- ]{3,120}?)(?=\s*(?:role|position|job|\(|[.!?\n,]| at\b| with\b))/gi,
    source: "body-applied-for",
    priority: 90,
  },
  {
    regex:
      /^([A-Za-z0-9/&,+.()\- ]{3,80})\s+at\s+([A-Za-z0-9&.,'()\-/ ]{2,80})$/i,
    source: "subject-role-at-company",
    priority: 72,
  },
];

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

const EXTRACTION_PROMPT = `You extract structured job-application data from email messages.

Return ONLY a valid JSON object with these fields:
{
  "isJobRelated": boolean,
  "company": "Hiring company name",
  "role": "Exact applied role title from the email body or null",
  "dateApplied": "YYYY-MM-DD or null",
  "status": "applied | interviewing | offered | rejected | ghosted",
  "interviewRound": "Phone Screen | Online Assessment | Round 1 | Round 2 | Final Round | HR Round | null",
  "platform": "LinkedIn | Naukri | Indeed | Glassdoor | Wellfound | Career Site | Direct | Other | null"
}

Rules:
- Use the FULL email body, not just the subject.
- Extract the exact applied role title only when the email explicitly states it.
- If multiple different role titles appear and none is clearly the applied role, return role as null.
- Do not return workflow phrases, candidate-portal text, or generic words like "application" as the role.
- The company must be the hiring company, not the job platform.
- Mark newsletters, alerts, digests, or generic career content as isJobRelated=false.
- Return JSON only.`;

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function textIncludesAny(text: string, patterns: string[]): boolean {
  return patterns.some((pattern) => text.includes(pattern));
}

function parseExtractionResponse(responseText: string): ExtractedJobData | null {
  const cleaned = responseText
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();

  try {
    return JSON.parse(cleaned) as ExtractedJobData;
  } catch {
    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");
    if (first === -1 || last <= first) return null;

    try {
      return JSON.parse(cleaned.slice(first, last + 1)) as ExtractedJobData;
    } catch {
      return null;
    }
  }
}

function trimAtStopPhrase(value: string, stopPhrases: string[]): string {
  const lower = value.toLowerCase();
  let cutIndex = -1;

  for (const phrase of stopPhrases) {
    const index = lower.indexOf(phrase);
    if (index > 0 && (cutIndex === -1 || index < cutIndex)) {
      cutIndex = index;
    }
  }

  return cutIndex > 0 ? value.slice(0, cutIndex).trim() : value.trim();
}

function cleanCompanyName(value: string | null | undefined): string | null {
  if (!value) return null;

  let cleaned = normalizeWhitespace(value.replace(/["'`]/g, ""));
  cleaned = cleaned.replace(
    /^(thank you for applying to|thank you for your application to|application received(?: for)?|your application (?:to|for)|we(?:'|’)ve? received your application (?:for|to)?|applying to)\s+/i,
    "",
  );

  cleaned = trimAtStopPhrase(cleaned, COMPANY_STOP_PHRASES);
  cleaned = cleaned.replace(/[.,:;\-|]+$/g, "").trim();
  cleaned = cleaned
    .replace(
      /\b(careers?|recruiting|talent|talent acquisition|jobs?|team|hiring team|recruitment)\b$/i,
      "",
    )
    .trim();

  return cleaned || null;
}

function isGenericRoleToken(value: string): boolean {
  return GENERIC_ROLE_TOKENS.has(value.trim().toLowerCase());
}

function cleanRoleCandidate(
  value: string | null | undefined,
  company?: string | null,
): string | null {
  if (!value) return null;

  let cleaned = normalizeWhitespace(value.replace(/["'`]/g, ""));
  cleaned = cleaned.replace(
    /^(thank you for applying(?: to)?|thank you for your application(?: to)?|application received(?: for)?|application update|application confirmation|application submitted|we(?:'|’)ve? received your application(?: for| to)?|your application (?:to|for)|you applied for(?: the)?|applied for(?: the)?|submit(?:ting|ted)?(?: the time)? to submit your application for)\s+/i,
    "",
  );

  cleaned = cleaned.replace(
    /\s*\((?:job|req|requisition)\s*(?:number|id)?[:#]?\s*[A-Za-z0-9-]+\)\s*$/i,
    "",
  );
  cleaned = cleaned.replace(
    /\b(?:job|req|requisition)\s*(?:number|id)?[:#]?\s*[A-Za-z0-9-]+\b/gi,
    "",
  );

  if (company) {
    cleaned = cleaned
      .replace(new RegExp(`\\bat\\s+${escapeRegExp(company)}\\b`, "ig"), " ")
      .replace(new RegExp(`\\b${escapeRegExp(company)}\\b`, "ig"), " ");
  }

  cleaned = trimAtStopPhrase(cleaned, ROLE_STOP_PHRASES);
  cleaned = cleaned.replace(/^[-:|,\s]+|[-:|,\s]+$/g, "").trim();
  cleaned = normalizeWhitespace(cleaned);

  if (!cleaned || cleaned.length < 3 || cleaned.length > 90) return null;
  if (isGenericRoleToken(cleaned)) return null;

  const words = cleaned.split(" ").filter(Boolean);
  if (words.length > 12) return null;

  return cleaned;
}

function normalizeRoleKey(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
}

function extractSubjectHints(subject: string): SubjectHints {
  const normalized = normalizeWhitespace(subject);
  if (!normalized) return { company: null, role: null };

  const patterns: Array<{
    regex: RegExp;
    companyIndex?: number;
    roleIndex?: number;
  }> = [
    {
      regex:
        /^([A-Za-z0-9&.,'()\-/ ]{2,80})\s*[:|]\s*(?:application received|application update|application confirmation|we(?:'|’)ve? received your application|thank you for applying(?: to)?|interview invitation|interview scheduled|offer letter)(?:\s*[-:|]\s*([A-Za-z0-9/&,+.()\- ]{2,80}))?$/i,
      companyIndex: 1,
      roleIndex: 2,
    },
    {
      regex:
        /^thank you for applying to\s+([A-Za-z0-9&.,'()\-/ ]{2,80})(?:\s*[-:|]\s*([A-Za-z0-9/&,+.()\- ]{2,80}))?$/i,
      companyIndex: 1,
      roleIndex: 2,
    },
    {
      regex:
        /^your application (?:to|for)\s+([A-Za-z0-9&.,'()\-/ ]{2,80})(?:\s*[-:|]\s*([A-Za-z0-9/&,+.()\- ]{2,80}))?$/i,
      companyIndex: 1,
      roleIndex: 2,
    },
    {
      regex:
        /^([A-Za-z0-9/&,+.()\- ]{2,80})\s+at\s+([A-Za-z0-9&.,'()\-/ ]{2,80})$/i,
      roleIndex: 1,
      companyIndex: 2,
    },
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern.regex);
    if (!match) continue;

    const company = cleanCompanyName(
      pattern.companyIndex ? match[pattern.companyIndex] : null,
    );
    const role = cleanRoleCandidate(
      pattern.roleIndex ? match[pattern.roleIndex] : null,
      company,
    );

    if (company || role) {
      return { company: company || null, role: role || null };
    }
  }

  return { company: null, role: null };
}

function isUnknownCompany(value: string | null | undefined): boolean {
  const cleaned = cleanCompanyName(value)?.toLowerCase();
  if (!cleaned) return true;

  if (["unknown", "unknown company", "n/a", "na", "none", "null"].includes(cleaned)) {
    return true;
  }

  return KNOWN_PLATFORM_NAMES.some((platform) => cleaned.includes(platform));
}

function extractEmailAddress(from: string): string {
  const angleMatch = from.match(/<([^>]+)>/);
  if (angleMatch?.[1]) return angleMatch[1].toLowerCase();

  return (
    from.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0].toLowerCase() || ""
  );
}

function extractSenderDisplayName(from: string): string | null {
  const trimmed = from.trim();
  if (!trimmed) return null;
  const angleIndex = trimmed.indexOf("<");
  const rawName = angleIndex > 0 ? trimmed.slice(0, angleIndex).trim() : "";
  return cleanCompanyName(rawName.replace(/^"|"$/g, ""));
}

function extractCompanyFromDomain(from: string): string | null {
  const email = extractEmailAddress(from);
  const domain = email.split("@")[1] || "";
  if (!domain || PUBLIC_MAIL_PROVIDERS.has(domain)) return null;

  const parts = domain.split(".").filter(Boolean);
  if (parts.length < 2) return null;

  let index = parts.length - 2;
  if (["co", "com", "org", "net"].includes(parts[index]) && parts.length >= 3) {
    index = parts.length - 3;
  }

  const token = parts[index];
  if (!token || KNOWN_PLATFORM_NAMES.some((platform) => token.includes(platform))) {
    return null;
  }

  const normalized = token
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

  return cleanCompanyName(normalized);
}

function extractCompanyFromText(text: string): string | null {
  const patterns = [
    /thank you for applying to\s+([A-Za-z0-9&.,'\- ]{2,80})/i,
    /your application to\s+([A-Za-z0-9&.,'\- ]{2,80})/i,
    /(?:interview|offer|application)\s+(?:with|at|from)\s+([A-Za-z0-9&.,'\- ]{2,80})/i,
    /position\s+(?:at|with)\s+([A-Za-z0-9&.,'\- ]{2,80})/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match?.[1]) continue;
    const cleaned = cleanCompanyName(match[1]);
    if (!isUnknownCompany(cleaned)) {
      return cleaned;
    }
  }

  return null;
}

function collectRoleCandidates(
  email: GmailMessage,
  company: string | null,
  aiRole: string | null | undefined,
  subjectHints: SubjectHints,
): RoleCandidate[] {
  const candidates: RoleCandidate[] = [];
  const bodyText = email.textBody.slice(0, 12_000);

  for (const pattern of ROLE_PATTERNS) {
    if (pattern.source === "subject-role-at-company") {
      const match = email.subject.match(pattern.regex);
      if (match?.[1]) {
        const cleaned = cleanRoleCandidate(match[1], company);
        if (cleaned) {
          candidates.push({
            value: cleaned,
            source: pattern.source,
            priority: pattern.priority,
          });
        }
      }

      continue;
    }

    for (const match of bodyText.matchAll(pattern.regex)) {
      const cleaned = cleanRoleCandidate(match[1], company);
      if (cleaned) {
        candidates.push({
          value: cleaned,
          source: pattern.source,
          priority: pattern.priority,
        });
      }
    }
  }

  if (subjectHints.role) {
    candidates.push({
      value: subjectHints.role,
      source: "subject-hint",
      priority: 74,
    });
  }

  const cleanedAiRole = cleanRoleCandidate(aiRole, company);
  if (cleanedAiRole) {
    candidates.push({
      value: cleanedAiRole,
      source: "ai",
      priority: 68,
    });
  }

  return candidates;
}

function resolveRole(
  email: GmailMessage,
  company: string | null,
  aiRole: string | null | undefined,
  subjectHints: SubjectHints,
): ResolvedRole {
  const candidates = collectRoleCandidates(email, company, aiRole, subjectHints);

  const grouped = new Map<
    string,
    {
      value: string;
      bestPriority: number;
      sources: string[];
    }
  >();

  for (const candidate of candidates) {
    const key = normalizeRoleKey(candidate.value);
    const existing = grouped.get(key);

    if (!existing) {
      grouped.set(key, {
        value: candidate.value,
        bestPriority: candidate.priority,
        sources: [candidate.source],
      });
      continue;
    }

    existing.bestPriority = Math.max(existing.bestPriority, candidate.priority);
    if (!existing.sources.includes(candidate.source)) {
      existing.sources.push(candidate.source);
    }
  }

  const rankedGroups = Array.from(grouped.values()).sort(
    (left, right) => right.bestPriority - left.bestPriority,
  );

  const strongGroups = rankedGroups.filter((group) => group.bestPriority >= 90);
  if (strongGroups.length > 1) {
    return {
      role: null,
      source: null,
      candidates,
      rejectedCandidates: rankedGroups.map((group) => group.value),
      ambiguous: true,
    };
  }

  if (strongGroups.length === 1) {
    const chosen = strongGroups[0];
    return {
      role: chosen.value,
      source: chosen.sources[0] || "body-pattern",
      candidates,
      rejectedCandidates: rankedGroups
        .filter((group) => group.value !== chosen.value)
        .map((group) => group.value),
      ambiguous: false,
    };
  }

  if (rankedGroups.length === 1) {
    const chosen = rankedGroups[0];
    return {
      role: chosen.value,
      source: chosen.sources[0] || null,
      candidates,
      rejectedCandidates: [],
      ambiguous: false,
    };
  }

  if (rankedGroups.length > 1) {
    return {
      role: null,
      source: null,
      candidates,
      rejectedCandidates: rankedGroups.map((group) => group.value),
      ambiguous: true,
    };
  }

  return {
    role: null,
    source: null,
    candidates,
    rejectedCandidates: [],
    ambiguous: false,
  };
}

function inferCompany(
  aiCompany: string | null | undefined,
  email: GmailMessage,
  subjectHints: SubjectHints,
): InferredCompany {
  const cleanedAi = cleanCompanyName(aiCompany);
  if (!isUnknownCompany(cleanedAi)) {
    return { company: cleanedAi!, source: "ai" };
  }

  if (!isUnknownCompany(subjectHints.company)) {
    return { company: subjectHints.company!, source: "subject-hint" };
  }

  const textContext = buildEmailTextContext(email, 12_000);
  const fromText = extractCompanyFromText(textContext);
  if (fromText) {
    return { company: fromText, source: "body-pattern" };
  }

  const displayName = extractSenderDisplayName(email.from);
  if (!isUnknownCompany(displayName)) {
    return { company: displayName!, source: "sender-display-name" };
  }

  const domain = extractCompanyFromDomain(email.from);
  if (!isUnknownCompany(domain)) {
    return { company: domain!, source: "sender-domain" };
  }

  return { company: "Unknown Company", source: "unknown" };
}

function inferInterviewRound(text: string): string | null {
  if (/phone screen|recruiter call|intro call/i.test(text)) return "Phone Screen";
  if (/online assessment|coding challenge|hackerrank|codesignal|codility/i.test(text)) {
    return "Online Assessment";
  }
  if (/final round|panel interview|onsite/i.test(text)) return "Final Round";
  if (/round 2|second round/i.test(text)) return "Round 2";
  if (/round 1|first round/i.test(text)) return "Round 1";
  if (/hr round/i.test(text)) return "HR Round";
  return null;
}

function inferStatus(text: string): ExtractedJobData["status"] {
  if (
    text.includes("pleased to offer") ||
    text.includes("offer letter") ||
    text.includes("offer for")
  ) {
    return "offered";
  }

  if (
    text.includes("regret to inform") ||
    text.includes("unfortunately") ||
    text.includes("not moving forward") ||
    text.includes("not selected")
  ) {
    return "rejected";
  }

  if (
    text.includes("interview") ||
    text.includes("assessment") ||
    text.includes("phone screen")
  ) {
    return "interviewing";
  }

  return "applied";
}

function normalizeDateApplied(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

function isPromotionalEmail(text: string): boolean {
  return textIncludesAny(text, PROMOTIONAL_PATTERNS);
}

function hasTransactionalJobSignal(text: string): boolean {
  return textIncludesAny(text, TRANSACTIONAL_JOB_PATTERNS);
}

function hasRecipientSpecificSignal(text: string): boolean {
  return textIncludesAny(text, RECIPIENT_SPECIFIC_PATTERNS);
}

function isMeaningfulCompany(value: string): boolean {
  return !isUnknownCompany(value);
}

function isMeaningfulRole(value: string | null): boolean {
  return Boolean(value && !isGenericRoleToken(value));
}

function getGenerativeModel(apiKey: string): GeminiModel {
  if (!cachedModel || cachedApiKey !== apiKey) {
    const genAI = new GoogleGenerativeAI(apiKey);
    cachedModel = genAI.getGenerativeModel({ model: MODEL_NAME });
    cachedApiKey = apiKey;
  }

  return cachedModel;
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function isGeminiQuotaError(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes("429") ||
    message.includes("too many requests") ||
    message.includes("quota exceeded") ||
    message.includes("rate limit")
  );
}

function getGeminiRetryDelayMs(error: unknown): number {
  const message = getErrorMessage(error);
  const retryInfoMatch = message.match(/retry in\s+(\d+(?:\.\d+)?)s/i);
  if (retryInfoMatch?.[1]) {
    return Math.max(Math.ceil(Number.parseFloat(retryInfoMatch[1]) * 1000), 1000);
  }

  const retryDelayMatch = message.match(/"retryDelay":"(\d+)s"/i);
  if (retryDelayMatch?.[1]) {
    return Math.max(Number.parseInt(retryDelayMatch[1], 10) * 1000, 1000);
  }

  return GEMINI_QUOTA_COOLDOWN_MS;
}

function buildAiFallbackResult(
  deterministic: JobExtractionResult,
): JobExtractionResult {
  return {
    ...deterministic,
    diagnostics: {
      ...deterministic.diagnostics,
      aiUsed: true,
      aiSucceeded: false,
    },
  };
}

function warnGeminiQuotaOnce(retryMs: number) {
  const now = Date.now();
  if (now - lastGeminiQuotaWarningAt < GEMINI_QUOTA_COOLDOWN_MS) {
    return;
  }

  lastGeminiQuotaWarningAt = now;
  console.warn(
    `Gemini quota exceeded; using deterministic extraction for ${Math.ceil(
      retryMs / 1000,
    )}s.`,
  );
}

function buildModelEmailContext(
  email: GmailMessage,
  senderPlatform: string | null,
): { content: string; contextLength: number } {
  const normalizedText = buildEmailTextContext(email, 12_000);
  const htmlPreview = email.htmlBody.slice(0, 4_000);
  const links = email.links
    .slice(0, 12)
    .map((link) => `- ${link.text || "(no label)"} -> ${link.href}`)
    .join("\n");
  const images = email.images
    .slice(0, 8)
    .map((image) =>
      `- alt=${image.alt || "none"} filename=${image.filename || "none"} src=${image.sourceUrl || "inline"} cid=${image.contentId || "none"}`,
    )
    .join("\n");

  return {
    contextLength: normalizedText.length,
    content: [
      `From: ${email.from}`,
      `Detected Platform: ${senderPlatform || "none"}`,
      `Subject: ${email.subject}`,
      `Text Context:\n${normalizedText}`,
      htmlPreview ? `HTML Preview:\n${htmlPreview}` : "",
      links ? `Links:\n${links}` : "",
      images ? `Image Hints:\n${images}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}

function buildDeterministicResult(
  email: GmailMessage,
  senderPlatform: string | null,
): JobExtractionResult {
  const subjectHints = extractSubjectHints(email.subject);
  const text = buildEmailTextContext(email, 12_000).toLowerCase();
  const company = inferCompany(null, email, subjectHints);
  const role = resolveRole(email, company.company, null, subjectHints);
  const status = inferStatus(text);
  const transactional = hasTransactionalJobSignal(text);
  const recipientSpecific = hasRecipientSpecificSignal(text);
  const promotional = isPromotionalEmail(text);
  const isJobRelated =
    !promotional &&
    transactional &&
    recipientSpecific &&
    (isMeaningfulCompany(company.company) || isMeaningfulRole(role.role));

  return {
    extracted: {
      isJobRelated,
      company: isMeaningfulCompany(company.company) ? company.company : "Unknown Company",
      role: isJobRelated ? role.role : null,
      dateApplied: null,
      status,
      interviewRound: inferInterviewRound(text),
      platform: senderPlatform,
    },
    diagnostics: {
      aiUsed: false,
      aiSucceeded: false,
      companySource: company.source,
      roleSource: role.source,
      ambiguousRole: role.ambiguous,
      roleCandidates: role.candidates,
      rejectedRoleCandidates: role.rejectedCandidates,
      normalizedContextLength: text.length,
    },
  };
}

function normalizeExtraction(
  aiExtracted: ExtractedJobData,
  email: GmailMessage,
  senderPlatform: string | null,
  aiUsed: boolean,
  aiSucceeded: boolean,
  contextLength: number,
): JobExtractionResult {
  const text = buildEmailTextContext(email, 12_000).toLowerCase();
  const subjectHints = extractSubjectHints(email.subject);
  const company = inferCompany(aiExtracted.company, email, subjectHints);
  const role = resolveRole(email, company.company, aiExtracted.role, subjectHints);

  let isJobRelated = Boolean(aiExtracted.isJobRelated);
  const transactional = hasTransactionalJobSignal(text);
  const recipientSpecific = hasRecipientSpecificSignal(text);
  const promotional = isPromotionalEmail(text);

  if (!isJobRelated && transactional && recipientSpecific && !promotional) {
    isJobRelated = true;
  }
  if (promotional && !transactional) {
    isJobRelated = false;
  }

  const status = VALID_STATUSES.includes(aiExtracted.status)
    ? aiExtracted.status
    : inferStatus(text);

  return {
    extracted: {
      isJobRelated,
      company: company.company,
      role: role.role,
      dateApplied: normalizeDateApplied(aiExtracted.dateApplied),
      status,
      interviewRound:
        aiExtracted.interviewRound?.trim() || inferInterviewRound(text),
      platform:
        senderPlatform && (!aiExtracted.platform || aiExtracted.platform === "Other")
          ? senderPlatform
          : aiExtracted.platform || senderPlatform,
    },
    diagnostics: {
      aiUsed,
      aiSucceeded,
      companySource: company.source,
      roleSource: role.source,
      ambiguousRole: role.ambiguous,
      roleCandidates: role.candidates,
      rejectedRoleCandidates: role.rejectedCandidates,
      normalizedContextLength: contextLength,
    },
  };
}

export async function extractJobData(
  email: GmailMessage,
  senderPlatform: string | null,
): Promise<JobExtractionResult> {
  const deterministic = buildDeterministicResult(email, senderPlatform);
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return deterministic;
  }

  if (Date.now() < geminiQuotaCooldownUntil) {
    return buildAiFallbackResult(deterministic);
  }

  const model = getGenerativeModel(apiKey);
  const { content, contextLength } = buildModelEmailContext(email, senderPlatform);

  try {
    const result = await withTimeout(
      model.generateContent([EXTRACTION_PROMPT, content]),
      AI_TIMEOUT_MS,
      "Gemini extraction timed out",
    );

    const responseText = result.response.text().trim();
    const parsed = parseExtractionResponse(responseText);

    if (!parsed) {
      throw new Error("Unable to parse structured extraction JSON");
    }

    return normalizeExtraction(parsed, email, senderPlatform, true, true, contextLength);
  } catch (error) {
    if (isGeminiQuotaError(error)) {
      const retryMs = getGeminiRetryDelayMs(error);
      geminiQuotaCooldownUntil = Date.now() + retryMs;
      warnGeminiQuotaOnce(retryMs);
      return buildAiFallbackResult(deterministic);
    }

    console.error("Gemini extraction failed:", error);
    return buildAiFallbackResult(deterministic);
  }
}
