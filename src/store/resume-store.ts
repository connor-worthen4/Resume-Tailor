import { create } from 'zustand';
import type { FeedbackVerification } from '@/lib/ai/tailor';
import type { ATSScoreResult, CoverLetterScoreResult } from '@/lib/ai/ats-scorer';
import type { ProcessedJD } from '@/lib/ai/jd-preprocessor';

export type StrategyMode = 'keyword' | 'achievement' | 'hybrid';
export type DocumentType = 'resume' | 'cv' | 'cover_letter';

export interface ParsedResume {
  text: string;
  fileName: string;
  fileType: 'pdf' | 'docx';
}

export interface JobPosting {
  url: string;
  title: string;
  company: string;
  description: string;
  requirements: string[];
  originalInput?: string;
}

export interface TailoredResume {
  text: string;
  changes: string[];
  flaggedKeywords?: string[];
  verifiedChanges?: FeedbackVerification[];
}

export interface TailoredCoverLetter {
  text: string;
  painPoints: string[];
  changes: string[];
  flaggedKeywords?: string[];
  verifiedChanges?: FeedbackVerification[];
}

interface ResumeState {
  // Original resume
  originalResume: ParsedResume | null;
  setOriginalResume: (resume: ParsedResume | null) => void;

  // Drive base files (auto-detected from Google Drive)
  driveBaseFiles: { resume?: ParsedResume; cv?: ParsedResume; coverLetterTemplate?: ParsedResume } | null;
  setDriveBaseFiles: (files: { resume?: ParsedResume; cv?: ParsedResume; coverLetterTemplate?: ParsedResume } | null) => void;

  // Job posting
  jobPosting: JobPosting | null;
  setJobPosting: (job: JobPosting | null) => void;

  // Tailored resume
  tailoredResume: TailoredResume | null;
  setTailoredResume: (resume: TailoredResume | null) => void;

  // Tailored CV (separate from resume)
  tailoredCV: TailoredResume | null;
  setTailoredCV: (cv: TailoredResume | null) => void;

  // Tailored cover letter
  tailoredCoverLetter: TailoredCoverLetter | null;
  setTailoredCoverLetter: (coverLetter: TailoredCoverLetter | null) => void;

  // ATS Scores
  resumeATSScore: ATSScoreResult | null;
  setResumeATSScore: (score: ATSScoreResult | null) => void;
  cvATSScore: ATSScoreResult | null;
  setCvATSScore: (score: ATSScoreResult | null) => void;
  coverLetterScore: CoverLetterScoreResult | null;
  setCoverLetterScore: (score: CoverLetterScoreResult | null) => void;
  originalResumeATSScore: ATSScoreResult | null;
  setOriginalResumeATSScore: (score: ATSScoreResult | null) => void;

  // Preprocessed JD (shared across generation, refinement, and cover letter)
  processedJD: ProcessedJD | null;
  setProcessedJD: (jd: ProcessedJD | null) => void;

  // Format checklist (user-managed checkboxes)
  formatChecklist: Record<string, boolean>;
  setFormatChecklistItem: (key: string, value: boolean) => void;

  // Feedback history (per-tab)
  feedbackHistoryPerTab: Record<'resume' | 'cv' | 'cover_letter', string[]>;
  addFeedback: (tab: DocumentType, feedback: string) => void;
  clearFeedback: () => void;

  // Previous draft per tab (for refinement diff)
  previousDraftPerTab: Record<'resume' | 'cv' | 'cover_letter', string>;
  setPreviousDraft: (tab: DocumentType, draft: string) => void;

  // User prompt (custom instructions)
  userPrompt: string;
  setUserPrompt: (prompt: string) => void;

  // Strategy & document type
  strategyMode: StrategyMode;
  setStrategyMode: (mode: StrategyMode) => void;
  documentType: DocumentType;
  setDocumentType: (type: DocumentType) => void;

  // Cover letter opt-in
  generateCoverLetter: boolean;
  setGenerateCoverLetter: (value: boolean) => void;

  // Active document tab for review step
  activeDocumentTab: 'resume' | 'cv' | 'cover_letter';
  setActiveDocumentTab: (tab: 'resume' | 'cv' | 'cover_letter') => void;

  // Quick Tailor readiness
  quickTailorReady: boolean;
  setQuickTailorReady: (value: boolean) => void;

  // UI state
  isProcessing: boolean;
  setIsProcessing: (value: boolean) => void;
  isRefining: boolean;
  setIsRefining: (value: boolean) => void;
  currentStep: 'upload' | 'job' | 'review' | 'export';
  setCurrentStep: (step: 'upload' | 'job' | 'review' | 'export') => void;

  // Selected template for export
  selectedTemplate: 'modern' | 'classic' | 'minimal';
  setSelectedTemplate: (template: 'modern' | 'classic' | 'minimal') => void;

  // Reset state
  reset: () => void;
}

const initialState = {
  originalResume: null,
  driveBaseFiles: null,
  jobPosting: null,
  tailoredResume: null,
  tailoredCV: null,
  tailoredCoverLetter: null,
  resumeATSScore: null,
  cvATSScore: null,
  coverLetterScore: null,
  originalResumeATSScore: null,
  processedJD: null,
  formatChecklist: {} as Record<string, boolean>,
  feedbackHistoryPerTab: { resume: [], cv: [], cover_letter: [] },
  previousDraftPerTab: { resume: '', cv: '', cover_letter: '' },
  userPrompt: '',
  strategyMode: 'hybrid' as StrategyMode,
  documentType: 'resume' as DocumentType,
  generateCoverLetter: false,
  activeDocumentTab: 'resume' as const,
  quickTailorReady: false,
  isProcessing: false,
  isRefining: false,
  currentStep: 'upload' as const,
  selectedTemplate: 'modern' as const,
};

export const useResumeStore = create<ResumeState>((set) => ({
  ...initialState,

  setOriginalResume: (resume) => set({ originalResume: resume }),
  setDriveBaseFiles: (files) => set({ driveBaseFiles: files }),
  setJobPosting: (job) => set({ jobPosting: job }),
  setTailoredResume: (resume) => set({ tailoredResume: resume }),
  setTailoredCV: (cv) => set({ tailoredCV: cv }),
  setTailoredCoverLetter: (coverLetter) => set({ tailoredCoverLetter: coverLetter }),

  setResumeATSScore: (score) => set({ resumeATSScore: score }),
  setCvATSScore: (score) => set({ cvATSScore: score }),
  setCoverLetterScore: (score) => set({ coverLetterScore: score }),
  setOriginalResumeATSScore: (score) => set({ originalResumeATSScore: score }),
  setProcessedJD: (jd) => set({ processedJD: jd }),

  setFormatChecklistItem: (key, value) =>
    set((state) => ({
      formatChecklist: { ...state.formatChecklist, [key]: value },
    })),

  addFeedback: (tab, feedback) =>
    set((state) => ({
      feedbackHistoryPerTab: {
        ...state.feedbackHistoryPerTab,
        [tab]: [...state.feedbackHistoryPerTab[tab], feedback],
      },
    })),
  clearFeedback: () => set({ feedbackHistoryPerTab: { resume: [], cv: [], cover_letter: [] } }),
  setPreviousDraft: (tab, draft) =>
    set((state) => ({
      previousDraftPerTab: {
        ...state.previousDraftPerTab,
        [tab]: draft,
      },
    })),
  setUserPrompt: (prompt) => set({ userPrompt: prompt }),

  setStrategyMode: (mode) => set({ strategyMode: mode }),
  setDocumentType: (type) => set({ documentType: type }),

  setGenerateCoverLetter: (value) => set({ generateCoverLetter: value }),
  setActiveDocumentTab: (tab) => set({ activeDocumentTab: tab }),
  setQuickTailorReady: (value) => set({ quickTailorReady: value }),

  setIsProcessing: (value) => set({ isProcessing: value }),
  setIsRefining: (value) => set({ isRefining: value }),
  setCurrentStep: (step) => set({ currentStep: step }),
  setSelectedTemplate: (template) => set({ selectedTemplate: template }),

  reset: () => set(initialState),
}));
