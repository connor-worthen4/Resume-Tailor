'use client';

import { useMemo, useState } from 'react';
import { diffWords, type Change } from 'diff';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { WarningBadge } from '@/components/WarningBadge';
import type { FeedbackVerification } from '@/lib/ai/tailor';
import { cn } from '@/lib/utils';

interface CoverLetterViewerProps {
  coverLetter: string;
  painPoints: string[];
  changes?: string[];
  flaggedKeywords?: string[];
  verifiedChanges?: FeedbackVerification[];
  previousDraft?: string;
  feedbackHistory?: string[];
}

interface Hunk {
  type: 'context' | 'change' | 'collapsed';
  parts: Change[];
  collapsedLength?: number;
}

function getHunks(diffResult: Change[], contextChars = 80): Hunk[] {
  const hunks: Hunk[] = [];

  for (const part of diffResult) {
    if (part.added || part.removed) {
      hunks.push({ type: 'change', parts: [part] });
    } else {
      const text = part.value;
      if (text.length <= contextChars * 2) {
        hunks.push({ type: 'context', parts: [part] });
      } else {
        const leading = text.slice(0, contextChars);
        hunks.push({ type: 'context', parts: [{ value: leading, count: 1, added: false, removed: false }] });
        const collapsedLen = text.length - contextChars * 2;
        hunks.push({ type: 'collapsed', parts: [], collapsedLength: collapsedLen });
        const trailing = text.slice(-contextChars);
        hunks.push({ type: 'context', parts: [{ value: trailing, count: 1, added: false, removed: false }] });
      }
    }
  }

  return hunks;
}

export function CoverLetterViewer({
  coverLetter,
  painPoints,
  changes,
  flaggedKeywords,
  verifiedChanges,
  previousDraft,
}: CoverLetterViewerProps) {
  const [diffOpen, setDiffOpen] = useState(false);

  const refinementDiff = useMemo(() => {
    if (!previousDraft) return null;
    return diffWords(previousDraft, coverLetter);
  }, [previousDraft, coverLetter]);

  const refinementHunks = useMemo(() => {
    if (!refinementDiff) return null;
    return getHunks(refinementDiff);
  }, [refinementDiff]);

  return (
    <div className="space-y-4">
      {flaggedKeywords && flaggedKeywords.length > 0 && (
        <WarningBadge flaggedKeywords={flaggedKeywords} />
      )}

      {painPoints.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Pain Points Analysis</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-2 text-sm text-muted-foreground">
              Key problems this role is hired to solve, addressed in your cover letter:
            </p>
            <ul className="list-inside list-disc space-y-1 text-sm">
              {painPoints.map((point, i) => (
                <li key={i}>{point}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Cover Letter Preview</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-h-[800px] overflow-auto rounded-md bg-muted p-4">
            <div className="whitespace-pre-wrap text-sm leading-relaxed">{coverLetter}</div>
          </div>
        </CardContent>
      </Card>

      {/* Audit Rail */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Applied Changes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Refinement Diff */}
          {refinementHunks && (
            <Collapsible open={diffOpen} onOpenChange={setDiffOpen}>
              <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium hover:bg-muted transition-colors">
                <span className={cn('text-xs transition-transform', diffOpen && 'rotate-90')}>
                  ▶
                </span>
                Refinement Diff
                <span className="text-xs text-muted-foreground ml-1">(previous draft → current)</span>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-2 max-h-[400px] overflow-auto rounded-md border bg-muted/50 p-4">
                  <pre className="whitespace-pre-wrap text-sm">
                    {refinementHunks.map((hunk, hi) => {
                      if (hunk.type === 'collapsed') {
                        return (
                          <span key={hi} className="diff-collapsed">
                            {`... ${hunk.collapsedLength} unchanged characters ...`}
                          </span>
                        );
                      }
                      return hunk.parts.map((part, pi) => {
                        if (part.added) {
                          return (
                            <span key={`${hi}-${pi}`} className="diff-added">
                              {part.value}
                            </span>
                          );
                        }
                        if (part.removed) {
                          return (
                            <span key={`${hi}-${pi}`} className="diff-removed">
                              {part.value}
                            </span>
                          );
                        }
                        return <span key={`${hi}-${pi}`}>{part.value}</span>;
                      });
                    })}
                  </pre>
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}

          {/* Feedback Status */}
          {verifiedChanges && verifiedChanges.length > 0 && (
            <div>
              {refinementHunks && <div className="border-t my-3" />}
              <p className="text-sm font-medium mb-2">Feedback Status</p>
              <ul className="space-y-1.5">
                {verifiedChanges.map((vc, index) => (
                  <li key={index} className="flex items-center gap-2 text-sm">
                    <span className="flex-1 truncate">{vc.feedback}</span>
                    <span
                      className={cn(
                        'shrink-0 text-xs px-1.5 py-0.5 rounded-full font-medium',
                        vc.applied
                          ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                          : 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400'
                      )}
                    >
                      {vc.applied ? 'Applied' : 'Not Detected'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* AI Summary */}
          {changes && changes.length > 0 && (
            <div>
              {((verifiedChanges && verifiedChanges.length > 0) || refinementHunks) && (
                <div className="border-t my-3" />
              )}
              <p className="text-sm font-medium mb-2">AI Summary</p>
              <ul className="list-inside list-disc space-y-1 text-sm">
                {changes.map((change, i) => (
                  <li key={i}>{change}</li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
