// ---------------------------------------------------------------------------
// LinkedIn-specific pre-sanitizer — runs server-side before the existing
// jd-preprocessor pipeline to strip paste artifacts and HR boilerplate.
// ---------------------------------------------------------------------------

import { extractSkillsFromJD, extractRequirementMetadata } from './jd-preprocessor';
import type { ExtractedSkills, RequirementMetadata } from './jd-preprocessor';

// ---------------------------------------------------------------------------
// Tech skill set for boilerplate guard (flat lowercase set from jd-preprocessor)
// ---------------------------------------------------------------------------

const TECH_TERMS: string[] = [
  // Languages
  'python', 'javascript', 'typescript', 'java', 'c++', 'c#', 'go', 'golang',
  'rust', 'ruby', 'php', 'swift', 'kotlin', 'scala', 'sql', 'html', 'css',
  // Frameworks
  'react', 'angular', 'vue', 'next.js', 'django', 'flask', 'fastapi',
  'spring', 'express', 'node.js', 'nestjs', 'rails', 'laravel', '.net',
  'tensorflow', 'pytorch', 'pandas', 'numpy', 'spark', 'kafka',
  // Cloud / DevOps
  'aws', 'azure', 'gcp', 'docker', 'kubernetes', 'terraform', 'jenkins',
  'github actions', 'datadog', 'grafana', 'prometheus', 'elasticsearch',
  // Databases
  'postgresql', 'mysql', 'mongodb', 'redis', 'dynamodb', 'snowflake',
  'firebase', 'supabase', 'cassandra', 'neo4j',
  // Methodologies / Concepts
  'ci/cd', 'agile', 'scrum', 'microservices', 'rest', 'graphql', 'grpc',
  'machine learning', 'deep learning', 'nlp', 'llm', 'etl', 'data pipeline',
  'distributed systems', 'api design',
];

const TECH_SKILL_SET = new Set(TECH_TERMS);

// ---------------------------------------------------------------------------
// 1. stripLinkedInArtifacts — line-level removal of paste junk
// ---------------------------------------------------------------------------

const EXACT_ARTIFACT_LINES = new Set([
  'see more', 'show more', 'show less', 'report this job', 'follow', 'save',
  'apply', 'easy apply', 'share', 'message', 'jobs', 'people', 'companies',
  'linkedin', 'actively recruiting', 'matches your job preferences',
  'repost', 'like', 'comment', 'about the job', 'done',
]);

const ARTIFACT_LINE_PATTERNS: RegExp[] = [
  /^\d+\s+applicants?$/i,
  /^posted\s+\d+\s+(days?|weeks?|months?|hours?)\s+ago$/i,
  /^reposted\s+\d+\s+(days?|weeks?|months?|hours?)\s+ago$/i,
  /^\d[\d,]*\s+employees?$/i,
  /^\d[\d,]*-\d[\d,]*\s+employees?$/i,
  /^job\s*id\s*:?\s*.+$/i,
  /^seniority\s+level\s*:?\s*.*/i,
  /^employment\s+type\s*:?\s*.*/i,
  /^job\s+function\s*:?\s*.*/i,
  /^industries?\s*:?\s*.*/i,
  // Standalone location-with-type lines (short, matches pattern)
  /^[A-Z][a-z]+(?:\s[A-Z][a-z]+)*,\s*[A-Z]{2}\s*\((?:Remote|On-site|Hybrid|On\s*site)\)$/,
  /^[A-Z][a-z]+(?:\s[A-Z][a-z]+)*,\s*[A-Z][a-z]+(?:\s[A-Z][a-z]+)*\s*\((?:Remote|On-site|Hybrid|On\s*site)\)$/,
  // Referral prompts
  /^know\s+someone\s+who\s+would\s+be\s+a\s+great\s+fit/i,
  /^refer\s+a\s+friend/i,
  // Reactions & engagement
  /^\d+\s+(likes?|comments?|reposts?|reactions?)$/i,
];

export function stripLinkedInArtifacts(rawText: string): {
  sanitized: string;
  strippedItems: string[];
} {
  const lines = rawText.split('\n');
  const kept: string[] = [];
  const strippedItems: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      kept.push('');
      continue;
    }

    const lower = trimmed.toLowerCase();

    // Exact match
    if (EXACT_ARTIFACT_LINES.has(lower)) {
      strippedItems.push(trimmed);
      continue;
    }

    // Pattern match (only for short lines — long lines are likely real content)
    if (trimmed.length < 80) {
      let matched = false;
      for (const pattern of ARTIFACT_LINE_PATTERNS) {
        if (pattern.test(trimmed)) {
          strippedItems.push(trimmed);
          matched = true;
          break;
        }
      }
      if (matched) continue;
    }

    kept.push(line);
  }

  // Collapse excessive blank lines (3+ consecutive → 2)
  const sanitized = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();

  return { sanitized, strippedItems };
}

// ---------------------------------------------------------------------------
// 2. stripHRBoilerplate — paragraph-level removal of noise content
// ---------------------------------------------------------------------------

const BOILERPLATE_INDICATORS: RegExp[] = [
  /equal\s+opportunity\s+employer/i,
  /regardless\s+of\s+race/i,
  /affirmative\s+action/i,
  /protected\s+veteran/i,
  /disability\s+status/i,
  /gender\s+identity/i,
  /sexual\s+orientation/i,
  /we\s+are\s+an?\s+(?:equal|inclusive)/i,
  /accommodation\s+(?:for|during|in)\s+(?:the\s+)?(?:application|interview|hiring)/i,
  // Benefits blocks
  /\b(?:401k|401\(k\)|dental\s+(?:insurance|plan)|vision\s+(?:insurance|plan)|health\s+insurance|medical\s+insurance|pto|paid\s+time\s+off|parental\s+leave|tuition\s+reimbursement|wellness\s+(?:stipend|program)|life\s+insurance|disability\s+insurance|stock\s+options|equity\s+compensation)\b/i,
  // Salary / compensation disclosure
  /\bpay\s+(?:range|scale|transparency)\b/i,
  /\bbase\s+(?:salary|pay)\s+range/i,
  /\$[\d,]+\s*[-–]\s*\$[\d,]+/,
];

function paragraphContainsTechSkill(paragraph: string): boolean {
  const lower = paragraph.toLowerCase();
  for (const term of TECH_SKILL_SET) {
    if (lower.includes(term)) return true;
  }
  return false;
}

export function stripHRBoilerplate(text: string): {
  sanitized: string;
  boilerplateWordCount: number;
} {
  // Split into paragraphs (double newline or more)
  const paragraphs = text.split(/\n\s*\n/);
  const kept: string[] = [];
  let boilerplateWordCount = 0;

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    const isBoilerplate = BOILERPLATE_INDICATORS.some((p) => p.test(trimmed));

    if (isBoilerplate && !paragraphContainsTechSkill(trimmed)) {
      boilerplateWordCount += trimmed.split(/\s+/).length;
      continue;
    }

    kept.push(trimmed);
  }

  return {
    sanitized: kept.join('\n\n'),
    boilerplateWordCount,
  };
}

// ---------------------------------------------------------------------------
// 3. extractTitleCompanyFromPaste — heuristic title/company from raw paste
// ---------------------------------------------------------------------------

const ROLE_KEYWORDS = /\b(?:engineer|developer|manager|director|analyst|designer|architect|scientist|lead|coordinator|specialist|consultant|administrator|intern|associate|officer|vice\s+president|vp|head\s+of|chief)\b/i;

export function extractTitleCompanyFromPaste(rawText: string): {
  title?: string;
  company?: string;
} {
  const lines = rawText.split('\n');
  const candidates: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length > 100) continue;

    const lower = trimmed.toLowerCase();

    // Skip known artifact lines
    if (EXACT_ARTIFACT_LINES.has(lower)) continue;

    // Skip lines that are clearly metadata
    let isMetadata = false;
    for (const pattern of ARTIFACT_LINE_PATTERNS) {
      if (pattern.test(trimmed)) {
        isMetadata = true;
        break;
      }
    }
    if (isMetadata) continue;

    // Skip very short lines (< 3 chars) or lines that look like numbers only
    if (trimmed.length < 3 || /^\d+$/.test(trimmed)) continue;

    candidates.push(trimmed);
    if (candidates.length >= 2) break;
  }

  let title: string | undefined;
  let company: string | undefined;

  if (candidates.length >= 1) {
    title = candidates[0];
  }

  if (candidates.length >= 2) {
    // If the second line contains role keywords, it's probably not a company
    if (ROLE_KEYWORDS.test(candidates[1])) {
      company = undefined;
    } else {
      company = candidates[1];
    }
  }

  return { title, company };
}

// ---------------------------------------------------------------------------
// 4. distillRequirements — extract structured requirement strings
// ---------------------------------------------------------------------------

const VERB_BANK = [
  // Leadership
  'spearheaded', 'championed', 'directed', 'orchestrated', 'navigated',
  'galvanized', 'delegated', 'mentored', 'cultivated', 'facilitated',
  // Technical
  'architected', 'engineered', 'deployed', 'automated', 'modernized',
  'refactored', 'optimized', 'integrated', 'standardized', 'debugged',
  // Analytical
  'deciphered', 'audited', 'forecasted', 'discovered', 'evaluated',
  'validated', 'investigated', 'identified', 'interpreted', 'reconciled',
  // Communication
  'negotiated', 'influenced', 'persuaded', 'authored', 'presented',
  'advised', 'consulted', 'mediated', 'clarified', 'collaborated',
  // Impact/Results
  'pioneered', 'transformed', 'generated', 'launched', 'exceeded',
  'accelerated', 'maximized', 'secured', 'revitalized', 'reduced',
];

const VERB_BANK_SET = new Set(VERB_BANK);

// Common JD action verbs that map to the verb bank categories
const JD_ACTION_VERBS = [
  'build', 'builds', 'design', 'designs', 'develop', 'develops',
  'implement', 'implements', 'manage', 'manages', 'lead', 'leads',
  'create', 'creates', 'maintain', 'maintains', 'drive', 'drives',
  'collaborate', 'collaborates', 'own', 'owns', 'deliver', 'delivers',
  'analyze', 'analyzes', 'test', 'tests', 'write', 'writes',
  'configure', 'configures', 'monitor', 'monitors', 'troubleshoot',
  'troubleshoots', 'optimize', 'optimizes', 'deploy', 'deploys',
  'automate', 'automates', 'scale', 'scales', 'mentor', 'mentors',
];

const JD_ACTION_VERB_SET = new Set(JD_ACTION_VERBS);

export function distillRequirements(
  fullRelevantText: string,
  extractedSkills: ExtractedSkills,
  metadata: RequirementMetadata,
): string[] {
  const requirements: string[] = [];
  const seen = new Set<string>();

  function addUnique(item: string) {
    const key = item.toLowerCase().trim();
    if (key && !seen.has(key)) {
      seen.add(key);
      requirements.push(item.trim());
    }
  }

  // 1. Hard skills (technical nouns)
  for (const skill of extractedSkills.hardSkills) {
    addUnique(skill);
  }

  // 2. Years-of-experience strings
  for (const yoe of metadata.yearsExperience) {
    const area = yoe.area ? ` of ${yoe.area}` : '';
    addUnique(`${yoe.min}+ years${area}`);
  }

  // 3. Certifications
  for (const cert of metadata.certifications) {
    addUnique(cert);
  }

  // 4. Degree requirement
  if (metadata.degreeRequirement) {
    const { level, field } = metadata.degreeRequirement;
    const fieldStr = field ? ` in ${field}` : '';
    addUnique(`${level} degree${fieldStr}`);
  }

  // 5. Extract compact verb+object phrases from sentences containing JD action verbs
  const sentences = fullRelevantText.split(/[.;!?]+/).map((s) => s.trim()).filter(Boolean);
  for (const sentence of sentences) {
    const words = sentence.split(/\s+/);
    for (let i = 0; i < words.length; i++) {
      const word = words[i].toLowerCase().replace(/[^a-z]/g, '');
      if (JD_ACTION_VERB_SET.has(word) || VERB_BANK_SET.has(word)) {
        // Grab verb + up to 6 following words as a compact phrase
        const phrase = words.slice(i, i + 7).join(' ').replace(/[,;:]+$/, '').trim();
        if (phrase.length >= 10 && phrase.length <= 80) {
          addUnique(phrase);
        }
        break; // One phrase per sentence
      }
    }
  }

  return requirements;
}
