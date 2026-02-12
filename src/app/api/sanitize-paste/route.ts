import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  stripLinkedInArtifacts,
  stripHRBoilerplate,
  extractTitleCompanyFromPaste,
  distillRequirements,
} from '@/lib/ai/linkedin-sanitizer';
import {
  cleanJDText,
  segmentJDSections,
  extractSkillsFromJD,
  extractRequirementMetadata,
} from '@/lib/ai/jd-preprocessor';

const requestSchema = z.object({
  rawText: z.string().min(1, 'Please provide job description text'),
  manualTitle: z.string().optional(),
  manualCompany: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { rawText, manualTitle, manualCompany } = requestSchema.parse(body);

    const originalWordCount = rawText.split(/\s+/).filter(Boolean).length;

    // Step 1: Strip LinkedIn UI artifacts
    const { sanitized: afterArtifacts, strippedItems } = stripLinkedInArtifacts(rawText);

    // Step 2: Strip HR boilerplate
    const { sanitized: afterBoilerplate, boilerplateWordCount } =
      stripHRBoilerplate(afterArtifacts);

    // Step 3: Clean text (normalize whitespace, quotes, dashes)
    const cleanedText = cleanJDText(afterBoilerplate);

    // Step 4: Segment into relevant vs noise sections
    const sections = segmentJDSections(cleanedText);

    // Step 5: Extract skills from relevant text
    const extractedSkills = extractSkillsFromJD(sections.fullRelevantText);

    // Step 6: Extract years/degree/certifications metadata
    const metadata = extractRequirementMetadata(sections.fullRelevantText);

    // Step 7: Auto-extract title/company from raw text
    const autoExtracted = extractTitleCompanyFromPaste(rawText);

    // Step 8: Distill structured requirements
    const requirements = distillRequirements(
      sections.fullRelevantText,
      extractedSkills,
      metadata,
    );

    // Use manual overrides if provided, else auto-extracted
    const title = manualTitle?.trim() || autoExtracted.title || '';
    const company = manualCompany?.trim() || autoExtracted.company || '';

    const cleanedWordCount = cleanedText.split(/\s+/).filter(Boolean).length;
    const wordsRemoved = originalWordCount - cleanedWordCount;
    const noisePercentage =
      originalWordCount > 0 ? Math.round((wordsRemoved / originalWordCount) * 100) : 0;

    return NextResponse.json({
      jobPosting: {
        url: '',
        title,
        company,
        description: sections.fullRelevantText,
        requirements,
      },
      stats: {
        originalWordCount,
        cleanedWordCount,
        wordsRemoved,
        noisePercentage,
        strippedItems,
        boilerplateWordCount,
        sectionsFound: {
          relevant: Object.keys(sections.relevant).filter(
            (k) => (sections.relevant as Record<string, string>)[k],
          ),
          noise: Object.keys(sections.noise).filter(
            (k) => (sections.noise as Record<string, string>)[k],
          ),
        },
      },
      extractedSkills: {
        hardSkills: extractedSkills.hardSkills,
        softSkills: extractedSkills.softSkills,
      },
      metadata: {
        yearsExperience: metadata.yearsExperience,
        degreeRequirement: metadata.degreeRequirement,
        certifications: metadata.certifications,
      },
      autoExtracted,
    });
  } catch (error) {
    console.error('Error sanitizing paste:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0].message },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { error: 'Failed to sanitize job description text.' },
      { status: 500 },
    );
  }
}
