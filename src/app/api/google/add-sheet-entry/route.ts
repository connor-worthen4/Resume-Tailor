import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { addSheetEntry } from '@/lib/google/sheets';

const requestSchema = z.object({
  company: z.string().min(1, 'Company is required'),
  jobTitle: z.string().min(1, 'Job title is required'),
  url: z.string().optional(),
  resumeLink: z.string().optional(),
  cvLink: z.string().optional(),
  coverLetterLink: z.string().optional(),
  documentType: z.enum(['resume', 'cv', 'cover_letter']).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.accessToken) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const body = await request.json();
    const data = requestSchema.parse(body);

    const result = await addSheetEntry(session.accessToken, data);

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error adding sheet entry:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0].message }, { status: 400 });
    }

    return NextResponse.json({ error: 'Failed to add sheet entry' }, { status: 500 });
  }
}
