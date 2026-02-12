# Resume Tailor

AI-powered resume and cover letter optimization tool that helps you beat Applicant Tracking Systems. Upload your resume, paste a job posting, and get a tailored version scored against real ATS criteria — keyword matching, structural compliance, and job title alignment. Each tailored resume receives an ATS compatibility score with a tier-by-tier breakdown, so you know exactly where you stand before you hit apply.

## Features

- **ATS Scoring Engine** — Deterministic 6-tier scoring system (hard skills, job title alignment, experience relevance, soft skills, structure, supplementary factors) with before/after comparison
- **AI Resume Tailoring** — Claude AI rewrites your resume to match the job description while preserving your actual experience
- **Cover Letter Generation** — Generates targeted cover letters scored on keyword reinforcement, pain point coverage, and authentic voice
- **Job Description Preprocessing** — Strips LinkedIn artifacts, HR boilerplate, and noise to extract what actually matters from a posting
- **Validation Guards** — Detects fabricated metrics, scope inflation, and new phrases not in your original resume
- **Resume Upload** — Drag-and-drop PDF/DOCX with automatic text extraction
- **Job Scraping** — Paste any job URL to auto-extract title, company, and requirements
- **Diff Viewer** — Side-by-side comparison showing exactly what changed
- **Iterative Refinement** — Add feedback and regenerate with score delta tracking
- **Multiple Templates** — Modern, Classic, and Minimal resume styles
- **Document Export** — Download as PDF or DOCX
- **Google Drive Integration** — Save tailored resumes directly to Drive with organized folder structure
- **Application Tracking** — Auto-logs applications to a Google Sheets spreadsheet
- **Rate Limiting & Security Headers** — Per-IP rate limiting on API routes with CSP, HSTS, and clickjacking protection

## Tech Stack

- **Framework**: Next.js (App Router, TypeScript)
- **UI**: shadcn/ui + Tailwind CSS
- **State**: Zustand
- **Auth**: NextAuth with Google OAuth
- **AI**: Anthropic SDK (Claude)
- **Documents**: pdf-parse, mammoth (parsing) / docx (generation)
- **Google**: googleapis (Drive + Sheets)

## Getting Started

1. Copy the example environment file:
```bash
cp .env.example .env.local
```

2. Fill in your credentials in `.env.local`:
```bash
ANTHROPIC_API_KEY=your_anthropic_api_key
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
NEXTAUTH_SECRET=your_random_secret  # Generate with: openssl rand -base64 32
NEXTAUTH_URL=http://localhost:3000
```

3. Install and run:
```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## License

MIT
