import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  tailorResumeStream,
  tailorCoverLetterStream,
  validateNoFabricatedMetrics,
  validateNoNewPhrases,
  detectScopeInflation,
  validateSectionHeadings,
  detectEmploymentGaps,
} from '@/lib/ai/tailor';
import { computeATSScore, scoreCoverLetter } from '@/lib/ai/ats-scorer';
import { preprocessJobDescription } from '@/lib/ai/jd-preprocessor';

const requestSchema = z.object({
  resumeText: z.string().min(1, 'Resume text is required'),
  jobTitle: z.string().min(1, 'Job title is required'),
  company: z.string().min(1, 'Company name is required'),
  jobDescription: z.string().min(1, 'Job description is required'),
  requirements: z.array(z.string()).default([]),
  feedback: z.array(z.string()).optional(),
  userPrompt: z.string().optional(),
  strategyMode: z.enum(['keyword', 'achievement', 'hybrid']).default('hybrid'),
  documentType: z.enum(['resume', 'cv', 'cover_letter']).default('resume'),
  coverLetterTemplate: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const data = requestSchema.parse(body);

    // Step 15: Preprocess the JD ONCE, reuse for all scoring
    const processedJD = preprocessJobDescription(data.jobDescription, data.jobTitle);

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          if (data.documentType === 'cover_letter') {
            // Cover letter generation
            const generator = tailorCoverLetterStream({
              resumeText: data.resumeText,
              coverLetterTemplate: data.coverLetterTemplate,
              jobTitle: data.jobTitle,
              company: data.company,
              jobDescription: data.jobDescription,
              requirements: data.requirements,
              feedback: data.feedback,
              userPrompt: data.userPrompt,
            });

            let result;
            while (true) {
              const { value, done } = await generator.next();
              if (done) {
                result = value;
                break;
              }
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: 'chunk', content: value })}\n\n`)
              );
            }

            // Post-processing: additional validation
            const metricValidation = validateNoFabricatedMetrics(data.resumeText, result.coverLetter);

            // Step 17: Cover letter scoring uses same processedJD
            const coverLetterScoreResult = scoreCoverLetter(
              result.coverLetter,
              processedJD,
              data.resumeText
            );

            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: 'complete',
                  coverLetter: result.coverLetter,
                  painPoints: result.painPoints,
                  changes: result.changes,
                  flaggedKeywords: result.flaggedKeywords || [],
                  coverLetterScore: coverLetterScoreResult,
                  processedJD,
                  validationWarnings: [
                    ...metricValidation.warnings,
                  ],
                })}\n\n`
              )
            );
          } else {
            // Resume/CV generation
            const generator = tailorResumeStream(data);
            let result;

            while (true) {
              const { value, done } = await generator.next();
              if (done) {
                result = value;
                break;
              }
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: 'chunk', content: value })}\n\n`)
              );
            }

            // Post-processing validation (Steps 35-38)
            const metricValidation = validateNoFabricatedMetrics(data.resumeText, result.tailoredResume);
            const phraseValidation = validateNoNewPhrases(data.resumeText, result.tailoredResume);
            const scopeInflation = detectScopeInflation(data.resumeText, result.tailoredResume);
            const headingValidation = validateSectionHeadings(result.tailoredResume);
            const gapDetection = detectEmploymentGaps(result.tailoredResume);

            // Step 15: ATS Scoring uses preprocessed JD + original resume for gap detection
            const atsScore = computeATSScore(result.tailoredResume, processedJD, data.resumeText);

            // Original resume score for comparison (also uses same processedJD)
            const originalATSScore = computeATSScore(data.resumeText, processedJD, data.resumeText);

            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: 'complete',
                  tailoredResume: result.tailoredResume,
                  changes: result.changes,
                  flaggedKeywords: result.flaggedKeywords || [],
                  atsScore,
                  originalATSScore,
                  processedJD,
                  validationWarnings: [
                    ...metricValidation.warnings,
                    ...phraseValidation.warnings,
                    ...scopeInflation.warnings,
                    ...headingValidation.suggestions,
                  ],
                  employmentGaps: gapDetection,
                })}\n\n`
              )
            );
          }

          controller.close();
        } catch (error) {
          console.error('Streaming error:', error);
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: 'error',
                message: 'Failed to tailor document',
              })}\n\n`
            )
          );
          controller.close();
        }
      },
    });

    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    console.error('Error tailoring document:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0].message }, { status: 400 });
    }

    return NextResponse.json({ error: 'Failed to tailor document' }, { status: 500 });
  }
}
