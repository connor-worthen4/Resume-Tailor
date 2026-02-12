'use client';

import { useMemo, useRef, useCallback, useState } from 'react';
import { diffWords, type Change } from 'diff';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ResumePreview } from '@/components/ResumePreview';
import { WarningBadge } from '@/components/WarningBadge';
import { useResumeStore } from '@/store/resume-store';
import type { FeedbackVerification } from '@/lib/ai/tailor';
import { cn } from '@/lib/utils';

interface DiffViewerProps {
  original: string;
  tailored: string;
  changes: string[];
  flaggedKeywords?: string[];
  verifiedChanges?: FeedbackVerification[];
  previousDraft?: string;
  feedbackHistory?: string[];
  docLabel?: string;
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
      // Unchanged text — collapse if long
      const text = part.value;
      if (text.length <= contextChars * 2) {
        hunks.push({ type: 'context', parts: [part] });
      } else {
        // Show leading context
        const leading = text.slice(0, contextChars);
        hunks.push({ type: 'context', parts: [{ value: leading, count: 1, added: false, removed: false }] });

        // Collapsed middle
        const collapsedLen = text.length - contextChars * 2;
        hunks.push({
          type: 'collapsed',
          parts: [],
          collapsedLength: collapsedLen,
        });

        // Show trailing context
        const trailing = text.slice(-contextChars);
        hunks.push({ type: 'context', parts: [{ value: trailing, count: 1, added: false, removed: false }] });
      }
    }
  }

  return hunks;
}

export function DiffViewer({
  original,
  tailored,
  changes,
  flaggedKeywords,
  verifiedChanges,
  previousDraft,
  docLabel,
}: DiffViewerProps) {
  const selectedTemplate = useResumeStore((state) => state.selectedTemplate);
  const label = docLabel || 'Resume';
  const leftScrollRef = useRef<HTMLDivElement>(null);
  const rightScrollRef = useRef<HTMLDivElement>(null);
  const isSyncing = useRef(false);
  const [diffOpen, setDiffOpen] = useState(false);

  const handleScroll = useCallback((source: 'left' | 'right') => {
    if (isSyncing.current) return;
    isSyncing.current = true;

    const sourceEl = source === 'left' ? leftScrollRef.current : rightScrollRef.current;
    const targetEl = source === 'left' ? rightScrollRef.current : leftScrollRef.current;

    if (sourceEl && targetEl) {
      const maxScroll = sourceEl.scrollHeight - sourceEl.clientHeight;
      const scrollRatio = maxScroll > 0 ? sourceEl.scrollTop / maxScroll : 0;
      const targetMaxScroll = targetEl.scrollHeight - targetEl.clientHeight;
      targetEl.scrollTop = scrollRatio * targetMaxScroll;
    }

    requestAnimationFrame(() => {
      isSyncing.current = false;
    });
  }, []);

  const diffResult = useMemo(() => {
    return diffWords(original, tailored);
  }, [original, tailored]);

  // Compute refinement diff (previous draft → current tailored)
  const refinementDiff = useMemo(() => {
    if (!previousDraft) return null;
    return diffWords(previousDraft, tailored);
  }, [previousDraft, tailored]);

  const refinementHunks = useMemo(() => {
    if (!refinementDiff) return null;
    return getHunks(refinementDiff);
  }, [refinementDiff]);

  return (
    <div className="space-y-4">
      {flaggedKeywords && flaggedKeywords.length > 0 && (
        <WarningBadge flaggedKeywords={flaggedKeywords} />
      )}

      <Tabs defaultValue="side-by-side">
        <TabsList>
          <TabsTrigger value="side-by-side">Side by Side</TabsTrigger>
          <TabsTrigger value="diff">Diff View</TabsTrigger>
          <TabsTrigger value="tailored">Tailored Only</TabsTrigger>
        </TabsList>

        <TabsContent value="side-by-side">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{`Original ${label}`}</CardTitle>
              </CardHeader>
              <CardContent>
                <div
                  ref={leftScrollRef}
                  onScroll={() => handleScroll('left')}
                  className="max-h-[800px] overflow-auto rounded-md bg-muted p-4"
                >
                  <ResumePreview text={original} />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{`Tailored ${label}`}</CardTitle>
              </CardHeader>
              <CardContent>
                <div
                  ref={rightScrollRef}
                  onScroll={() => handleScroll('right')}
                  className="max-h-[800px] overflow-auto rounded-md bg-muted p-4"
                >
                  <ResumePreview text={tailored} template={selectedTemplate} />
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="diff">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Changes</CardTitle>
              <p className="text-sm text-muted-foreground">
                <span className="rounded bg-red-100 px-1 text-red-800 dark:bg-red-900 dark:text-red-200">
                  Removed
                </span>{' '}
                <span className="rounded bg-green-100 px-1 text-green-800 dark:bg-green-900 dark:text-green-200">
                  Added
                </span>
              </p>
            </CardHeader>
            <CardContent>
              <div className="max-h-[500px] overflow-auto rounded-md bg-muted p-4">
                <pre className="whitespace-pre-wrap text-sm">
                  {diffResult.map((part, index) => {
                    if (part.added) {
                      return (
                        <span
                          key={index}
                          className="diff-added"
                        >
                          {part.value}
                        </span>
                      );
                    }
                    if (part.removed) {
                      return (
                        <span
                          key={index}
                          className="diff-removed"
                        >
                          {part.value}
                        </span>
                      );
                    }
                    return <span key={index}>{part.value}</span>;
                  })}
                </pre>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="tailored">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{`Tailored ${label}`}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="max-h-[500px] overflow-auto rounded-md bg-muted p-4">
                <pre className="whitespace-pre-wrap text-sm">{tailored}</pre>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Audit Rail */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Applied Changes</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Refinement Diff — only after a refinement */}
          {refinementHunks && (
            <Collapsible open={diffOpen} onOpenChange={setDiffOpen}>
              <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium hover:bg-muted transition-colors">
                <span className={cn("text-xs transition-transform", diffOpen && "rotate-90")}>
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
          {(verifiedChanges && verifiedChanges.length > 0) || refinementHunks ? (
            <div className="border-t my-3" />
          ) : null}
          <div>
            <p className="text-sm font-medium mb-2">AI Summary</p>
            <ul className="list-inside list-disc space-y-1 text-sm">
              {changes.map((change, index) => {
                if (change.startsWith('ATS Keyword Match:')) {
                  return (
                    <li key={index}>
                      <strong>{change}</strong>
                      <br />
                      <span className="text-xs text-muted-foreground">
                        Definition: This score measures semantic density. A 90%+ score confirms all
                        primary technical requirements and 80% of secondary skills from the JD are
                        integrated using exact-match terminology to pass automated parsers.
                      </span>
                    </li>
                  );
                }
                return <li key={index}>{change}</li>;
              })}
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
