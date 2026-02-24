import {
  Document,
  Paragraph,
  TextRun,
  HeadingLevel,
  Packer,
  AlignmentType,
  BorderStyle,
  PageBreak,
} from 'docx';
import { parseResumeIntoSections } from './parse-sections';

export type TemplateStyle = 'modern' | 'classic' | 'minimal';

/** Split text on **bold** markers into styled TextRun segments. */
function parseMarkdownBold(
  text: string,
  baseOpts: { size: number; font: string; color: string },
): TextRun[] {
  const parts = text.split(/(\*\*.*?\*\*)/g);
  return parts.filter(Boolean).map((part) => {
    const isBold = part.startsWith('**') && part.endsWith('**');
    return new TextRun({
      text: isBold ? part.slice(2, -2) : part,
      bold: isBold,
      ...baseOpts,
    });
  });
}

/**
 * Detect if a line looks like a role/company header within an experience section.
 * Patterns: "Software Engineer | Company Name" or "Company Name - Role" or bold text.
 */
function isRoleLine(line: string): boolean {
  const trimmed = line.trim();
  // Contains pipe or dash separator typical of role lines
  if (/\s+[|]\s+/.test(trimmed) || /\s+[-–—]\s+/.test(trimmed)) {
    // But not bullet points
    if (!trimmed.startsWith('-') && !trimmed.startsWith('•')) return true;
  }
  // Entirely bold markdown
  if (/^\*\*.+\*\*$/.test(trimmed)) return true;
  return false;
}

/**
 * Detect if a line contains a date range (likely a role date line).
 * E.g., "January 2020 - Present" or "01/2020 - 03/2022"
 */
function isDateLine(line: string): boolean {
  return /(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}\s*[-–—]\s*(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|\d{4}|Present|Current)/i.test(line) ||
    /\d{1,2}\/\d{4}\s*[-–—]\s*(?:\d{1,2}\/\d{4}|Present|Current)/i.test(line);
}

// Generate DOCX document
export async function generateDOCX(
  resumeText: string,
  template: TemplateStyle
): Promise<Buffer> {
  const sections = parseResumeIntoSections(resumeText);

  const children: Paragraph[] = [];

  // Template-specific styling
  const styles = getTemplateStyles(template);

  // Force ATS-compliant black text
  const atsColor = '000000';

  // Track content height estimate for page break hints
  let estimatedLines = 0;
  const LINES_PER_PAGE = 45; // Rough estimate for page breaks

  for (const section of sections) {
    if (section.title === 'Header') {
      // Header section (name/contact info)
      for (let i = 0; i < section.content.length; i++) {
        const line = section.content[i];
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: line,
                bold: i === 0,
                size: i === 0 ? styles.nameSize : styles.textSize,
                font: styles.font,
                color: atsColor,
              }),
            ],
            alignment: styles.headerAlignment,
            spacing: { after: i === 0 ? 200 : 100 },
          })
        );
        estimatedLines++;
      }

      // Add separator after header
      if (template !== 'minimal') {
        children.push(
          new Paragraph({
            border: {
              bottom: {
                style: BorderStyle.SINGLE,
                size: 6,
                color: atsColor,
              },
            },
            spacing: { after: 200 },
          })
        );
      }
    } else {
      // Add page break hint before a new major section if we're near the page boundary
      // This prevents orphaned section headers at the bottom of a page
      if (estimatedLines > LINES_PER_PAGE - 5 && estimatedLines < LINES_PER_PAGE + 5) {
        children.push(
          new Paragraph({
            children: [new PageBreak()],
          })
        );
        estimatedLines = 0;
      }

      // Section header
      children.push(
        new Paragraph({
          children: [
            new TextRun({
              text: section.title.toUpperCase(),
              bold: true,
              size: styles.sectionSize,
              font: styles.font,
              color: atsColor,
            }),
          ],
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 300, after: 150 },
          border:
            template === 'classic'
              ? {
                  bottom: {
                    style: BorderStyle.SINGLE,
                    size: 4,
                    color: atsColor,
                  },
                }
              : undefined,
        })
      );
      estimatedLines += 2;

      // Section content with role/date/bullet differentiation
      for (const line of section.content) {
        const trimmed = line.trim();
        const isBullet = trimmed.startsWith('-') || trimmed.startsWith('•') || trimmed.startsWith('*');
        const cleanLine = isBullet ? trimmed.replace(/^[-•*]\s*/, '') : trimmed;

        if (isRoleLine(trimmed) && !isBullet) {
          // Role/Company line — bold
          // Strip markdown bold markers since we're making the whole line bold
          const plainLine = cleanLine.replace(/\*\*/g, '');
          children.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: plainLine,
                  bold: true,
                  size: styles.textSize,
                  font: styles.font,
                  color: atsColor,
                }),
              ],
              spacing: { before: 150, after: 50 },
            })
          );
        } else if (isDateLine(trimmed) && !isBullet) {
          // Date range line — italic, right-aligned or inline
          children.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: trimmed,
                  italics: true,
                  size: styles.textSize,
                  font: styles.font,
                  color: atsColor,
                }),
              ],
              spacing: { after: 100 },
            })
          );
        } else if (isBullet) {
          // Bullet point
          children.push(
            new Paragraph({
              children: parseMarkdownBold(cleanLine, {
                size: styles.textSize,
                font: styles.font,
                color: atsColor,
              }),
              bullet: { level: 0 },
              spacing: { after: 80 },
            })
          );
        } else {
          // Regular content line
          children.push(
            new Paragraph({
              children: parseMarkdownBold(cleanLine, {
                size: styles.textSize,
                font: styles.font,
                color: atsColor,
              }),
              spacing: { after: 100 },
            })
          );
        }
        estimatedLines++;
      }
    }
  }

  const doc = new Document({
    sections: [
      {
        properties: {},
        children,
      },
    ],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}

/**
 * Generate a DOCX for cover letters.
 * Handles prose paragraphs, greeting/closing, and optional bullet points.
 */
export async function generateCoverLetterDOCX(
  coverLetterText: string,
  template: TemplateStyle
): Promise<Buffer> {
  const styles = getTemplateStyles(template);
  const atsColor = '000000';
  const children: Paragraph[] = [];

  const paragraphs = coverLetterText.split(/\n\n+/);

  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;

    // Check if this looks like a greeting (Dear...) or closing (Sincerely,)
    const isGreeting = /^dear\s/i.test(trimmed);
    const isClosing = /^(sincerely|regards|best regards|warm regards|respectfully|thank you|best|cheers)/i.test(trimmed);

    if (isGreeting || isClosing) {
      children.push(
        new Paragraph({
          children: parseMarkdownBold(trimmed, {
            size: styles.textSize,
            font: styles.font,
            color: atsColor,
          }),
          spacing: { before: isClosing ? 300 : 0, after: 200 },
        })
      );
    } else {
      // Check if this paragraph contains bullet points (lines starting with - or *)
      const lines = trimmed.split('\n');
      const hasBullets = lines.some(l => /^\s*[-•*]\s/.test(l));

      if (hasBullets) {
        // Process mixed prose and bullets within a paragraph
        for (const line of lines) {
          const lineTrimmed = line.trim();
          if (!lineTrimmed) continue;

          const isBullet = /^[-•*]\s/.test(lineTrimmed);
          if (isBullet) {
            const bulletText = lineTrimmed.replace(/^[-•*]\s*/, '');
            children.push(
              new Paragraph({
                children: parseMarkdownBold(bulletText, {
                  size: styles.textSize,
                  font: styles.font,
                  color: atsColor,
                }),
                bullet: { level: 0 },
                spacing: { after: 80 },
              })
            );
          } else {
            children.push(
              new Paragraph({
                children: parseMarkdownBold(lineTrimmed, {
                  size: styles.textSize,
                  font: styles.font,
                  color: atsColor,
                }),
                spacing: { after: 100 },
              })
            );
          }
        }
      } else {
        // Regular body paragraph — join any single newlines within
        const text = trimmed.replace(/\n/g, ' ');
        children.push(
          new Paragraph({
            children: parseMarkdownBold(text, {
              size: styles.textSize,
              font: styles.font,
              color: atsColor,
            }),
            spacing: { after: 200 },
          })
        );
      }
    }
  }

  const doc = new Document({
    sections: [
      {
        properties: {},
        children,
      },
    ],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}

export function getTemplateStyles(template: TemplateStyle) {
  switch (template) {
    case 'modern':
      return {
        font: 'Calibri',
        nameSize: 32,
        sectionSize: 24,
        textSize: 22,       // 11pt
        accentColor: '2563EB',
        headerAlignment: AlignmentType.LEFT,
      };
    case 'classic':
      return {
        font: 'Times New Roman',
        nameSize: 28,
        sectionSize: 22,
        textSize: 22,       // 11pt
        accentColor: '000000',
        headerAlignment: AlignmentType.CENTER,
      };
    case 'minimal':
      return {
        font: 'Arial',
        nameSize: 28,
        sectionSize: 22,
        textSize: 22,       // 11pt (was 20/10pt — too small for ATS readability)
        accentColor: '374151',
        headerAlignment: AlignmentType.LEFT,
      };
    default:
      return getTemplateStyles('modern');
  }
}

// For PDF generation, we'll generate data needed for the PDF
export function preparePDFData(resumeText: string, template: TemplateStyle) {
  const sections = parseResumeIntoSections(resumeText);
  const styles = getTemplateStyles(template);

  return {
    sections,
    styles: {
      ...styles,
      nameSize: styles.nameSize / 2, // Convert to pt
      sectionSize: styles.sectionSize / 2,
      textSize: styles.textSize / 2,
    },
  };
}
