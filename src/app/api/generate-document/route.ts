import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { generateDOCX, generateCoverLetterDOCX, preparePDFData, TemplateStyle } from '@/lib/document/generator';
import { parseResumeIntoSections } from '@/lib/document/parse-sections';

const requestSchema = z.object({
  text: z.string().min(1, 'Resume text is required'),
  format: z.enum(['pdf', 'docx']),
  template: z.enum(['modern', 'classic', 'minimal']).default('modern'),
  fileName: z.string().optional(),
  documentType: z.enum(['resume', 'cv', 'cover_letter']).optional(),
});

// Map template fonts to PDF standard fonts
const FONT_MAP: Record<string, { regular: string; bold: string }> = {
  'Calibri': { regular: 'Helvetica', bold: 'Helvetica-Bold' },
  'Times New Roman': { regular: 'Times-Roman', bold: 'Times-Bold' },
  'Arial': { regular: 'Helvetica', bold: 'Helvetica-Bold' },
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { text, format, template, fileName, documentType } = requestSchema.parse(body);

    const baseName = fileName || 'resume';
    const sanitizedName = baseName.replace(/[^a-zA-Z0-9-_]/g, '_');

    if (format === 'docx') {
      const buffer = documentType === 'cover_letter'
        ? await generateCoverLetterDOCX(text, template as TemplateStyle)
        : await generateDOCX(text, template as TemplateStyle);

      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          'Content-Type':
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'Content-Disposition': `attachment; filename="${sanitizedName}.docx"`,
        },
      });
    }

    if (format === 'pdf') {
      const pdfData = preparePDFData(text, template as TemplateStyle);
      const pdfContent = generateStructuredPDF(text, pdfData.styles, pdfData.sections);

      return new NextResponse(new Uint8Array(pdfContent), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${sanitizedName}.pdf"`,
        },
      });
    }

    return NextResponse.json({ error: 'Invalid format' }, { status: 400 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0].message }, { status: 400 });
    }

    return NextResponse.json({ error: 'Failed to generate document' }, { status: 500 });
  }
}

/**
 * Escape a string for safe inclusion in a PDF text object.
 * Handles backslash, parentheses, and strips non-ASCII chars that would
 * break Type1 font encoding (WinAnsiEncoding only supports Latin-1 subset).
 */
function pdfEscape(text: string): string {
  return text
    .replace(/[^\x20-\x7E]/g, '') // Strip non-printable/non-ASCII for Type1 safety
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

/**
 * PDF generator that uses parsed sections for structured output.
 * Supports: bold section headers, different font sizes, bullet indentation,
 * role line detection, and multi-page output with proper pagination.
 */
function generateStructuredPDF(
  text: string,
  styles: { font: string; nameSize: number; sectionSize: number; textSize: number },
  sections: ReturnType<typeof parseResumeIntoSections>,
): Buffer {
  const margin = 54; // 0.75 inch
  const pageWidth = 612;
  const pageHeight = 792;
  const contentWidth = pageWidth - 2 * margin;
  const textSize = styles.textSize;
  const sectionSize = styles.sectionSize;
  const nameSize = styles.nameSize;
  // lineHeight is used in pagination calculation below

  const fonts = FONT_MAP[styles.font] || FONT_MAP['Calibri'];

  // Approximate chars per line for text wrapping (proportional font estimate)
  const avgCharWidth = textSize * 0.48;
  const charsPerLine = Math.floor(contentWidth / avgCharWidth);
  const bulletIndent = 18;
  const bulletCharsPerLine = Math.floor((contentWidth - bulletIndent) / avgCharWidth);

  // Build a flat list of render instructions
  interface RenderLine {
    text: string;
    fontSize: number;
    bold: boolean;
    indent: number;
    spaceBefore: number;
    bullet?: boolean;
  }

  const renderLines: RenderLine[] = [];

  for (const section of sections) {
    if (section.title === 'Header') {
      for (let i = 0; i < section.content.length; i++) {
        const line = section.content[i];
        renderLines.push({
          text: line,
          fontSize: i === 0 ? nameSize : textSize,
          bold: i === 0,
          indent: 0,
          spaceBefore: i === 0 ? 0 : 2,
        });
      }
      // Separator after header
      renderLines.push({ text: '', fontSize: 4, bold: false, indent: 0, spaceBefore: 8 });
    } else {
      // Section header
      renderLines.push({
        text: section.title.toUpperCase(),
        fontSize: sectionSize,
        bold: true,
        indent: 0,
        spaceBefore: 12,
      });

      for (const line of section.content) {
        const trimmed = line.trim();
        const isBullet = trimmed.startsWith('-') || trimmed.startsWith('•') || trimmed.startsWith('*');
        const cleanLine = isBullet ? trimmed.replace(/^[-•*]\s*/, '') : trimmed;
        // Strip markdown bold markers for PDF (we can't render inline bold easily)
        const plainLine = cleanLine.replace(/\*\*/g, '');

        const maxChars = isBullet ? bulletCharsPerLine : charsPerLine;
        const wrapped = wrapText(plainLine, maxChars);

        for (let wi = 0; wi < wrapped.length; wi++) {
          renderLines.push({
            text: wrapped[wi],
            fontSize: textSize,
            bold: false,
            indent: isBullet ? bulletIndent : 0,
            spaceBefore: wi === 0 ? (isBullet ? 2 : 4) : 0,
            bullet: isBullet && wi === 0,
          });
        }
      }
    }
  }

  // Paginate
  const pages: RenderLine[][] = [[]];
  let currentY = pageHeight - margin;

  for (const rl of renderLines) {
    const needed = rl.fontSize * 1.4 + rl.spaceBefore;
    if (currentY - needed < margin) {
      pages.push([]);
      currentY = pageHeight - margin;
    }
    pages[pages.length - 1].push(rl);
    currentY -= needed;
  }

  if (pages.length === 1 && pages[0].length === 0) {
    pages[0].push({ text: '', fontSize: textSize, bold: false, indent: 0, spaceBefore: 0 });
  }

  // Build PDF objects
  const objects: string[] = [];
  let objectCount = 0;

  const addObject = (content: string): number => {
    objectCount++;
    objects.push(`${objectCount} 0 obj\n${content}\nendobj\n`);
    return objectCount;
  };

  // Catalog
  const catalogId = addObject('<< /Type /Catalog /Pages 2 0 R >>');

  // Pages placeholder
  const pagesPlaceholder = objectCount + 1;
  addObject('PAGES_PLACEHOLDER');

  // Fonts (regular + bold)
  const fontRegularId = addObject(
    `<< /Type /Font /Subtype /Type1 /BaseFont /${fonts.regular} /Encoding /WinAnsiEncoding >>`
  );
  const fontBoldId = addObject(
    `<< /Type /Font /Subtype /Type1 /BaseFont /${fonts.bold} /Encoding /WinAnsiEncoding >>`
  );

  // Create pages
  const pageIds: number[] = [];

  for (const pageLines of pages) {
    let stream = 'BT\n0 0 0 rg\n';
    let y = pageHeight - margin;

    for (const rl of pageLines) {
      y -= rl.spaceBefore;
      const fontRef = rl.bold ? '/F2' : '/F1';
      stream += `${fontRef} ${rl.fontSize} Tf\n`;

      const xPos = margin + rl.indent;

      // Draw bullet character
      if (rl.bullet) {
        stream += `1 0 0 1 ${margin} ${y} Tm\n`;
        // Use a simple dash as bullet for Type1 font compatibility
        stream += `(- ) Tj\n`;
      }

      stream += `1 0 0 1 ${xPos} ${y} Tm\n`;
      stream += `(${pdfEscape(rl.text)}) Tj\n`;

      y -= rl.fontSize * 1.4;
    }

    stream += 'ET';

    const contentId = addObject(
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
    );

    const pageId = addObject(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> >> >>`
    );
    pageIds.push(pageId);
  }

  // Fill pages placeholder
  objects[pagesPlaceholder - 1] = `${pagesPlaceholder} 0 obj\n<< /Type /Pages /Kids [${pageIds
    .map((id) => `${id} 0 R`)
    .join(' ')}] /Count ${pageIds.length} >>\nendobj\n`;

  // Assemble final PDF
  let pdf = '%PDF-1.4\n';

  const offsets: number[] = [];
  for (const obj of objects) {
    offsets.push(pdf.length);
    pdf += obj;
  }

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`;

  for (const offset of offsets) {
    pdf += `${offset.toString().padStart(10, '0')} 00000 n \n`;
  }

  pdf += `trailer\n<< /Size ${objectCount + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, 'utf-8');
}

function wrapText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];

  const lines: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxChars) {
      lines.push(remaining);
      break;
    }
    let breakPoint = maxChars;
    const lastSpace = remaining.lastIndexOf(' ', maxChars);
    if (lastSpace > maxChars * 0.4) {
      breakPoint = lastSpace;
    }
    lines.push(remaining.substring(0, breakPoint).trim());
    remaining = remaining.substring(breakPoint).trim();
  }

  return lines.length > 0 ? lines : [text];
}
