// ---------------------------------------------------------------------------
// ATS Scoring Engine — 100% deterministic, zero LLM calls
// Redesigned to use preprocessed JD data with two-score system
// ---------------------------------------------------------------------------

import { SYNONYM_MAP, termExistsWithSynonyms } from './tailor';
import type { ProcessedJD } from './jd-preprocessor';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ATSScoreResult {
  totalScore: number;              // Optimization Score (primary)
  jdCoverageScore: number;         // JD Coverage (secondary/informational)
  jdCoverageDetail: {              // Details for UI display
    overlappingSkills: number;
    totalJDSkills: number;
    percentage: number;
  };
  passedParsingGate: boolean;
  parsingFailReasons?: string[];
  tierScores: {
    hardSkillMatch: { score: number; matched: string[]; missing: string[]; skillsGap: string[] };
    jobTitleAlignment: { score: number; matchType: 'exact' | 'core' | 'partial' | 'elsewhere' | 'none' };
    experienceRelevance: { score: number; contextualKeywords: number; bareListKeywords: number; hasQuantifiedAchievements: boolean };
    softSkillMatch: { score: number; matched: string[]; missing: string[] };
    structuralCompliance: { score: number; issues: string[]; contentChecks: ContentCheck[] };
    supplementaryFactors: { score: number; issues: string[] };
  };
  keywordDensity: { term: string; density: number; overStuffed: boolean }[];
  recommendations: string[];
  coveragePercentage: number;
  // Debug/transparency data (Step 18)
  scoringDebug?: {
    hardSkillsFromJD: string[];
    softSkillsFromJD: string[];
    skillsInResume: string[];
    overlappingSkills: string[];
    skillsGap: string[];
    noisePercentageFiltered: number;
  };
}

export interface ContentCheck {
  label: string;
  passed: boolean;
  detail?: string;
}

export interface CoverLetterScoreResult {
  totalScore: number;
  tierScores: {
    keywordReinforcement: { score: number; found: string[]; missing: string[] };
    painPointCoverage: { score: number; addressed: string[]; missed: string[] };
    lengthCompliance: { score: number; wordCount: number };
    noDuplication: { score: number; duplicatedSentences: string[] };
    structuralCompliance: { score: number; paragraphCount: number; hasBullets: boolean };
    authenticVoice: { score: number; flaggedPhrases: string[] };
  };
  recommendations: string[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const APPROVED_HEADINGS = new Set([
  'professional summary', 'summary', 'profile',
  'work experience', 'experience', 'professional experience', 'employment history',
  'education', 'academic background',
  'skills', 'technical skills', 'core competencies', 'core skills',
  'projects', 'key projects', 'selected projects',
  'certifications', 'licenses & certifications', 'professional certifications',
  'awards', 'awards & honors',
  'publications',
  'volunteer experience', 'community involvement',
]);

const AI_ISM_BLACKLIST = [
  'i am passionate about',
  'i thrive in',
  'i bring a unique blend',
  'in today\'s fast-paced',
  'i am confident that',
  'proven track record',
  'results-driven professional',
  'dynamic environment',
  'hit the ground running',
  'value-add',
  'value proposition',
  'cutting-edge',
  'best-in-class',
  'world-class',
  'leverage my',
  'synergy',
  'i am excited to',
];

// ---------------------------------------------------------------------------
// Helper: Identify resume sections
// ---------------------------------------------------------------------------

interface ResumeSection {
  name: string;
  content: string;
  zone: number; // 1=headline, 2=summary, 3=skills, 4=experience, 5=education
}

function parseResumeSections(resume: string): ResumeSection[] {
  const lines = resume.split('\n');
  const sections: ResumeSection[] = [];
  let currentSection: ResumeSection | null = null;

  // First line(s) = headline zone
  let headlineEnd = 0;
  for (let i = 0; i < Math.min(lines.length, 5); i++) {
    if (lines[i].trim()) {
      headlineEnd = i + 1;
      break;
    }
  }

  sections.push({
    name: 'headline',
    content: lines.slice(0, Math.max(headlineEnd, 3)).join('\n'),
    zone: 1,
  });

  for (let i = headlineEnd; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    const normalized = trimmed.toLowerCase().replace(/[*_#]/g, '').trim();
    const isHeading = (trimmed === trimmed.toUpperCase() && /^[A-Z\s&/]+$/.test(trimmed) && trimmed.length >= 3)
      || /^#{1,3}\s+/.test(trimmed);

    if (isHeading && normalized.length > 0) {
      if (currentSection) sections.push(currentSection);

      let zone = 4; // default to experience
      if (/summary|profile|objective/.test(normalized)) zone = 2;
      else if (/skills|competenc|technical/.test(normalized)) zone = 3;
      else if (/experience|employment|work/.test(normalized)) zone = 4;
      else if (/education|academic|certification|award|publication/.test(normalized)) zone = 5;

      currentSection = { name: normalized, content: '', zone };
    } else if (currentSection) {
      currentSection.content += trimmed + '\n';
    }
  }

  if (currentSection) sections.push(currentSection);
  return sections;
}

// ---------------------------------------------------------------------------
// TIER 0: Parsing Gate
// ---------------------------------------------------------------------------

function checkParsingGate(resume: string): { passed: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const lower = resume.toLowerCase();

  const hasStandardHeading = Array.from(APPROVED_HEADINGS).some(h => lower.includes(h));
  if (!hasStandardHeading) {
    reasons.push('No standard section headings detected (e.g., "Experience," "Skills," "Education")');
  }

  const hasEmail = /@/.test(resume);
  const hasPhone = /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/.test(resume);
  if (!hasEmail && !hasPhone) {
    reasons.push('No contact information (email or phone) detected in document body');
  }

  const datePatterns = resume.match(/(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}|\d{1,2}\/\d{4}/g) || [];
  if (datePatterns.length === 0) {
    reasons.push('No recognizable date formats detected');
  }

  const tabCount = (resume.match(/\t/g) || []).length;
  const lineCount = resume.split('\n').length;
  if (tabCount > lineCount * 2) {
    reasons.push('Heavy tab usage detected — possible table-based layout which may confuse ATS parsers');
  }

  return { passed: reasons.length === 0, reasons };
}

// ---------------------------------------------------------------------------
// TIER 1: Hard Skills Keyword Match (35% weight — Step 7, 13)
// Now scores ONLY overlapping skills (JD skills that exist in original resume)
// ---------------------------------------------------------------------------

function scoreHardSkillMatch(
  tailoredResume: string,
  hardSkills: string[],
  sections: ResumeSection[],
  originalResume?: string,
): {
  score: number;
  matched: string[];
  missing: string[];       // Overlapping skills not well-placed in tailored resume
  skillsGap: string[];     // JD skills not in candidate's original resume at all
} {
  const matched: string[] = [];
  const missing: string[] = [];
  const skillsGap: string[] = [];

  // Separate JD skills into overlapping (candidate has) vs gap (candidate doesn't have)
  const overlappingSkills: string[] = [];

  console.log(`\n[DIAG:scoreHardSkillMatch] --- Checking ${hardSkills.length} hard skills ---`);

  for (const skill of hardSkills) {
    console.log(`\n[DIAG:scoreHardSkillMatch] Checking skill: "${skill}"`);

    console.log(`[DIAG:scoreHardSkillMatch]   Step 1: Check if "${skill}" exists in ORIGINAL resume...`);
    const inOriginal = originalResume ? termExistsWithSynonyms(skill, originalResume) : true;

    if (!inOriginal) {
      // Candidate doesn't have this skill — it's a gap, not a penalty
      console.log(`[DIAG:scoreHardSkillMatch]   Result: SKILLS GAP (not in original resume)`);
      skillsGap.push(skill);
      continue;
    }

    console.log(`[DIAG:scoreHardSkillMatch]   Step 1 result: FOUND in original resume`);
    overlappingSkills.push(skill);

    console.log(`[DIAG:scoreHardSkillMatch]   Step 2: Check if "${skill}" exists in TAILORED resume...`);
    if (termExistsWithSynonyms(skill, tailoredResume)) {
      console.log(`[DIAG:scoreHardSkillMatch]   Result: MATCHED (in both original and tailored)`);
      matched.push(skill);
    } else {
      // Skill exists in original but missing from tailored — optimization failure
      console.log(`[DIAG:scoreHardSkillMatch]   Result: MISSING (in original but NOT in tailored — optimization failure)`);
      missing.push(skill);
    }
  }

  console.log(`\n[DIAG:scoreHardSkillMatch] --- Summary ---`);
  console.log(`  Matched: [${matched.join(', ')}]`);
  console.log(`  Missing (optimization failures): [${missing.join(', ')}]`);
  console.log(`  Skills gap (not in original): [${skillsGap.join(', ')}]`);
  console.log(`  Overlapping: [${overlappingSkills.join(', ')}]`);

  // Score based on overlapping skills only (not the full JD list)
  // If zero overlap, the candidate has none of the JD's skills — score is 0, not a free pass
  if (overlappingSkills.length === 0) return { score: 0, matched, missing, skillsGap };

  let weightedScore = 0;

  for (const skill of matched) {
    let bestMultiplier = 1.0;
    for (const section of sections) {
      if (termExistsWithSynonyms(skill, section.content)) {
        const multiplier = section.zone === 1 ? 3.0 : section.zone === 2 ? 2.0 : section.zone === 3 ? 1.5 : section.zone === 4 ? 1.0 : 0.75;
        bestMultiplier = Math.max(bestMultiplier, multiplier);
      }
    }

    // BM25 frequency saturation — use word-boundary matching to avoid substring hits
    // (e.g., "Java" should not count occurrences inside "JavaScript")
    const skillLower = skill.toLowerCase();
    const escaped = skillLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wordBoundaryRegex = new RegExp(`\\b${escaped}\\b`, 'gi');
    const occurrences = (tailoredResume.match(wordBoundaryRegex) || []).length;

    let frequencyScore = 0;
    if (occurrences >= 1) frequencyScore += 1.0;
    if (occurrences >= 2) frequencyScore += 0.5;
    if (occurrences >= 3) frequencyScore += 0.25;

    weightedScore += bestMultiplier * Math.min(frequencyScore, 1.75);
  }

  // Denominator: use a realistic best-case scenario, not "all skills in headline"
  // Most skills appear in experience (zone 4, multiplier 1.0) with 2 mentions (freq 1.5)
  // A few top skills appear in summary/skills (zone 2-3, multiplier 1.5-2.0)
  // The best realistic placement for an average skill is zone 3 (skills section) with 2 mentions
  const realisticMultiplier = 1.5; // Skills section (zone 3) as realistic best-case average
  const realisticFrequency = 1.5;  // 2 mentions (1.0 + 0.5)
  const maxPossible = overlappingSkills.length * realisticMultiplier * realisticFrequency;
  const score = Math.min(100, Math.round((weightedScore / maxPossible) * 100));

  return { score, matched, missing, skillsGap };
}

// ---------------------------------------------------------------------------
// TIER 2: Job Title Alignment (15% weight — Step 8)
// Uses jobTitle from ProcessedJD (request field), NOT extracted from JD body
// ---------------------------------------------------------------------------

const TITLE_NOISE_WORDS = new Set([
  'senior', 'junior', 'lead', 'staff', 'principal', 'associate',
  'i', 'ii', 'iii', 'iv', 'v', 'intern', 'co-op', 'contractor',
  'remote', 'hybrid', 'onsite', 'full-time', 'part-time',
]);

/**
 * Normalize a title for comparison: lowercase, strip separators/punctuation/noise words.
 * Also strips parenthetical content into separate words so "Backend (Python)" becomes
 * "backend python" rather than losing the tech keywords.
 */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[()]/g, ' ')       // Convert parens to spaces (preserve content)
    .replace(/[-–—|]/g, ' ')     // Convert separators to spaces
    .replace(/[^a-z0-9+#\s]/g, '') // Keep +/# for C++, C#, etc.
    .split(/\s+/)
    .filter(w => w.length > 0 && !TITLE_NOISE_WORDS.has(w))
    .join(' ')
    .trim();
}

/**
 * Score how well the resume headline matches the JD title.
 *
 * Scoring tiers:
 *   100% — exact normalized substring match (verbatim or reordered with all words adjacent)
 *    95% — all core title words appear in headline (any order) — rewards smart decomposition
 *    60% — >50% of core title words appear in headline
 *    30% — title appears elsewhere in the resume body
 *     0% — no match found
 */
function scoreJobTitleAlignment(resume: string, jobTitle: string, sections: ResumeSection[]): {
  score: number; matchType: 'exact' | 'core' | 'partial' | 'elsewhere' | 'none';
} {
  if (!jobTitle || !jobTitle.trim()) {
    return { score: 50, matchType: 'none' }; // No title provided — neutral
  }

  const titleLower = jobTitle.toLowerCase().trim();
  const normalizedTitle = normalizeTitle(jobTitle);
  const resumeLower = resume.toLowerCase();

  // Check headline (zone 1) and also summary (zone 2) as fallback for qualifier placement
  const headline = sections.find(s => s.zone === 1);
  const summary = sections.find(s => s.zone === 2);
  const headlineText = (headline?.content || '').toLowerCase();
  const normalizedHeadline = normalizeTitle(headline?.content || '');
  const headlinePlusSummary = normalizeTitle(
    (headline?.content || '') + ' ' + (summary?.content || '')
  );

  // Exact match (after normalization): 100%
  if (normalizedHeadline.includes(normalizedTitle) || headlineText.includes(titleLower)) {
    return { score: 100, matchType: 'exact' };
  }

  // Word-set matching: all core title words present in headline (any order) — 95%
  // This rewards smart decomposition like "Backend Software Engineer | Python"
  // for a JD title "Software Engineer - Backend (Python)"
  const titleCoreWords = normalizedTitle.split(/\s+/).filter(w => w.length > 1);
  const headlineCoreWords = new Set(normalizedHeadline.split(/\s+/));
  const headlinePlusSummaryWords = new Set(headlinePlusSummary.split(/\s+/));

  if (titleCoreWords.length > 0) {
    const headlineMatchCount = titleCoreWords.filter(w => headlineCoreWords.has(w)).length;

    // All title words in headline (any order): 95%
    if (headlineMatchCount === titleCoreWords.length) {
      return { score: 95, matchType: 'core' };
    }

    // All title words in headline + summary combined: 85%
    // (qualifiers placed in summary instead of headline is acceptable)
    const combinedMatchCount = titleCoreWords.filter(w => headlinePlusSummaryWords.has(w)).length;
    if (combinedMatchCount === titleCoreWords.length) {
      return { score: 85, matchType: 'core' };
    }

    // Partial overlap in headline (>50% of title words present): 60%
    if (headlineMatchCount >= titleCoreWords.length * 0.5) {
      return { score: 60, matchType: 'partial' };
    }
  }

  // Title appears elsewhere in resume (not headline/summary): 30%
  if (resumeLower.includes(titleLower) || resumeLower.includes(normalizedTitle)) {
    return { score: 30, matchType: 'elsewhere' };
  }

  return { score: 0, matchType: 'none' };
}

// ---------------------------------------------------------------------------
// TIER 3: Experience Relevance (20% weight)
// ---------------------------------------------------------------------------

function scoreExperienceRelevance(
  resume: string,
  hardSkills: string[],
  sections: ResumeSection[],
  originalResume?: string,
): {
  score: number; contextualKeywords: number; bareListKeywords: number; hasQuantifiedAchievements: boolean;
} {
  // Only score skills that overlap with the original resume
  const relevantSkills = originalResume
    ? hardSkills.filter(s => termExistsWithSynonyms(s, originalResume))
    : hardSkills;

  let contextualKeywords = 0;
  let bareListKeywords = 0;

  const experienceSections = sections.filter(s => s.zone === 4);
  const skillsSections = sections.filter(s => s.zone === 3);

  for (const skill of relevantSkills) {
    const inExperience = experienceSections.some(s => termExistsWithSynonyms(skill, s.content));
    const inSkills = skillsSections.some(s => termExistsWithSynonyms(skill, s.content));

    if (inExperience) contextualKeywords++;
    else if (inSkills) bareListKeywords++;
  }

  const hasQuantifiedAchievements = /\d+%|\$[\d,]+|\d+\s*(users|clients|team|engineers|projects)/i.test(resume);

  if (relevantSkills.length === 0) {
    return { score: 100, contextualKeywords, bareListKeywords, hasQuantifiedAchievements };
  }

  const maxPossible = relevantSkills.length * 1.5;
  let raw = (contextualKeywords * 1.5 + bareListKeywords * 1.0) / maxPossible * 100;
  if (hasQuantifiedAchievements) raw += 5;

  return {
    score: Math.min(100, Math.round(raw)),
    contextualKeywords,
    bareListKeywords,
    hasQuantifiedAchievements,
  };
}

// ---------------------------------------------------------------------------
// TIER 4: Soft Skills Match (5% weight)
// ---------------------------------------------------------------------------

function scoreSoftSkillMatch(resume: string, softSkills: string[]): {
  score: number; matched: string[]; missing: string[];
} {
  const matched: string[] = [];
  const missing: string[] = [];

  for (const skill of softSkills) {
    // Use word-boundary matching to avoid "communication" matching "telecommunications"
    const escaped = skill.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'i');
    if (regex.test(resume)) {
      matched.push(skill);
    } else {
      missing.push(skill);
    }
  }

  if (softSkills.length === 0) return { score: 100, matched, missing };
  return {
    score: Math.min(100, Math.round((matched.length / softSkills.length) * 100)),
    matched,
    missing,
  };
}

// ---------------------------------------------------------------------------
// TIER 5: Structural Compliance (15% weight — Step 9, content-verifiable only)
// ---------------------------------------------------------------------------

function scoreStructuralCompliance(resume: string, sections: ResumeSection[]): {
  score: number; issues: string[]; contentChecks: ContentCheck[];
} {
  const issues: string[] = [];
  const contentChecks: ContentCheck[] = [];
  let points = 0;

  // 1. Standard section headings present
  const lower = resume.toLowerCase();
  const approvedFound = Array.from(APPROVED_HEADINGS).filter(h => lower.includes(h));
  const hasStandard = approvedFound.length > 0;
  const headingCheck: ContentCheck = {
    label: 'Standard section headings used',
    passed: hasStandard,
    detail: hasStandard ? `${approvedFound.length} approved headings found` : 'Missing standard section headings',
  };
  contentChecks.push(headingCheck);
  if (hasStandard) points += 20;
  else issues.push('Missing standard section headings');

  // 2. Reverse chronological order (check experience section only, not education/certs)
  const experienceContent = sections
    .filter(s => s.zone === 4)
    .map(s => s.content)
    .join('\n');
  const experienceYears = experienceContent.match(/20\d{2}/g)?.map(Number) || [];
  // Fallback: if no experience section detected, check the full resume
  const years = experienceYears.length >= 2 ? experienceYears : (resume.match(/20\d{2}/g)?.map(Number) || []);
  let isReverseChron = true;
  if (years.length >= 2) {
    // Check pairs of years — in reverse-chron, each year should be <= the previous (+1 tolerance for ranges)
    for (let i = 1; i < Math.min(years.length, 8); i++) {
      if (years[i] > years[i - 1] + 1) { isReverseChron = false; break; }
    }
  }
  const chronCheck: ContentCheck = {
    label: 'Reverse chronological order',
    passed: isReverseChron,
    detail: isReverseChron ? 'Dates in correct order' : 'May not be in reverse-chronological order',
  };
  contentChecks.push(chronCheck);
  if (isReverseChron) points += 20;
  else {
    if (years.length >= 2) points += 0;
    else points += 10; // partial credit if few dates
    issues.push('May not be in reverse-chronological order');
  }

  // 3. Consistent date formatting
  const monthYearDates = resume.match(/(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}/g) || [];
  const abbrDates = resume.match(/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}/g) || [];
  const numDates = resume.match(/\d{1,2}\/\d{4}/g) || [];
  const formatCount = [monthYearDates.length > 0, abbrDates.length > 0, numDates.length > 0].filter(Boolean).length;
  const dateConsistent = formatCount <= 1;
  const dateCheck: ContentCheck = {
    label: 'Consistent date formatting',
    passed: dateConsistent,
    detail: dateConsistent ? 'Consistent date format' : 'Mixed date formats detected',
  };
  contentChecks.push(dateCheck);
  if (dateConsistent) points += 20;
  else issues.push('Mixed date formats detected');

  // 4. Contact info in document body (first ~200 chars for placement check, but also full doc)
  const first200 = resume.substring(0, 500);
  const hasEmail = /@/.test(first200);
  const hasPhone = /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/.test(first200);
  const hasLinkedIn = /linkedin\.com/i.test(first200);
  const contactItems = [hasEmail, hasPhone, hasLinkedIn].filter(Boolean).length;
  const contactCheck: ContentCheck = {
    label: 'Contact info in document body',
    passed: contactItems >= 1,
    detail: `${contactItems}/3 items found (email, phone, LinkedIn)`,
  };
  contentChecks.push(contactCheck);
  if (contactItems >= 2) points += 20;
  else if (contactItems === 1) {
    points += 10;
    issues.push('Limited contact info detected — consider adding email, phone, and LinkedIn');
  } else {
    issues.push('No contact information detected in document body');
  }

  // 5. Appropriate length (updated for 2-page resume target)
  const wordCount = resume.split(/\s+/).length;
  const goodLength = wordCount >= 400 && wordCount <= 1500;
  const okLength = wordCount >= 250 && wordCount <= 1800;
  const lengthCheck: ContentCheck = {
    label: 'Appropriate length',
    passed: goodLength,
    detail: `${wordCount} words (target: 400-1500)`,
  };
  contentChecks.push(lengthCheck);
  if (goodLength) points += 20;
  else if (okLength) {
    points += 10;
    issues.push(`Word count (${wordCount}) is outside optimal range (400-1500)`);
  } else {
    issues.push(`Word count (${wordCount}) is significantly outside optimal range (400-1500)`);
  }

  // 6. Standard bullets only (no emojis or decorative characters)
  const hasDecorative = /[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[★☆✓✗→⇒]/u.test(resume);
  const bulletCheck: ContentCheck = {
    label: 'Standard bullets only',
    passed: !hasDecorative,
    detail: hasDecorative ? 'Decorative characters or emojis detected' : 'Standard characters only',
  };
  contentChecks.push(bulletCheck);
  if (!hasDecorative) {
    // No penalty — standard characters used
  } else {
    // Deduct from score — decorative chars cause ATS parsing failures
    points = Math.max(0, points - 15);
    issues.push('Decorative characters or emojis detected — ATS parsers may misread these');
  }

  return { score: Math.min(100, points), issues, contentChecks };
}

// ---------------------------------------------------------------------------
// TIER 6: Supplementary Factors (10% weight)
// ---------------------------------------------------------------------------

function scoreSupplementaryFactors(resume: string, hardSkills: string[]): {
  score: number; issues: string[];
} {
  const issues: string[] = [];
  let points = 0;
  const lower = resume.toLowerCase();

  // Acronym + full-term dual inclusion for top keywords
  let dualCount = 0;
  let applicableCount = 0;
  for (const skill of hardSkills.slice(0, 5)) {
    const synonyms = SYNONYM_MAP[skill.toLowerCase()];
    if (synonyms) {
      applicableCount++;
      const hasAcronym = lower.includes(skill.toLowerCase());
      const hasFullTerm = synonyms.some(s => lower.includes(s));
      if (hasAcronym && hasFullTerm) dualCount++;
    }
  }
  if (applicableCount === 0) {
    points += 25; // No applicable acronyms, full credit
  } else if (dualCount > 0) {
    points += 25;
  } else {
    issues.push('Consider including both acronym and full-term forms for technical abbreviations');
  }

  // No single keyword exceeds 3% density — use word-boundary matching
  const wordCount = resume.split(/\s+/).length;
  let stuffingDetected = false;
  for (const skill of hardSkills) {
    const escaped = skill.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const occurrences = (resume.match(new RegExp(`\\b${escaped}\\b`, 'gi')) || []).length;
    const density = wordCount > 0 ? (occurrences / wordCount) * 100 : 0;
    if (density > 3) {
      stuffingDetected = true;
      issues.push(`Keyword "${skill}" appears at ${density.toFixed(1)}% density (exceeds 3% threshold)`);
    }
  }
  if (!stuffingDetected) points += 25;

  // Date consistency check (spelling consistency proxy)
  const monthYearDates = resume.match(/(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}/g) || [];
  const abbrDates = resume.match(/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}/g) || [];
  const numDates = resume.match(/\d{1,2}\/\d{4}/g) || [];
  const dateFormats = [monthYearDates.length > 0, abbrDates.length > 0, numDates.length > 0].filter(Boolean).length;
  if (dateFormats <= 1) {
    points += 25;
  } else {
    issues.push('Mixed date formats detected — use a consistent format throughout');
  }

  // Contact info completeness (email + phone + LinkedIn = full marks)
  const hasEmail = /@/.test(resume);
  const hasPhone = /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/.test(resume);
  const hasLinkedIn = /linkedin\.com/i.test(resume);
  const contactScore = [hasEmail, hasPhone, hasLinkedIn].filter(Boolean).length;
  if (contactScore >= 3) points += 25;
  else if (contactScore >= 2) points += 15;
  else if (contactScore >= 1) points += 5;
  else issues.push('Missing contact information — include email, phone, and LinkedIn');

  return { score: Math.min(100, points), issues };
}

// ---------------------------------------------------------------------------
// Step 10: Recommendation Engine (verified, no duplicates, capped at 5)
// ---------------------------------------------------------------------------

function generateRecommendations(
  jobTitle: string,
  tailoredResume: string,
  t1: { score: number; matched: string[]; missing: string[]; skillsGap: string[] },
  t2: { score: number; matchType: string },
  t3: { score: number; hasQuantifiedAchievements: boolean },
  t5: { score: number; issues: string[] },
  t6: { score: number; issues: string[] },
): string[] {
  const recommendations: string[] = [];

  // Tier 2: Job title alignment
  if (t2.score < 85 && jobTitle) {
    // Only recommend if the title is NOT already in the headline
    const firstLines = tailoredResume.split('\n').slice(0, 5).join(' ').toLowerCase();
    const titleNormalized = normalizeTitle(jobTitle);
    if (!firstLines.includes(titleNormalized) && !firstLines.includes(jobTitle.toLowerCase())) {
      recommendations.push(
        `Your resume headline doesn't closely match the job title "${jobTitle}". Consider updating it.`
      );
    }
  }

  // Tier 1: Missing overlapping skills (optimization failures, not gaps)
  if (t1.score < 60 && t1.missing.length > 0) {
    // Only list skills actually missing from tailored resume that were in original
    const actuallyMissing = t1.missing.filter(s => !termExistsWithSynonyms(s, tailoredResume));
    if (actuallyMissing.length > 0) {
      recommendations.push(
        `Consider adding these skills more prominently: ${actuallyMissing.slice(0, 5).join(', ')}`
      );
    }
  }

  // Tier 3: Quantified achievements
  if (!t3.hasQuantifiedAchievements) {
    recommendations.push('Add quantified metrics to your experience bullets where possible');
  }

  // Tier 5: Structural issues
  for (const issue of t5.issues) {
    if (issue.includes('date format')) {
      recommendations.push('Standardize date formats throughout your resume');
      break;
    }
  }

  // Tier 6: Dual forms
  for (const issue of t6.issues) {
    if (issue.includes('acronym')) {
      recommendations.push('Include both full term and acronym for technical abbreviations (e.g., "Amazon Web Services (AWS)")');
      break;
    }
  }

  // Skills gap info (informational, not penalizing)
  if (t1.skillsGap.length > 0) {
    recommendations.push(
      `Skills gap: These JD skills are not in your base resume: ${t1.skillsGap.slice(0, 8).join(', ')}. If you have this experience, consider adding them to your master resume.`
    );
  }

  // Cap at 5 recommendations, prioritized by order above
  return recommendations.slice(0, 5);
}

// ---------------------------------------------------------------------------
// Main: Compute ATS Score (Step 6 — accepts ProcessedJD)
// ---------------------------------------------------------------------------

export function computeATSScore(
  tailoredResume: string,
  processedJD: ProcessedJD,
  originalResume?: string,
): ATSScoreResult {
  const { hardSkills, softSkills } = processedJD.extractedSkills;
  const jobTitle = processedJD.jobTitle;
  const sections = parseResumeSections(tailoredResume);

  // DIAG: Log what text is being scored and what skills are being checked
  const isTailoredScoring = tailoredResume !== originalResume;
  console.log(`\n${'='.repeat(80)}`);
  console.log(`[DIAG:computeATSScore] Scoring ${isTailoredScoring ? 'TAILORED' : 'ORIGINAL'} resume`);
  console.log(`[DIAG:computeATSScore] Tailored resume length: ${tailoredResume.length} chars, ${tailoredResume.split(/\s+/).length} words`);
  console.log(`[DIAG:computeATSScore] Tailored resume first 500 chars:\n---\n${tailoredResume.substring(0, 500)}\n---`);
  if (originalResume) {
    console.log(`[DIAG:computeATSScore] Original resume length: ${originalResume.length} chars, ${originalResume.split(/\s+/).length} words`);
    console.log(`[DIAG:computeATSScore] Original resume first 500 chars:\n---\n${originalResume.substring(0, 500)}\n---`);
  } else {
    console.log(`[DIAG:computeATSScore] Original resume: NOT PROVIDED`);
  }
  console.log(`[DIAG:computeATSScore] JD Hard Skills (${hardSkills.length}): [${hardSkills.join(', ')}]`);
  console.log(`[DIAG:computeATSScore] JD Soft Skills (${softSkills.length}): [${softSkills.join(', ')}]`);
  console.log(`[DIAG:computeATSScore] Job Title: "${jobTitle}"`);
  console.log(`[DIAG:computeATSScore] Parsed sections: ${sections.map(s => `${s.name}(zone${s.zone})`).join(', ')}`);
  console.log(`${'='.repeat(80)}\n`);

  // TIER 0: Parsing Gate
  const parsingGate = checkParsingGate(tailoredResume);
  if (!parsingGate.passed) {
    return {
      totalScore: 0,
      jdCoverageScore: 0,
      jdCoverageDetail: { overlappingSkills: 0, totalJDSkills: hardSkills.length, percentage: 0 },
      passedParsingGate: false,
      parsingFailReasons: parsingGate.reasons,
      tierScores: {
        hardSkillMatch: { score: 0, matched: [], missing: hardSkills, skillsGap: [] },
        jobTitleAlignment: { score: 0, matchType: 'none' },
        experienceRelevance: { score: 0, contextualKeywords: 0, bareListKeywords: 0, hasQuantifiedAchievements: false },
        softSkillMatch: { score: 0, matched: [], missing: softSkills },
        structuralCompliance: { score: 0, issues: parsingGate.reasons, contentChecks: [] },
        supplementaryFactors: { score: 0, issues: [] },
      },
      keywordDensity: [],
      recommendations: parsingGate.reasons.map(r => `Fix parsing issue: ${r}`),
      coveragePercentage: 0,
    };
  }

  // TIER 1-6 Scoring (Step 14 — recalibrated weights)
  const t1 = scoreHardSkillMatch(tailoredResume, hardSkills, sections, originalResume);
  const t2 = scoreJobTitleAlignment(tailoredResume, jobTitle, sections);
  const t3 = scoreExperienceRelevance(tailoredResume, hardSkills, sections, originalResume);
  const t4 = scoreSoftSkillMatch(tailoredResume, softSkills);
  const t5 = scoreStructuralCompliance(tailoredResume, sections);
  const t6 = scoreSupplementaryFactors(tailoredResume, t1.matched);

  // Step 14: Recalibrated weights
  const totalScore = Math.round(
    t1.score * 0.35 +   // Hard Skills (was 0.40)
    t2.score * 0.15 +   // Job Title
    t3.score * 0.20 +   // Experience Relevance
    t4.score * 0.05 +   // Soft Skills
    t5.score * 0.15 +   // Structure (was 0.10)
    t6.score * 0.10     // Supplementary
  );

  // Step 13: JD Coverage Score (secondary/informational)
  const overlappingCount = t1.matched.length + t1.missing.length; // Skills candidate has
  const jdCoveragePercentage = hardSkills.length > 0
    ? Math.round((overlappingCount / hardSkills.length) * 100)
    : 100;

  // Keyword density breakdown (only for matched/overlapping skills) — word-boundary matching
  const wordCount = tailoredResume.split(/\s+/).length;
  const keywordDensity = t1.matched.map(skill => {
    const escaped = skill.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const occurrences = (tailoredResume.match(new RegExp(`\\b${escaped}\\b`, 'gi')) || []).length;
    const density = wordCount > 0 ? (occurrences / wordCount) * 100 : 0;
    return { term: skill, density: Math.round(density * 100) / 100, overStuffed: density > 3 };
  });

  // Step 10: Generate verified recommendations
  const recommendations = generateRecommendations(jobTitle, tailoredResume, t1, t2, t3, t5, t6);

  // Coverage percentage (raw overlap before weighting)
  const coveragePercentage = hardSkills.length > 0
    ? Math.round((t1.matched.length / hardSkills.length) * 100)
    : 100;

  // Step 18: Debug/transparency data
  const skillsInResume = originalResume
    ? hardSkills.filter(s => termExistsWithSynonyms(s, originalResume))
    : hardSkills;

  return {
    totalScore,
    jdCoverageScore: jdCoveragePercentage,
    jdCoverageDetail: {
      overlappingSkills: overlappingCount,
      totalJDSkills: hardSkills.length,
      percentage: jdCoveragePercentage,
    },
    passedParsingGate: true,
    tierScores: {
      hardSkillMatch: t1,
      jobTitleAlignment: t2,
      experienceRelevance: t3,
      softSkillMatch: t4,
      structuralCompliance: t5,
      supplementaryFactors: t6,
    },
    keywordDensity,
    recommendations,
    coveragePercentage,
    scoringDebug: {
      hardSkillsFromJD: hardSkills,
      softSkillsFromJD: softSkills,
      skillsInResume,
      overlappingSkills: t1.matched,
      skillsGap: t1.skillsGap,
      noisePercentageFiltered: processedJD.debug?.noisePercentageFiltered || 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Cover Letter Scoring (Step 17 — accepts ProcessedJD)
// ---------------------------------------------------------------------------

export function scoreCoverLetter(
  coverLetter: string,
  processedJD: ProcessedJD,
  resumeText: string,
): CoverLetterScoreResult {
  const hardSkills = processedJD.extractedSkills.hardSkills;
  const recommendations: string[] = [];

  // 1. Keyword Reinforcement (30%)
  const top5 = hardSkills.slice(0, 5);
  const clLower = coverLetter.toLowerCase();
  const foundKeywords = top5.filter(s => termExistsWithSynonyms(s, coverLetter));
  const missingKeywords = top5.filter(s => !termExistsWithSynonyms(s, coverLetter));
  const keywordScore = top5.length > 0
    ? Math.min(100, Math.round((foundKeywords.length / top5.length) * 100))
    : 100;

  if (missingKeywords.length > 0) {
    recommendations.push(`Weave these JD keywords into the cover letter: ${missingKeywords.join(', ')}`);
  }

  // 2. Pain Point Coverage (30%) — use relevant JD text and extracted skills
  const relevantText = processedJD.sections.fullRelevantText;
  const jdSentences = relevantText.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 20);
  // Identify requirement sentences: must contain a requirement keyword AND at least one hard skill
  const topRequirements = jdSentences
    .filter(s => {
      const hasReqKeyword = /require|responsib|must|essential|key qualif|minimum|expected/i.test(s);
      const hasSkill = hardSkills.some(skill => {
        const escaped = skill.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`\\b${escaped}\\b`, 'i').test(s);
      });
      return hasReqKeyword || hasSkill;
    })
    .slice(0, 5);

  const addressed: string[] = [];
  const missed: string[] = [];
  for (const req of topRequirements) {
    // Check if the cover letter addresses this requirement by matching
    // hard skills and significant content words from the requirement
    const reqContentWords = req.toLowerCase().split(/\s+/)
      .filter(w => w.length > 3 && !['the','and','with','that','this','from','have','been','will','must'].includes(w));
    const skillsInReq = hardSkills.filter(skill => req.toLowerCase().includes(skill.toLowerCase()));
    const skillsAddressed = skillsInReq.filter(skill => termExistsWithSynonyms(skill, coverLetter));
    const contentMatch = reqContentWords.filter(w => clLower.includes(w)).length;

    // Addressed if: relevant skills mentioned OR significant content overlap
    if (skillsAddressed.length > 0 || (reqContentWords.length > 0 && contentMatch >= reqContentWords.length * 0.4)) {
      addressed.push(req.substring(0, 80) + (req.length > 80 ? '...' : ''));
    } else {
      missed.push(req.substring(0, 80) + (req.length > 80 ? '...' : ''));
    }
  }
  const painPointScore = topRequirements.length > 0
    ? Math.min(100, Math.round((addressed.length / topRequirements.length) * 100))
    : 100;

  // 3. Length Compliance (10%)
  const wordCount = coverLetter.split(/\s+/).length;
  let lengthScore: number;
  if (wordCount >= 250 && wordCount <= 400) lengthScore = 100;
  else if ((wordCount >= 200 && wordCount < 250) || (wordCount > 400 && wordCount <= 500)) lengthScore = 70;
  else lengthScore = 30;

  if (wordCount < 250) recommendations.push(`Cover letter is too short (${wordCount} words). Target 250-400 words.`);
  if (wordCount > 400) recommendations.push(`Cover letter is too long (${wordCount} words). Target 250-400 words.`);

  // 4. No Resume Duplication (10%)
  // Filter out common/stop words so overlap measures meaningful content words only
  const DUPLICATION_STOP_WORDS = new Set([
    'the','a','an','and','or','of','to','in','for','with','on','at','by','from',
    'is','are','was','were','be','been','have','has','had','do','does','did',
    'will','would','can','could','should','may','might','not','but','if','than',
    'that','this','these','those','it','its','my','your','our','their','his','her',
    'we','they','i','you','he','she','me','us','them','who','which','what','where',
    'when','how','all','each','both','more','most','other','some','such','so','too',
    'very','just','about','also','as','into','over','through','then','there',
  ]);
  const clSentences = coverLetter.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 20);
  const resumeLower = resumeText.toLowerCase();
  const resumeContentWords = new Set(
    resumeLower.split(/\s+/).filter(w => w.length > 2 && !DUPLICATION_STOP_WORDS.has(w))
  );
  const duplicatedSentences: string[] = [];
  for (const sentence of clSentences) {
    const contentWords = sentence.toLowerCase().split(/\s+/).filter(w => w.length > 2 && !DUPLICATION_STOP_WORDS.has(w));
    if (contentWords.length < 4) continue; // Too short to meaningfully compare
    const overlapCount = contentWords.filter(w => resumeContentWords.has(w)).length;
    if (overlapCount / contentWords.length > 0.85) {
      duplicatedSentences.push(sentence.substring(0, 60) + '...');
    }
  }
  const duplicationScore = Math.max(0, 100 - duplicatedSentences.length * 20);

  if (duplicatedSentences.length > 0) {
    recommendations.push('Some sentences closely duplicate resume content. Tell the story behind achievements instead.');
  }

  // 5. Structural Compliance (10%)
  const paragraphs = coverLetter.split(/\n\s*\n/).filter(p => p.trim().length > 0);
  const paragraphCount = paragraphs.length;
  const hasBullets = /^[-•*]\s/m.test(coverLetter);
  let structureScore: number;
  if (paragraphCount >= 3 && paragraphCount <= 4) structureScore = 100;
  else if (paragraphCount === 2 || paragraphCount === 5) structureScore = 60;
  else structureScore = 20;

  // 6. Authentic Voice (10%)
  const flaggedPhrases: string[] = [];
  for (const phrase of AI_ISM_BLACKLIST) {
    if (clLower.includes(phrase)) {
      flaggedPhrases.push(phrase);
    }
  }
  const voiceScore = Math.max(0, 100 - flaggedPhrases.length * 15);

  if (flaggedPhrases.length > 0) {
    recommendations.push(`Remove AI-sounding phrases: ${flaggedPhrases.join(', ')}`);
  }

  const totalScore = Math.round(
    keywordScore * 0.30 +
    painPointScore * 0.30 +
    lengthScore * 0.10 +
    duplicationScore * 0.10 +
    structureScore * 0.10 +
    voiceScore * 0.10
  );

  return {
    totalScore,
    tierScores: {
      keywordReinforcement: { score: keywordScore, found: foundKeywords, missing: missingKeywords },
      painPointCoverage: { score: painPointScore, addressed, missed },
      lengthCompliance: { score: lengthScore, wordCount },
      noDuplication: { score: duplicationScore, duplicatedSentences },
      structuralCompliance: { score: structureScore, paragraphCount, hasBullets },
      authenticVoice: { score: voiceScore, flaggedPhrases },
    },
    recommendations,
  };
}
