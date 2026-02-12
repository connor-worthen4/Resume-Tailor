'use client';

import { useResumeStore, StrategyMode } from '@/store/resume-store';
import { Card, CardContent } from '@/components/ui/card';

const strategies: {
  mode: StrategyMode;
  title: string;
  description: string;
  recommended?: boolean;
}[] = [
  {
    mode: 'keyword',
    title: 'Strict Keyword Mirroring',
    description:
      'Maximizes ATS keyword match rate by injecting exact terminology from the job description into your resume.',
  },
  {
    mode: 'achievement',
    title: 'Achievement Quantifier',
    description:
      'Transforms bullet points into quantified accomplishments using the XYZ formula for maximum impact.',
  },
  {
    mode: 'hybrid',
    title: 'The Hybrid',
    description:
      'Combines keyword optimization with achievement rewriting for the best balance of ATS score and recruiter appeal.',
    recommended: true,
  },
];

export function StrategySelector() {
  const strategyMode = useResumeStore((s) => s.strategyMode);
  const setStrategyMode = useResumeStore((s) => s.setStrategyMode);

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {strategies.map((s) => {
        const isSelected = strategyMode === s.mode;
        return (
          <Card
            key={s.mode}
            className={`cursor-pointer transition-all ${
              isSelected
                ? 'border-primary ring-2 ring-primary/20'
                : 'hover:border-muted-foreground/50'
            }`}
            onClick={() => setStrategyMode(s.mode)}
          >
            <CardContent className="p-4">
              <div className="mb-1 flex items-center gap-2">
                <span className="text-sm font-semibold">{s.title}</span>
                {s.recommended && (
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                    Recommended
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{s.description}</p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
