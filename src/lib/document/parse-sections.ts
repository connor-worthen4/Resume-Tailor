export interface ResumeSection {
  title: string;
  content: string[];
}

// Approved section headers — comprehensive list matching ATS expectations
const SECTION_HEADERS = new Set([
  'experience',
  'education',
  'skills',
  'summary',
  'objective',
  'projects',
  'certifications',
  'awards',
  'publications',
  'languages',
  'interests',
  'references',
  'work experience',
  'professional experience',
  'employment history',
  'technical skills',
  'core skills',
  'core competencies',
  'professional summary',
  'career objective',
  'profile',
  'academic background',
  'key projects',
  'selected projects',
  'licenses & certifications',
  'professional certifications',
  'awards & honors',
  'volunteer experience',
  'community involvement',
]);

// Words that commonly appear in ALL-CAPS but are NOT section headers
// (company names, abbreviations, location lines, etc.)
const ALL_CAPS_EXCLUDE_PATTERNS = [
  /^[A-Z]{1,5}$/, // Short abbreviations: IBM, AWS, NASA, NYC
  /,\s*[A-Z]{2}$/, // Location lines: "NEW YORK, NY"
  /\d/, // Contains numbers: "Q4 2023", "ISO 9001"
  /^(BS|BA|MS|MA|MBA|PHD|MD|JD|DO|LLC|INC|LTD|CORP|CO)$/i,
];

/**
 * Determines if a line is a section header.
 * Handles: exact match, "Header:" format, markdown headings (## Header), and ALL-CAPS.
 * Guards against false positives from company names and abbreviations.
 */
function isSectionHeader(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;

  // Check for markdown headings: ## Experience, ### Skills, etc.
  const markdownMatch = trimmed.match(/^#{1,3}\s+(.+)$/);
  if (markdownMatch) {
    const headingText = markdownMatch[1].replace(/[*_]/g, '').trim().toLowerCase();
    return SECTION_HEADERS.has(headingText);
  }

  // Check for bold markdown headings: **Experience** or **EXPERIENCE**
  const boldMatch = trimmed.match(/^\*\*([^*]+)\*\*$/);
  if (boldMatch) {
    const headingText = boldMatch[1].trim().toLowerCase();
    return SECTION_HEADERS.has(headingText);
  }

  const lowerLine = trimmed.toLowerCase().replace(/:$/, '').trim();

  // Exact match or "Header:" format
  if (SECTION_HEADERS.has(lowerLine)) return true;

  // ALL-CAPS detection with guards against false positives
  if (trimmed === trimmed.toUpperCase() && /^[A-Z\s&/]+$/.test(trimmed) && trimmed.length >= 4 && trimmed.length < 40) {
    // Check exclusion patterns
    for (const pattern of ALL_CAPS_EXCLUDE_PATTERNS) {
      if (pattern.test(trimmed)) return false;
    }
    // Additional guard: must be a recognized section header when lowercased
    // This prevents company names like "GOOGLE" or "ACME CORP" from being treated as headers
    const asLower = trimmed.toLowerCase();
    if (SECTION_HEADERS.has(asLower)) return true;
    // Allow if it's a close match (e.g., "WORK EXPERIENCE" -> "work experience")
    for (const header of SECTION_HEADERS) {
      if (asLower.includes(header) || header.includes(asLower)) return true;
    }
    return false;
  }

  return false;
}

/**
 * Extracts the clean heading text from a line, stripping markdown and formatting.
 */
function extractHeadingText(line: string): string {
  let text = line.trim();
  // Strip markdown heading markers
  text = text.replace(/^#{1,3}\s+/, '');
  // Strip bold markers
  text = text.replace(/^\*\*|\*\*$/g, '');
  // Strip trailing colon
  text = text.replace(/:$/, '');
  return text.trim();
}

// Parse resume text into sections
export function parseResumeIntoSections(text: string): ResumeSection[] {
  const lines = text.split('\n').filter((line) => line.trim());
  const sections: ResumeSection[] = [];
  let currentSection: ResumeSection | null = null;

  for (const line of lines) {
    if (isSectionHeader(line)) {
      if (currentSection) {
        sections.push(currentSection);
      }
      currentSection = {
        title: extractHeadingText(line),
        content: [],
      };
    } else if (currentSection) {
      currentSection.content.push(line);
    } else {
      // Content before first section (usually name/contact)
      if (!sections.length || sections[0].title !== 'Header') {
        sections.unshift({ title: 'Header', content: [] });
      }
      sections[0].content.push(line);
    }
  }

  if (currentSection) {
    sections.push(currentSection);
  }

  return sections;
}
