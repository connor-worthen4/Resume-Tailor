'use client';

import { useResumeStore } from '@/store/resume-store';
import type { ATSScoreResult } from '@/lib/ai/ats-scorer';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';

// Section B: Export Checklist — manual items that cannot be verified from text
const EXPORT_ITEMS = [
  { key: 'docx', label: 'Save as .docx (95% ATS parse rate) or text-based .pdf' },
  { key: 'single-col', label: 'Single-column layout only' },
  { key: 'no-tables', label: 'No tables, text boxes, or floating elements' },
  { key: 'no-images', label: 'No text embedded in images, icons, or graphics' },
  { key: 'standard-fonts', label: 'Standard fonts only (Arial, Calibri, Times New Roman)' },
  { key: 'file-size', label: 'File size under 200KB (PDF) or 300KB (DOCX)' },
  { key: 'file-name', label: 'File name: FirstName_LastName_Resume.pdf' },
  { key: 'metadata', label: 'Set document metadata: Title = "[Name] - [Job Title] Resume"' },
];

interface FormatChecklistProps {
  atsScore?: ATSScoreResult | null;
}

export function FormatChecklist({ atsScore }: FormatChecklistProps) {
  const { formatChecklist, setFormatChecklistItem } = useResumeStore();

  const exportCheckedCount = EXPORT_ITEMS.filter(item => formatChecklist[item.key]).length;
  const exportPercentage = Math.round((exportCheckedCount / EXPORT_ITEMS.length) * 100);

  // Section A: Content Compliance — auto-scored from the ATS scoring engine
  const contentChecks = atsScore?.tierScores.structuralCompliance.contentChecks || [];
  const contentPassedCount = contentChecks.filter(c => c.passed).length;
  const contentPercentage = contentChecks.length > 0
    ? Math.round((contentPassedCount / contentChecks.length) * 100)
    : 0;

  return (
    <div className="space-y-4">
      {/* Section A: Content Compliance (auto-scored) */}
      {contentChecks.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Content Compliance</CardTitle>
              <span className="text-sm text-muted-foreground">{contentPercentage}%</span>
            </div>
            <Progress value={contentPercentage} className="h-2" />
            <p className="text-[10px] text-muted-foreground">Auto-scored from your resume content. Part of ATS score.</p>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {contentChecks.map((check, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <span className={`mt-0.5 flex-shrink-0 ${check.passed ? 'text-green-600' : 'text-red-500'}`}>
                    {check.passed ? '\u2713' : '\u2717'}
                  </span>
                  <div>
                    <span className={check.passed ? 'text-muted-foreground' : ''}>
                      {check.label}
                    </span>
                    {check.detail && (
                      <span className="ml-1 text-muted-foreground/60 text-[10px]">
                        ({check.detail})
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Section B: Export Checklist (manual) */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Export Checklist</CardTitle>
            <span className="text-sm text-muted-foreground">{exportPercentage}%</span>
          </div>
          <Progress value={exportPercentage} className="h-2" />
          <p className="text-[10px] text-muted-foreground">Confirm before submitting. Does not affect ATS score.</p>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {EXPORT_ITEMS.map((item) => (
              <label
                key={item.key}
                className="flex cursor-pointer items-start gap-2 text-xs"
              >
                <input
                  type="checkbox"
                  checked={formatChecklist[item.key] || false}
                  onChange={(e) => setFormatChecklistItem(item.key, e.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 rounded border-gray-300"
                />
                <span className={formatChecklist[item.key] ? 'text-muted-foreground line-through' : ''}>
                  {item.label}
                </span>
              </label>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
