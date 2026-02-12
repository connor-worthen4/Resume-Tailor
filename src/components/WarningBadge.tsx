'use client';

import { useState } from 'react';

interface WarningBadgeProps {
  flaggedKeywords: string[];
}

export function WarningBadge({ flaggedKeywords }: WarningBadgeProps) {
  const [expanded, setExpanded] = useState(false);

  if (!flaggedKeywords || flaggedKeywords.length === 0) return null;

  return (
    <div>
      <button
        type="button"
        className={`warning-badge ${expanded ? 'expanded' : ''}`}
        onClick={() => setExpanded(!expanded)}
      >
        <span className="badge-chevron">&#9654;</span>
        {flaggedKeywords.length} new skill{flaggedKeywords.length !== 1 ? 's' : ''} detected
        &mdash; click to review
      </button>
      <div className={`keyword-list ${expanded ? 'visible' : ''}`}>
        {flaggedKeywords.map((keyword, i) => (
          <div key={i}>{keyword}</div>
        ))}
      </div>
    </div>
  );
}
