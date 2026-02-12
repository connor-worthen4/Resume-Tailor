'use client';

import { useState } from 'react';
import { useResumeStore } from '@/store/resume-store';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface ActionButtonsProps {
  onAccept: () => void;
  onDownload: (format: 'pdf' | 'docx') => void;
  isAuthenticated: boolean;
  onSignIn: () => void;
}

export function ActionButtons({
  onAccept,
  onDownload,
  isAuthenticated,
  onSignIn,
}: ActionButtonsProps) {
  const [showAcceptDialog, setShowAcceptDialog] = useState(false);
  const { isProcessing, jobPosting, tailoredCoverLetter, tailoredCV, activeDocumentTab } = useResumeStore();

  const handleAcceptClick = () => {
    if (!isAuthenticated) {
      onSignIn();
      return;
    }
    setShowAcceptDialog(true);
  };

  const handleConfirmAccept = () => {
    setShowAcceptDialog(false);
    onAccept();
  };

  const docTypes: string[] = ['Resume'];
  if (tailoredCV) docTypes.push('CV');
  if (tailoredCoverLetter) docTypes.push('Cover Letter');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={() => onDownload('pdf')} disabled={isProcessing}>
          Download PDF
        </Button>

        <Button variant="outline" onClick={() => onDownload('docx')} disabled={isProcessing}>
          Download DOCX
        </Button>

        <Button onClick={handleAcceptClick} disabled={isProcessing}>
          {isAuthenticated ? 'Accept & Save to Drive' : 'Sign in to Save'}
        </Button>
      </div>

      <Dialog open={showAcceptDialog} onOpenChange={setShowAcceptDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save to Google Drive</DialogTitle>
            <DialogDescription>
              This will save your tailored {docTypes.join(', ')} to Google Drive and log the
              application in your tracking spreadsheet.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 text-sm">
            <p>
              <strong>Company:</strong> {jobPosting?.company || 'Unknown'}
            </p>
            <p>
              <strong>Position:</strong> {jobPosting?.title || 'Unknown'}
            </p>
            <p>
              <strong>Documents:</strong> {docTypes.join(', ')}
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAcceptDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleConfirmAccept}>Confirm & Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
