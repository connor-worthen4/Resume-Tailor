'use client';

import { useState } from 'react';
import type { CoverLetterScoreResult } from '@/lib/ai/ats-scorer';
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

interface CoverLetterScoreDashboardProps {
  score: CoverLetterScoreResult;
}

export function CoverLetterScoreDashboard({ score }: CoverLetterScoreDashboardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Cover Letter Quality Score</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Primary Score */}
        <div className="flex items-center gap-4">
          <div className={`text-4xl font-bold ${scoreColor(score.totalScore)}`}>
            {score.totalScore}
          </div>
          <div className="flex-1">
            <Progress value={score.totalScore} className={`h-3 ${progressColor(score.totalScore)}`} />
          </div>
        </div>

        {/* Tier Breakdown */}
        <Collapsible open={expanded} onOpenChange={setExpanded}>
          <CollapsibleTrigger className="flex w-full items-center justify-between text-sm font-medium text-muted-foreground hover:text-foreground">
            Score Breakdown
            <span className="text-xs">{expanded ? 'Hide' : 'Show'}</span>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3 space-y-3">
            <TierRow
              label="Keyword Reinforcement"
              score={score.tierScores.keywordReinforcement.score}
              detail={`${score.tierScores.keywordReinforcement.found.length} of ${score.tierScores.keywordReinforcement.found.length + score.tierScores.keywordReinforcement.missing.length} keywords`}
            />
            <TierRow
              label="Pain Point Coverage"
              score={score.tierScores.painPointCoverage.score}
              detail={`${score.tierScores.painPointCoverage.addressed.length} addressed`}
            />
            <TierRow
              label="Length"
              score={score.tierScores.lengthCompliance.score}
              detail={`${score.tierScores.lengthCompliance.wordCount} words`}
            />
            <TierRow
              label="Originality"
              score={score.tierScores.noDuplication.score}
              detail={score.tierScores.noDuplication.duplicatedSentences.length === 0 ? 'No duplication' : `${score.tierScores.noDuplication.duplicatedSentences.length} duplicated`}
            />
            <TierRow
              label="Structure"
              score={score.tierScores.structuralCompliance.score}
              detail={`${score.tierScores.structuralCompliance.paragraphCount} paragraphs`}
            />
            <TierRow
              label="Authentic Voice"
              score={score.tierScores.authenticVoice.score}
              detail={score.tierScores.authenticVoice.flaggedPhrases.length === 0 ? 'No AI-isms detected' : `${score.tierScores.authenticVoice.flaggedPhrases.length} flagged`}
            />
          </CollapsibleContent>
        </Collapsible>

        {/* Flagged AI Phrases */}
        {score.tierScores.authenticVoice.flaggedPhrases.length > 0 && (
          <div className="rounded-md border border-yellow-200 bg-yellow-50 p-3 text-xs dark:border-yellow-900 dark:bg-yellow-900/20">
            <div className="mb-1 font-medium text-yellow-800 dark:text-yellow-300">
              AI-Sounding Phrases Detected
            </div>
            <div className="text-yellow-700 dark:text-yellow-400">
              {score.tierScores.authenticVoice.flaggedPhrases.map((phrase, i) => (
                <span key={i} className="mr-2 inline-block rounded bg-yellow-100 px-1 dark:bg-yellow-800/30">
                  &ldquo;{phrase}&rdquo;
                </span>
              ))}
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
      </CardContent>
    </Card>
  );
}

function TierRow({ label, score, detail }: { label: string; score: number; detail: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-36 truncate">{label}</span>
      <Progress value={score} className={`h-2 flex-1 ${progressColor(score)}`} />
      <span className={`w-8 text-right font-mono ${scoreColor(score)}`}>{score}</span>
      <span className="w-28 truncate text-muted-foreground">{detail}</span>
    </div>
  );
}
