/**
 * ATS Scoring Diagnostic — standalone script to trace keyword matching bugs
 *
 * Run with: npx tsx src/lib/ai/ats-scoring-diagnostic.ts
 *
 * This traces the exact code paths used during ATS scoring to identify
 * why skills like "Distributed Systems", "MySQL", "Kotlin", "RESTful APIs",
 * and "REST" are being falsely reported as skills gaps.
 */

import { SYNONYM_MAP, termExistsWithSynonyms } from './tailor';
import { preprocessJobDescription } from './jd-preprocessor';
import { computeATSScore } from './ats-scorer';

// ---------------------------------------------------------------------------
// Test 1: wordBoundaryMatch character boundary analysis
// ---------------------------------------------------------------------------

console.log('\n' + '='.repeat(80));
console.log('TEST 1: wordBoundaryMatch boundary character analysis');
console.log('='.repeat(80));

// The boundary regex used:
// (?:^|[\s,;.!?()[\]{}/"'\-])TERM(?:$|[\s,;.!?()[\]{}/"'\-])
// Boundary chars: whitespace, comma, semicolon, period, !, ?, (, ), [, ], {, }, /, ", ', -

const boundaryChars = new Set([' ', '\t', '\n', '\r', ',', ';', '.', '!', '?', '(', ')', '[', ']', '{', '}', '/', '"', "'", '-']);
const missingChars = [':', '*', '|', '#', '_', '+', '~', '`', '@', '\\', '<', '>', '&', '='];

console.log('\nCharacters NOT in boundary set that commonly appear in resumes:');
for (const ch of missingChars) {
  console.log(`  "${ch}" (code ${ch.charCodeAt(0)}) — NOT in boundary set`);
}

// ---------------------------------------------------------------------------
// Test 2: Specific match scenarios
// ---------------------------------------------------------------------------

console.log('\n' + '='.repeat(80));
console.log('TEST 2: Specific keyword match scenarios');
console.log('='.repeat(80));

interface TestCase {
  skill: string;
  resumeSnippet: string;
  expectedResult: boolean;
  description: string;
}

const testCases: TestCase[] = [
  // REST vs RESTful
  { skill: 'REST', resumeSnippet: 'Built RESTful APIs for microservices', expectedResult: false, description: 'REST in "RESTful" — boundary after "rest" is "f"' },
  { skill: 'REST', resumeSnippet: 'Built REST APIs for microservices', expectedResult: true, description: 'Standalone REST with space boundary' },
  { skill: 'RESTful', resumeSnippet: 'Built RESTful APIs for microservices', expectedResult: true, description: 'RESTful with space boundaries' },

  // Distributed Systems
  { skill: 'Distributed Systems', resumeSnippet: 'Experience with Distributed Systems and microservices', expectedResult: true, description: 'Distributed Systems with space boundaries' },
  { skill: 'Distributed Systems', resumeSnippet: '**Distributed Systems**, Microservices', expectedResult: false, description: 'Distributed Systems in markdown bold' },

  // MySQL
  { skill: 'MySQL', resumeSnippet: 'Databases: PostgreSQL, MySQL, Redis', expectedResult: true, description: 'MySQL in comma-separated list after colon+space' },
  { skill: 'MySQL', resumeSnippet: 'Databases:MySQL, PostgreSQL', expectedResult: false, description: 'MySQL after colon (no space) — ":" not in boundary' },
  { skill: 'MySQL', resumeSnippet: '**MySQL**, PostgreSQL', expectedResult: false, description: 'MySQL in markdown bold' },

  // Kotlin
  { skill: 'Kotlin', resumeSnippet: 'Languages: Python, Kotlin, Java', expectedResult: true, description: 'Kotlin in comma-separated list' },
  { skill: 'Kotlin', resumeSnippet: '**Kotlin**, Java, Python', expectedResult: false, description: 'Kotlin in markdown bold' },

  // Already-matching skills (for comparison)
  { skill: 'PY', resumeSnippet: 'Languages: Python, Java', expectedResult: true, description: 'PY matching via synonym expansion to "python"' },
  { skill: 'K8S', resumeSnippet: 'DevOps: Docker, Kubernetes, Terraform', expectedResult: true, description: 'K8S matching via synonym expansion to "kubernetes"' },
  { skill: 'SQL', resumeSnippet: 'Databases: PostgreSQL, MySQL, SQL Server', expectedResult: true, description: 'SQL matching — but might also match inside "MySQL" or "PostgreSQL"' },

  // Edge cases with various formatting
  { skill: 'MySQL', resumeSnippet: 'MySQL PostgreSQL Redis', expectedResult: true, description: 'MySQL at start of string (^ boundary)' },
  { skill: 'MySQL', resumeSnippet: 'I used MySQL.', expectedResult: true, description: 'MySQL followed by period' },
  { skill: 'REST', resumeSnippet: 'REST, GraphQL, gRPC', expectedResult: true, description: 'REST followed by comma' },
];

for (const tc of testCases) {
  const result = termExistsWithSynonyms(tc.skill, tc.resumeSnippet);
  const status = result === tc.expectedResult ? 'PASS' : 'FAIL';
  const icon = result === tc.expectedResult ? '  ' : '>>';
  console.log(`\n${icon} [${status}] "${tc.skill}" in "${tc.resumeSnippet}"`);
  console.log(`   Expected: ${tc.expectedResult}, Got: ${result}`);
  console.log(`   ${tc.description}`);
}

// ---------------------------------------------------------------------------
// Test 3: SYNONYM_MAP coverage analysis
// ---------------------------------------------------------------------------

console.log('\n' + '='.repeat(80));
console.log('TEST 3: SYNONYM_MAP coverage analysis for reported problem skills');
console.log('='.repeat(80));

const problemSkills = ['REST', 'RESTful', 'RESTful APIs', 'MySQL', 'Kotlin', 'Distributed Systems', 'Monitoring'];

for (const skill of problemSkills) {
  const lower = skill.toLowerCase();
  const asKey = SYNONYM_MAP[lower];
  const asValue = Object.entries(SYNONYM_MAP).find(([, values]) => values.some(v => v === lower));

  console.log(`\n"${skill}":`);
  console.log(`  In SYNONYM_MAP as key: ${asKey ? `YES => [${asKey.join(', ')}]` : 'NO'}`);
  console.log(`  In SYNONYM_MAP as value: ${asValue ? `YES => key="${asValue[0]}", values=[${asValue[1].join(', ')}]` : 'NO'}`);
  if (!asKey && !asValue) {
    console.log(`  STATUS: No synonym mapping — must match EXACTLY via word boundary`);
  }
}

// ---------------------------------------------------------------------------
// Test 4: REST/RESTful normalization trace
// ---------------------------------------------------------------------------

console.log('\n' + '='.repeat(80));
console.log('TEST 4: How REST and RESTful get normalized during JD preprocessing');
console.log('='.repeat(80));

const mockJDWithRest = `
Requirements:
- 5+ years experience with REST APIs and microservices
- Experience with Distributed Systems
- Proficiency in Python, Kotlin, Java
- Experience with MySQL, PostgreSQL
- Kubernetes, Docker, AWS
- Monitoring and observability
`;

console.log('\nMock JD input:');
console.log(mockJDWithRest);

const processedJD = preprocessJobDescription(mockJDWithRest, 'Software Engineer');

console.log('\nFinal extracted hard skills:', processedJD.extractedSkills.hardSkills);
console.log('Extraction methods:', processedJD.extractedSkills.extractionMethod);

// ---------------------------------------------------------------------------
// Test 5: Full scoring simulation with mock data
// ---------------------------------------------------------------------------

console.log('\n' + '='.repeat(80));
console.log('TEST 5: Full ATS scoring simulation');
console.log('='.repeat(80));

const mockOriginalResume = `
John Doe
Software Engineer
john@example.com | (555) 123-4567 | linkedin.com/in/johndoe

PROFESSIONAL SUMMARY
Experienced software engineer with expertise in building scalable backend systems using Python, Java, and Kotlin. Skilled in RESTful APIs, distributed systems, and cloud infrastructure.

TECHNICAL SKILLS
Languages: Python, Kotlin, Java, SQL
Frameworks: Spring Boot, Flask, FastAPI
Databases: PostgreSQL, MySQL, Redis, MongoDB
Cloud & DevOps: AWS (EC2, Lambda, S3, ECS), Docker, Kubernetes, Terraform
Tools: Git, Jira, Datadog, Grafana
Methodologies: Agile, CI/CD, Microservices, REST, Monitoring

WORK EXPERIENCE

Senior Software Engineer | TechCorp | January 2022 - Present
- Built distributed systems handling 50K requests/second using Python and AWS Lambda
- Designed RESTful APIs for payment processing microservices using Spring Boot and Kotlin
- Implemented MySQL database optimization reducing query latency by 40%
- Set up monitoring and alerting dashboards using Datadog and Grafana

Software Engineer | DataCo | June 2019 - December 2021
- Developed backend services in Java and Python for data pipeline processing
- Managed Kubernetes clusters running 200+ pods across multiple AWS regions
- Built REST API integrations with third-party payment providers

EDUCATION
B.S. Computer Science | State University | May 2019
`;

const mockTailoredResume = `
John Doe
Software Engineer
john@example.com | (555) 123-4567 | linkedin.com/in/johndoe

**PROFESSIONAL SUMMARY**
Experienced software engineer specializing in Distributed Systems and backend architecture using Python, Kotlin, and Java. Proven expertise in REST APIs, MySQL optimization, and cloud-native deployments on AWS with Kubernetes.

**TECHNICAL SKILLS**
**Languages:** Python, Kotlin, Java, SQL
**Frameworks:** Spring Boot, Flask, FastAPI
**Databases:** PostgreSQL, MySQL, Redis
**Cloud & DevOps:** AWS (EC2, Lambda, S3, ECS), Docker, Kubernetes, Terraform
**Methodologies:** Agile, CI/CD, Distributed Systems, REST, Monitoring

**WORK EXPERIENCE**

**Senior Software Engineer** | TechCorp | January 2022 - Present
- Built distributed systems handling 50K requests/second using Python and AWS Lambda
- Designed RESTful APIs for payment processing microservices using Spring Boot and Kotlin
- Optimized MySQL database queries reducing latency by 40% through index restructuring
- Implemented monitoring dashboards using Datadog with automated alerting

**Software Engineer** | DataCo | June 2019 - December 2021
- Developed REST API backend services in Java and Python for data pipelines
- Managed Kubernetes clusters with 200+ pods across AWS regions

**EDUCATION**
B.S. Computer Science | State University | May 2019
`;

console.log('\n--- Scoring tailored resume (with original as baseline) ---');
const tailoredScore = computeATSScore(mockTailoredResume, processedJD, mockOriginalResume);

console.log('\n--- FINAL RESULTS ---');
console.log(`Total Score: ${tailoredScore.totalScore}`);
console.log(`Hard Skill Score: ${tailoredScore.tierScores.hardSkillMatch.score}`);
console.log(`Matched: [${tailoredScore.tierScores.hardSkillMatch.matched.join(', ')}]`);
console.log(`Missing: [${tailoredScore.tierScores.hardSkillMatch.missing.join(', ')}]`);
console.log(`Skills Gap: [${tailoredScore.tierScores.hardSkillMatch.skillsGap.join(', ')}]`);
console.log(`Skills in Resume (debug): [${tailoredScore.scoringDebug?.skillsInResume.join(', ')}]`);

// ---------------------------------------------------------------------------
// Test 6: Markdown bold interference analysis
// ---------------------------------------------------------------------------

console.log('\n' + '='.repeat(80));
console.log('TEST 6: Markdown bold marker interference');
console.log('='.repeat(80));

const markdownTests = [
  { text: '**Python**, Kotlin, Java', skills: ['Python', 'Kotlin', 'Java'] },
  { text: '**Languages:** Python, Kotlin, Java', skills: ['Python', 'Kotlin', 'Java'] },
  { text: '**Distributed Systems**, Microservices', skills: ['Distributed Systems', 'Microservices'] },
  { text: '**MySQL**, PostgreSQL', skills: ['MySQL', 'PostgreSQL'] },
  { text: '**REST**, GraphQL', skills: ['REST', 'GraphQL'] },
];

for (const test of markdownTests) {
  console.log(`\nText: "${test.text}"`);
  for (const skill of test.skills) {
    const found = termExistsWithSynonyms(skill, test.text);
    console.log(`  "${skill}": ${found ? 'FOUND' : 'NOT FOUND'}`);
  }
}

console.log('\n' + '='.repeat(80));
console.log('DIAGNOSTIC COMPLETE');
console.log('='.repeat(80));
