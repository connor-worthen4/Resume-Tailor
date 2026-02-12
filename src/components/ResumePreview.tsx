'use client';

import { useMemo } from 'react';
import { parseResumeIntoSections } from '@/lib/document/parse-sections';
import type { TemplateStyle } from '@/lib/document/generator';

interface ResumePreviewProps {
  text: string;
  template?: TemplateStyle;
}

// ATS-compliant: strictly no colors, icons, or multi-column layouts.
// All text is rendered in black (#000000) regardless of template.
function getTemplateStyles(template: TemplateStyle) {
  const atsColor = '#000000';
  switch (template) {
    case 'modern':
      return {
        fontFamily: "'Calibri', 'Segoe UI', sans-serif",
        accentColor: atsColor,
        headerAlignment: 'text-left' as const,
        nameFontSize: 'text-2xl',
        sectionBorder: true,
      };
    case 'classic':
      return {
        fontFamily: "'Times New Roman', 'Georgia', serif",
        accentColor: atsColor,
        headerAlignment: 'text-center' as const,
        nameFontSize: 'text-xl',
        sectionBorder: true,
      };
    case 'minimal':
      return {
        fontFamily: "'Arial', 'Helvetica', sans-serif",
        accentColor: atsColor,
        headerAlignment: 'text-left' as const,
        nameFontSize: 'text-xl',
        sectionBorder: false,
      };
    default:
      return getTemplateStyles('modern');
  }
}

export function ResumePreview({ text, template }: ResumePreviewProps) {
  const sections = useMemo(() => parseResumeIntoSections(text), [text]);
  const styles = useMemo(() => getTemplateStyles(template ?? 'modern'), [template]);

  return (
    <div
      className="mx-auto bg-white shadow-lg"
      style={{
        fontFamily: styles.fontFamily,
        padding: '2.5rem 3rem',
        maxWidth: '8.5in',
        minHeight: '11in',
      }}
    >
      {sections.map((section, sectionIndex) => {
        if (section.title === 'Header') {
          return (
            <div key={sectionIndex} className={`mb-4 ${styles.headerAlignment}`}>
              {section.content.map((line, lineIndex) => {
                if (lineIndex === 0) {
                  return (
                    <h1
                      key={lineIndex}
                      className={`${styles.nameFontSize} font-bold`}
                      style={{ color: styles.accentColor }}
                    >
                      {line}
                    </h1>
                  );
                }
                return (
                  <p key={lineIndex} className="text-sm text-black">
                    {line}
                  </p>
                );
              })}
              <hr
                className="mt-3"
                style={{ borderColor: styles.accentColor, borderWidth: '1px' }}
              />
            </div>
          );
        }

        return (
          <div key={sectionIndex} className="mb-3">
            <h2
              className="mb-1 text-sm font-bold uppercase tracking-wide"
              style={{
                color: styles.accentColor,
                borderBottom: styles.sectionBorder
                  ? `1px solid ${styles.accentColor}`
                  : undefined,
                paddingBottom: styles.sectionBorder ? '2px' : undefined,
              }}
            >
              {section.title}
            </h2>
            <div className="mt-1 space-y-0.5">
              {section.content.map((line, lineIndex) => {
                const isBullet = line.trim().startsWith('-') || line.trim().startsWith('•');
                const cleanLine = line.replace(/^[-•]\s*/, '');

                if (isBullet) {
                  return (
                    <div key={lineIndex} className="flex gap-2 pl-4 text-sm text-black">
                      <span className="shrink-0" style={{ color: styles.accentColor }}>
                        &bull;
                      </span>
                      <span>{cleanLine}</span>
                    </div>
                  );
                }

                return (
                  <p key={lineIndex} className="text-sm text-black">
                    {line}
                  </p>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
