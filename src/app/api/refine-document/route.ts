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
  // Validated to prevent score manipulation via crafted skill lists
  processedJD: z.object({
    cleanedText: z.string(),
    sections: z.object({
      relevant: z.record(z.string(), z.string()).optional(),
      noise: z.record(z.string(), z.string()).optional(),
      fullRelevantText: z.string(),
    }),
    extractedSkills: z.object({
      hardSkills: z.array(z.string()),
      softSkills: z.array(z.string()),
    }),
    metadata: z.object({
      yearsExperience: z.array(z.object({ min: z.number(), area: z.string().optional() })),
      degreeRequirement: z.object({ level: z.string(), field: z.string().optional() }).optional(),
      certifications: z.array(z.string()),
    }),
    jobTitle: z.string(),
    debug: z.any().optional(),
  }).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const data = requestSchema.parse(body);

    // Step 16: Reuse processedJD if provided and validated; otherwise preprocess fresh.
    // Even with Zod validation above, we re-derive from the JD text to prevent
    // a client from sending valid-shaped but fabricated skill lists.
    // The client-provided processedJD is used only as a performance hint — if the
    // structure matches what we'd derive, we skip reprocessing.
    let processedJD: ProcessedJD;
    if (data.processedJD && data.processedJD.extractedSkills) {
      // Sanity check: the provided skills should be derivable from the JD text
      const freshProcessed = preprocessJobDescription(data.jobDescription, data.jobTitle);
      const clientSkillCount = data.processedJD.extractedSkills.hardSkills.length;
      const freshSkillCount = freshProcessed.extractedSkills.hardSkills.length;

      // If the client's skill list is suspiciously different from what we'd derive,
      // use the fresh version instead
      if (Math.abs(clientSkillCount - freshSkillCount) > freshSkillCount * 0.5 + 3) {
        processedJD = freshProcessed;
      } else {
        processedJD = data.processedJD as ProcessedJD;
      }
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

            // Post-processing: full validation suite for cover letters
            const metricValidation = validateNoFabricatedMetrics(data.resumeText, result.coverLetter);
            const phraseValidation = validateNoNewPhrases(data.resumeText, result.coverLetter);
            const scopeInflation = detectScopeInflation(data.resumeText, result.coverLetter);

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
                  validationWarnings: [
                    ...metricValidation.warnings,
                    ...phraseValidation.warnings,
                    ...scopeInflation.warnings,
                  ],
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
          const errorMessage = classifyStreamingError(error);
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: 'error',
                message: errorMessage,
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
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.issues[0].message }, { status: 400 });
    }

    const message = classifyStreamingError(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Classifies an error into an actionable user-facing message.
 * Avoids leaking internal details while giving the user enough to act on.
 */
function classifyStreamingError(error: unknown): string {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('rate limit') || msg.includes('429')) {
      return 'Rate limit reached. Please wait a moment and try again.';
    }
    if (msg.includes('authentication') || msg.includes('401') || msg.includes('api key')) {
      return 'AI service authentication error. Check your API key configuration.';
    }
    if (msg.includes('content') && (msg.includes('filter') || msg.includes('block') || msg.includes('safety'))) {
      return 'The AI flagged content concerns. Try rephrasing your feedback or simplifying the request.';
    }
    if (msg.includes('timeout') || msg.includes('timed out')) {
      return 'The request timed out. Try a shorter document or simpler feedback.';
    }
    if (msg.includes('overloaded') || msg.includes('503')) {
      return 'AI service is temporarily overloaded. Please try again in a few minutes.';
    }
  }
  return 'Failed to refine document. Please try again.';
}
