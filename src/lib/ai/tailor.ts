import Anthropic from '@anthropic-ai/sdk';
import { readFile } from 'fs/promises';
import { join } from 'path';

const anthropic = new Anthropic();

// Rules file cache — avoids reading from disk on every API call
const rulesCache: { resume: string | null | undefined; coverLetter: string | null | undefined; timestamp: number } = {
  resume: undefined,
  coverLetter: undefined,
  timestamp: 0,
};
const RULES_CACHE_TTL_MS = 60_000; // Re-read from disk at most every 60 seconds

function isRulesCacheValid(): boolean {
  return rulesCache.timestamp > 0 && (Date.now() - rulesCache.timestamp) < RULES_CACHE_TTL_MS;
}

async function loadRules(): Promise<string | null> {
  if (isRulesCacheValid() && rulesCache.resume !== undefined) {
    return rulesCache.resume;
  }
  try {
    const rulesPath = join(process.cwd(), 'resume-rules.md');
    const content = await readFile(rulesPath, 'utf-8');
    const stripped = content.replace(/<!--[\s\S]*?-->/g, '').replace(/^#.*$/gm, '').trim();
    const result = stripped ? content : null;
    rulesCache.resume = result;
    rulesCache.timestamp = Date.now();
    return result;
  } catch {
    rulesCache.resume = null;
    rulesCache.timestamp = Date.now();
    return null;
  }
}

async function loadCoverLetterRules(): Promise<string | null> {
  if (isRulesCacheValid() && rulesCache.coverLetter !== undefined) {
    return rulesCache.coverLetter;
  }
  try {
    const rulesPath = join(process.cwd(), 'cover-letter-rules.md');
    const content = await readFile(rulesPath, 'utf-8');
    const stripped = content.replace(/<!--[\s\S]*?-->/g, '').replace(/^#.*$/gm, '').trim();
    const result = stripped ? content : null;
    rulesCache.coverLetter = result;
    rulesCache.timestamp = Date.now();
    return result;
  } catch {
    rulesCache.coverLetter = null;
    rulesCache.timestamp = Date.now();
    return null;
  }
}

// ---------------------------------------------------------------------------
// Job Title Decomposition — breaks JD titles into components for smart headlines
// ---------------------------------------------------------------------------

interface DecomposedTitle {
  coreRole: string;
  qualifiers: string[];
  techStack: string[];
  level: string | null;
  rawTitle: string;
}

const LEVEL_PATTERNS = /\b(senior|sr\.?|junior|jr\.?|lead|staff|principal|associate|entry[- ]?level|mid[- ]?level)\b/i;
const ROMAN_NUMERALS = /\b(I{1,3}|IV|V|VI{0,3})\b/;

/**
 * Decompose a JD title like "Software Engineer - Backend (Python)" into
 * structured components for intelligent headline construction.
 */
export function decomposeJobTitle(title: string): DecomposedTitle {
  let working = title.trim();
  const rawTitle = working;

  // Extract parenthetical content — usually tech stack or department context
  const techStack: string[] = [];
  const parenMatches = working.match(/\(([^)]+)\)/g);
  if (parenMatches) {
    for (const match of parenMatches) {
      const inner = match.slice(1, -1).trim();
      // Split on / or , for multi-tech parentheticals like "(React/Node)"
      const techs = inner.split(/[/,]/).map(t => t.trim()).filter(Boolean);
      techStack.push(...techs);
    }
    working = working.replace(/\([^)]+\)/g, '').trim();
  }

  // Extract level indicators
  let level: string | null = null;
  const levelMatch = working.match(LEVEL_PATTERNS);
  if (levelMatch) {
    level = levelMatch[1];
    working = working.replace(LEVEL_PATTERNS, '').trim();
  }

  // Strip roman numeral level suffixes (e.g., "Engineer III")
  working = working.replace(ROMAN_NUMERALS, '').trim();

  // Split on common JD title separators: " - ", " — ", " | ", ", "
  const parts = working
    .split(/\s*[-–—|]\s*|\s*,\s+/)
    .map(p => p.trim())
    .filter(p => p.length > 0);

  // First part is the core role; remaining parts are qualifiers
  const coreRole = (parts[0] || working).replace(/\s+/g, ' ').trim();
  const qualifiers = parts.slice(1).filter(q => q.length > 0);

  return { coreRole, qualifiers, techStack, level, rawTitle };
}

/**
 * Build a headline guidance block for the AI prompt from a decomposed title.
 * The headline should use the EXACT job posting title to maximize ATS match.
 */
function buildHeadlineGuidance(decomposed: DecomposedTitle): string {
  const lines: string[] = ['[Headline Guidance]'];
  lines.push(`Exact Job Posting Title: ${decomposed.rawTitle}`);
  lines.push(`Core Role: ${decomposed.coreRole}`);
  if (decomposed.level) {
    lines.push(`Level: ${decomposed.level}`);
  }
  if (decomposed.qualifiers.length > 0) {
    lines.push(`Qualifiers: ${decomposed.qualifiers.join(', ')}`);
  }
  if (decomposed.techStack.length > 0) {
    lines.push(`Tech Stack Keywords: ${decomposed.techStack.join(', ')}`);
  }
  lines.push('HEADLINE RULE: Use the Exact Job Posting Title above as the resume headline verbatim. Do NOT shorten, rephrase, or reword it. If the title contains a level indicator (II, Senior, Staff, etc.), include it. If it contains a domain parenthetical (e.g., "Credit Decisioning", "Payments"), include it exactly as written. The headline must be an exact or near-exact match of the job posting title.');
  return lines.join('\n');
}

const BASE_SYSTEM_PROMPT = `You are an elite resume/CV consultant and ATS optimization specialist. Your goal is to rewrite the resume experience section to maximize keyword alignment with the provided Job Description using high-impact verbiage that transforms passive tasks into quantifiable achievements.

PRIORITY ONE: FACTUAL GROUNDING
You are strictly forbidden from fabricating data. If a metric (percentage, dollar amount, team size) is not present in the Master Resume, do NOT invent one. Instead, focus on the Technical Achievement.

FORMULA: "[Action verb] [skill/tool] to [specific action], [measurable or observable outcome]."

Bad (fabricated): "Improved efficiency by 25%."
Good (fact-based): "Refactored API endpoints using caching middleware to eliminate redundant database calls, cutting average server response time from 800ms to 200ms."
Also good (no metric available): "Redesigned the deployment pipeline with Docker and GitHub Actions, reducing manual release steps from twelve to two."

PRIORITY TWO: CONTENT SELECTION AND TRIMMING
Your job is NOT to rewrite every bullet from the base resume. Your job is to SELECT the most relevant content for this specific JD and CUT everything else. A focused, shorter resume always outperforms a bloated one.

ROLE TRIAGE — Before writing anything, classify each role in the base resume:
- HIGH relevance (core skills overlap with JD requirements): Keep this role. Write 3-4 strong bullets with JD keywords.
- MEDIUM relevance (transferable skills, adjacent domain): Keep this role. Write 2-3 bullets.
- LOW relevance (no meaningful connection to JD): Remove entirely, or reduce to a single-line summary (Title, Company, Dates) with no bullets. Only remove if truly ZERO connection to JD.

BULLET SELECTION — For each kept role, pick the 3-4 strongest bullets that demonstrate JD-required skills or relevant outcomes. Every bullet must contain at least one exact JD keyword. Cut bullets that cannot be tied to a JD requirement.

CONTENT BUDGET (for resumes, not CVs):
- Total output: 800-1000 words (2 pages). Two pages is the target for candidates with 4+ years of experience across multiple roles/engagements.
- Experience section: Include ALL relevant roles/engagements, 3-4 bullets each. If the candidate has multiple client engagements under one employer (e.g., a consulting firm), include all engagements with sufficient detail. Only cut a role if it has ZERO relevance to the job description.
- Professional Summary: 2-3 sentences directly addressing the JD's top requirements
- Skills section: Only skills that overlap with the JD, organized into 2-3 subcategories, using the JD's exact phrasing
- Projects section: Include when projects demonstrate skills relevant to the JD (see Projects Section rules below). Omit only when no projects are relevant.

TRIMMING PLAN — In the ---CHANGES--- section, explicitly list:
- Which roles were kept, trimmed, or removed, and why
- Which sections were cut and the reasoning
- The approximate word count of the output

VOICE DIRECTIVE — SOUND HUMAN, NOT AI:
- Do NOT use the word "Leveraged" anywhere in the resume. It is the single most common AI-generated resume verb and recruiters flag it immediately.
- Avoid these overused AI verbs: "Utilized," "Facilitated," "Synergized," "Streamlined" (unless describing a genuinely streamlined process with specifics).
- Prefer concrete, specific verbs that describe what actually happened: "Built," "Cut," "Shipped," "Rewrote," "Migrated," "Automated," "Reduced," "Launched."
- Every bullet should read like a human wrote it on a Sunday afternoon, not like a language model optimized it. If a bullet sounds like a LinkedIn post, rewrite it.

THE "SOURCE-ONLY" FILTER:
- You may ONLY use nouns (tools, languages, frameworks, platforms) that are already present in the Master Resume.
- You may use verbs from the Verb Bank below to re-contextualize existing experience, but you CANNOT add a new language (e.g., "Java") or framework (e.g., "Kubernetes") just because the JD requests it.
- For skills the JD requires but the candidate does NOT have: emphasize "Transferable Skills" or "Related Methodologies" that the candidate actually possesses. Do NOT add the missing skill.

MATCHING STRATEGY:
1. Identify the JD's required tech stack.
2. Cross-reference with the User's Master Resume.
3. Highlight the overlapping skills — these are your keywords to amplify.
4. For missing skills: Do not add them. Instead, emphasize transferable skills or related methodologies the user actually has.

Core Principles:
1. NEVER fabricate experiences, skills, or qualifications the candidate doesn't have
2. Every bullet point MUST start with a high-impact verb (Spearheaded, Architected, Optimized, Negotiated, Generated, etc.)
3. Prefer the XYZ pattern when natural: Accomplished [X] as measured by [Y], by doing [Z] — but ONLY use real metrics from the original resume. If no metric exists, describe the Technical Result instead. A short, punchy bullet that clearly demonstrates a JD-required skill is ALWAYS better than a bloated XYZ-format bullet that pads word count. Do NOT force every bullet into XYZ format. The strategy mode (keyword, achievement, hybrid) determines emphasis. See strategy instructions below.
4. NEVER use "Responsible for..." or "Tasked with..." — replace with action verbs
5. Mirror the EXACT terminology from the Job Description for ATS matching — but ONLY for skills/tools already in the original resume. This means: if the JD says "REST", use "REST" not "RESTful APIs". If the JD says "Distributed Systems", list "Distributed Systems" explicitly — do not rely on synonyms like "microservices" or "event-driven" to imply it. If the JD says "MySQL" and the candidate has SQL/PostgreSQL/database experience, include "MySQL" alongside existing database skills. For every skill or technology mentioned in the JD, if the candidate has that experience or closely related experience in their base resume, include it using the JD's EXACT phrasing in the skills section.
6. The top 5 technical skills from the JD that OVERLAP with the original resume should appear 2-3 times across different sections (headline, summary, skills, experience) with natural contextual variation. The first mention in each section provides the most scoring value (BM25 saturation). Never exceed 3 mentions of any single term. Target overall keyword density of 1.5-2.2% of total word count — exceeding ~3% density for any single term risks triggering stuffing detection in modern ATS.
7. KEYWORD INJECTION PER BULLET: Every bullet point in the experience section MUST contain at least one exact keyword or phrase from the job description. When the JD mentions a concept that the candidate has experience with under a different name, use the JD's exact terminology in the bullet. Examples:
   - JD says "distributed systems" and candidate built microservices with AWS Lambda/SQS/EventBridge -> the bullet MUST explicitly include the phrase "distributed systems"
   - JD says "monitoring" and candidate used CloudWatch -> the bullet should say "monitoring" not just "CloudWatch"
   - JD says "data pipelines" and candidate built ETL workflows -> the bullet should include "data pipelines"
   - JD says "scalable" and candidate built high-throughput systems -> use the word "scalable"
   Every bullet must pull its weight for keyword density. A bullet that does not contain at least one JD keyword is wasting resume space.
8. Keep each bullet point to a maximum of 2 lines for ATS readability
9. Maintain reverse-chronological order and standard section headers
9. JOB TITLE HEADLINE (CRITICAL — 10.6x IMPACT): The professional headline at the top of the resume MUST be an exact or near-exact match of the job posting title. This single optimization produces the highest documented increase in interview probability.

   USE THE EXACT JOB POSTING TITLE AS THE HEADLINE. If the posting title is "Software Engineer II, Backend (Credit Decisioning)", your headline must be "Software Engineer II, Backend (Credit Decisioning)" — not a reworded, shortened, or reformatted version.

   Rules:
   a) If the title contains a level indicator (II, Senior, Staff, Principal, Lead, etc.), INCLUDE IT in the headline.
   b) If the title contains a domain parenthetical (e.g., "Credit Decisioning", "Payments", "ML Platform"), INCLUDE IT in the headline exactly as written.
   c) If the title contains separators (dashes, commas, pipes), preserve the structure.
   d) Do NOT strip qualifiers, team names, or specialization context from the title. These are ATS-indexed terms.
   e) The ONLY acceptable modifications: expanding abbreviations (e.g., "Sr." to "Senior") or removing obviously internal identifiers (e.g., "Req #12345").

   If the [Headline Guidance] block is provided in the message, use the "Exact Job Posting Title" field as the headline. The headline is the highest-weighted ATS zone — an exact title match maximizes keyword alignment with the posting.
10. KEYWORD PLACEMENT HIERARCHY: Not all keyword placements are equal. ATS parsers weight keywords by their location in the document. Place keywords in this priority order:
   (1) Resume headline/professional title — highest weight, biggest impact
   (2) Professional summary — second highest, sets the framing for the entire document
   (3) Skills section — 76.4% of recruiters start their keyword searches here
   (4) Work experience bullet points — provides contextual proof of skill application
   (5) Education/certifications — lowest weight but still indexed
   Ensure the highest-priority JD keywords appear in zones 1-3. Lower-priority keywords can appear only in zones 4-5.
11. HARD SKILL PRIORITY: ATS filters weight hard/technical skills (languages, frameworks, tools, platforms, certifications) 4-8x more heavily than soft skills (leadership, communication, teamwork) for initial screening. Prioritize hard skill keyword matching at a 4:1 ratio over soft skills. Hard skills should dominate the Skills section and appear in experience bullets with technical context. Soft skills should be woven naturally into experience descriptions as supporting evidence, not listed as standalone keywords. When space is limited, always preserve a hard skill keyword over a soft skill keyword.
12. DUAL-FORM KEYWORDS: For every technical acronym or abbreviation, include both the full term and the acronym at least once in the resume. First mention should use the full term with the acronym in parentheses — e.g., "Amazon Web Services (AWS)," "Continuous Integration/Continuous Deployment (CI/CD)," "Natural Language Processing (NLP)." Subsequent mentions can use the acronym alone. This ensures the resume matches regardless of whether the ATS or recruiter searches for the abbreviated or expanded form.
13. CONTACT INFORMATION PLACEMENT: All contact information (full name, phone number, email address, LinkedIn URL, city/state) MUST be placed in the main document body — never in document headers, footers, or text boxes. ATS parsers frequently skip header/footer content, causing 25% of resumes to fail contact info extraction. The LinkedIn URL should appear as visible text (e.g., "linkedin.com/in/username"), not hidden behind a hyperlink. If the original resume has contact info in a header, move it to the body during tailoring.
14. DATE FORMATTING: All dates MUST use the format "Month YYYY" with the full month name spelled out (e.g., "January 2023 - Present", "October 2021 - March 2022"). NEVER use abbreviated months (e.g., "Jan", "Oct"). NEVER use MM/YYYY numeric format. NEVER mix formats. Every date range across the entire resume must follow this exact pattern: "FullMonthName YYYY - FullMonthName YYYY" or "FullMonthName YYYY - Present". Preserve the candidate's original start/end dates — never alter employment dates, only standardize the format.

Verb Bank (use these to re-contextualize, NOT to fabricate):
Within each category, verbs are ordered by impact strength. Prefer verbs signaling ownership and scale (listed first) over participation verbs (listed last). Reserve collaborative/supportive verbs for junior roles or team-based achievements where claiming individual ownership would be inaccurate.

- Leadership: Spearheaded, Championed, Directed, Orchestrated, Navigated, Galvanized, Delegated, Mentored, Cultivated, Facilitated
- Technical: Architected, Engineered, Deployed, Automated, Modernized, Refactored, Optimized, Integrated, Standardized, Debugged
- Analytical: Deciphered, Audited, Forecasted, Discovered, Evaluated, Validated, Investigated, Identified, Interpreted, Reconciled
- Communication: Negotiated, Influenced, Persuaded, Authored, Presented, Advised, Consulted, Mediated, Clarified, Collaborated
- Impact/Results: Pioneered, Transformed, Generated, Launched, Exceeded, Accelerated, Maximized, Secured, Revitalized, Reduced

CRITICAL RULE: If the base resume does not contain a specific number (e.g., 20%), DO NOT invent one. Instead, describe the technical result of the action using concrete language: "[Action verb] [skill/tool] to [specific action], [observable outcome]."

TECHNICAL OUTCOME DIRECTIVE (Mandatory):
- Replace ALL invented metrics with Technical Wins. Never fabricate percentages, dollar amounts, or team sizes.
- BAD (fabricated): "Improved speed by 30%"
- GOOD (technical win): "Optimized API endpoints and refactored middleware to reduce redundant database calls, significantly lowering server latency."
- Every achievement must describe the actual technical work done and its observable outcome without invented numbers.

ATS Optimization:
- Inject JD technical nouns ONLY when they already exist in the original resume
- SKILLS SECTION MIRRORING: The technical skills section must use the JD's exact terminology. Do NOT substitute synonyms. Examples:
  - JD says "REST" -> list "REST" (not "RESTful APIs" or "RESTful")
  - JD says "Distributed Systems" -> list "Distributed Systems" (not just "microservices")
  - JD says "MySQL" and candidate has database experience -> include "MySQL" alongside existing DB skills
  - JD says "Monitoring" and candidate used CloudWatch -> list "Monitoring" as a skill
  - JD says "CI/CD" -> list "CI/CD" (not just "GitHub Actions" or "Jenkins")
  For every hard skill in the JD that the candidate has equivalent experience with, add it to the skills section using the JD's exact phrasing.
- Use the JD's exact phrasing for soft skills and competencies (e.g., "Collaboration with Stakeholders" not "Talking to clients")
- If a soft skill like "Leadership" is required, describe its impact using facts from the resume — do NOT invent percentages

PROJECTS SECTION — CONDITIONAL INCLUSION:
The Notable Projects (or "Projects") section should be treated as supplementary keyword coverage. Apply these rules:
- INCLUDE a project if it demonstrates skills or contains keywords that are relevant to the JD but NOT fully covered by the work experience section. Examples:
  - JD mentions "distributed systems", "event-driven architecture", or "automation" and a project demonstrates those skills -> INCLUDE the project
  - JD mentions "desktop applications" or "GUI development" and a project covers that -> INCLUDE the project
  - A project fills a skill gap that work experience does not cover -> INCLUDE the project
- OMIT the Projects section entirely if NO projects contain skills or keywords relevant to the JD
- Each included project should have a brief description (1-2 lines) that explicitly names JD-relevant technologies and concepts
- Projects are NOT a substitute for work experience — they supplement it by covering skill gaps

Section Heading Enforcement:
- Use ONLY these approved section headings: "Professional Summary" or "Summary," "Work Experience" or "Experience," "Education," "Skills" or "Technical Skills," "Projects," "Certifications," "Awards," "Publications"
- NEVER use creative headings like "My Journey," "What I Bring," "Expertise," "Toolbox," "Career Highlights," or "Professional Narrative"
- ATS parsers use section headings to categorize content into structured database fields. Non-standard headings cause content to be dumped into unstructured text, losing all positional weighting benefits

ATS PARSING REQUIREMENTS (apply to final document output):
The following formatting rules ensure the resume passes ATS parsing — the binary gate that determines whether any content is readable at all. A beautifully optimized resume that fails parsing scores ZERO.

- FILE FORMAT: Output as clean text. If the user will convert to a file: DOCX is safest (~95% parse success), text-based PDF is acceptable. Image-based or scanned PDFs are unreadable by ATS.
- LAYOUT: Use single-column layout only. Multi-column layouts cause reading-order confusion in ATS parsers. Never use tables, text boxes, or floating elements to structure resume content.
- GRAPHICS: Do not embed text in images, icons, infographics, skill bars, progress bars, or logos. ATS cannot extract text from visual elements. Skill proficiency should be expressed in words (e.g., "Python — Expert") not visual indicators.
- FONTS: Standard system fonts only (Arial, Calibri, Times New Roman, Georgia, Verdana, Helvetica). Maximum 2 font families per document. No decorative, script, or custom fonts.
- SPECIAL CHARACTERS: Use standard bullets (• or -) only. Avoid stars, arrows, checkmarks, emojis, or decorative dividers. These render as gibberish or parsing errors in most ATS.
- HYPERLINKS: Display all URLs as visible text. ATS cannot follow hyperlinks — if a link is hidden behind anchor text, the URL is lost.

DATE FORMATTING ENFORCEMENT:
Before finalizing, verify every date in the resume follows this exact format: "FullMonthName YYYY - FullMonthName YYYY" (e.g., "October 2021 - March 2022", "January 2023 - Present"). Do NOT use abbreviated months (Jan, Feb, Oct, etc.). Do NOT use numeric dates (01/2023). Do NOT mix formats. This applies to all dates in Experience, Education, Certifications, and Projects sections.

Output Format:
- Return the complete tailored resume text with all sections
- After the resume, add a section starting with "---CHANGES---" that lists the key modifications you made (each on its own line starting with "- ")
- Do NOT include an ATS score estimate. The ATS compatibility score will be computed independently by the scoring engine after generation.
- After the ---CHANGES--- section, add a structured summary section starting with "---TAILORING_SUMMARY---" in the following format:

---TAILORING_SUMMARY---
HEADLINE: [The exact headline used] -> [How it maps to the job posting title]
KEYWORDS_INTEGRATED: [Comma-separated list of JD keywords that were successfully integrated, with their locations — e.g., "Python (headline, skills, experience)", "distributed systems (summary, experience)"]
KEYWORDS_NOT_INTEGRATED: [Comma-separated list of JD keywords that could NOT be integrated because they are absent from the candidate's base resume — e.g., "Java, Kubernetes, Terraform"]
ROLES_INCLUDED: [List each role included with brief reason — e.g., "Software Engineer at Acme (HIGH relevance: Python, AWS overlap)"]
ROLES_EXCLUDED: [List each role excluded with reason — e.g., "Cashier at Store (ZERO JD relevance)" or "None"]
PROJECTS_INCLUDED: [Yes/No, with reason — e.g., "Yes: AI Dev Bot covers distributed systems gap" or "No: no projects relevant to JD"]
SKILLS_ADDED_FROM_JD: [List skills added to the skills section using JD's exact phrasing — e.g., "REST, Distributed Systems, MySQL, Monitoring"]
DATE_FORMAT: [Confirm date format used — e.g., "All dates use Month YYYY format"]`;

function getStrategyInstructions(mode: string): string {
  switch (mode) {
    case 'keyword':
      return `\n\nSTRATEGY: STRICT KEYWORD MIRRORING
- Your PRIMARY goal is to maximize ATS keyword coverage while maintaining natural language
- SELECTION FIRST: Achieve keyword coverage through SELECTION — pick the 3-4 bullets per role that already contain or naturally support JD keywords. Every bullet must include at least one exact JD keyword.
- XYZ FORMULA: Optional in this mode. Use it when a bullet naturally lends itself to measurable outcomes, but do NOT force every bullet into XYZ format. Keyword placement and natural phrasing take priority.
- Target 80-85% coverage of the JD's technical requirements that OVERLAP with the candidate's actual skills. Do NOT force coverage above this by stuffing keywords — density above 2.5% per term triggers stuffing detection in modern ATS
- Extract every technical term, tool, framework, methodology, and competency phrase from the JD
- Each overlapping keyword should appear in 2-3 distinct sections (headline, summary, skills, experience) with natural contextual variation — first mention in each section carries the most weight
- Prefer the JD's exact phrasing over synonyms. Include both acronym and full-term forms for every technical abbreviation
- Preserve the candidate's core experience but reframe descriptions around JD terminology
- NEVER add a technical skill that does not exist in the original resume
- Prioritize hard/technical skill keywords over soft skills at a 4:1 ratio`;
    case 'achievement':
      return `\n\nSTRATEGY: ACHIEVEMENT QUANTIFIER
- Your PRIMARY goal is to select and sharpen the candidate's most compelling achievements for this specific JD
- SELECTION FIRST: Pick the 3-4 strongest achievements per role that demonstrate JD-required skills or relevant impact. Every bullet must include at least one exact JD keyword.
- XYZ FORMULA: Preferred when natural. Use the pattern "Accomplished [X] as measured by [Y], by doing [Z]" for bullets with real metrics, but a concise achievement bullet without forced XYZ structure is better than a padded one.
- Use ONLY metrics that already exist in the original resume. If a metric is missing, describe the Technical Outcome instead (e.g., "reducing server latency" rather than inventing "by 25%")
- Focus on business impact using factual descriptions: efficiency gains, cost reductions, technical improvements — without fabricated numbers
- Use the strongest possible action verbs from the Verb Bank — prefer ownership verbs (Spearheaded, Architected, Pioneered) over participation verbs
- Still ensure the resume headline uses the exact job posting title verbatim — this is non-negotiable regardless of strategy mode
- Keyword coverage is secondary to achievement storytelling, but overlapping JD keywords should still appear naturally in achievement descriptions
- Prioritize hard skill keywords when weaving JD terms into achievement bullets`;
    case 'hybrid':
    default:
      return `\n\nSTRATEGY: HYBRID (KEYWORD + ACHIEVEMENT)
- Balance ATS keyword optimization with achievement-oriented rewriting
- SELECTION FIRST: Start by selecting the most relevant roles and bullets, then optimize those selections for keywords and achievements. Pick 3-4 bullets per role and sharpen them. Every bullet must contain at least one exact JD keyword.
- XYZ FORMULA: Use the pattern when it fits naturally. A concise, punchy bullet that demonstrates a JD skill is always better than a padded XYZ bullet.
- Target 70-80% coverage of the JD's technical requirements that overlap with the candidate's actual skills. Coverage above 80% should only come from genuine skill overlap, never from forced insertion
- Mirror JD terminology AND weave keywords into achievement-oriented bullets
- Prioritize the top 5 JD hard skills that OVERLAP with the original resume for keyword placement — use the placement hierarchy: headline > summary > skills section > experience bullets
- Include both acronym and full-term forms for every technical abbreviation
- Hard skills take 4:1 priority over soft skills for keyword optimization
- For metrics: use only what exists in the original. For missing metrics, describe Technical Outcomes instead of fabricating numbers
- NEVER add technical skills absent from the original resume`;
  }
}

function getDocumentTypeInstructions(type: string): string {
  switch (type) {
    case 'cv':
      return `\n\nDOCUMENT TYPE: CV (Curriculum Vitae)
- Ignore all 1-page rules — CVs are expected to be comprehensive (2+ pages)
- Include EVERYTHING from the base CV: ALL professional experience, publications, presentations, certifications, academic history, research, grants, and professional affiliations
- Use resume-rules.md ONLY for formatting guidance and verb usage; prioritize depth and completeness over brevity
- Do NOT trim or summarize any role — maintain detailed descriptions of each position and project
- Include academic history, research, grants, and professional affiliations if present`;
    case 'resume':
    default:
      return `\n\nDOCUMENT TYPE: RESUME — CONTENT GUIDELINES
- TARGET: 2 pages, 800-1000 words. Two pages allows sufficient room for keyword density and role coverage for experienced candidates.
- EXPERIENCE: Include all roles that have ANY relevance to the JD. If the candidate has multiple client engagements under one employer (e.g., consulting/contracting firm), include ALL engagements with sufficient detail to maximize keyword coverage. Only cut a role if it has absolutely ZERO relevance to the job description.
- BULLETS: 3-4 per role. Each bullet must be 1-2 lines and contain at least one exact JD keyword or phrase. Pick bullets that best demonstrate JD-required skills.
- SUMMARY: 2-3 sentences that directly address the JD's top 2-3 requirements. No generic filler.
- SKILLS: List all skills that overlap with the JD using the JD's exact phrasing. Organize into 2-3 subcategories.
- PROJECTS: Include the Notable Projects section when projects contain keywords or demonstrate skills relevant to the JD. Omit only when NO projects are relevant.
- Do NOT sacrifice keyword density or role coverage for brevity. Two pages of targeted, keyword-rich content outperforms one page that cuts relevant experience.`;
  }
}

async function buildSystemPrompt(strategyMode?: string, documentType?: string): Promise<string> {
  const rules = await loadRules();
  let prompt = BASE_SYSTEM_PROMPT;
  // Rules first (lowest recency weight) — provides formatting and verb guidance
  if (rules) {
    prompt += `\n\nThe following rules MUST be followed when tailoring the resume:\n${rules}`;
  }
  // Strategy next — sets the optimization approach
  prompt += getStrategyInstructions(strategyMode || 'hybrid');
  // Document type last (highest recency weight) — enforces page limits and bullet budgets
  prompt += getDocumentTypeInstructions(documentType || 'resume');
  return prompt;
}

// ---------------------------------------------------------------------------
// Cover Letter System Prompt & Functions
// ---------------------------------------------------------------------------

const COVER_LETTER_SYSTEM_PROMPT = `You are an elite cover letter consultant. Your goal is to craft a compelling, authentic cover letter that directly addresses the employer's pain points and demonstrates the candidate's fit.

PRIORITY ONE: PAIN POINT ANALYSIS
Before writing, identify the top 2-3 "pain points" from the job description — the core problems this role is being hired to solve. Structure the cover letter body around how the candidate's experience directly addresses these pain points.

STRUCTURE:
1. **Hook** — Open with a specific, compelling reference to the company (recent news, product, mission). Never open with "I am writing to apply for..."
2. **Alignment** — Connect the candidate's trajectory to the company's goals. Show you understand what they do and why this role matters.
3. **Benefit/Evidence** — For each pain point, provide a concrete example from the candidate's experience using the pattern: "At [Company], I [action] which [result]." Only use facts from the base resume.

VOICE RULES — THIS IS THE MOST IMPORTANT SECTION:
The cover letter must read like a real person sat down, researched the company, and wrote this specifically for them. Not like an AI spit it out. Here is how:

- Write the way a smart, articulate professional actually talks. Not formal-stiff, not casual-sloppy. Think "how would I explain this to a colleague I respect."
- Vary sentence length. Short sentences punch. Longer ones carry nuance and show you can think through complexity. Mix them.
- Include ONE specific, non-obvious detail about the company that shows genuine research (a recent product launch, a blog post, an engineering decision, a company value that resonates). Generic flattery ("your innovative company") is worse than nothing.
- Use contractions naturally (I'm, I've, didn't, we'd). People write with contractions. AI tends not to.
- Start at least one sentence with "I" and at least one with something other than "I" to avoid the "I, I, I" pattern.
- Reference a specific moment or decision from your career — not just "I did X at Company Y" but why it mattered to you or what you learned.
- Do NOT repeat the resume verbatim — tell the story behind 2-3 key achievements. Add context the resume can't: why you chose that approach, what the tradeoff was, what surprised you.
- End with something specific you want to discuss, not a generic "I look forward to discussing." Example: "I'd love to talk about how your team handles [specific challenge mentioned in JD] — it's a problem I've thought about a lot."

AI-ISM BLACKLIST — instant rejection if any of these appear:
- "I am passionate about..." / "I'm passionate about..."
- "I thrive in..." / "I excel in..."
- "I bring a unique blend of..."
- "In today's fast-paced..." / "In an era of..."
- "I am confident that..." / "I'm confident that..."
- "proven track record" (without specific proof immediately following)
- "results-driven professional" / "detail-oriented professional"
- "dynamic environment" / "fast-paced environment"
- "hit the ground running"
- "value-add" / "value proposition"
- "cutting-edge" / "best-in-class" / "world-class" / "state-of-the-art"
- "leverage my" / "utilize my" / "synergy" / "synergies"
- "I am excited to..." / "I'm excited to..."
- "I would welcome the opportunity..."
- "I believe I would be a great fit..."
- "Dear Hiring Manager" (use "Dear [Team Name] Team" or "Dear Hiring Team" — never the robotic "Dear Hiring Manager")
- Any phrase that sounds like a LinkedIn headline rather than something a human would actually write

KEYWORD SUPPLEMENTATION:
While the cover letter is optimized for human persuasion (not ATS scoring), modern ATS platforms DO index cover letter text for keyword searches. Naturally weave 3-5 of the JD's highest-priority technical keywords into the cover letter narrative. These keywords must:
- Appear in context within achievement descriptions, not as standalone keyword lists
- Reference only skills/tools that exist in the candidate's base resume
- Reinforce (not duplicate) the resume's top keyword placements
- Read naturally as part of the story — if a keyword insertion sounds forced, omit it
The cover letter provides a supplementary keyword boost. Treat it as reinforcement of the resume's top keywords, not a separate optimization target.

OUTPUT FORMAT:
Return the cover letter text first, then add:

---PAIN_POINTS---
- [Pain point 1 from JD]
- [Pain point 2 from JD]
- [Pain point 3 from JD]

---CHANGES---
- [Key decision 1 made while writing]
- [Key decision 2]

CONSTRAINTS:
- 3-4 paragraphs maximum (approximately 250-400 words)
- The letter should flow as prose by default — no bullet points. Exception: if the user's cover letter template explicitly includes bullet points in the body, a brief set of 2-3 achievement bullets may be used. Otherwise, always default to prose paragraphs.
- NEVER fabricate experiences, companies, skills, or metrics
- Only reference skills/tools that exist in the candidate's base resume
- If the base resume lacks a specific metric, describe the outcome without inventing numbers
- Address "Dear Hiring Team" unless a specific name is provided

SIGN-OFF RESPECT:
- If the user's feedback or custom instructions specify a closing/sign-off (e.g., "Best regards, [Name]" or "Sincerely, [Name]"), you MUST use that exact sign-off.
- If no sign-off is specified, use a professional closing appropriate to the tone.

TECHNICAL OUTCOME DIRECTIVE (Mandatory):
- Replace invented metrics with Technical Wins. Never fabricate percentages, dollar amounts, or team sizes.
- BAD: "Improved efficiency by 25%"
- GOOD: "Streamlined the deployment pipeline to eliminate manual steps, resulting in faster and more reliable releases."
- Every claim must describe real technical work and its observable outcome.`;

async function buildCoverLetterSystemPrompt(): Promise<string> {
  const rules = await loadCoverLetterRules();
  let prompt = COVER_LETTER_SYSTEM_PROMPT;
  if (rules) {
    prompt += `\n\nThe following cover letter rules MUST be followed:\n${rules}`;
  }
  return prompt;
}

// ---------------------------------------------------------------------------
// Post-generation validation: flag any technical keywords in the tailored
// output that are absent from the original resume.
// ---------------------------------------------------------------------------

// Common stop-words and generic terms that should not trigger false positives.
const IGNORE_WORDS = new Set([
  'a','an','the','and','or','of','to','in','for','with','on','at','by','from',
  'is','are','was','were','be','been','being','have','has','had','do','does',
  'did','will','would','shall','should','may','might','can','could','not',
  'but','if','than','that','this','these','those','it','its','my','your',
  'our','their','his','her','we','they','i','you','he','she','me','us',
  'them','who','whom','which','what','where','when','how','all','each',
  'every','both','few','more','most','other','some','such','no','nor',
  'only','same','so','too','very','just','about','above','after','again',
  'also','am','as','because','before','below','between','during','into',
  'over','through','under','until','up','down','out','off','then','once',
  'here','there','why','any','many','much','own','per','via','etc',
  // Common resume verbs (from our Verb Bank — these are expected additions)
  'spearheaded','orchestrated','mentored','galvanized','navigated','delegated',
  'championed','directed','cultivated','facilitated','architected','deployed',
  'refactored','optimized','automated','integrated','debugged','modernized',
  'standardized','visualized','deciphered','audited','forecasted','identified',
  'interpreted','reconciled','investigated','evaluated','discovered','validated',
  'negotiated','influenced','persuaded','presented','authored','consulted',
  'clarified','collaborated','advised','mediated','generated','exceeded',
  'reduced','accelerated','maximized','revitalized','launched','secured',
  'pioneered','transformed','managed','developed','designed','implemented',
  'created','built','led','improved','established','maintained','provided',
  'delivered','ensured','achieved','drove','enabled','enhanced','streamlined',
  'leveraged','utilized','applied','conducted','performed','supported',
  'coordinated','contributed','oversaw','supervised','analyzed','resolved',
  'demonstrated','accomplished','engineered',
  // Generic resume section headers and common words
  'experience','education','skills','summary','objective','projects',
  'certifications','awards','publications','languages','interests',
  'references','professional','work','technical','career','relevant',
  'additional','contact','information','phone','email','address',
  'results','resulting','impact','team','teams','company','client',
  'clients','project','projects','system','systems','process',
  'processes','business','data','development','management','service',
  'services','solution','solutions','technology','application',
  'applications','environment','platform','infrastructure',
  // Cover letter common words
  'dear','hiring','sincerely','regards','opportunity','position',
  'role','organization','forward','discuss','contribute','bring',
  'excited','look','welcome','eager','happy','pleased','grateful',
]);

/**
 * Extracts technical-looking keywords (2+ chars, not in ignore list) from text.
 * Considers words that look like tool/technology names (often capitalized or
 * contain special chars like C++, Node.js, etc.).
 */
function extractTechnicalKeywords(text: string): Set<string> {
  // Match words, including those with dots/hashes/plusses (e.g., C#, Node.js, C++)
  const tokens = text.match(/[A-Za-z][A-Za-z0-9.+#_-]{1,}/g) || [];
  const keywords = new Set<string>();
  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (!IGNORE_WORDS.has(lower) && lower.length >= 2) {
      keywords.add(lower);
    }
  }
  return keywords;
}

export interface ValidationResult {
  flaggedSkills: string[];
  warnings: string[];
}

/**
 * Validates tailored content against original resume.
 * Flags technical keywords in tailored output absent from original.
 * Returns structured result with flagged skills and warnings.
 */
export function validateTailoredContent(original: string, tailored: string): ValidationResult {
  const originalKeywords = extractTechnicalKeywords(original);
  const tailoredKeywords = extractTechnicalKeywords(tailored);

  const flaggedSkills: string[] = [];
  for (const keyword of tailoredKeywords) {
    if (!originalKeywords.has(keyword)) {
      // Before flagging, check if the keyword is a synonym of something in the original
      // e.g., "JS" should not be flagged if "javascript" is in the original
      if (!termExistsWithSynonyms(keyword, original)) {
        flaggedSkills.push(keyword);
      }
    }
  }

  const warnings: string[] = [];
  if (flaggedSkills.length > 0) {
    warnings.push(
      `The AI added skills not found in your base resume: ${flaggedSkills.join(', ')}. Please verify these are accurate.`
    );
  }

  return { flaggedSkills, warnings };
}

/** @deprecated Use validateTailoredContent instead */
export function validateNoNewSkills(original: string, tailored: string): string[] {
  return validateTailoredContent(original, tailored).flaggedSkills;
}

// ---------------------------------------------------------------------------
// Feedback Verification — programmatically check if feedback was applied
// ---------------------------------------------------------------------------

export interface FeedbackVerification {
  feedback: string;
  applied: boolean;
  matchedTerms: string[];
}

export function verifyFeedbackApplied(
  feedback: string,
  feedbackHistory: string[],
  previousDraft: string,
  newDraft: string
): FeedbackVerification[] {
  const allFeedback = [...feedbackHistory, feedback];
  const prevLower = previousDraft.toLowerCase();
  const newLower = newDraft.toLowerCase();

  return allFeedback.map((fb) => {
    // Extract significant terms (3+ chars, not stopwords)
    const terms = fb
      .toLowerCase()
      .split(/[\s,;.!?"'()]+/)
      .filter((t) => t.length >= 3 && !IGNORE_WORDS.has(t));

    // Check which terms appear in the new draft
    const matchedTerms = terms.filter((t) => newLower.includes(t));

    // Check which terms are NEW to the draft (weren't in previous version)
    const newlyAddedTerms = terms.filter((t) => newLower.includes(t) && !prevLower.includes(t));

    // Detect structural changes for non-keyword feedback (e.g., "make it shorter", "remove the summary")
    const prevWordCount = previousDraft.split(/\s+/).length;
    const newWordCount = newDraft.split(/\s+/).length;
    const significantLengthChange = Math.abs(prevWordCount - newWordCount) > prevWordCount * 0.1;

    // Determine if feedback was actually applied:
    // 1. New terms were added that match the feedback (additive feedback)
    // 2. Sufficient existing terms match AND the document actually changed in the relevant area
    // 3. Structural changes occurred for non-keyword feedback
    let applied = false;

    if (terms.length === 0) {
      // Feedback had no extractable terms (e.g., "make it shorter") — check for structural change
      applied = significantLengthChange || newDraft !== previousDraft;
    } else if (newlyAddedTerms.length > 0) {
      // New content was added matching the feedback
      applied = true;
    } else if (matchedTerms.length > terms.length * 0.5) {
      // Majority of terms present — but only count as applied if the draft actually changed
      // in a way that relates to the feedback (not just unrelated AI drift)
      const prevMatchCount = terms.filter((t) => prevLower.includes(t)).length;
      applied = matchedTerms.length > prevMatchCount || newDraft !== previousDraft;
    }

    return { feedback: fb, applied, matchedTerms };
  });
}

// ---------------------------------------------------------------------------
// Synonym / Abbreviation Normalization Map (Step 39)
// ---------------------------------------------------------------------------

export const SYNONYM_MAP: Record<string, string[]> = {
  'js': ['javascript'],
  'ts': ['typescript'],
  'py': ['python'],
  'ml': ['machine learning'],
  'ai': ['artificial intelligence'],
  'dl': ['deep learning'],
  'nlp': ['natural language processing'],
  'comp-vision': ['computer vision'],
  'aws': ['amazon web services'],
  'gcp': ['google cloud platform', 'google cloud'],
  'k8s': ['kubernetes'],
  'ci/cd': ['continuous integration', 'continuous deployment', 'continuous integration/continuous deployment'],
  'pm': ['project manager', 'project management', 'product manager', 'product management'],
  'qa': ['quality assurance'],
  'ui': ['user interface'],
  'ux': ['user experience'],
  'api': ['application programming interface'],
  'sql': ['structured query language'],
  'nosql': ['non-relational database'],
  'oop': ['object-oriented programming'],
  'saas': ['software as a service'],
  'sdk': ['software development kit'],
  'etl': ['extract transform load'],
  'rbac': ['role-based access control'],
  'sso': ['single sign-on'],
  'oauth': ['open authorization'],
  'jwt': ['json web token'],
  'rest': ['representational state transfer'],
  'graphql': ['graph query language'],
  'node': ['node.js', 'nodejs'],
  'react': ['reactjs'],
  'vue': ['vuejs', 'vue.js'],
  'db': ['database'],
  'postgres': ['postgresql'],
  'mongo': ['mongodb'],
  'golang': ['go'],
  'tf': ['terraform'],
  'docker': ['containerization'],
};

/**
 * Checks if a term appears in text using word-boundary matching to avoid
 * false positives (e.g., "db" matching "feedback", "app" matching "happy").
 */
function wordBoundaryMatch(needle: string, haystack: string): boolean {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(?:^|[\\s,;.!?()\\[\\]{}/"'\\-])${escaped}(?:$|[\\s,;.!?()\\[\\]{}/"'\\-])`, 'i');
  const result = pattern.test(haystack);

  // DIAG: Log boundary match attempts for debugging ATS scoring
  if (!result) {
    // Check if the needle exists as a plain substring (would catch boundary char issues)
    const substringExists = haystack.toLowerCase().includes(needle.toLowerCase());
    if (substringExists) {
      // Find the surrounding characters to diagnose boundary failure
      const idx = haystack.toLowerCase().indexOf(needle.toLowerCase());
      const charBefore = idx > 0 ? haystack[idx - 1] : '^START';
      const charAfter = idx + needle.length < haystack.length ? haystack[idx + needle.length] : '$END';
      console.log(`[DIAG:wordBoundaryMatch] SUBSTRING EXISTS but boundary match FAILED for "${needle}"`);
      console.log(`  charBefore="${charBefore}" (code=${typeof charBefore === 'string' ? charBefore.charCodeAt(0) : 'N/A'}), charAfter="${charAfter}" (code=${typeof charAfter === 'string' ? charAfter.charCodeAt(0) : 'N/A'})`);
      console.log(`  Context: "...${haystack.substring(Math.max(0, idx - 15), idx)}[${haystack.substring(idx, idx + needle.length)}]${haystack.substring(idx + needle.length, idx + needle.length + 15)}..."`);
      console.log(`  Pattern used: ${pattern.source}`);
    }
  }

  return result;
}

/**
 * Normalizes a term by checking if it (or its synonym) exists in the provided text.
 * Uses word-boundary matching to prevent false positives from substring matches.
 */
export function termExistsWithSynonyms(term: string, text: string): boolean {
  const lower = text.toLowerCase();
  const termLower = term.toLowerCase();

  // DIAG: Track all match attempts for this term
  const diagAttempts: string[] = [];

  if (wordBoundaryMatch(termLower, lower)) {
    diagAttempts.push(`direct match "${termLower}" => FOUND`);
    console.log(`[DIAG:termExists] "${term}" => FOUND (direct match)`);
    return true;
  }
  diagAttempts.push(`direct match "${termLower}" => NOT FOUND`);

  // Check if term is a key in synonym map
  const synonyms = SYNONYM_MAP[termLower];
  if (synonyms) {
    for (const syn of synonyms) {
      const synMatch = wordBoundaryMatch(syn, lower);
      diagAttempts.push(`synonym "${syn}" => ${synMatch ? 'FOUND' : 'NOT FOUND'}`);
      if (synMatch) {
        console.log(`[DIAG:termExists] "${term}" => FOUND via synonym "${syn}"`);
        return true;
      }
    }
  }

  // Check if term is a value in synonym map (reverse lookup)
  for (const [abbrev, expansions] of Object.entries(SYNONYM_MAP)) {
    if (expansions.some(exp => exp === termLower)) {
      const abbrevMatch = wordBoundaryMatch(abbrev, lower);
      diagAttempts.push(`reverse-synonym abbrev "${abbrev}" => ${abbrevMatch ? 'FOUND' : 'NOT FOUND'}`);
      if (abbrevMatch) {
        console.log(`[DIAG:termExists] "${term}" => FOUND via reverse-synonym abbrev "${abbrev}"`);
        return true;
      }
    }
  }

  // DIAG: Log all failed attempts
  console.log(`[DIAG:termExists] "${term}" => NOT FOUND in text. All attempts:`);
  for (const attempt of diagAttempts) {
    console.log(`  - ${attempt}`);
  }
  // Check for plain substring presence as a sanity check
  if (lower.includes(termLower)) {
    console.log(`  WARNING: "${term}" EXISTS as substring but all boundary matches failed!`);
  }

  return false;
}

// ---------------------------------------------------------------------------
// Numeric Fabrication Validator (Step 35)
// ---------------------------------------------------------------------------

export interface MetricValidationResult {
  fabricatedMetrics: string[];
  warnings: string[];
}

interface ParsedMetric {
  raw: string;
  value: number;
  type: 'percent' | 'dollar' | 'contextual';
}

/**
 * Extracts the numeric value from a metric string.
 * Handles percentages ("25%"), dollar amounts ("$100K"), and contextual numbers ("15 team").
 */
function parseMetricValue(metric: string): ParsedMetric | null {
  // Percentage
  const pctMatch = metric.match(/^(\d+(?:\.\d+)?)%$/);
  if (pctMatch) {
    return { raw: metric, value: parseFloat(pctMatch[1]), type: 'percent' };
  }

  // Dollar amounts with optional K/M/B suffix
  const dollarMatch = metric.match(/^\$([\d,]+(?:\.\d+)?)([KMB])?$/i);
  if (dollarMatch) {
    let val = parseFloat(dollarMatch[1].replace(/,/g, ''));
    const suffix = (dollarMatch[2] || '').toUpperCase();
    if (suffix === 'K') val *= 1_000;
    else if (suffix === 'M') val *= 1_000_000;
    else if (suffix === 'B') val *= 1_000_000_000;
    return { raw: metric, value: val, type: 'dollar' };
  }

  // Contextual number (leading digits)
  const ctxMatch = metric.match(/^(\d+)/);
  if (ctxMatch) {
    return { raw: metric, value: parseInt(ctxMatch[1], 10), type: 'contextual' };
  }

  return null;
}

/**
 * Checks if a metric is a "nudged" version of any original metric (within 15% and same type).
 * Returns the original metric it appears to be derived from, or null.
 */
function findNudgedMetric(candidate: ParsedMetric, originals: ParsedMetric[]): string | null {
  const NUDGE_THRESHOLD = 0.15;
  for (const orig of originals) {
    if (orig.type !== candidate.type) continue;
    if (orig.value === 0) continue;
    const ratio = Math.abs(candidate.value - orig.value) / orig.value;
    if (ratio > 0 && ratio <= NUDGE_THRESHOLD) {
      return orig.raw;
    }
  }
  return null;
}

export function validateNoFabricatedMetrics(original: string, tailored: string): MetricValidationResult {
  const fabricatedMetrics: string[] = [];
  const warnings: string[] = [];

  // Extract percentages
  const percentagePattern = /\d+(\.\d+)?%/g;
  // Extract dollar amounts
  const dollarPattern = /\$[\d,]+(\.\d+)?[KMB]?/gi;
  // Extract contextual numbers (near metric-adjacent words)
  const contextualNumberPattern = /\b(\d+)\s*(?:team|engineers|developers|clients|users|projects|months|years|hours|people|members|staff|reports|customers|stakeholders)/gi;

  const extractMatches = (text: string, pattern: RegExp): string[] => {
    const matches: string[] = [];
    let match;
    const re = new RegExp(pattern.source, pattern.flags);
    while ((match = re.exec(text)) !== null) {
      matches.push(match[0]);
    }
    return matches;
  };

  // Build parsed metric arrays from originals for nudge detection
  const originalPctStrings = extractMatches(original, percentagePattern);
  const originalDollarStrings = extractMatches(original, dollarPattern);
  const originalCtxStrings = extractMatches(original, contextualNumberPattern);

  const originalParsedMetrics: ParsedMetric[] = [
    ...originalPctStrings.map(s => parseMetricValue(s)).filter((m): m is ParsedMetric => m !== null),
    ...originalDollarStrings.map(s => parseMetricValue(s)).filter((m): m is ParsedMetric => m !== null),
    ...originalCtxStrings.map(s => parseMetricValue(s)).filter((m): m is ParsedMetric => m !== null),
  ];

  const originalPercentages = new Set(originalPctStrings);
  const tailoredPercentages = extractMatches(tailored, percentagePattern);
  for (const pct of tailoredPercentages) {
    if (!originalPercentages.has(pct)) {
      const numVal = parseFloat(pct);
      if (numVal >= 1900 && numVal <= 2100) continue;

      // Check for nudged metric
      const parsed = parseMetricValue(pct);
      if (parsed) {
        const nudgedFrom = findNudgedMetric(parsed, originalParsedMetrics);
        if (nudgedFrom) {
          fabricatedMetrics.push(pct);
          warnings.push(
            `"${pct}" appears to be a modified version of "${nudgedFrom}" from the original resume.`
          );
          continue;
        }
      }
      fabricatedMetrics.push(pct);
    }
  }

  const originalDollars = new Set(originalDollarStrings);
  const tailoredDollars = extractMatches(tailored, dollarPattern);
  for (const dollar of tailoredDollars) {
    if (!originalDollars.has(dollar)) {
      const parsed = parseMetricValue(dollar);
      if (parsed) {
        const nudgedFrom = findNudgedMetric(parsed, originalParsedMetrics);
        if (nudgedFrom) {
          fabricatedMetrics.push(dollar);
          warnings.push(
            `"${dollar}" appears to be a modified version of "${nudgedFrom}" from the original resume.`
          );
          continue;
        }
      }
      fabricatedMetrics.push(dollar);
    }
  }

  const originalContextual = new Set(originalCtxStrings.map(m => m.toLowerCase()));
  const tailoredContextual = extractMatches(tailored, contextualNumberPattern);
  for (const ctx of tailoredContextual) {
    if (!originalContextual.has(ctx.toLowerCase())) {
      const parsed = parseMetricValue(ctx);
      if (parsed) {
        const nudgedFrom = findNudgedMetric(parsed, originalParsedMetrics);
        if (nudgedFrom) {
          fabricatedMetrics.push(ctx);
          warnings.push(
            `"${ctx}" appears to be a modified version of "${nudgedFrom}" from the original resume.`
          );
          continue;
        }
      }
      fabricatedMetrics.push(ctx);
    }
  }

  if (fabricatedMetrics.length > 0) {
    // Add a general warning only if there are fabricated metrics without specific nudge warnings
    const nudgeWarningCount = warnings.length;
    const generalCount = fabricatedMetrics.length - nudgeWarningCount;
    if (generalCount > 0) {
      const generalMetrics = fabricatedMetrics.slice(nudgeWarningCount);
      warnings.push(
        `Potentially fabricated metrics detected: ${generalMetrics.join(', ')}. These numbers do not appear in the original resume.`
      );
    }
  }

  return { fabricatedMetrics, warnings };
}

// ---------------------------------------------------------------------------
// Multi-Word Phrase Validator (Step 36)
// ---------------------------------------------------------------------------

export interface PhraseValidationResult {
  newPhrases: string[];
  warnings: string[];
}

const KNOWN_TECHNICAL_PHRASES = new Set([
  // Original entries
  'machine learning', 'deep learning', 'data pipeline', 'data engineering',
  'project management', 'product management', 'system design', 'cloud computing',
  'distributed systems', 'microservices architecture', 'test driven',
  'continuous integration', 'continuous deployment', 'data science',
  'full stack', 'front end', 'back end', 'web development',
  'mobile development', 'devops engineering', 'site reliability',
  'software engineering', 'data analytics', 'business intelligence',
  'user experience', 'user interface', 'quality assurance',
  'agile methodology', 'scrum master', 'technical lead',
  'solutions architect', 'cloud infrastructure', 'data warehouse',
  'natural language processing', 'computer vision', 'neural network',
  'version control', 'code review', 'pull request',
  'load balancing', 'auto scaling', 'event driven',
  'object oriented', 'functional programming', 'design patterns',
  // Infrastructure and DevOps
  'infrastructure as code', 'container orchestration', 'service mesh',
  'blue green deployment', 'canary deployment', 'rolling deployment',
  'configuration management', 'secrets management', 'log aggregation',
  'monitoring and alerting', 'incident response', 'disaster recovery',
  'high availability', 'fault tolerance', 'chaos engineering',
  // Security
  'penetration testing', 'threat modeling', 'security audit',
  'identity management', 'access control', 'zero trust',
  'data encryption', 'vulnerability assessment', 'compliance framework',
  // Agile and PM
  'sprint planning', 'backlog grooming', 'product roadmap',
  'stakeholder management', 'risk management', 'change management',
  'requirements gathering', 'technical writing', 'release management',
  'kanban board', 'story points', 'velocity tracking',
  // Data and ML
  'feature engineering', 'model training', 'model deployment',
  'a/b testing', 'data modeling', 'data governance',
  'real time analytics', 'stream processing', 'batch processing',
  'data lake', 'data mesh', 'data catalog',
  'recommendation engine', 'anomaly detection', 'sentiment analysis',
  // Architecture
  'domain driven design', 'service oriented architecture', 'api gateway',
  'message queue', 'event sourcing', 'cqrs pattern',
  'clean architecture', 'hexagonal architecture', 'serverless architecture',
  'edge computing', 'content delivery', 'reverse proxy',
  // Testing
  'unit testing', 'integration testing', 'end to end testing',
  'test automation', 'performance testing', 'load testing',
  'regression testing', 'acceptance testing', 'behavior driven',
  // Cloud
  'cloud native', 'cloud migration', 'multi cloud',
  'hybrid cloud', 'cloud security', 'cost optimization',
  // General business
  'cross functional', 'digital transformation', 'process automation',
  'strategic planning', 'vendor management', 'budget management',
  'revenue growth', 'cost reduction', 'customer success',
]);

function generateNgrams(text: string, n: number): Set<string> {
  const words = text.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/).filter(w => w.length > 1);
  const ngrams = new Set<string>();
  for (let i = 0; i <= words.length - n; i++) {
    ngrams.add(words.slice(i, i + n).join(' '));
  }
  return ngrams;
}

export function validateNoNewPhrases(original: string, tailored: string): PhraseValidationResult {
  const newPhrases: string[] = [];
  const warnings: string[] = [];

  const originalBigrams = generateNgrams(original, 2);
  const originalTrigrams = generateNgrams(original, 3);

  const tailoredBigrams = generateNgrams(tailored, 2);
  const tailoredTrigrams = generateNgrams(tailored, 3);

  // Check tailored bigrams against known technical phrases
  for (const bigram of tailoredBigrams) {
    if (KNOWN_TECHNICAL_PHRASES.has(bigram) && !originalBigrams.has(bigram)) {
      // Check synonym map before flagging
      if (!termExistsWithSynonyms(bigram, original)) {
        newPhrases.push(bigram);
      }
    }
  }

  // Check tailored trigrams
  for (const trigram of tailoredTrigrams) {
    if (KNOWN_TECHNICAL_PHRASES.has(trigram) && !originalTrigrams.has(trigram)) {
      if (!termExistsWithSynonyms(trigram, original)) {
        newPhrases.push(trigram);
      }
    }
  }

  if (newPhrases.length > 0) {
    warnings.push(
      `New multi-word technical terms detected: ${newPhrases.join(', ')}. These phrases do not appear in the original resume.`
    );
  }

  return { newPhrases, warnings };
}

// ---------------------------------------------------------------------------
// Scope Inflation Detector (Step 37)
// ---------------------------------------------------------------------------

export interface ScopeInflationResult {
  inflatedBullets: { original: string; tailored: string; severity: string }[];
  warnings: string[];
}

const VERB_TIERS: Record<number, Set<string>> = {
  1: new Set(['assisted', 'contributed', 'participated', 'helped', 'supported', 'involved']),
  2: new Set(['managed', 'developed', 'created', 'built', 'designed', 'implemented']),
  3: new Set(['spearheaded', 'architected', 'pioneered', 'led', 'directed', 'championed', 'orchestrated', 'founded', 'engineered', 'transformed']),
};

function getVerbTier(verb: string): number {
  const lower = verb.toLowerCase();
  for (const [tier, verbs] of Object.entries(VERB_TIERS)) {
    if (verbs.has(lower)) return Number(tier);
  }
  return 0; // unknown verb
}

function extractLeadingVerb(bullet: string): string | null {
  const cleaned = bullet.replace(/^[-•*]\s*/, '').trim();
  const firstWord = cleaned.split(/\s+/)[0];
  return firstWord || null;
}

/**
 * Computes word overlap ratio between two strings (Jaccard-like).
 * Used to match original bullets to their tailored counterparts by content
 * similarity rather than array position.
 */
function bulletSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(w => w.length > 2));
  const wordsB = new Set(b.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(w => w.length > 2));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let overlap = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) overlap++;
  }
  return overlap / Math.max(wordsA.size, wordsB.size);
}

const SCOPE_AMPLIFIERS = new Set([
  'single-handedly', 'singlehandedly',
  'cross-functional', 'cross functional',
  'enterprise-wide', 'enterprise wide', 'enterprisewide',
  'end-to-end', 'end to end',
  'mission-critical', 'mission critical',
  'global',
  'flagship',
  'company-wide', 'company wide', 'companywide',
  'organization-wide', 'organization wide',
  'multi-million', 'multimillion',
  'billion-dollar', 'million-dollar',
  'first-ever', 'first ever',
  'sole',
  'exclusively',
  'revolutionized',
  'groundbreaking',
]);

export function detectScopeInflation(original: string, tailored: string): ScopeInflationResult {
  const inflatedBullets: { original: string; tailored: string; severity: string }[] = [];
  const warnings: string[] = [];

  // Extract bullet points from both
  const bulletPattern = /^[-•*]\s+.+$/gm;
  const originalBullets = original.match(bulletPattern) || [];
  const tailoredBullets = tailored.match(bulletPattern) || [];

  // Match each tailored bullet to its most similar original bullet by content
  const usedOriginals = new Set<number>();
  let unmatchedCount = 0;

  for (const tailBullet of tailoredBullets) {
    let bestIdx = -1;
    let bestScore = 0;

    for (let j = 0; j < originalBullets.length; j++) {
      if (usedOriginals.has(j)) continue;
      const score = bulletSimilarity(originalBullets[j], tailBullet);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = j;
      }
    }

    // Track unmatched bullets (potential fabricated content)
    if (bestIdx === -1 || bestScore < 0.3) {
      unmatchedCount++;
      continue;
    }
    usedOriginals.add(bestIdx);

    const origVerb = extractLeadingVerb(originalBullets[bestIdx]);
    const tailVerb = extractLeadingVerb(tailBullet);
    if (!origVerb || !tailVerb) continue;

    const origTier = getVerbTier(origVerb);
    const tailTier = getVerbTier(tailVerb);

    // Flag Tier 1 -> Tier 3 jumps (supporting -> ownership)
    if (origTier === 1 && tailTier === 3) {
      inflatedBullets.push({
        original: originalBullets[bestIdx],
        tailored: tailBullet,
        severity: 'high',
      });
    }
    // Also flag Tier 1 -> Tier 2 jumps as medium severity
    if (origTier === 1 && tailTier === 2) {
      inflatedBullets.push({
        original: originalBullets[bestIdx],
        tailored: tailBullet,
        severity: 'medium',
      });
    }

    // Check for qualifier amplification: scope amplifiers present in tailored but absent from original
    const origLower = originalBullets[bestIdx].toLowerCase();
    const tailLower = tailBullet.toLowerCase();
    const addedAmplifiers: string[] = [];
    for (const amplifier of SCOPE_AMPLIFIERS) {
      if (tailLower.includes(amplifier) && !origLower.includes(amplifier)) {
        addedAmplifiers.push(amplifier);
      }
    }
    if (addedAmplifiers.length > 0) {
      inflatedBullets.push({
        original: originalBullets[bestIdx],
        tailored: tailBullet,
        severity: 'medium',
      });
      warnings.push(
        `Qualifier amplification: "${addedAmplifiers.join('", "')}" added to bullet not present in original.`
      );
    }
  }

  if (inflatedBullets.length > 0) {
    const highCount = inflatedBullets.filter(b => b.severity === 'high').length;
    const medCount = inflatedBullets.filter(b => b.severity === 'medium').length;
    const parts: string[] = [];
    if (highCount > 0) parts.push(`${highCount} high-severity (e.g., "assisted" upgraded to "spearheaded")`);
    if (medCount > 0) parts.push(`${medCount} medium-severity (e.g., "assisted" upgraded to "managed")`);
    warnings.push(
      `Scope inflation detected: ${parts.join(', ')}. Review these bullets to ensure the verb matches the candidate's actual role.`
    );
  }

  if (unmatchedCount > 0) {
    warnings.push(
      `${unmatchedCount} tailored bullet(s) could not be matched to any original content. These may contain fabricated experience.`
    );
  }

  return { inflatedBullets, warnings };
}

// ---------------------------------------------------------------------------
// Section Heading Validator (Step 38)
// ---------------------------------------------------------------------------

export interface HeadingValidationResult {
  nonStandardHeadings: string[];
  suggestions: string[];
}

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

export function validateSectionHeadings(tailored: string): HeadingValidationResult {
  const nonStandardHeadings: string[] = [];
  const suggestions: string[] = [];

  // Extract potential section headings: lines that are all-caps, or short lines followed by content,
  // or lines with markdown heading markers
  const lines = tailored.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Check for markdown headings (## Heading)
    const markdownMatch = trimmed.match(/^#{1,3}\s+(.+)$/);
    // Check for all-caps headings (EXPERIENCE, SKILLS, etc.)
    const isAllCaps = trimmed === trimmed.toUpperCase() && /^[A-Z\s&/]+$/.test(trimmed) && trimmed.length >= 3 && trimmed.length <= 40;

    let headingText: string | null = null;

    if (markdownMatch) {
      headingText = markdownMatch[1].trim();
    } else if (isAllCaps) {
      headingText = trimmed;
    }

    if (headingText) {
      const normalized = headingText.toLowerCase().replace(/[*_#]/g, '').trim();
      if (normalized && !APPROVED_HEADINGS.has(normalized)) {
        // Avoid flagging names or single words that aren't section headings
        if (normalized.split(/\s+/).length <= 4 && !normalized.match(/^\d/)) {
          nonStandardHeadings.push(headingText);
        }
      }
    }
  }

  if (nonStandardHeadings.length > 0) {
    suggestions.push(
      `Non-standard section headings detected: ${nonStandardHeadings.join(', ')}. Use approved ATS headings like "Professional Summary," "Work Experience," "Skills," "Education," "Projects," "Certifications."`
    );
  }

  return { nonStandardHeadings, suggestions };
}

// ---------------------------------------------------------------------------
// Employment Gap Detector (Step 64)
// ---------------------------------------------------------------------------

export interface EmploymentGap {
  startDate: string;
  endDate: string;
  months: number;
}

export interface GapDetectionResult {
  gaps: EmploymentGap[];
  recommendations: string[];
}

export function detectEmploymentGaps(resumeText: string): GapDetectionResult {
  const gaps: EmploymentGap[] = [];
  const recommendations: string[] = [];

  // Match date ranges like "January 2020 – March 2022" or "01/2020 - 03/2022" or "Jan 2020 - Present"
  const dateRangePattern = /(?:(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}|\d{1,2}\/\d{4})\s*[–—-]\s*(?:(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}|\d{1,2}\/\d{4}|Present|Current)/gi;

  const dateRanges = resumeText.match(dateRangePattern) || [];

  const parseDate = (dateStr: string): Date | null => {
    const str = dateStr.trim();
    if (/present|current/i.test(str)) return new Date();

    // Try "Month YYYY" format
    const monthYear = str.match(/^(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})$/i);
    if (monthYear) {
      return new Date(`${monthYear[1]} 1, ${monthYear[2]}`);
    }

    // Try "MM/YYYY" format
    const mmYyyy = str.match(/^(\d{1,2})\/(\d{4})$/);
    if (mmYyyy) {
      return new Date(Number(mmYyyy[2]), Number(mmYyyy[1]) - 1);
    }

    return null;
  };

  const parsedRanges: { start: Date; end: Date; raw: string }[] = [];

  for (const range of dateRanges) {
    const parts = range.split(/\s*[–—-]\s*/);
    if (parts.length === 2) {
      const start = parseDate(parts[0]);
      const end = parseDate(parts[1]);
      if (start && end) {
        parsedRanges.push({ start, end, raw: range });
      }
    }
  }

  // Sort by end date descending (most recent first)
  parsedRanges.sort((a, b) => b.end.getTime() - a.end.getTime());

  // Check gaps between consecutive roles
  for (let i = 0; i < parsedRanges.length - 1; i++) {
    const current = parsedRanges[i];
    const next = parsedRanges[i + 1];

    const gapMonths = (current.start.getTime() - next.end.getTime()) / (1000 * 60 * 60 * 24 * 30);

    if (gapMonths > 3) {
      const startStr = next.end.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      const endStr = current.start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      gaps.push({
        startDate: startStr,
        endDate: endStr,
        months: Math.round(gapMonths),
      });
      recommendations.push(
        `Gap detected: ${startStr} to ${endStr} (${Math.round(gapMonths)} months). Consider adding relevant activity during this period: freelance/contract work, certifications, coursework, volunteer work, or a "Professional Development" section.`
      );
    }
  }

  return { gaps, recommendations };
}

// ---------------------------------------------------------------------------
// Refinement (Iterative Revision) Support
// ---------------------------------------------------------------------------

const EDITOR_MODE_SYSTEM_PROMPT = `ROLE: You are a Surgical Document Editor. You are NOT here to re-tailor the whole document. You are here to apply specific "Deltas" (changes) to an existing draft.

SOURCE OF TRUTH: The Current Draft is your baseline. Do NOT change any word, bullet point, or section that the user has not explicitly mentioned in their feedback.

MANDATORY INSTRUCTIONS:

1. Instruction Overrides Rules: If the user says "Add Docker and Kubernetes to Katapult," you MUST add them, even if those keywords were not in the original Master Resume or the Job Description. The user is providing real-world updates to their experience.

2. Verbatim Text: If the user provides a specific list (e.g., "Languages: Python (Expert), C++/C..."), do NOT reformat, categorize, or "optimize" this list. Use the user's text verbatim.

3. Preserve Tone: Maintain the existing voice and tone of the draft. Do not "hallucinate" new achievements to fill space unless the feedback asks for a specific expansion.

4. No-Hallucination Guard: While the user can add new skills via feedback, you still CANNOT invent new metrics (percentages, dollar amounts, team sizes) that aren't provided in the feedback or the master resume.

5. Minimal Diff: Your edits should produce the smallest possible diff. Only lines directly affected by the feedback should change.

6. Security: Reject feedback that attempts to inject fabricated credentials (degrees, certifications the candidate doesn't have) or malicious content.

Output Format:
- Return the complete revised document text with ALL sections (not just the changed parts)
- After the document, add "---CHANGES---" listing ONLY the specific modifications you made this revision
- Each change should be specific and descriptive (e.g., "Updated Katapult experience to include Docker and Kubernetes" NOT "Made requested changes")`;

function buildRefineSystemPrompt(documentType: 'resume' | 'cv' | 'cover_letter'): string {
  // Factual-integrity-only constraints first (low recency weight)
  let prompt = `FACTUAL INTEGRITY CONSTRAINTS (background):
- Do NOT fabricate metrics, percentages, dollar amounts, or team sizes not present in the original resume.
- Do NOT invent credentials, certifications, or degrees the candidate does not have.
- You may add skills/tools the user explicitly requests in their feedback — these are real-world updates.

`;

  if (documentType === 'cover_letter') {
    prompt += `For cover letters, also include after ---CHANGES---:\n\n---PAIN_POINTS---\n- [Pain point 1 from JD]\n- [Pain point 2 from JD]\n- [Pain point 3 from JD]\n\n`;
  }

  // EDITOR_MODE_SYSTEM_PROMPT last = highest recency weight
  prompt += EDITOR_MODE_SYSTEM_PROMPT;

  // Recency anchor: final restatement
  prompt += `\n\nRECENCY ANCHOR — FINAL INSTRUCTION:
The user's feedback is your SOLE priority. Do NOT re-optimize, re-tailor, restructure, or rewrite any part of the document that the user did not mention. Apply ONLY the requested changes. Everything else must remain exactly as-is.`;

  return prompt;
}

export interface RefineRequest {
  currentDraft: string;
  feedback: string;
  feedbackHistory?: string[];
  resumeText: string;
  jobTitle: string;
  company: string;
  jobDescription: string;
  requirements: string[];
  documentType: 'resume' | 'cv' | 'cover_letter';
  coverLetterTemplate?: string;
  topKeywords?: string;          // Comma-separated top 10 JD keywords
  coreRequirements?: string[];   // Top 3 JD requirements, condensed
}

export async function* refineResumeStream(
  request: RefineRequest
): AsyncGenerator<string, TailorResponse, unknown> {
  const systemPrompt = buildRefineSystemPrompt(request.documentType);

  // Build feedback history context if available
  let historyBlock = '';
  if (request.feedbackHistory && request.feedbackHistory.length > 0) {
    historyBlock = `Previous revision requests (already applied — DO NOT undo these):
${request.feedbackHistory.map((f, i) => `${i + 1}. "${f}"`).join('\n')}

Current revision request:
`;
  }

  // Prompt Sandwich: Feedback at TOP and BOTTOM to combat "Lost in the Middle"
  const keywordRef = request.topKeywords || request.coreRequirements?.length
    ? `\n\n---\n\n**Keyword Alignment Reference (for verification ONLY — do NOT use for re-tailoring):**\nTop JD Keywords: ${request.topKeywords || 'N/A'}\nCore Requirements: ${request.coreRequirements?.join(', ') || 'N/A'}\nUse this reference ONLY to verify that your edits maintain keyword alignment. If the user's feedback causes a keyword-rich bullet to be rewritten, ensure the replacement text preserves the relevant JD keywords where natural. Do NOT use this reference to re-tailor or re-optimize sections the user didn't mention.`
    : '';

  const sandwichedMessage = `${historyBlock}MANDATORY REVISION: ${request.feedback}

---

Current Draft (baseline — preserve everything not mentioned in feedback):
${request.currentDraft}

---

Role Context: ${request.jobTitle} at ${request.company}${keywordRef}

---

**Factual Reference (DO NOT use for re-tailoring — only to verify claims):**
${request.resumeText}

---

FINAL INSTRUCTION: Apply ONLY the revision above. Do not re-optimize, re-tailor, or restructure anything else.
${request.feedback}`;

  const stream = anthropic.messages.stream({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 8192,
    system: systemPrompt,
    messages: [
      { role: 'user', content: sandwichedMessage },
    ],
  });

  let fullText = '';

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      fullText += event.delta.text;
      yield event.delta.text;
    }
  }

  const changesSeparator = '---CHANGES---';
  const separatorIndex = fullText.indexOf(changesSeparator);

  let tailoredResume: string;
  let changes: string[] = [];

  if (separatorIndex !== -1) {
    tailoredResume = fullText.substring(0, separatorIndex).trim();
    const changesText = fullText.substring(separatorIndex + changesSeparator.length).trim();
    changes = changesText
      .split('\n')
      .map((line) => line.replace(/^-\s*/, '').trim())
      .filter((line) => line.length > 0);
  } else {
    tailoredResume = fullText.trim();
    changes = ['Document has been revised based on feedback'];
  }

  const validation = validateTailoredContent(request.resumeText, tailoredResume);
  if (validation.flaggedSkills.length > 0) {
    changes.push(`WARNING: Potentially new keywords detected: ${validation.flaggedSkills.join(', ')}`);
  }

  const verifiedChanges = verifyFeedbackApplied(
    request.feedback,
    request.feedbackHistory || [],
    request.currentDraft,
    tailoredResume
  );

  return { tailoredResume, changes, flaggedKeywords: validation.flaggedSkills, verifiedChanges };
}

export async function* refineCoverLetterStream(
  request: RefineRequest
): AsyncGenerator<string, TailorCoverLetterResponse, unknown> {
  const systemPrompt = buildRefineSystemPrompt('cover_letter');

  // Build feedback history context if available
  let historyBlock = '';
  if (request.feedbackHistory && request.feedbackHistory.length > 0) {
    historyBlock = `Previous revision requests (already applied — DO NOT undo these):
${request.feedbackHistory.map((f, i) => `${i + 1}. "${f}"`).join('\n')}

Current revision request:
`;
  }

  // Prompt Sandwich: Feedback at TOP and BOTTOM to combat "Lost in the Middle"
  const clKeywordRef = request.topKeywords || request.coreRequirements?.length
    ? `\n\n---\n\n**Keyword Alignment Reference (for verification ONLY — do NOT use for re-tailoring):**\nTop JD Keywords: ${request.topKeywords || 'N/A'}\nCore Requirements: ${request.coreRequirements?.join(', ') || 'N/A'}\nUse this reference ONLY to verify that your edits maintain keyword alignment. Do NOT use this reference to re-tailor or re-optimize sections the user didn't mention.`
    : '';

  let sandwichedMessage = `${historyBlock}MANDATORY REVISION: ${request.feedback}

---

Current Draft (baseline — preserve everything not mentioned in feedback):
${request.currentDraft}

---

Role Context: ${request.jobTitle} at ${request.company}${clKeywordRef}

---

**Factual Reference (DO NOT use for re-tailoring — only to verify claims):**
${request.resumeText}`;

  if (request.coverLetterTemplate) {
    sandwichedMessage += `\n\n**Cover Letter Template (DO NOT restructure — style/tone reference only):**\n${request.coverLetterTemplate}`;
  }

  sandwichedMessage += `\n\n---

FINAL INSTRUCTION: Apply ONLY the revision above. Do not re-optimize, re-tailor, or restructure anything else.
${request.feedback}`;

  const stream = anthropic.messages.stream({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: systemPrompt,
    messages: [
      { role: 'user', content: sandwichedMessage },
    ],
  });

  let fullText = '';

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      fullText += event.delta.text;
      yield event.delta.text;
    }
  }

  // Parse the response — extract pain points and changes
  const painPointsSeparator = '---PAIN_POINTS---';
  const changesSeparator = '---CHANGES---';

  let coverLetter: string;
  let painPoints: string[] = [];
  let changes: string[] = [];

  const painPointsIndex = fullText.indexOf(painPointsSeparator);
  const changesIndex = fullText.indexOf(changesSeparator);

  if (painPointsIndex !== -1) {
    coverLetter = fullText.substring(0, painPointsIndex).trim();

    const painPointsEnd = changesIndex !== -1 ? changesIndex : fullText.length;
    const painPointsText = fullText.substring(painPointsIndex + painPointsSeparator.length, painPointsEnd).trim();
    painPoints = painPointsText
      .split('\n')
      .map((line) => line.replace(/^-\s*/, '').trim())
      .filter((line) => line.length > 0);

    if (changesIndex !== -1) {
      const changesText = fullText.substring(changesIndex + changesSeparator.length).trim();
      changes = changesText
        .split('\n')
        .map((line) => line.replace(/^-\s*/, '').trim())
        .filter((line) => line.length > 0);
    }
  } else if (changesIndex !== -1) {
    coverLetter = fullText.substring(0, changesIndex).trim();
    const changesText = fullText.substring(changesIndex + changesSeparator.length).trim();
    changes = changesText
      .split('\n')
      .map((line) => line.replace(/^-\s*/, '').trim())
      .filter((line) => line.length > 0);
  } else {
    coverLetter = fullText.trim();
  }

  const validation = validateTailoredContent(request.resumeText, coverLetter);

  const verifiedChanges = verifyFeedbackApplied(
    request.feedback,
    request.feedbackHistory || [],
    request.currentDraft,
    coverLetter
  );

  return {
    coverLetter,
    painPoints,
    changes,
    flaggedKeywords: validation.flaggedSkills,
    verifiedChanges,
  };
}

// ---------------------------------------------------------------------------
// Initial Generation Types & Functions
// ---------------------------------------------------------------------------

/**
 * Parse the ---TAILORING_SUMMARY--- block from the AI output into a structured object.
 */
function parseTailoringSummary(text: string): TailoringSummary | undefined {
  const summaryMarker = '---TAILORING_SUMMARY---';
  const summaryIndex = text.indexOf(summaryMarker);
  if (summaryIndex === -1) return undefined;

  const summaryText = text.substring(summaryIndex + summaryMarker.length).trim();

  const extractField = (label: string): string => {
    const pattern = new RegExp(`^${label}:\\s*(.+)`, 'mi');
    const match = summaryText.match(pattern);
    return match ? match[1].trim() : '';
  };

  return {
    headline: extractField('HEADLINE'),
    keywordsIntegrated: extractField('KEYWORDS_INTEGRATED'),
    keywordsNotIntegrated: extractField('KEYWORDS_NOT_INTEGRATED'),
    rolesIncluded: extractField('ROLES_INCLUDED'),
    rolesExcluded: extractField('ROLES_EXCLUDED'),
    projectsIncluded: extractField('PROJECTS_INCLUDED'),
    skillsAddedFromJD: extractField('SKILLS_ADDED_FROM_JD'),
    dateFormat: extractField('DATE_FORMAT'),
  };
}

export interface TailorRequest {
  resumeText: string;
  jobTitle: string;
  company: string;
  jobDescription: string;
  requirements: string[];
  feedback?: string[];
  userPrompt?: string;
  strategyMode?: string;
  documentType?: string;
}

export interface TailoringSummary {
  headline: string;
  keywordsIntegrated: string;
  keywordsNotIntegrated: string;
  rolesIncluded: string;
  rolesExcluded: string;
  projectsIncluded: string;
  skillsAddedFromJD: string;
  dateFormat: string;
}

export interface TailorResponse {
  tailoredResume: string;
  changes: string[];
  flaggedKeywords?: string[];
  verifiedChanges?: FeedbackVerification[];
  tailoringSummary?: TailoringSummary;
}

export async function tailorResume(request: TailorRequest): Promise<TailorResponse> {
  const { resumeText, jobTitle, company, jobDescription, requirements, feedback, userPrompt, strategyMode, documentType } = request;

  const systemPrompt = await buildSystemPrompt(strategyMode, documentType);

  const decomposedTitle = decomposeJobTitle(jobTitle);
  const headlineGuidance = buildHeadlineGuidance(decomposedTitle);

  const isResume = !documentType || documentType === 'resume';
  const contentDirective = isResume ? `\n\n**Content Directive:**
Target output: 2 pages, 3-4 bullets per role, 800-1000 words. Include all relevant roles and client engagements. Every bullet must contain at least one exact JD keyword. Only cut a role if it has zero relevance to the JD. Include the Projects section when projects cover JD-relevant skills.` : '';

  let messageContent = `Please tailor this resume for the following job:

**Job Title:** ${jobTitle}
**Company:** ${company}

${headlineGuidance}

**Job Description:**
${jobDescription}

**Key Requirements:**
${requirements.map((r) => `- ${r}`).join('\n')}

**Current Resume:**
${resumeText}${contentDirective}`;

  if (userPrompt) {
    messageContent += `\n\n**MANDATORY REVISION INSTRUCTIONS (these override base rules — you MUST follow them):**\n${userPrompt}`;
  }

  if (feedback && feedback.length > 0) {
    messageContent += `\n\n**MANDATORY FEEDBACK (highest priority — apply these revisions exactly as requested):**
${feedback.map((f, i) => `${i + 1}. ${f}`).join('\n')}`;
  }

  const maxTokens = documentType === 'cv' ? 16384 : 8192;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: messageContent }],
  });

  const content = response.content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected response type');
  }

  const fullText = content.text;

  // Parse the response to separate resume, changes, and tailoring summary
  const changesSeparator = '---CHANGES---';
  const summaryMarker = '---TAILORING_SUMMARY---';
  const separatorIndex = fullText.indexOf(changesSeparator);

  let tailoredResume: string;
  let changes: string[] = [];

  if (separatorIndex !== -1) {
    tailoredResume = fullText.substring(0, separatorIndex).trim();
    // Extract changes between ---CHANGES--- and ---TAILORING_SUMMARY--- (or end)
    const changesStart = separatorIndex + changesSeparator.length;
    const summaryIdx = fullText.indexOf(summaryMarker, changesStart);
    const changesEnd = summaryIdx !== -1 ? summaryIdx : fullText.length;
    const changesText = fullText.substring(changesStart, changesEnd).trim();
    changes = changesText
      .split('\n')
      .map((line) => line.replace(/^-\s*/, '').trim())
      .filter((line) => line.length > 0);
  } else {
    tailoredResume = fullText.substring(0, fullText.indexOf(summaryMarker) !== -1 ? fullText.indexOf(summaryMarker) : fullText.length).trim();
    changes = ['Resume has been tailored to match the job requirements'];
  }

  // Parse the tailoring summary
  const tailoringSummary = parseTailoringSummary(fullText);

  // Post-generation validation
  const validation = validateTailoredContent(resumeText, tailoredResume);
  if (validation.flaggedSkills.length > 0) {
    changes.push(`WARNING: Potentially new keywords detected: ${validation.flaggedSkills.join(', ')}`);
  }

  return { tailoredResume, changes, flaggedKeywords: validation.flaggedSkills, tailoringSummary };
}

// Streaming version for better UX
export async function* tailorResumeStream(
  request: TailorRequest
): AsyncGenerator<string, TailorResponse, unknown> {
  const { resumeText, jobTitle, company, jobDescription, requirements, feedback, userPrompt, strategyMode, documentType } = request;

  const systemPrompt = await buildSystemPrompt(strategyMode, documentType);

  const decomposedTitle = decomposeJobTitle(jobTitle);
  const headlineGuidance = buildHeadlineGuidance(decomposedTitle);

  const isResumeDoc = !documentType || documentType === 'resume';
  const streamContentDirective = isResumeDoc ? `\n\n**Content Directive:**
Target output: 2 pages, 3-4 bullets per role, 800-1000 words. Include all relevant roles and client engagements. Every bullet must contain at least one exact JD keyword. Only cut a role if it has zero relevance to the JD. Include the Projects section when projects cover JD-relevant skills.` : '';

  let messageContent = `Please tailor this resume for the following job:

**Job Title:** ${jobTitle}
**Company:** ${company}

${headlineGuidance}

**Job Description:**
${jobDescription}

**Key Requirements:**
${requirements.map((r) => `- ${r}`).join('\n')}

**Current Resume:**
${resumeText}${streamContentDirective}`;

  if (userPrompt) {
    messageContent += `\n\n**MANDATORY REVISION INSTRUCTIONS (these override base rules — you MUST follow them):**\n${userPrompt}`;
  }

  if (feedback && feedback.length > 0) {
    messageContent += `\n\n**MANDATORY FEEDBACK (highest priority — apply these revisions exactly as requested):**
${feedback.map((f, i) => `${i + 1}. ${f}`).join('\n')}`;
  }

  // CVs need more tokens — they include all experience, publications, research, etc.
  const maxTokens = documentType === 'cv' ? 16384 : 8192;

  const stream = anthropic.messages.stream({
    model: 'claude-sonnet-4-20250514',
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: messageContent }],
  });

  let fullText = '';

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      fullText += event.delta.text;
      yield event.delta.text;
    }
  }

  // Parse the response — extract resume, changes, and tailoring summary
  const changesSeparator = '---CHANGES---';
  const summaryMarker = '---TAILORING_SUMMARY---';
  const separatorIndex = fullText.indexOf(changesSeparator);

  let tailoredResume: string;
  let changes: string[] = [];

  if (separatorIndex !== -1) {
    tailoredResume = fullText.substring(0, separatorIndex).trim();
    // Extract changes between ---CHANGES--- and ---TAILORING_SUMMARY--- (or end)
    const changesStart = separatorIndex + changesSeparator.length;
    const summaryIdx = fullText.indexOf(summaryMarker, changesStart);
    const changesEnd = summaryIdx !== -1 ? summaryIdx : fullText.length;
    const changesText = fullText.substring(changesStart, changesEnd).trim();
    changes = changesText
      .split('\n')
      .map((line) => line.replace(/^-\s*/, '').trim())
      .filter((line) => line.length > 0);
  } else {
    tailoredResume = fullText.substring(0, fullText.indexOf(summaryMarker) !== -1 ? fullText.indexOf(summaryMarker) : fullText.length).trim();
    changes = ['Resume has been tailored to match the job requirements'];
  }

  // Parse the tailoring summary
  const tailoringSummary = parseTailoringSummary(fullText);

  // Post-generation validation
  const validation = validateTailoredContent(request.resumeText, tailoredResume);
  if (validation.flaggedSkills.length > 0) {
    changes.push(`WARNING: Potentially new keywords detected: ${validation.flaggedSkills.join(', ')}`);
  }

  return { tailoredResume, changes, flaggedKeywords: validation.flaggedSkills, tailoringSummary };
}

// ---------------------------------------------------------------------------
// Cover Letter Tailoring
// ---------------------------------------------------------------------------

export interface TailorCoverLetterRequest {
  resumeText: string;
  coverLetterTemplate?: string;
  jobTitle: string;
  company: string;
  jobDescription: string;
  requirements: string[];
  feedback?: string[];
  userPrompt?: string;
}

export interface TailorCoverLetterResponse {
  coverLetter: string;
  painPoints: string[];
  changes: string[];
  flaggedKeywords?: string[];
  verifiedChanges?: FeedbackVerification[];
}

export async function* tailorCoverLetterStream(
  request: TailorCoverLetterRequest
): AsyncGenerator<string, TailorCoverLetterResponse, unknown> {
  const { resumeText, coverLetterTemplate, jobTitle, company, jobDescription, requirements, feedback, userPrompt } = request;

  const systemPrompt = await buildCoverLetterSystemPrompt();

  let messageContent = `Please write a tailored cover letter for the following job:

**Job Title:** ${jobTitle}
**Company:** ${company}

**Job Description:**
${jobDescription}

**Key Requirements:**
${requirements.map((r) => `- ${r}`).join('\n')}

**Candidate's Resume (source of truth for experience/skills):**
${resumeText}`;

  if (coverLetterTemplate) {
    messageContent += `\n\n**Cover Letter Template (use as style/tone reference):**\n${coverLetterTemplate}`;
  }

  if (userPrompt) {
    messageContent += `\n\n**MANDATORY REVISION INSTRUCTIONS (these override base rules — you MUST follow them):**\n${userPrompt}`;
  }

  if (feedback && feedback.length > 0) {
    messageContent += `\n\n**MANDATORY FEEDBACK (highest priority — apply these revisions exactly as requested, including any sign-off or closing preferences):**
${feedback.map((f, i) => `${i + 1}. ${f}`).join('\n')}`;
  }

  const stream = anthropic.messages.stream({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: messageContent }],
  });

  let fullText = '';

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      fullText += event.delta.text;
      yield event.delta.text;
    }
  }

  // Parse the response — extract pain points and changes
  const painPointsSeparator = '---PAIN_POINTS---';
  const changesSeparator = '---CHANGES---';

  let coverLetter: string;
  let painPoints: string[] = [];
  let changes: string[] = [];

  const painPointsIndex = fullText.indexOf(painPointsSeparator);
  const changesIndex = fullText.indexOf(changesSeparator);

  if (painPointsIndex !== -1) {
    coverLetter = fullText.substring(0, painPointsIndex).trim();

    const painPointsEnd = changesIndex !== -1 ? changesIndex : fullText.length;
    const painPointsText = fullText.substring(painPointsIndex + painPointsSeparator.length, painPointsEnd).trim();
    painPoints = painPointsText
      .split('\n')
      .map((line) => line.replace(/^-\s*/, '').trim())
      .filter((line) => line.length > 0);

    if (changesIndex !== -1) {
      const changesText = fullText.substring(changesIndex + changesSeparator.length).trim();
      changes = changesText
        .split('\n')
        .map((line) => line.replace(/^-\s*/, '').trim())
        .filter((line) => line.length > 0);
    }
  } else if (changesIndex !== -1) {
    coverLetter = fullText.substring(0, changesIndex).trim();
    const changesText = fullText.substring(changesIndex + changesSeparator.length).trim();
    changes = changesText
      .split('\n')
      .map((line) => line.replace(/^-\s*/, '').trim())
      .filter((line) => line.length > 0);
  } else {
    coverLetter = fullText.trim();
  }

  // Post-generation validation against the resume
  const validation = validateTailoredContent(resumeText, coverLetter);

  return {
    coverLetter,
    painPoints,
    changes,
    flaggedKeywords: validation.flaggedSkills,
  };
}
