import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { uploadToDrive } from '@/lib/google/drive';
import { generateDOCX, generateCoverLetterDOCX, TemplateStyle } from '@/lib/document/generator';

const requestSchema = z.object({
  resumeText: z.string().min(1, 'Resume text is required'),
  company: z.string().min(1, 'Company is required'),
  jobTitle: z.string().min(1, 'Job title is required'),
  template: z.enum(['modern', 'classic', 'minimal']).default('modern'),
  format: z.enum(['pdf', 'docx']).default('pdf'),
  documentType: z.enum(['resume', 'cv', 'cover_letter']).default('resume'),
});

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.accessToken) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const body = await request.json();
    const { resumeText, company, jobTitle, template, documentType } = requestSchema.parse(body);

    // Generate document
    let fileBuffer: Buffer;
    const mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const extension = 'docx';

    if (documentType === 'cover_letter') {
      fileBuffer = await generateCoverLetterDOCX(resumeText, template as TemplateStyle);
    } else {
      fileBuffer = await generateDOCX(resumeText, template as TemplateStyle);
    }

    const sanitizedCompany = company.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    const typeSuffix = documentType === 'cover_letter' ? '-cover-letter' : documentType === 'cv' ? '-cv' : '-resume';
    const fileName = `${sanitizedCompany}${typeSuffix}.${extension}`;

    const result = await uploadToDrive(
      session.accessToken,
      fileBuffer,
      fileName,
      mimeType,
      company,
      jobTitle
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error uploading to Drive:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0].message }, { status: 400 });
    }

    return NextResponse.json({ error: 'Failed to upload to Drive' }, { status: 500 });
  }
}
