export interface ResumeSection {
  title: string;
  content: string[];
}

// Common section headers
const sectionHeaders = [
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
  'technical skills',
  'professional summary',
  'career objective',
];

// Parse resume text into sections
export function parseResumeIntoSections(text: string): ResumeSection[] {
  const lines = text.split('\n').filter((line) => line.trim());
  const sections: ResumeSection[] = [];
  let currentSection: ResumeSection | null = null;

  for (const line of lines) {
    const lowerLine = line.toLowerCase().trim();
    const isHeader = sectionHeaders.some(
      (header) => lowerLine === header || lowerLine.startsWith(header + ':')
    );

    if (isHeader || (line === line.toUpperCase() && line.length > 2 && line.length < 50)) {
      if (currentSection) {
        sections.push(currentSection);
      }
      currentSection = {
        title: line.replace(/:$/, '').trim(),
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
