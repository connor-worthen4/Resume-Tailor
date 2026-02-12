import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  refineResumeStream,
  refineCoverLetterStream,
  validateNoFabricatedMetrics,
  validateNoNewPhrases,
  detectScopeInflation,
} from '@/lib/ai/tailor';
import { computeATSScore, scoreCoverLetter } from '@/lib/ai/ats-scorer';
import { preprocessJobDescription } from '@/lib/ai/jd-preprocessor';
import type { ProcessedJD } from '@/lib/ai/jd-preprocessor';

const requestSchema = z.object({
  currentDraft: z.string().min(1, 'Current draft is required'),
  feedback: z.string().min(1, 'Feedback is required'),
  feedbackHistory: z.array(z.string()).default([]),
  resumeText: z.string().min(1, 'Resume text is required'),
  jobTitle: z.string().min(1, 'Job title is required'),
  company: z.string().min(1, 'Company name is required'),
  jobDescription: z.string().min(1, 'Job description is required'),
  requirements: z.array(z.string()).default([]),
  documentType: z.enum(['resume', 'cv', 'cover_letter']).default('resume'),
  coverLetterTemplate: z.string().optional(),
  topKeywords: z.string().optional(),
  coreRequirements: z.array(z.string()).optional(),
  // Step 16: Accept pre-processed JD from the client to reuse
  processedJD: z.any().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const data = requestSchema.parse(body);

    // Step 16: Reuse processedJD if provided; otherwise preprocess fresh
    let processedJD: ProcessedJD;
    if (data.processedJD && data.processedJD.extractedSkills) {
      processedJD = data.processedJD as ProcessedJD;
    } else {
      processedJD = preprocessJobDescription(data.jobDescription, data.jobTitle);
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          if (data.documentType === 'cover_letter') {
            const generator = refineCoverLetterStream({
              currentDraft: data.currentDraft,
              feedback: data.feedback,
              feedbackHistory: data.feedbackHistory,
              resumeText: data.resumeText,
              jobTitle: data.jobTitle,
              company: data.company,
              jobDescription: data.jobDescription,
              requirements: data.requirements,
              documentType: data.documentType,
              coverLetterTemplate: data.coverLetterTemplate,
              topKeywords: data.topKeywords,
              coreRequirements: data.coreRequirements,
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

            // Post-processing validation
            const metricValidation = validateNoFabricatedMetrics(data.resumeText, result.coverLetter);

            // Step 17: Re-score cover letter using same processedJD
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
                  verifiedChanges: result.verifiedChanges || [],
                  coverLetterScore: coverLetterScoreResult,
                  validationWarnings: metricValidation.warnings,
                })}\n\n`
              )
            );
          } else {
            const generator = refineResumeStream({
              currentDraft: data.currentDraft,
              feedback: data.feedback,
              feedbackHistory: data.feedbackHistory,
              resumeText: data.resumeText,
              jobTitle: data.jobTitle,
              company: data.company,
              jobDescription: data.jobDescription,
              requirements: data.requirements,
              documentType: data.documentType,
              topKeywords: data.topKeywords,
              coreRequirements: data.coreRequirements,
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

            // Post-processing validation against ORIGINAL resume
            const metricValidation = validateNoFabricatedMetrics(data.resumeText, result.tailoredResume);
            const phraseValidation = validateNoNewPhrases(data.resumeText, result.tailoredResume);
            const scopeInflation = detectScopeInflation(data.resumeText, result.tailoredResume);

            // Step 16: Re-score using same processedJD + original resume
            const atsScore = computeATSScore(result.tailoredResume, processedJD, data.resumeText);

            // Score the previous draft for comparison (same processedJD)
            const previousATSScore = computeATSScore(data.currentDraft, processedJD, data.resumeText);

            // Warn if score dropped significantly
            const scoreDelta = atsScore.totalScore - previousATSScore.totalScore;
            const validationWarnings = [
              ...metricValidation.warnings,
              ...phraseValidation.warnings,
              ...scopeInflation.warnings,
            ];
            if (scoreDelta < -5) {
              validationWarnings.push(
                `This revision reduced your ATS score from ${previousATSScore.totalScore} to ${atsScore.totalScore}. Consider reviewing keyword coverage.`
              );
            }

            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: 'complete',
                  tailoredResume: result.tailoredResume,
                  changes: result.changes,
                  flaggedKeywords: result.flaggedKeywords || [],
                  verifiedChanges: result.verifiedChanges || [],
                  atsScore,
                  previousATSScore,
                  validationWarnings,
                })}\n\n`
              )
            );
          }

          controller.close();
        } catch (error) {
          console.error('Refinement streaming error:', error);
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: 'error',
                message: 'Failed to refine document',
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
    console.error('Error refining document:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0].message }, { status: 400 });
    }

    return NextResponse.json({ error: 'Failed to refine document' }, { status: 500 });
  }
}
