'use client';

import { useState } from 'react';
import { useResumeStore } from '@/store/resume-store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

interface FeedbackInputProps {
  onRefresh: () => void;
}

const TAB_LABELS: Record<string, string> = {
  resume: 'Resume',
  cv: 'CV',
  cover_letter: 'Cover Letter',
};

export function FeedbackInput({ onRefresh }: FeedbackInputProps) {
  const [feedback, setFeedback] = useState('');
  const {
    addFeedback,
    feedbackHistoryPerTab,
    isProcessing,
    activeDocumentTab,
    tailoredResume,
    tailoredCV,
    tailoredCoverLetter,
  } = useResumeStore();
  const feedbackHistory = feedbackHistoryPerTab[activeDocumentTab];

  const tabLabel = TAB_LABELS[activeDocumentTab] || 'document';

  // Get verifiedChanges for the active tab
  const verifiedChanges =
    activeDocumentTab === 'cover_letter'
      ? tailoredCoverLetter?.verifiedChanges
      : activeDocumentTab === 'cv'
      ? tailoredCV?.verifiedChanges
      : tailoredResume?.verifiedChanges;

  const handleSubmit = () => {
    if (!feedback.trim()) return;
    addFeedback(activeDocumentTab, feedback.trim());
    setFeedback('');
    onRefresh();
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Refinement Feedback</CardTitle>
        <p className="text-xs text-muted-foreground">
          Editing: <strong>{tabLabel}</strong> only
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {feedbackHistory.length > 0 && (
          <div className="rounded-md bg-muted p-3">
            <p className="mb-2 text-sm font-medium">Previous feedback:</p>
            <ul className="list-inside list-decimal space-y-1 text-sm text-muted-foreground">
              {feedbackHistory.map((fb, index) => {
                const verification = verifiedChanges?.find((vc) => vc.feedback === fb);
                return (
                  <li key={index} className="flex items-center gap-2">
                    <span className="flex-1">{fb}</span>
                    {verification && (
                      <span
                        className={cn(
                          'shrink-0 text-xs px-1.5 py-0.5 rounded-full font-medium',
                          verification.applied
                            ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400'
                            : 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400'
                        )}
                      >
                        {verification.applied ? 'Applied' : 'Not Detected'}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div>
          <Textarea
            placeholder={`Add feedback to refine the ${tabLabel}... (e.g., 'Emphasize more leadership experience' or 'Best regards, CW')`}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            rows={3}
            disabled={isProcessing}
          />
        </div>

        <Button
          onClick={handleSubmit}
          disabled={!feedback.trim() || isProcessing}
          className="w-full"
        >
          {isProcessing ? 'Processing...' : `Refresh ${tabLabel} with Feedback`}
        </Button>
      </CardContent>
    </Card>
  );
}
