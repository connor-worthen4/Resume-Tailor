import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { generateDOCX, generateCoverLetterDOCX, preparePDFData, TemplateStyle } from '@/lib/document/generator';

const requestSchema = z.object({
  text: z.string().min(1, 'Resume text is required'),
  format: z.enum(['pdf', 'docx']),
  template: z.enum(['modern', 'classic', 'minimal']).default('modern'),
  fileName: z.string().optional(),
  documentType: z.enum(['resume', 'cv', 'cover_letter']).optional(),
});

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
      // For PDF, we'll generate a simple text-based PDF
      const pdfData = preparePDFData(text, template as TemplateStyle);

      const pdfContent = generateSimplePDF(text, pdfData.styles);

      return new NextResponse(new Uint8Array(pdfContent), {
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': `attachment; filename="${sanitizedName}.pdf"`,
        },
      });
    }

    return NextResponse.json({ error: 'Invalid format' }, { status: 400 });
  } catch (error) {
    console.error('Error generating document:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0].message }, { status: 400 });
    }

    return NextResponse.json({ error: 'Failed to generate document' }, { status: 500 });
  }
}

// Simple PDF generation using raw PDF format
function generateSimplePDF(
  text: string,
  styles: { font: string; nameSize: number; textSize: number }
): Buffer {
  const lines = text.split('\n');
  const fontSize = styles.textSize;
  const lineHeight = fontSize * 1.5;
  const margin = 50;
  const pageWidth = 612; // Letter size
  const pageHeight = 792;
  const contentWidth = pageWidth - 2 * margin;

  // Wrap text to fit page width (rough approximation)
  const wrappedLines: string[] = [];
  const charsPerLine = Math.floor(contentWidth / (fontSize * 0.5));

  for (const line of lines) {
    if (line.length <= charsPerLine) {
      wrappedLines.push(line);
    } else {
      let remaining = line;
      while (remaining.length > 0) {
        let breakPoint = charsPerLine;
        if (remaining.length > charsPerLine) {
          const lastSpace = remaining.lastIndexOf(' ', charsPerLine);
          if (lastSpace > charsPerLine / 2) {
            breakPoint = lastSpace;
          }
        }
        wrappedLines.push(remaining.substring(0, breakPoint).trim());
        remaining = remaining.substring(breakPoint).trim();
      }
    }
  }

  // Calculate pages needed
  const linesPerPage = Math.floor((pageHeight - 2 * margin) / lineHeight);
  const pages: string[][] = [];

  for (let i = 0; i < wrappedLines.length; i += linesPerPage) {
    pages.push(wrappedLines.slice(i, i + linesPerPage));
  }

  if (pages.length === 0) {
    pages.push(['']);
  }

  // Build PDF
  const objects: string[] = [];
  let objectCount = 0;

  const addObject = (content: string): number => {
    objectCount++;
    objects.push(`${objectCount} 0 obj\n${content}\nendobj\n`);
    return objectCount;
  };

  // Catalog
  const catalogId = addObject('<< /Type /Catalog /Pages 2 0 R >>');

  // Pages
  const pageIds: number[] = [];
  const pagesPlaceholder = objectCount + 1;
  addObject('PAGES_PLACEHOLDER');

  // Font
  const fontId = addObject(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  );

  // Create pages
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const pageLines = pages[pageIndex];

    // Build content stream
    let stream = `BT\n0 0 0 rg\n/F1 ${fontSize} Tf\n`;
    let y = pageHeight - margin;

    for (const line of pageLines) {
      // Escape special characters in PDF strings
      const escapedLine = line
        .replace(/\\/g, '\\\\')
        .replace(/\(/g, '\\(')
        .replace(/\)/g, '\\)');

      stream += `1 0 0 1 ${margin} ${y} Tm\n(${escapedLine}) Tj\n`;
      y -= lineHeight;
    }

    stream += 'ET';

    // Content stream
    const contentId = addObject(
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
    );

    // Page
    const pageId = addObject(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`
    );
    pageIds.push(pageId);
  }

  // Update pages object
  objects[pagesPlaceholder - 1] = `${pagesPlaceholder} 0 obj\n<< /Type /Pages /Kids [${pageIds
    .map((id) => `${id} 0 R`)
    .join(' ')}] /Count ${pageIds.length} >>\nendobj\n`;

  // Build final PDF
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
