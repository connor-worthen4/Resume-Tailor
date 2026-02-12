import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { scrapeJobPosting, cleanJobDescription } from '@/lib/scraper';

const requestSchema = z.object({
  url: z.string().url('Please provide a valid URL'),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { url } = requestSchema.parse(body);

    const job = await scrapeJobPosting(url);

    // Clean up the description
    job.description = cleanJobDescription(job.description);

    // Validate we got meaningful content
    if (!job.title && !job.description) {
      return NextResponse.json(
        {
          error:
            'Could not extract job information from this page. Please try pasting the job details manually.',
        },
        { status: 400 }
      );
    }

    return NextResponse.json(job);
  } catch (error) {
    console.error('Error scraping job:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0].message },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        error:
          'Failed to scrape job posting. The site may be blocking automated requests. Please try pasting the job details manually.',
      },
      { status: 500 }
    );
  }
}
