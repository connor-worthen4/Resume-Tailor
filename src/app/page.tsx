'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSession, signIn, signOut } from 'next-auth/react';
import { toast } from 'sonner';
import { useResumeStore } from '@/store/resume-store';
import type { FeedbackVerification } from '@/lib/ai/tailor';
import { FileUploader } from '@/components/FileUploader';
import { JobUrlInput } from '@/components/JobUrlInput';
import { DiffViewer } from '@/components/DiffViewer';
import { CoverLetterViewer } from '@/components/CoverLetterViewer';
import { FeedbackInput } from '@/components/FeedbackInput';
import { ActionButtons } from '@/components/ActionButtons';
import { StrategySelector } from '@/components/StrategySelector';
import { ATSScoreDashboard } from '@/components/ATSScoreDashboard';
import { CoverLetterScoreDashboard } from '@/components/CoverLetterScoreDashboard';
import { FormatChecklist } from '@/components/FormatChecklist';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// ---------------------------------------------------------------------------
// Streaming helpers
// ---------------------------------------------------------------------------
interface StreamDocParams {
  baseText: string;
  docType: 'resume' | 'cv' | 'cover_letter';
  jobTitle: string;
  company: string;
  jobDescription: string;
  requirements: string[];
  feedbackHistory: string[];
  userPrompt: string;
  strategyMode: string;
  coverLetterTemplate?: string;
  onStream: (fullText: string) => void;
  onComplete: (data: Record<string, unknown>) => void;
}

interface StreamRefineParams {
  currentDraft: string;
  feedback: string;
  feedbackHistory: string[];
  resumeText: string;
  docType: 'resume' | 'cv' | 'cover_letter';
  jobTitle: string;
  company: string;
  jobDescription: string;
  requirements: string[];
  coverLetterTemplate?: string;
  processedJD?: import('@/lib/ai/jd-preprocessor').ProcessedJD | null;
  onStream: (fullText: string) => void;
  onComplete: (data: Record<string, unknown>) => void;
}

async function streamRefinement(params: StreamRefineParams) {
  const response = await fetch('/api/refine-document', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      currentDraft: params.currentDraft,
      feedback: params.feedback,
      feedbackHistory: params.feedbackHistory,
      resumeText: params.resumeText,
      jobTitle: params.jobTitle,
      company: params.company,
      jobDescription: params.jobDescription,
      requirements: params.requirements,
      documentType: params.docType,
      coverLetterTemplate: params.coverLetterTemplate,
      processedJD: params.processedJD || undefined,
    }),
  });

  if (!response.ok) throw new Error(`Failed to refine ${params.docType}`);

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let fullText = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split('\n\n');

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const data = JSON.parse(line.slice(6));
          if (data.type === 'chunk') {
            fullText += data.content;
            params.onStream(fullText);
          } else if (data.type === 'complete') {
            params.onComplete(data);
          } else if (data.type === 'error') {
            throw new Error(data.message);
          }
        } catch {
          // Ignore parse errors for incomplete chunks
        }
      }
    }
  }
}

async function streamDocument(params: StreamDocParams) {
  const response = await fetch('/api/tailor-resume', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      resumeText: params.baseText,
      jobTitle: params.jobTitle,
      company: params.company,
      jobDescription: params.jobDescription,
      requirements: params.requirements,
      feedback: params.feedbackHistory,
      userPrompt: params.userPrompt || undefined,
      strategyMode: params.strategyMode,
      documentType: params.docType,
      coverLetterTemplate: params.coverLetterTemplate,
    }),
  });

  if (!response.ok) throw new Error(`Failed to tailor ${params.docType}`);

  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body');

  const decoder = new TextDecoder();
  let fullText = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split('\n\n');

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const data = JSON.parse(line.slice(6));
          if (data.type === 'chunk') {
            fullText += data.content;
            params.onStream(fullText);
          } else if (data.type === 'complete') {
            params.onComplete(data);
          } else if (data.type === 'error') {
            throw new Error(data.message);
          }
        } catch {
          // Ignore parse errors for incomplete chunks
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Main Page Component
// ---------------------------------------------------------------------------
export default function Home() {
  const { data: session, status } = useSession();
  const [streamingText, setStreamingText] = useState('');
  const [streamingCVText, setStreamingCVText] = useState('');
  const [streamingCoverLetterText, setStreamingCoverLetterText] = useState('');

  const {
    originalResume,
    driveBaseFiles,
    jobPosting,
    tailoredResume,
    tailoredCV,
    tailoredCoverLetter,
    resumeATSScore,
    cvATSScore,
    coverLetterScore,
    originalResumeATSScore,
    feedbackHistoryPerTab,
    previousDraftPerTab,
    userPrompt,
    strategyMode,
    generateCoverLetter,
    activeDocumentTab,
    quickTailorReady,
    isProcessing,
    isRefining,
    currentStep,
    selectedTemplate,
    setOriginalResume,
    setDriveBaseFiles,
    setCurrentStep,
    setTailoredResume,
    setTailoredCV,
    setTailoredCoverLetter,
    setResumeATSScore,
    setCvATSScore,
    setCoverLetterScore,
    setOriginalResumeATSScore,
    setProcessedJD,
    processedJD,
    setPreviousDraft,
    setIsProcessing,
    setIsRefining,
    setGenerateCoverLetter,
    setActiveDocumentTab,
    setQuickTailorReady,
    setUserPrompt,
    setSelectedTemplate,
    reset,
  } = useResumeStore();

  const driveSearchDone = useRef(false);

  // Auto-load base files from Google Drive for authenticated users
  useEffect(() => {
    if (status !== 'authenticated' || driveSearchDone.current || originalResume) return;
    driveSearchDone.current = true;

    (async () => {
      try {
        const res = await fetch('/api/google/search-drive');
        if (!res.ok) return;
        const data = await res.json();

        if (data.resume || data.cv || data.coverLetterTemplate) {
          setDriveBaseFiles({
            resume: data.resume || undefined,
            cv: data.cv || undefined,
            coverLetterTemplate: data.coverLetterTemplate || undefined,
          });

          // Check if all 3 base files are present for Quick Tailor
          if (data.resume && data.cv && data.coverLetterTemplate) {
            setQuickTailorReady(true);
          }

          // Auto-populate with resume if available, otherwise cv
          const base = data.resume || data.cv;
          if (base) {
            setOriginalResume({
              text: base.text,
              fileName: base.fileName,
              fileType: base.fileType,
            });
            setCurrentStep('job');

            const fileNames = [
              data.resume?.fileName,
              data.cv?.fileName,
              data.coverLetterTemplate?.fileName,
            ].filter(Boolean);

            toast.success(`Found ${fileNames.length} base file(s) on Google Drive`, {
              description: `Loaded: ${fileNames.join(', ')}`,
            });
          }
        }
      } catch {
        // Silently fail — user can always upload manually
      }
    })();
  }, [status, originalResume, setDriveBaseFiles, setOriginalResume, setCurrentStep, setQuickTailorReady]);

  // Shared params builder for streaming
  const buildStreamParams = useCallback(
    (
      docType: 'resume' | 'cv' | 'cover_letter',
      onStream: (text: string) => void,
      onComplete: (data: Record<string, unknown>) => void,
    ): StreamDocParams | null => {
      if (!originalResume || !jobPosting) return null;

      const baseText =
        docType === 'cv' && driveBaseFiles?.cv
          ? driveBaseFiles.cv.text
          : originalResume.text;

      return {
        baseText,
        docType,
        jobTitle: jobPosting.title,
        company: jobPosting.company,
        jobDescription: jobPosting.description,
        requirements: jobPosting.requirements,
        feedbackHistory: feedbackHistoryPerTab[docType],
        userPrompt,
        strategyMode,
        coverLetterTemplate: driveBaseFiles?.coverLetterTemplate?.text,
        onStream,
        onComplete,
      };
    },
    [originalResume, jobPosting, driveBaseFiles, feedbackHistoryPerTab, userPrompt, strategyMode],
  );

  // Handle tailoring all selected documents
  const handleTailor = useCallback(async () => {
    if (!originalResume || !jobPosting) return;

    setIsProcessing(true);
    setStreamingText('');
    setStreamingCVText('');
    setStreamingCoverLetterText('');
    setTailoredCV(null);
    setTailoredCoverLetter(null);

    try {
      const promises: Promise<void>[] = [];

      // Always generate Resume
      const resumeParams = buildStreamParams(
        'resume',
        setStreamingText,
        (data) => {
          setTailoredResume({
            text: data.tailoredResume as string,
            changes: data.changes as string[],
            flaggedKeywords: (data.flaggedKeywords as string[]) || [],
            validationWarnings: (data.validationWarnings as string[]) || [],
          });
          if (data.atsScore) setResumeATSScore(data.atsScore as import('@/lib/ai/ats-scorer').ATSScoreResult);
          if (data.originalATSScore) setOriginalResumeATSScore(data.originalATSScore as import('@/lib/ai/ats-scorer').ATSScoreResult);
          if (data.processedJD) setProcessedJD(data.processedJD as import('@/lib/ai/jd-preprocessor').ProcessedJD);
        },
      );
      if (resumeParams) promises.push(streamDocument(resumeParams));

      // Optionally generate Cover Letter
      if (generateCoverLetter) {
        const clParams = buildStreamParams(
          'cover_letter',
          setStreamingCoverLetterText,
          (data) => {
            setTailoredCoverLetter({
              text: data.coverLetter as string,
              painPoints: (data.painPoints as string[]) || [],
              changes: (data.changes as string[]) || [],
              flaggedKeywords: (data.flaggedKeywords as string[]) || [],
              validationWarnings: (data.validationWarnings as string[]) || [],
            });
            if (data.coverLetterScore) setCoverLetterScore(data.coverLetterScore as import('@/lib/ai/ats-scorer').CoverLetterScoreResult);
          },
        );
        if (clParams) promises.push(streamDocument(clParams));
      }

      await Promise.all(promises);
      setCurrentStep('review');
    } catch (error) {
      console.error('Error tailoring documents:', error);
      toast.error('Failed to tailor documents. Please try again.');
    } finally {
      setIsProcessing(false);
      setStreamingText('');
      setStreamingCVText('');
      setStreamingCoverLetterText('');
    }
  }, [
    originalResume,
    jobPosting,
    generateCoverLetter,
    buildStreamParams,
    setIsProcessing,
    setTailoredResume,
    setTailoredCV,
    setTailoredCoverLetter,
    setResumeATSScore,
    setOriginalResumeATSScore,
    setCoverLetterScore,
    setCurrentStep,
  ]);

  // Tab-specific refresh — uses iterative refinement when a draft exists
  const handleTabRefresh = useCallback(async () => {
    if (!originalResume || !jobPosting) return;

    // Hide export success screen
    if (currentStep === 'export') {
      setCurrentStep('review');
    }

    setIsProcessing(true);

    const tab = activeDocumentTab;

    // Read the latest state directly from the store to avoid stale closures.
    // FeedbackInput calls addFeedback() then onRefresh() synchronously — the
    // Zustand store is already updated, but React hasn't re-rendered yet, so
    // the destructured values from useResumeStore() are one tick behind.
    const freshState = useResumeStore.getState();

    // Determine if we have an existing draft to refine
    const existingDraft =
      tab === 'resume' ? freshState.tailoredResume?.text :
      tab === 'cv' ? freshState.tailoredCV?.text :
      freshState.tailoredCoverLetter?.text;

    // Get the latest feedback item for this tab
    const tabFeedback = freshState.feedbackHistoryPerTab[tab];
    const latestFeedback = tabFeedback[tabFeedback.length - 1] || '';

    // Determine base resume text for this tab
    const baseText =
      tab === 'cv' && driveBaseFiles?.cv
        ? driveBaseFiles.cv.text
        : originalResume.text;

    try {
      if (existingDraft && latestFeedback) {
        // --- Iterative refinement path ---
        setIsRefining(true);
        setPreviousDraft(tab, existingDraft);

        const setStreaming =
          tab === 'resume' ? setStreamingText :
          tab === 'cv' ? setStreamingCVText :
          setStreamingCoverLetterText;

        setStreaming('');

        const onComplete =
          tab === 'cover_letter'
            ? (data: Record<string, unknown>) => {
                setTailoredCoverLetter({
                  text: data.coverLetter as string,
                  painPoints: (data.painPoints as string[]) || [],
                  changes: (data.changes as string[]) || [],
                  flaggedKeywords: (data.flaggedKeywords as string[]) || [],
                  verifiedChanges: (data.verifiedChanges as FeedbackVerification[]) || [],
                  validationWarnings: (data.validationWarnings as string[]) || [],
                });
                if (data.coverLetterScore) setCoverLetterScore(data.coverLetterScore as import('@/lib/ai/ats-scorer').CoverLetterScoreResult);
              }
            : tab === 'cv'
            ? (data: Record<string, unknown>) => {
                setTailoredCV({
                  text: data.tailoredResume as string,
                  changes: data.changes as string[],
                  flaggedKeywords: (data.flaggedKeywords as string[]) || [],
                  verifiedChanges: (data.verifiedChanges as FeedbackVerification[]) || [],
                  validationWarnings: (data.validationWarnings as string[]) || [],
                });
                if (data.atsScore) setCvATSScore(data.atsScore as import('@/lib/ai/ats-scorer').ATSScoreResult);
              }
            : (data: Record<string, unknown>) => {
                setTailoredResume({
                  text: data.tailoredResume as string,
                  changes: data.changes as string[],
                  flaggedKeywords: (data.flaggedKeywords as string[]) || [],
                  verifiedChanges: (data.verifiedChanges as FeedbackVerification[]) || [],
                  validationWarnings: (data.validationWarnings as string[]) || [],
                });
                if (data.atsScore) setResumeATSScore(data.atsScore as import('@/lib/ai/ats-scorer').ATSScoreResult);
              };

        await streamRefinement({
          currentDraft: existingDraft,
          feedback: latestFeedback,
          feedbackHistory: tabFeedback.slice(0, -1),
          resumeText: baseText,
          docType: tab,
          jobTitle: jobPosting.title,
          company: jobPosting.company,
          jobDescription: jobPosting.description,
          requirements: jobPosting.requirements,
          coverLetterTemplate: driveBaseFiles?.coverLetterTemplate?.text,
          processedJD,
          onStream: setStreaming,
          onComplete,
        });
      } else {
        // --- Fallback: full regeneration (no existing draft or no feedback) ---
        if (tab === 'resume') {
          setStreamingText('');
          const params = buildStreamParams(
            'resume',
            setStreamingText,
            (data) => {
              setTailoredResume({
                text: data.tailoredResume as string,
                changes: data.changes as string[],
                flaggedKeywords: (data.flaggedKeywords as string[]) || [],
                validationWarnings: (data.validationWarnings as string[]) || [],
              });
            },
          );
          if (params) await streamDocument(params);
        } else if (tab === 'cv') {
          setStreamingCVText('');
          const params = buildStreamParams(
            'cv',
            setStreamingCVText,
            (data) => {
              setTailoredCV({
                text: data.tailoredResume as string,
                changes: data.changes as string[],
                flaggedKeywords: (data.flaggedKeywords as string[]) || [],
                validationWarnings: (data.validationWarnings as string[]) || [],
              });
            },
          );
          if (params) await streamDocument(params);
        } else if (tab === 'cover_letter') {
          setStreamingCoverLetterText('');
          const params = buildStreamParams(
            'cover_letter',
            setStreamingCoverLetterText,
            (data) => {
              setTailoredCoverLetter({
                text: data.coverLetter as string,
                painPoints: (data.painPoints as string[]) || [],
                changes: (data.changes as string[]) || [],
                flaggedKeywords: (data.flaggedKeywords as string[]) || [],
                validationWarnings: (data.validationWarnings as string[]) || [],
              });
            },
          );
          if (params) await streamDocument(params);
        }
      }
    } catch (error) {
      console.error('Error refreshing document:', error);
      toast.error('Failed to refresh document. Please try again.');
    } finally {
      setIsProcessing(false);
      setIsRefining(false);
      setStreamingText('');
      setStreamingCVText('');
      setStreamingCoverLetterText('');
    }
  }, [
    originalResume,
    jobPosting,
    activeDocumentTab,
    currentStep,
    driveBaseFiles,
    buildStreamParams,
    setIsProcessing,
    setIsRefining,
    setPreviousDraft,
    setTailoredResume,
    setTailoredCV,
    setTailoredCoverLetter,
    setResumeATSScore,
    setCvATSScore,
    setCoverLetterScore,
    setCurrentStep,
  ]);

  // Handle document download — based on active tab
  const handleDownload = useCallback(
    async (format: 'pdf' | 'docx') => {
      let textToDownload: string | undefined;
      let docType: string;

      if (activeDocumentTab === 'cover_letter' && tailoredCoverLetter) {
        textToDownload = tailoredCoverLetter.text;
        docType = 'cover_letter';
      } else if (activeDocumentTab === 'cv' && tailoredCV) {
        textToDownload = tailoredCV.text;
        docType = 'cv';
      } else {
        textToDownload = tailoredResume?.text;
        docType = 'resume';
      }

      if (!textToDownload) return;

      try {
        const typeSuffix = docType === 'cover_letter' ? '-cover-letter' : docType === 'cv' ? '-cv' : '-resume';
        const baseName = jobPosting
          ? `${jobPosting.company}${typeSuffix}`
          : `tailored${typeSuffix}`;

        const response = await fetch('/api/generate-document', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: textToDownload,
            format,
            template: selectedTemplate,
            fileName: baseName,
            documentType: docType,
          }),
        });

        if (!response.ok) throw new Error('Failed to generate document');

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${baseName}.${format}`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);

        const label = docType === 'cover_letter' ? 'Cover Letter' : docType === 'cv' ? 'CV' : 'Resume';
        toast.success(`${label} downloaded as ${format.toUpperCase()}`);
      } catch (error) {
        console.error('Error downloading document:', error);
        toast.error('Failed to download document');
      }
    },
    [tailoredResume, tailoredCV, tailoredCoverLetter, selectedTemplate, jobPosting, activeDocumentTab]
  );

  // Handle accept and save to Google Drive — uploads all generated docs
  const handleAccept = useCallback(async () => {
    if (!tailoredResume || !jobPosting || !session?.accessToken) return;

    setIsProcessing(true);

    try {
      // Upload Resume to Drive
      const resumeUpload = await fetch('/api/google/upload-drive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resumeText: tailoredResume.text,
          company: jobPosting.company,
          jobTitle: jobPosting.title,
          template: selectedTemplate,
          format: 'docx',
          documentType: 'resume',
        }),
      });
      if (!resumeUpload.ok) throw new Error('Failed to upload resume to Drive');
      const { webViewLink: resumeLink } = await resumeUpload.json();

      // Upload CV to Drive if available
      let cvLink: string | undefined;
      if (tailoredCV) {
        const cvUpload = await fetch('/api/google/upload-drive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            resumeText: tailoredCV.text,
            company: jobPosting.company,
            jobTitle: jobPosting.title,
            template: selectedTemplate,
            format: 'docx',
            documentType: 'cv',
          }),
        });
        if (cvUpload.ok) {
          const cvResult = await cvUpload.json();
          cvLink = cvResult.webViewLink;
        }
      }

      // Upload Cover Letter to Drive if available
      let coverLetterLink: string | undefined;
      if (tailoredCoverLetter) {
        const clUpload = await fetch('/api/google/upload-drive', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            resumeText: tailoredCoverLetter.text,
            company: jobPosting.company,
            jobTitle: jobPosting.title,
            template: selectedTemplate,
            format: 'docx',
            documentType: 'cover_letter',
          }),
        });
        if (clUpload.ok) {
          const clResult = await clUpload.json();
          coverLetterLink = clResult.webViewLink;
        }
      }

      // Add entry to Sheets — single entry with all links
      const sheetResponse = await fetch('/api/google/add-sheet-entry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company: jobPosting.company,
          jobTitle: jobPosting.title,
          url: jobPosting.url,
          resumeLink,
          cvLink,
          coverLetterLink,
          documentType: 'resume',
        }),
      });

      if (!sheetResponse.ok) throw new Error('Failed to add sheet entry');

      const { spreadsheetUrl } = await sheetResponse.json();

      const savedDocs = ['Resume', tailoredCV ? 'CV' : '', tailoredCoverLetter ? 'Cover Letter' : '']
        .filter(Boolean)
        .join(' + ');
      toast.success(`${savedDocs} saved to Google Drive!`, {
        description: 'Your application has been logged in the tracking sheet.',
        action: {
          label: 'Open Sheet',
          onClick: () => window.open(spreadsheetUrl, '_blank'),
        },
      });

      setCurrentStep('export');
    } catch (error) {
      console.error('Error saving to Google:', error);
      toast.error('Failed to save to Google Drive');
    } finally {
      setIsProcessing(false);
    }
  }, [tailoredResume, tailoredCV, tailoredCoverLetter, jobPosting, session, selectedTemplate, setIsProcessing, setCurrentStep]);

  // Handle back navigation — clear downstream state so the user can re-edit
  const handleBack = useCallback(() => {
    switch (currentStep) {
      case 'job':
        setCurrentStep('upload');
        break;
      case 'review':
        // Clear tailored results so the job-posting editing controls reappear
        setTailoredResume(null);
        setTailoredCV(null);
        setTailoredCoverLetter(null);
        setCurrentStep('job');
        break;
      case 'export':
        setCurrentStep('review');
        break;
    }
  }, [currentStep, setCurrentStep, setTailoredResume, setTailoredCV, setTailoredCoverLetter]);

  // Progress calculation
  const getProgress = () => {
    switch (currentStep) {
      case 'upload':
        return originalResume ? 25 : 0;
      case 'job':
        return jobPosting ? 50 : 25;
      case 'review':
        return tailoredResume ? 75 : 50;
      case 'export':
        return 100;
      default:
        return 0;
    }
  };

  // Determine which tabs to show in review
  const hasMultipleDocs = !!tailoredCV || !!tailoredCoverLetter;

  return (
    <main className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b">
        <div className="container mx-auto flex items-center justify-between px-4 py-4">
          <div>
            <h1 className="text-2xl font-bold">Resume/CV Tailor</h1>
            <p className="text-sm text-muted-foreground">AI-powered resume/CV customization</p>
          </div>
          <div className="flex items-center gap-4">
            {status === 'loading' ? (
              <Skeleton className="h-10 w-24" />
            ) : session ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">{session.user?.email}</span>
                <Button variant="outline" size="sm" onClick={() => signOut()}>
                  Sign Out
                </Button>
              </div>
            ) : (
              <Button onClick={() => signIn('google')}>Sign in with Google</Button>
            )}
            {(originalResume || jobPosting || tailoredResume) && (
              <Button variant="ghost" size="sm" onClick={reset}>
                Start Over
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Progress */}
      <div className="border-b bg-muted/30">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center gap-4">
            <span className="text-sm font-medium">Progress</span>
            <Progress value={getProgress()} className="flex-1" />
            <span className="text-sm text-muted-foreground">{getProgress()}%</span>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-8">
        <div className={`mx-auto space-y-8 ${tailoredResume && !isProcessing ? 'max-w-7xl' : 'max-w-4xl'}`}>
          {/* Step 1: Upload Resume */}
          <section>
            <h2 className="mb-4 text-lg font-semibold">1. Upload Your Resume/CV</h2>
            {originalResume ? (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Resume/CV Uploaded</CardTitle>
                  <CardDescription>{originalResume.fileName}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="max-h-40 overflow-auto rounded-md bg-muted p-3">
                    <pre className="whitespace-pre-wrap text-xs">
                      {originalResume.text.substring(0, 500)}
                      {originalResume.text.length > 500 ? '...' : ''}
                    </pre>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <FileUploader onUploadComplete={() => setCurrentStep('job')} />
            )}
          </section>

          {/* Step 2: Job Posting */}
          {originalResume && (
            <section>
              <div className="mb-4 flex items-center gap-3">
                <h2 className="text-lg font-semibold">2. Add Job Posting</h2>
                {driveBaseFiles && !tailoredResume && !isProcessing && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setOriginalResume(null);
                      setCurrentStep('upload');
                      driveSearchDone.current = true; // prevent re-fetch
                    }}
                  >
                    Change Base Files
                  </Button>
                )}
              </div>
              {jobPosting ? (
                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-base">{jobPosting.title}</CardTitle>
                        <CardDescription>{jobPosting.company}</CardDescription>
                      </div>
                      {!tailoredResume && !isProcessing && (
                        <Button variant="ghost" size="sm" onClick={handleBack}>
                          Back
                        </Button>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="max-h-40 overflow-auto rounded-md bg-muted p-3">
                      <pre className="whitespace-pre-wrap text-xs">
                        {jobPosting.description.substring(0, 500)}
                        {jobPosting.description.length > 500 ? '...' : ''}
                      </pre>
                    </div>
                    {!tailoredResume && !isProcessing && (
                      <>
                        {/* Cover Letter Opt-in */}
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            id="generate-cover-letter"
                            checked={generateCoverLetter}
                            onChange={(e) => setGenerateCoverLetter(e.target.checked)}
                            className="h-4 w-4 rounded border-gray-300"
                          />
                          <Label htmlFor="generate-cover-letter" className="cursor-pointer text-sm font-normal">
                            Also generate Cover Letter
                          </Label>
                        </div>

                        {/* Tailoring Strategy + Template Options side by side */}
                        <div>
                          <div className="mb-2 flex items-center gap-4">
                            <Label>Tailoring Strategy</Label>
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-muted-foreground">Template:</span>
                              <Select
                                value={selectedTemplate}
                                onValueChange={(value: 'modern' | 'classic' | 'minimal') =>
                                  setSelectedTemplate(value)
                                }
                              >
                                <SelectTrigger className="w-[140px]">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="modern">Modern</SelectItem>
                                  <SelectItem value="classic">Classic</SelectItem>
                                  <SelectItem value="minimal">Minimal</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                          <StrategySelector />
                        </div>

                        {/* Custom Instructions */}
                        <div>
                          <Label htmlFor="special-instructions" className="mb-2">
                            Special Instructions for this Version
                          </Label>
                          <Textarea
                            id="special-instructions"
                            value={userPrompt}
                            onChange={(e) => setUserPrompt(e.target.value)}
                            placeholder={'e.g., "Emphasize leadership experience", "I\'m transitioning from engineering to PM"'}
                            rows={3}
                          />
                        </div>

                        <Button className="w-full" onClick={handleTailor}>
                          Tailor Documents
                        </Button>
                      </>
                    )}
                  </CardContent>
                </Card>
              ) : (
                <JobUrlInput onJobLoaded={() => setCurrentStep('job')} />
              )}
            </section>
          )}

          {/* Streaming Preview */}
          {isProcessing && (streamingText || streamingCVText || streamingCoverLetterText) && (
            <section>
              <h2 className="mb-4 text-lg font-semibold">
                {isRefining ? 'Refining Document...' : 'Tailoring in Progress...'}
              </h2>

              {/* Side-by-side visual locking during refinement */}
              {isRefining && previousDraftPerTab[activeDocumentTab] ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <Card className="opacity-60">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Current Draft</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="max-h-96 overflow-auto rounded-md bg-muted p-4">
                        <pre className="whitespace-pre-wrap text-sm">{previousDraftPerTab[activeDocumentTab]}</pre>
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="border-primary/50">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm">Updating...</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="max-h-96 overflow-auto rounded-md bg-muted p-4">
                        <pre className="whitespace-pre-wrap text-sm">
                          {streamingText || streamingCVText || streamingCoverLetterText}
                        </pre>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              ) : (
                <div className="space-y-4">
                  {streamingText && (
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">Resume</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="max-h-60 overflow-auto rounded-md bg-muted p-4">
                          <pre className="whitespace-pre-wrap text-sm">{streamingText}</pre>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                  {streamingCVText && (
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">CV</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="max-h-60 overflow-auto rounded-md bg-muted p-4">
                          <pre className="whitespace-pre-wrap text-sm">{streamingCVText}</pre>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                  {streamingCoverLetterText && (
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">Cover Letter</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="max-h-60 overflow-auto rounded-md bg-muted p-4">
                          <pre className="whitespace-pre-wrap text-sm">{streamingCoverLetterText}</pre>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>
              )}
            </section>
          )}

          {/* Step 3: Review */}
          {tailoredResume && !isProcessing && (
            <section>
              <div className="mb-4 flex items-center gap-3">
                <Button variant="ghost" size="sm" onClick={handleBack}>
                  Back to Job Posting
                </Button>
                <h2 className="text-lg font-semibold">3. Review Changes</h2>
              </div>

              {/* Tabbed interface for Resume / CV / Cover Letter */}
              {hasMultipleDocs ? (
                <Tabs
                  value={activeDocumentTab}
                  onValueChange={(v) => setActiveDocumentTab(v as 'resume' | 'cv' | 'cover_letter')}
                >
                  <TabsList>
                    <TabsTrigger value="resume">Resume</TabsTrigger>
                    {tailoredCV && <TabsTrigger value="cv">CV</TabsTrigger>}
                    {tailoredCoverLetter && (
                      <TabsTrigger value="cover_letter">Cover Letter</TabsTrigger>
                    )}
                  </TabsList>

                  <TabsContent value="resume">
                    <DiffViewer
                      original={originalResume?.text || ''}
                      tailored={tailoredResume.text}
                      changes={tailoredResume.changes}
                      flaggedKeywords={tailoredResume.flaggedKeywords}
                      verifiedChanges={tailoredResume.verifiedChanges}
                      validationWarnings={tailoredResume.validationWarnings}
                      previousDraft={previousDraftPerTab.resume}
                      feedbackHistory={feedbackHistoryPerTab.resume}
                      docLabel="Resume"
                    />
                  </TabsContent>

                  {tailoredCV && (
                    <TabsContent value="cv">
                      <DiffViewer
                        original={driveBaseFiles?.cv?.text || originalResume?.text || ''}
                        tailored={tailoredCV.text}
                        changes={tailoredCV.changes}
                        flaggedKeywords={tailoredCV.flaggedKeywords}
                        verifiedChanges={tailoredCV.verifiedChanges}
                        validationWarnings={tailoredCV.validationWarnings}
                        previousDraft={previousDraftPerTab.cv}
                        feedbackHistory={feedbackHistoryPerTab.cv}
                        docLabel="CV"
                      />
                    </TabsContent>
                  )}

                  {tailoredCoverLetter && (
                    <TabsContent value="cover_letter">
                      <CoverLetterViewer
                        coverLetter={tailoredCoverLetter.text}
                        painPoints={tailoredCoverLetter.painPoints}
                        changes={tailoredCoverLetter.changes}
                        flaggedKeywords={tailoredCoverLetter.flaggedKeywords}
                        verifiedChanges={tailoredCoverLetter.verifiedChanges}
                        validationWarnings={tailoredCoverLetter.validationWarnings}
                        previousDraft={previousDraftPerTab.cover_letter}
                        feedbackHistory={feedbackHistoryPerTab.cover_letter}
                      />
                    </TabsContent>
                  )}
                </Tabs>
              ) : (
                <DiffViewer
                  original={originalResume?.text || ''}
                  tailored={tailoredResume.text}
                  changes={tailoredResume.changes}
                  flaggedKeywords={tailoredResume.flaggedKeywords}
                  verifiedChanges={tailoredResume.verifiedChanges}
                  validationWarnings={tailoredResume.validationWarnings}
                  previousDraft={previousDraftPerTab.resume}
                  feedbackHistory={feedbackHistoryPerTab.resume}
                  docLabel="Resume"
                />
              )}

              {/* ATS Score Dashboards */}
              <div className="mt-6 grid gap-6 md:grid-cols-2">
                {activeDocumentTab === 'resume' && resumeATSScore && (
                  <ATSScoreDashboard
                    score={resumeATSScore}
                    originalScore={originalResumeATSScore}
                    label="Resume"
                  />
                )}
                {activeDocumentTab === 'cv' && cvATSScore && (
                  <ATSScoreDashboard
                    score={cvATSScore}
                    label="CV"
                  />
                )}
                {activeDocumentTab === 'cover_letter' && coverLetterScore && (
                  <CoverLetterScoreDashboard score={coverLetterScore} />
                )}
                {(activeDocumentTab === 'resume' || activeDocumentTab === 'cv') && (
                  <FormatChecklist
                    atsScore={activeDocumentTab === 'resume' ? resumeATSScore : cvATSScore}
                  />
                )}
              </div>

              <div className="mt-6 grid gap-6 md:grid-cols-2">
                <FeedbackInput onRefresh={handleTabRefresh} />
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Export Options</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ActionButtons
                      onAccept={handleAccept}
                      onDownload={handleDownload}
                      isAuthenticated={!!session}
                      onSignIn={() => signIn('google')}
                    />
                  </CardContent>
                </Card>
              </div>
            </section>
          )}

          {/* Completion Message */}
          {currentStep === 'export' && (
            <section>
              <Card>
                <CardContent className="pt-6 text-center">
                  <div className="mb-4 text-4xl font-bold">Done</div>
                  <h3 className="mb-2 text-lg font-semibold">Application Saved!</h3>
                  <p className="text-muted-foreground">
                    Your tailored documents have been uploaded to Google Drive and logged in your
                    tracking spreadsheet.
                  </p>
                  <Button className="mt-4" onClick={reset}>
                    Tailor Another Set of Documents
                  </Button>
                </CardContent>
              </Card>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
