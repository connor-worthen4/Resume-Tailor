import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { searchBaseFiles } from '@/lib/google/drive';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.accessToken) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const result = await searchBaseFiles(session.accessToken);

    const response: Record<string, { text: string; fileName: string; fileType: string }> = {};

    if (result.resume) {
      response.resume = {
        text: result.resume.text,
        fileName: result.resume.fileName,
        fileType: result.resume.fileType,
      };
    }

    if (result.cv) {
      response.cv = {
        text: result.cv.text,
        fileName: result.cv.fileName,
        fileType: result.cv.fileType,
      };
    }

    if (result.coverLetterTemplate) {
      response.coverLetterTemplate = {
        text: result.coverLetterTemplate.text,
        fileName: result.coverLetterTemplate.fileName,
        fileType: result.coverLetterTemplate.fileType,
      };
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error searching Drive for base files:', error);
    return NextResponse.json({ error: 'Failed to search Drive' }, { status: 500 });
  }
}
