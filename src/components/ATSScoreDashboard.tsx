'use client';

import { useState } from 'react';
import type { ATSScoreResult } from '@/lib/ai/ats-scorer';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

function scoreColor(score: number): string {
  if (score >= 85) return 'text-green-700 dark:text-green-400';
  if (score >= 70) return 'text-green-600 dark:text-green-500';
  if (score >= 50) return 'text-yellow-600 dark:text-yellow-400';
  return 'text-red-600 dark:text-red-400';
}

function progressColor(score: number): string {
  if (score >= 85) return '[&>div]:bg-green-600';
  if (score >= 70) return '[&>div]:bg-green-500';
  if (score >= 50) return '[&>div]:bg-yellow-500';
  return '[&>div]:bg-red-500';
}

interface ATSScoreDashboardProps {
  score: ATSScoreResult;
  originalScore?: ATSScoreResult | null;
  label?: string;
}

export function ATSScoreDashboard({ score, originalScore, label = 'Resume' }: ATSScoreDashboardProps) {
  const [expanded, setExpanded] = useState(false);
  const [keywordsExpanded, setKeywordsExpanded] = useState(false);
  const [debugExpanded, setDebugExpanded] = useState(false);

  const delta = originalScore ? score.totalScore - originalScore.totalScore : null;

  return (
    <Card>
      {/* Parsing Gate Warning */}
      {!score.passedParsingGate && (
        <div className="rounded-t-lg bg-red-100 px-4 py-3 text-sm font-medium text-red-800 dark:bg-red-900/30 dark:text-red-300">
          ATS PARSING RISK: Your resume may not be readable by ATS systems
          {score.parsingFailReasons?.map((reason, i) => (
            <div key={i} className="mt-1 text-xs font-normal">- {reason}</div>
          ))}
        </div>
      )}

      <CardHeader className="pb-3">
        <CardTitle className="text-base">ATS Compatibility Score</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Primary Score — Optimization Score (Step 13) */}
        <div className="flex items-center gap-4">
          <div className={`text-4xl font-bold ${scoreColor(score.totalScore)}`}>
            {score.totalScore}
          </div>
          <div className="flex-1">
            <Progress value={score.totalScore} className={`h-3 ${progressColor(score.totalScore)}`} />
          </div>
          {delta !== null && delta !== 0 && (
            <div className={`text-sm font-medium ${delta > 0 ? 'text-green-600' : 'text-red-600'}`}>
              {delta > 0 ? '+' : ''}{delta} pts
            </div>
          )}
        </div>

        {/* Secondary Score — JD Coverage (Step 13) */}
        {score.jdCoverageDetail && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>JD Coverage: {score.jdCoverageDetail.percentage}%</span>
            <span className="text-muted-foreground/60">|</span>
            <span>{score.jdCoverageDetail.overlappingSkills} of {score.jdCoverageDetail.totalJDSkills} skills matched</span>
          </div>
        )}

        {/* Before/After Comparison */}
        {originalScore && (
          <div className="rounded-md bg-muted/50 p-3 text-xs">
            <div className="mb-1 font-medium">Before / After Tailoring</div>
            <div className="grid grid-cols-3 gap-2">
              <div>Hard Skills: {originalScore.tierScores.hardSkillMatch.score} → {score.tierScores.hardSkillMatch.score}</div>
              <div>Job Title: {originalScore.tierScores.jobTitleAlignment.score} → {score.tierScores.jobTitleAlignment.score}</div>
              <div>Structure: {originalScore.tierScores.structuralCompliance.score} → {score.tierScores.structuralCompliance.score}</div>
            </div>
          </div>
        )}

        {/* Tier Breakdown */}
        <Collapsible open={expanded} onOpenChange={setExpanded}>
          <CollapsibleTrigger className="flex w-full items-center justify-between text-sm font-medium text-muted-foreground hover:text-foreground">
            Score Breakdown
            <span className="text-xs">{expanded ? 'Hide' : 'Show'}</span>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3 space-y-3">
            {/* Hard Skills Match */}
            <TierRow
              label="Hard Skills Match"
              weight="35%"
              score={score.tierScores.hardSkillMatch.score}
              detail={`${score.tierScores.hardSkillMatch.matched.length} matched, ${score.tierScores.hardSkillMatch.missing.length} missing`}
            />

            {/* Job Title Alignment */}
            <TierRow
              label="Job Title Alignment"
              weight="15%"
              score={score.tierScores.jobTitleAlignment.score}
              detail={`Match: ${score.tierScores.jobTitleAlignment.matchType}`}
            />

            {/* Experience Relevance */}
            <TierRow
              label="Experience Relevance"
              weight="20%"
              score={score.tierScores.experienceRelevance.score}
              detail={`${score.tierScores.experienceRelevance.contextualKeywords} contextual, ${score.tierScores.experienceRelevance.bareListKeywords} listed`}
            />

            {/* Soft Skills Match */}
            <TierRow
              label="Soft Skills Match"
              weight="5%"
              score={score.tierScores.softSkillMatch.score}
              detail={`${score.tierScores.softSkillMatch.matched.length} matched`}
            />

            {/* Structure */}
            <TierRow
              label="Structure & Format"
              weight="15%"
              score={score.tierScores.structuralCompliance.score}
              detail={score.tierScores.structuralCompliance.issues.length === 0 ? 'All checks passed' : `${score.tierScores.structuralCompliance.issues.length} issue(s)`}
            />

            {/* Content Compliance Checks (Step 12 auto-scored section) */}
            {score.tierScores.structuralCompliance.contentChecks &&
              score.tierScores.structuralCompliance.contentChecks.length > 0 && (
              <div className="ml-4 space-y-1 border-l-2 border-muted pl-3">
                <div className="mb-1 text-xs font-medium text-muted-foreground">Content Compliance</div>
                {score.tierScores.structuralCompliance.contentChecks.map((check, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className={check.passed ? 'text-green-600' : 'text-red-500'}>
                      {check.passed ? '\u2713' : '\u2717'}
                    </span>
                    <span className={check.passed ? 'text-muted-foreground' : ''}>
                      {check.label}
                    </span>
                    {check.detail && (
                      <span className="text-muted-foreground/60 text-[10px]">({check.detail})</span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Supplementary */}
            <TierRow
              label="Supplementary Factors"
              weight="10%"
              score={score.tierScores.supplementaryFactors.score}
              detail={score.tierScores.supplementaryFactors.issues.length === 0 ? 'All checks passed' : `${score.tierScores.supplementaryFactors.issues.length} issue(s)`}
            />
          </CollapsibleContent>
        </Collapsible>

        {/* Keyword Density Detail */}
        {score.keywordDensity.length > 0 && (
          <Collapsible open={keywordsExpanded} onOpenChange={setKeywordsExpanded}>
            <CollapsibleTrigger className="flex w-full items-center justify-between text-sm font-medium text-muted-foreground hover:text-foreground">
              Keyword Density
              <span className="text-xs">{keywordsExpanded ? 'Hide' : 'Show'}</span>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3">
              <div className="space-y-1">
                {score.keywordDensity.filter(k => k.density > 0).map((kw, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="w-24 truncate font-mono">{kw.term}</span>
                    <Progress
                      value={Math.min(100, kw.density * 33)}
                      className={`h-2 flex-1 ${kw.overStuffed ? '[&>div]:bg-red-500' : kw.density > 2.2 ? '[&>div]:bg-yellow-500' : '[&>div]:bg-green-500'}`}
                    />
                    <span className={`w-12 text-right ${kw.overStuffed ? 'text-red-600' : ''}`}>
                      {kw.density}%
                    </span>
                    {kw.overStuffed && <span className="text-red-600">Stuffing</span>}
                  </div>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Missing Skills Callout — Step 11: only real extracted skills */}
        {score.tierScores.hardSkillMatch.skillsGap &&
          score.tierScores.hardSkillMatch.skillsGap.length > 0 && (
          <div className="rounded-md border border-yellow-200 bg-yellow-50 p-3 text-xs dark:border-yellow-900 dark:bg-yellow-900/20">
            <div className="mb-1 font-medium text-yellow-800 dark:text-yellow-300">
              JD Skills Not in Your Resume
            </div>
            <div className="text-yellow-700 dark:text-yellow-400">
              {score.tierScores.hardSkillMatch.skillsGap.join(', ')}
            </div>
            <div className="mt-1 text-yellow-600 dark:text-yellow-500">
              These were not added because they don&apos;t appear in your base resume. If you have this experience, add them to your master resume.
            </div>
          </div>
        )}

        {/* Optimization failures (skills candidate has but weren't placed well) */}
        {score.tierScores.hardSkillMatch.missing.length > 0 && (
          <div className="rounded-md border border-orange-200 bg-orange-50 p-3 text-xs dark:border-orange-900 dark:bg-orange-900/20">
            <div className="mb-1 font-medium text-orange-800 dark:text-orange-300">
              Skills to Improve Placement
            </div>
            <div className="text-orange-700 dark:text-orange-400">
              {score.tierScores.hardSkillMatch.missing.join(', ')}
            </div>
            <div className="mt-1 text-orange-600 dark:text-orange-500">
              These skills are in your base resume but could be placed more prominently in the tailored version.
            </div>
          </div>
        )}

        {/* Recommendations */}
        {score.recommendations.length > 0 && (
          <div className="space-y-1">
            <div className="text-sm font-medium">Recommendations</div>
            {score.recommendations.map((rec, i) => (
              <div key={i} className="text-xs text-muted-foreground">
                - {rec}
              </div>
            ))}
          </div>
        )}

        {/* Step 18: Debug/Transparency Panel */}
        {score.scoringDebug && (
          <Collapsible open={debugExpanded} onOpenChange={setDebugExpanded}>
            <CollapsibleTrigger className="flex w-full items-center justify-between text-sm font-medium text-muted-foreground hover:text-foreground">
              How We Scored Your Resume
              <span className="text-xs">{debugExpanded ? 'Hide' : 'Show'}</span>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3 space-y-2 text-xs">
              <div>
                <span className="font-medium">Hard skills from JD:</span>{' '}
                <span className="text-muted-foreground">
                  {score.scoringDebug.hardSkillsFromJD.join(', ') || 'None detected'}
                </span>
              </div>
              <div>
                <span className="font-medium">Soft skills from JD:</span>{' '}
                <span className="text-muted-foreground">
                  {score.scoringDebug.softSkillsFromJD.join(', ') || 'None detected'}
                </span>
              </div>
              <div>
                <span className="font-medium">Skills in your resume:</span>{' '}
                <span className="text-muted-foreground">
                  {score.scoringDebug.skillsInResume.join(', ') || 'None detected'}
                </span>
              </div>
              <div>
                <span className="font-medium">Overlapping (optimized for):</span>{' '}
                <span className="text-green-700 dark:text-green-400">
                  {score.scoringDebug.overlappingSkills.join(', ') || 'None'}
                </span>
              </div>
              {score.scoringDebug.skillsGap.length > 0 && (
                <div>
                  <span className="font-medium">Skills gap:</span>{' '}
                  <span className="text-yellow-700 dark:text-yellow-400">
                    {score.scoringDebug.skillsGap.join(', ')}
                  </span>
                </div>
              )}
              {score.scoringDebug.noisePercentageFiltered > 0 && (
                <div>
                  <span className="font-medium">Noise filtered:</span>{' '}
                  <span className="text-muted-foreground">
                    {score.scoringDebug.noisePercentageFiltered}% of JD text was company description, benefits, etc.
                  </span>
                </div>
              )}
            </CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>
    </Card>
  );
}

function TierRow({ label, weight, score, detail }: { label: string; weight: string; score: number; detail: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-36 truncate">{label}</span>
      <span className="w-8 text-muted-foreground">{weight}</span>
      <Progress value={score} className={`h-2 flex-1 ${progressColor(score)}`} />
      <span className={`w-8 text-right font-mono ${scoreColor(score)}`}>{score}</span>
      <span className="w-32 truncate text-muted-foreground">{detail}</span>
    </div>
  );
}
