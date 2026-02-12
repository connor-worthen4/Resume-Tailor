'use client';

import { useState } from 'react';
import { useResumeStore } from '@/store/resume-store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { toast } from 'sonner';

interface JobUrlInputProps {
  onJobLoaded?: () => void;
}

interface SanitizeResult {
  jobPosting: {
    url: string;
    title: string;
    company: string;
    description: string;
    requirements: string[];
  };
  stats: {
    originalWordCount: number;
    cleanedWordCount: number;
    wordsRemoved: number;
    noisePercentage: number;
    strippedItems: string[];
    boilerplateWordCount: number;
    sectionsFound: { relevant: string[]; noise: string[] };
  };
  extractedSkills: { hardSkills: string[]; softSkills: string[] };
  metadata: {
    yearsExperience: { min: number; area?: string }[];
    degreeRequirement?: { level: string; field?: string };
    certifications: string[];
  };
  autoExtracted: { title?: string; company?: string };
}

export function JobUrlInput({ onJobLoaded }: JobUrlInputProps) {
  const [url, setUrl] = useState('');
  const [activeTab, setActiveTab] = useState('url');
  const [manualTitle, setManualTitle] = useState('');
  const [manualCompany, setManualCompany] = useState('');
  const [manualDescription, setManualDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { setJobPosting, setIsProcessing, isProcessing } = useResumeStore();

  // Sanitize workflow state
  const [sanitizeEnabled, setSanitizeEnabled] = useState(false);
  const [isSanitizing, setIsSanitizing] = useState(false);
  const [sanitizeResult, setSanitizeResult] = useState<SanitizeResult | null>(null);
  const [isApplied, setIsApplied] = useState(false);
  // Editable overrides in review phase
  const [editTitle, setEditTitle] = useState('');
  const [editCompany, setEditCompany] = useState('');

  const handleScrape = async () => {
    if (!url) {
      setError('Please enter a URL');
      return;
    }

    setError(null);
    setIsProcessing(true);

    try {
      const response = await fetch('/api/scrape-job', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to scrape job posting');
      }

      setJobPosting({
        url: data.url,
        title: data.title,
        company: data.company,
        description: data.description,
        requirements: data.requirements,
      });

      onJobLoaded?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to scrape job posting';
      setError(message);
      // Auto-switch to manual tab so user can continue
      setActiveTab('manual');
      toast.info('Could not automatically extract job details. Please paste the description below.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleManualSubmit = () => {
    if (!manualTitle || !manualCompany || !manualDescription) {
      setError('Please fill in all fields');
      return;
    }

    setError(null);

    // Extract requirements from description (lines that look like bullet points)
    const requirements = manualDescription
      .split('\n')
      .filter((line) => line.match(/^[\s]*[-•*]\s/))
      .map((line) => line.replace(/^[\s]*[-•*]\s/, '').trim())
      .filter((line) => line.length > 0);

    setJobPosting({
      url: '',
      title: manualTitle,
      company: manualCompany,
      description: manualDescription,
      requirements,
    });

    onJobLoaded?.();
  };

  const handleSanitize = async () => {
    if (!manualDescription.trim()) {
      setError('Please paste a job description');
      return;
    }

    setError(null);
    setIsSanitizing(true);
    setIsProcessing(true);
    setSanitizeResult(null);
    setIsApplied(false);

    try {
      const response = await fetch('/api/sanitize-paste', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawText: manualDescription,
          manualTitle: manualTitle.trim() || undefined,
          manualCompany: manualCompany.trim() || undefined,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to sanitize text');
      }

      setSanitizeResult(data);
      setEditTitle(data.jobPosting.title);
      setEditCompany(data.jobPosting.company);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to sanitize text';
      setError(message);
      toast.error(message);
    } finally {
      setIsSanitizing(false);
      setIsProcessing(false);
    }
  };

  const handleApplySanitized = () => {
    if (!sanitizeResult) return;

    setJobPosting({
      url: '',
      title: editTitle || sanitizeResult.jobPosting.title,
      company: editCompany || sanitizeResult.jobPosting.company,
      description: sanitizeResult.jobPosting.description,
      requirements: sanitizeResult.jobPosting.requirements,
      originalInput: manualDescription,
    });

    setIsApplied(true);
    toast.success('Sanitized job description applied');
    onJobLoaded?.();
  };

  const handleResetSanitize = () => {
    setSanitizeResult(null);
    setIsApplied(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Job Posting</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4">
            <TabsTrigger value="url">Paste URL</TabsTrigger>
            <TabsTrigger value="manual">Enter Manually</TabsTrigger>
          </TabsList>

          <TabsContent value="url">
            <div className="space-y-4">
              <div>
                <Label htmlFor="job-url">Job Posting URL</Label>
                <div className="mt-1 flex gap-2">
                  <Input
                    id="job-url"
                    type="url"
                    placeholder="https://www.linkedin.com/jobs/..."
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    disabled={isProcessing}
                  />
                  <Button onClick={handleScrape} disabled={isProcessing || !url}>
                    {isProcessing ? 'Loading...' : 'Fetch'}
                  </Button>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Supports LinkedIn, Greenhouse, Lever, Workday, and most job boards
                </p>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="manual">
            <div className="space-y-4">
              {/* Sanitize toggle */}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  role="switch"
                  aria-checked={sanitizeEnabled}
                  onClick={() => {
                    setSanitizeEnabled(!sanitizeEnabled);
                    setSanitizeResult(null);
                    setIsApplied(false);
                  }}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
                    sanitizeEnabled ? 'bg-primary' : 'bg-input'
                  }`}
                >
                  <span
                    className={`pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform ${
                      sanitizeEnabled ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
                <Label className="cursor-pointer" onClick={() => {
                  setSanitizeEnabled(!sanitizeEnabled);
                  setSanitizeResult(null);
                  setIsApplied(false);
                }}>
                  Sanitize Paste
                </Label>
                <span className="text-xs text-muted-foreground">
                  Strip LinkedIn artifacts &amp; extract skills
                </span>
              </div>

              {!sanitizeEnabled ? (
                <>
                  {/* Original manual flow */}
                  <div>
                    <Label htmlFor="job-title">Job Title</Label>
                    <Input
                      id="job-title"
                      placeholder="Senior Software Engineer"
                      value={manualTitle}
                      onChange={(e) => setManualTitle(e.target.value)}
                    />
                  </div>

                  <div>
                    <Label htmlFor="company">Company</Label>
                    <Input
                      id="company"
                      placeholder="Acme Inc."
                      value={manualCompany}
                      onChange={(e) => setManualCompany(e.target.value)}
                    />
                  </div>

                  <div>
                    <Label htmlFor="description">Job Description</Label>
                    <Textarea
                      id="description"
                      placeholder="Paste the full job description here..."
                      value={manualDescription}
                      onChange={(e) => setManualDescription(e.target.value)}
                      rows={10}
                    />
                  </div>

                  <Button
                    onClick={handleManualSubmit}
                    disabled={!manualTitle || !manualCompany || !manualDescription}
                  >
                    Continue
                  </Button>
                </>
              ) : sanitizeResult ? (
                /* Phase B: Review sanitized results */
                <div className="space-y-4">
                  {/* Stats banner */}
                  <div className="rounded-md border bg-muted/50 p-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium">
                        Removed {sanitizeResult.stats.wordsRemoved} words ({sanitizeResult.stats.noisePercentage}% noise)
                      </p>
                      {isApplied && (
                        <span className="text-sm font-medium text-green-600">
                          Applied
                        </span>
                      )}
                    </div>

                    <Collapsible>
                      <CollapsibleTrigger className="mt-1 text-xs text-muted-foreground underline-offset-2 hover:underline">
                        Show details
                      </CollapsibleTrigger>
                      <CollapsibleContent className="mt-2 space-y-2">
                        {sanitizeResult.stats.strippedItems.length > 0 && (
                          <div>
                            <p className="text-xs font-medium text-muted-foreground">Stripped artifacts ({sanitizeResult.stats.strippedItems.length}):</p>
                            <p className="text-xs text-muted-foreground">
                              {sanitizeResult.stats.strippedItems.join(', ')}
                            </p>
                          </div>
                        )}
                        {sanitizeResult.stats.boilerplateWordCount > 0 && (
                          <p className="text-xs text-muted-foreground">
                            HR boilerplate: {sanitizeResult.stats.boilerplateWordCount} words removed
                          </p>
                        )}
                        {sanitizeResult.stats.sectionsFound.noise.length > 0 && (
                          <div>
                            <p className="text-xs font-medium text-muted-foreground">Noise sections:</p>
                            <p className="text-xs text-muted-foreground">
                              {sanitizeResult.stats.sectionsFound.noise.join(', ')}
                            </p>
                          </div>
                        )}
                        {sanitizeResult.stats.sectionsFound.relevant.length > 0 && (
                          <div>
                            <p className="text-xs font-medium text-muted-foreground">Relevant sections:</p>
                            <p className="text-xs text-muted-foreground">
                              {sanitizeResult.stats.sectionsFound.relevant.join(', ')}
                            </p>
                          </div>
                        )}
                      </CollapsibleContent>
                    </Collapsible>
                  </div>

                  {/* Editable title/company */}
                  <div>
                    <Label htmlFor="edit-title">Job Title</Label>
                    <Input
                      id="edit-title"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      placeholder="Job title"
                    />
                    {sanitizeResult.autoExtracted.title && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Auto-detected: {sanitizeResult.autoExtracted.title}
                      </p>
                    )}
                  </div>

                  <div>
                    <Label htmlFor="edit-company">Company</Label>
                    <Input
                      id="edit-company"
                      value={editCompany}
                      onChange={(e) => setEditCompany(e.target.value)}
                      placeholder="Company name"
                    />
                    {sanitizeResult.autoExtracted.company && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Auto-detected: {sanitizeResult.autoExtracted.company}
                      </p>
                    )}
                  </div>

                  {/* Extracted skills preview */}
                  {(sanitizeResult.extractedSkills.hardSkills.length > 0 ||
                    sanitizeResult.extractedSkills.softSkills.length > 0) && (
                    <div className="rounded-md border p-3">
                      <p className="mb-1 text-sm font-medium">Extracted Skills</p>
                      {sanitizeResult.extractedSkills.hardSkills.length > 0 && (
                        <p className="text-xs text-muted-foreground">
                          <span className="font-medium">Hard skills:</span>{' '}
                          {sanitizeResult.extractedSkills.hardSkills.join(', ')}
                        </p>
                      )}
                      {sanitizeResult.extractedSkills.softSkills.length > 0 && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          <span className="font-medium">Soft skills:</span>{' '}
                          {sanitizeResult.extractedSkills.softSkills.join(', ')}
                        </p>
                      )}
                      {sanitizeResult.metadata.yearsExperience.length > 0 && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          <span className="font-medium">Experience:</span>{' '}
                          {sanitizeResult.metadata.yearsExperience
                            .map((y) => `${y.min}+ years${y.area ? ` (${y.area})` : ''}`)
                            .join(', ')}
                        </p>
                      )}
                      {sanitizeResult.metadata.degreeRequirement && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          <span className="font-medium">Degree:</span>{' '}
                          {sanitizeResult.metadata.degreeRequirement.level}
                          {sanitizeResult.metadata.degreeRequirement.field
                            ? ` in ${sanitizeResult.metadata.degreeRequirement.field}`
                            : ''}
                        </p>
                      )}
                      {sanitizeResult.metadata.certifications.length > 0 && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          <span className="font-medium">Certifications:</span>{' '}
                          {sanitizeResult.metadata.certifications.join(', ')}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="flex items-center gap-2">
                    <Button onClick={handleApplySanitized} disabled={isApplied}>
                      {isApplied ? 'Applied' : 'Apply'}
                    </Button>
                    <button
                      type="button"
                      onClick={handleResetSanitize}
                      className="text-sm text-muted-foreground underline-offset-2 hover:underline"
                    >
                      Re-sanitize
                    </button>
                  </div>
                </div>
              ) : (
                /* Phase A: Paste input */
                <>
                  <div>
                    <Label htmlFor="sanitize-title">Job Title (optional)</Label>
                    <Input
                      id="sanitize-title"
                      placeholder="Leave blank to auto-detect"
                      value={manualTitle}
                      onChange={(e) => setManualTitle(e.target.value)}
                    />
                  </div>

                  <div>
                    <Label htmlFor="sanitize-company">Company (optional)</Label>
                    <Input
                      id="sanitize-company"
                      placeholder="Leave blank to auto-detect"
                      value={manualCompany}
                      onChange={(e) => setManualCompany(e.target.value)}
                    />
                  </div>

                  <div>
                    <Label htmlFor="sanitize-description">Paste Full Job Description</Label>
                    <Textarea
                      id="sanitize-description"
                      placeholder="Paste the entire LinkedIn job description here (including all the noise)..."
                      value={manualDescription}
                      onChange={(e) => setManualDescription(e.target.value)}
                      rows={12}
                    />
                  </div>

                  <Button
                    onClick={handleSanitize}
                    disabled={isSanitizing || !manualDescription.trim()}
                  >
                    {isSanitizing ? 'Sanitizing...' : 'Sanitize Paste'}
                  </Button>
                </>
              )}
            </div>
          </TabsContent>
        </Tabs>

        {error && <p className="mt-4 text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
