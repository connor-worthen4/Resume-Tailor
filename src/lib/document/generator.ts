import {
  Document,
  Paragraph,
  TextRun,
  HeadingLevel,
  Packer,
  AlignmentType,
  BorderStyle,
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

      // Section content
      for (const line of section.content) {
        const isBullet = line.trim().startsWith('-') || line.trim().startsWith('•');
        const cleanLine = line.replace(/^[-•]\s*/, '');

        children.push(
          new Paragraph({
            children: parseMarkdownBold(cleanLine, {
              size: styles.textSize,
              font: styles.font,
              color: atsColor,
            }),
            bullet: isBullet ? { level: 0 } : undefined,
            spacing: { after: 100 },
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

/**
 * Generate a simpler paragraph-based DOCX for cover letters.
 * No section headers — just flowing prose with consistent styling.
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
    const isClosing = /^(sincerely|regards|best regards|warm regards|respectfully|thank you)/i.test(trimmed);

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
        textSize: 22,
        accentColor: '2563EB', // Blue
        headerAlignment: AlignmentType.LEFT,
      };
    case 'classic':
      return {
        font: 'Times New Roman',
        nameSize: 28,
        sectionSize: 22,
        textSize: 22,
        accentColor: '000000', // Black
        headerAlignment: AlignmentType.CENTER,
      };
    case 'minimal':
      return {
        font: 'Arial',
        nameSize: 28,
        sectionSize: 20,
        textSize: 20,
        accentColor: '374151', // Gray
        headerAlignment: AlignmentType.LEFT,
      };
    default:
      return getTemplateStyles('modern');
  }
}

// For PDF generation, we'll use a server-side approach
// This function returns the data needed for PDF generation
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
