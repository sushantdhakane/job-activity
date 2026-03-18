import { GoogleGenerativeAI } from "@google/generative-ai";

export interface ExtractedJobData {
  isJobRelated: boolean;
  company: string;
  role: string;
  dateApplied: string | null;
  status: "applied" | "interviewing" | "offered" | "rejected" | "ghosted";
  interviewRound: string | null;
  platform: string | null;
}

type GeminiModel = ReturnType<GoogleGenerativeAI["getGenerativeModel"]>;

const MODEL_NAME = "gemini-2.0-flash";
const AI_TIMEOUT_MS = 8000;

let cachedApiKey: string | null = null;
let cachedModel: GeminiModel | null = null;

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
];

interface SubjectHints {
  company: string | null;
  role: string | null;
}

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

const EXTRACTION_PROMPT = `You are a job application data extractor. Given email sender, subject, and body, extract structured data about a specific job application.

Return ONLY a valid JSON object with these fields:
{
  "isJobRelated": boolean,
  "company": "Company Name (the hiring company, NOT the job platform)",
  "role": "Job Title / Position",
  "dateApplied": "YYYY-MM-DD or null if unknown",
  "status": "applied | interviewing | offered | rejected | ghosted",
  "interviewRound": "Phone Screen | Online Assessment | Round 1 | Round 2 | Final Round | HR Round | null",
  "platform": "LinkedIn | Naukri | Indeed | Glassdoor | Wellfound | Career Site | Direct | Other"
}

Rules:
- If the email is NOT about a specific job application (e.g., it's a promotion, newsletter, or general alert), set isJobRelated to false and fill other fields with defaults.
- Do NOT treat livestreams, creator content, webinars, newsletters, interview-prep content, or general career content as job-related unless they clearly reference the recipient's specific application or candidacy.
- Extract the company that is HIRING, not the job platform (e.g., "Google" not "LinkedIn").
- If company is not explicit, infer from sender display name and sender domain when possible.
- Infer status from context: "received your application" → applied, "interview scheduled" → interviewing, "pleased to offer" → offered, "unfortunately"/"regret" → rejected.
- Return ONLY the JSON object, no explanation, no code fences.`;

function normalizeText(subject: string, body: string): string {
  return `${subject} ${body.slice(0, 1500)}`.toLowerCase();
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

    const candidate = cleaned.slice(first, last + 1);
    try {
      return JSON.parse(candidate) as ExtractedJobData;
    } catch {
      return null;
    }
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function trimAtStopPhrase(value: string, stopPhrases: string[]): string {
  const lower = value.toLowerCase();
  let cutIndex = -1;

  for (const phrase of stopPhrases) {
    const idx = lower.indexOf(phrase);
    if (idx > 0 && (cutIndex === -1 || idx < cutIndex)) {
      cutIndex = idx;
    }
  }

  return cutIndex > 0 ? value.slice(0, cutIndex).trim() : value.trim();
}

function isGenericRoleToken(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return [
    "application",
    "interview",
    "assessment",
    "candidate",
    "offer",
    "job",
    "position",
    "role",
  ].includes(normalized);
}

function cleanCompanyName(value: string | null | undefined): string | null {
  if (!value) return null;
  let cleaned = value.replace(/["'`]/g, "").replace(/\s+/g, " ").trim();

  cleaned = cleaned.replace(
    /^(thank you for applying to|thank you for your application to|application received(?: for)?|your application (?:to|for)|we(?:'|’)ve? received your application (?:for|to)?|applying to)\s+/i,
    ""
  );

  cleaned = trimAtStopPhrase(cleaned, COMPANY_STOP_PHRASES);

  const splitBySeparator = cleaned.split(/\s(?:-|:)\s/);
  if (splitBySeparator.length > 1) {
    const suffix = splitBySeparator.slice(1).join(" ").toLowerCase();
    if (COMPANY_STOP_PHRASES.some((phrase) => suffix.includes(phrase))) {
      cleaned = splitBySeparator[0].trim();
    }
  }

  if (cleaned.length > 85) {
    cleaned = cleaned.split(/[.!?]/)[0]?.trim() || cleaned;
  }

  cleaned = cleaned.replace(/[.,:;\-|]+$/g, "").trim();
  cleaned = cleaned
    .replace(
      /\b(careers?|recruiting|talent|talent acquisition|jobs?|team|hiring team|recruitment)\b$/i,
      ""
    )
    .trim();

  cleaned = cleaned.replace(/^[-:|,\s]+|[-:|,\s]+$/g, "").trim();
  if (!cleaned) return null;
  return cleaned;
}

function cleanRoleName(
  value: string | null | undefined,
  company?: string | null
): string | null {
  if (!value) return null;
  let cleaned = value.replace(/["'`]/g, "").replace(/\s+/g, " ").trim();

  cleaned = cleaned.replace(
    /^(thank you for applying to|thank you for your application to|we(?:'|’)ve? received your application(?: for| to)?|application received(?: for)?|application update|application confirmation|application submitted|your application (?:to|for)|invitation to complete (?:an|a))\s+/i,
    ""
  );

  cleaned = trimAtStopPhrase(cleaned, ROLE_STOP_PHRASES);

  if (company) {
    const escapedCompany = escapeRegExp(company.trim());
    const companyRegex = new RegExp(`\\b${escapedCompany}\\b`, "ig");
    cleaned = cleaned.replace(companyRegex, " ").replace(/\s+/g, " ").trim();
  }

  cleaned = cleaned.replace(/^[-:|,\s]+|[-:|,\s]+$/g, "").trim();

  if (!cleaned || cleaned.length < 3) return null;
  if (cleaned.length > 90) return null;
  if (isGenericRoleToken(cleaned)) return null;

  const words = cleaned.split(" ").filter(Boolean);
  if (words.length > 12 && ROLE_STOP_PHRASES.some((phrase) => cleaned.toLowerCase().includes(phrase))) {
    return null;
  }

  return cleaned;
}

function extractSubjectHints(subject: string): SubjectHints {
  const normalized = subject.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return { company: null, role: null };
  }

  const subjectPatterns: Array<{
    regex: RegExp;
    companyIndex?: number;
    roleIndex?: number;
  }> = [
    {
      regex:
        /^([A-Za-z0-9&.,'()\-/ ]{2,80})\s*[:|]\s*(?:application received|application update|application confirmation|we(?:'|’)ve? received your application|thank you for applying(?: to)?|interview invitation|interview scheduled|offer letter|online assessment|invitation to [^:|]{2,60})(?:\s*[-:|]\s*([A-Za-z0-9/&,+.()\- ]{2,80}))?$/i,
      companyIndex: 1,
      roleIndex: 2,
    },
    {
      regex:
        /^([A-Za-z0-9&.,'()\-/ ]{2,80})\s+-\s+(?:application received|application update|we(?:'|’)ve? received your application|thank you for applying(?: to)?)(?:\s+([A-Za-z0-9/&,+.()\- ]{2,80}))?$/i,
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

  for (const pattern of subjectPatterns) {
    const match = normalized.match(pattern.regex);
    if (!match) continue;

    const company = cleanCompanyName(
      pattern.companyIndex ? match[pattern.companyIndex] : null
    );
    const role = cleanRoleName(
      pattern.roleIndex ? match[pattern.roleIndex] : null,
      company
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
  if (
    cleaned === "unknown" ||
    cleaned === "unknown company" ||
    cleaned === "n/a" ||
    cleaned === "na" ||
    cleaned === "none" ||
    cleaned === "null"
  ) {
    return true;
  }
  return KNOWN_PLATFORM_NAMES.some((platform) => cleaned.includes(platform));
}

function extractEmailAddress(from: string): string {
  const fromTrimmed = from.trim();
  const angleMatch = fromTrimmed.match(/<([^>]+)>/);
  if (angleMatch?.[1]) return angleMatch[1].toLowerCase();

  const plainMatch = fromTrimmed.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return plainMatch?.[0].toLowerCase() || "";
}

function extractSenderDisplayName(from: string): string | null {
  const trimmed = from.trim();
  if (!trimmed) return null;
  const angleIndex = trimmed.indexOf("<");
  const rawName = angleIndex > 0 ? trimmed.slice(0, angleIndex).trim() : "";
  if (!rawName) return null;
  return cleanCompanyName(rawName.replace(/^"|"$/g, ""));
}

function extractCompanyFromDomain(from: string): string | null {
  const email = extractEmailAddress(from);
  const domain = email.split("@")[1] || "";
  if (!domain || PUBLIC_MAIL_PROVIDERS.has(domain)) return null;

  const parts = domain.split(".").filter(Boolean);
  if (parts.length < 2) return null;

  let index = parts.length - 2;
  if (
    ["co", "com", "org", "net"].includes(parts[index]) &&
    parts.length >= 3
  ) {
    index = parts.length - 3;
  }

  const token = parts[index];
  if (!token || KNOWN_PLATFORM_NAMES.some((p) => token.includes(p))) {
    return null;
  }

  const normalized = token
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

  return cleanCompanyName(normalized);
}

function extractCompanyFromText(subject: string, body: string): string | null {
  const source = `${subject}\n${body.slice(0, 2500)}`;
  const patterns = [
    /thank you for applying to\s+([A-Za-z0-9&.,'\- ]{2,80})/i,
    /your application to\s+([A-Za-z0-9&.,'\- ]{2,80})/i,
    /(?:interview|offer|application)\s+(?:with|at|from)\s+([A-Za-z0-9&.,'\- ]{2,80})/i,
    /position\s+(?:at|with)\s+([A-Za-z0-9&.,'\- ]{2,80})/i,
    /welcome to\s+([A-Za-z0-9&.,'\- ]{2,80})/i,
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (!match?.[1]) continue;
    const cleaned = cleanCompanyName(match[1]);
    if (!isUnknownCompany(cleaned)) {
      return cleaned;
    }
  }

  return null;
}

function extractRoleFromText(
  subject: string,
  body: string,
  company: string | null
): string | null {
  const source = `${subject}\n${body.slice(0, 2500)}`;
  const patterns = [
    /application received\s*[:\-]?\s*([A-Za-z0-9/&,+.()\- ]{2,80})$/i,
    /(?:for|role|position|job title)\s*[:\-]?\s*([A-Za-z0-9/&,+.()\- ]{2,80})/i,
    /appl(?:ied|ying) for(?: the)?\s+([A-Za-z0-9/&,+.()\- ]{2,80})/i,
    /for the\s+([A-Za-z0-9/&,+.()\- ]{2,80})\s+(?:role|position)/i,
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (!match?.[1]) continue;

    const cleaned = cleanRoleName(match[1], company);
    if (!cleaned) continue;

    if (company && cleaned.toLowerCase() === company.toLowerCase()) {
      continue;
    }

    return cleaned;
  }

  return null;
}

function looksLikeRoleLabel(value: string): boolean {
  const normalized = value.trim();
  if (!normalized) return false;

  const lower = normalized.toLowerCase();
  if (ROLE_STOP_PHRASES.some((phrase) => lower.includes(phrase))) {
    return false;
  }

  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  return wordCount <= 8;
}

function inferCompany(
  aiCompany: string | null | undefined,
  subject: string,
  body: string,
  from: string,
  subjectHints: SubjectHints
): string {
  const cleanedAi = cleanCompanyName(aiCompany);
  if (!isUnknownCompany(cleanedAi)) {
    return cleanedAi!;
  }

  if (!isUnknownCompany(subjectHints.company)) {
    return subjectHints.company!;
  }

  const fromText = extractCompanyFromText(subject, body);
  if (fromText) return fromText;

  const displayName = extractSenderDisplayName(from);
  if (!isUnknownCompany(displayName)) {
    return displayName!;
  }

  const fromDomain = extractCompanyFromDomain(from);
  if (!isUnknownCompany(fromDomain)) {
    return fromDomain!;
  }

  return "Unknown Company";
}

function inferRole(
  subject: string,
  body: string,
  aiRole: string | null | undefined,
  company: string,
  subjectHints: SubjectHints
): string {
  const cleanedAiRole = cleanRoleName(aiRole, company);
  if (cleanedAiRole) {
    return cleanedAiRole;
  }

  if (subjectHints.role) {
    return subjectHints.role;
  }

  const fromText = extractRoleFromText(subject, body, company);
  if (fromText) {
    return fromText;
  }

  const roleMatch = subject.match(
    /(?:for|role|position)\s+(?:the\s+)?([A-Za-z0-9/,+&.\- ]{3,80})(?:\s+at|\s+with|$)/i
  );
  const fromSubjectPattern = cleanRoleName(roleMatch?.[1], company);
  if (fromSubjectPattern) {
    return fromSubjectPattern;
  }

  const cleanedSubject = cleanRoleName(subject, company);
  if (cleanedSubject && looksLikeRoleLabel(cleanedSubject)) {
    return cleanedSubject;
  }

  return "Unknown Role";
}

function inferStatus(subject: string, body: string): ExtractedJobData["status"] {
  const text = normalizeText(subject, body);
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

function isPromotionalEmail(subject: string, body: string): boolean {
  const text = normalizeText(subject, body);
  return PROMOTIONAL_PATTERNS.some((pattern) => text.includes(pattern));
}

function hasTransactionalJobSignal(subject: string, body: string): boolean {
  const text = normalizeText(subject, body);
  return TRANSACTIONAL_JOB_PATTERNS.some((pattern) => text.includes(pattern));
}

function hasRecipientSpecificSignal(subject: string, body: string): boolean {
  const text = normalizeText(subject, body);
  return RECIPIENT_SPECIFIC_PATTERNS.some((pattern) =>
    text.includes(pattern)
  );
}

function normalizeDateApplied(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  return trimmed;
}

function isUnknownRole(value: string | null | undefined): boolean {
  if (!value) return true;
  const normalized = value.trim().toLowerCase();
  return (
    normalized.length === 0 ||
    normalized === "unknown" ||
    normalized === "unknown role" ||
    normalized === "n/a" ||
    normalized === "none"
  );
}

function isMeaningfulCompany(value: string): boolean {
  return !isUnknownCompany(value);
}

function isMeaningfulRole(value: string): boolean {
  return !isUnknownRole(value);
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
  timeoutMessage: string
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

function buildDeterministicExtraction(
  subject: string,
  body: string,
  senderPlatform: string | null,
  from: string
): ExtractedJobData | null {
  const promotional = isPromotionalEmail(subject, body);
  const transactional = hasTransactionalJobSignal(subject, body);
  const recipientSpecific = hasRecipientSpecificSignal(subject, body);
  const subjectHints = extractSubjectHints(subject);

  const company = inferCompany(null, subject, body, from, subjectHints);
  const role = inferRole(subject, body, null, company, subjectHints);
  const status = inferStatus(subject, body);

  if (promotional && !transactional) {
    return {
      isJobRelated: false,
      company: "Unknown Company",
      role: "Unknown Role",
      dateApplied: null,
      status,
      interviewRound: null,
      platform: senderPlatform,
    };
  }

  if (
    transactional &&
    recipientSpecific &&
    (isMeaningfulCompany(company) || isMeaningfulRole(role))
  ) {
    return {
      isJobRelated: true,
      company,
      role,
      dateApplied: null,
      status,
      interviewRound: null,
      platform: senderPlatform,
    };
  }

  return null;
}

function buildHeuristicFallback(
  subject: string,
  body: string,
  senderPlatform: string | null,
  from: string
): ExtractedJobData {
  const transactional = hasTransactionalJobSignal(subject, body);
  const promotional = isPromotionalEmail(subject, body);
  const recipientSpecific = hasRecipientSpecificSignal(subject, body);
  const isJobRelated = transactional && recipientSpecific && !promotional;
  const subjectHints = extractSubjectHints(subject);
  const company = inferCompany(
    null,
    subject,
    body,
    from,
    subjectHints
  );
  const role = inferRole(subject, body, null, company, subjectHints);

  return {
    isJobRelated,
    company: isJobRelated ? company : "Unknown Company",
    role: isJobRelated ? role : "Unknown Role",
    dateApplied: null,
    status: inferStatus(subject, body),
    interviewRound: null,
    platform: senderPlatform,
  };
}

function normalizeExtraction(
  extracted: ExtractedJobData,
  subject: string,
  body: string,
  senderPlatform: string | null,
  from: string
): ExtractedJobData {
  const transactional = hasTransactionalJobSignal(subject, body);
  const promotional = isPromotionalEmail(subject, body);
  const recipientSpecific = hasRecipientSpecificSignal(subject, body);
  const subjectHints = extractSubjectHints(subject);

  const status = VALID_STATUSES.includes(extracted.status)
    ? extracted.status
    : inferStatus(subject, body);

  const company = inferCompany(
    extracted.company,
    subject,
    body,
    from,
    subjectHints
  );

  const role = inferRole(subject, body, extracted.role, company, subjectHints);

  let isJobRelated = Boolean(extracted.isJobRelated);
  if (!isJobRelated && transactional && recipientSpecific && !promotional) {
    isJobRelated = true;
  }
  if (promotional && !transactional) {
    isJobRelated = false;
  }

  return {
    isJobRelated,
    company,
    role,
    dateApplied: normalizeDateApplied(extracted.dateApplied),
    status,
    interviewRound: extracted.interviewRound?.trim() || null,
    platform:
      senderPlatform && (!extracted.platform || extracted.platform === "Other")
        ? senderPlatform
        : extracted.platform || senderPlatform,
  };
}

/**
 * Extract job data from an email using Gemini AI
 */
export async function extractJobData(
  subject: string,
  body: string,
  senderPlatform: string | null,
  from: string
): Promise<ExtractedJobData> {
  const deterministicFallback = buildDeterministicExtraction(
    subject,
    body,
    senderPlatform,
    from
  );

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return (
      deterministicFallback ||
      buildHeuristicFallback(subject, body, senderPlatform, from)
    );
  }

  const model = getGenerativeModel(apiKey);

  const emailContent = `From: ${from}\nDetected Platform: ${senderPlatform || "none"}\nSubject: ${subject}\n\nBody:\n${body}`;

  try {
    const result = await withTimeout(
      model.generateContent([EXTRACTION_PROMPT, emailContent]),
      AI_TIMEOUT_MS,
      "Gemini extraction timed out"
    );

    const responseText = result.response.text().trim();
    const parsed = parseExtractionResponse(responseText);

    if (!parsed) {
      throw new Error("Unable to parse structured extraction JSON");
    }

    return normalizeExtraction(parsed, subject, body, senderPlatform, from);
  } catch (error) {
    console.error("Gemini extraction failed:", error);
    return (
      deterministicFallback ||
      buildHeuristicFallback(subject, body, senderPlatform, from)
    );
  }
}
