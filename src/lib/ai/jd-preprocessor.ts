// ---------------------------------------------------------------------------
// JD Preprocessing Pipeline — Cleans, segments, and extracts skills from
// raw scraped job descriptions before they reach the scoring engine.
// ---------------------------------------------------------------------------

import { SYNONYM_MAP } from './tailor';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface JDSections {
  relevant: {
    roleOverview?: string;
    responsibilities?: string;
    requirements?: string;
    qualifications?: string;
    techStack?: string;
    niceToHave?: string;
  };
  noise: {
    companyDescription?: string;
    benefits?: string;
    salary?: string;
    location?: string;
    eeo?: string;
    applicationProcess?: string;
    otherNoise?: string;
  };
  fullRelevantText: string;
}

export interface ExtractedSkills {
  hardSkills: string[];
  softSkills: string[];
  yearsExperience?: string;
  degreeRequirement?: string;
  certifications?: string[];
}

export interface RequirementMetadata {
  yearsExperience: { min: number; area?: string }[];
  degreeRequirement?: { level: string; field?: string };
  certifications: string[];
}

export interface ProcessedJD {
  cleanedText: string;
  sections: JDSections;
  extractedSkills: ExtractedSkills;
  metadata: RequirementMetadata;
  jobTitle: string;
  debug?: {
    totalWordsInRaw: number;
    totalWordsInRelevant: number;
    noisePercentageFiltered: number;
    extractionMethod: Record<string, 'dictionary' | 'pattern' | 'both'>;
  };
}

// ---------------------------------------------------------------------------
// Step 1: Text Cleaning
// ---------------------------------------------------------------------------

export function cleanJDText(rawText: string): string {
  let text = rawText;

  // Fix sentence concatenation: insert space before capital letters following
  // periods, close-parens, colons, or semicolons with no space
  text = text.replace(/\.([A-Z])/g, '. $1');
  text = text.replace(/\)([A-Z])/g, ') $1');
  text = text.replace(/:([A-Z])/g, ': $1');
  text = text.replace(/;([A-Z])/g, '; $1');

  // Normalize whitespace
  text = text.replace(/[\r\n\t]+/g, ' ');
  text = text.replace(/\s{2,}/g, ' ');

  // Replace smart/curly quotes with straight quotes
  text = text.replace(/[\u2018\u2019\u201A\u201B]/g, "'");
  text = text.replace(/[\u201C\u201D\u201E\u201F]/g, '"');

  // Normalize dashes (em dash, en dash -> standard hyphen for consistency)
  text = text.replace(/[\u2013\u2014]/g, '-');

  // Remove zero-width and invisible Unicode characters
  text = text.replace(/[\u200B\u200C\u200D\uFEFF\u00AD]/g, '');

  return text.trim();
}

// ---------------------------------------------------------------------------
// Step 2: Section Segmentation (with Step 19 fallback)
// ---------------------------------------------------------------------------

interface SectionHeaderPattern {
  field: string;
  patterns: RegExp[];
}

const RELEVANT_HEADERS: SectionHeaderPattern[] = [
  {
    field: 'roleOverview',
    patterns: [
      /\b(?:role\s+overview|about\s+the\s+role|the\s+role|position\s+summary|job\s+summary|what\s+you'?ll\s+do|what\s+you\s+will\s+do|the\s+opportunity)\b/i,
    ],
  },
  {
    field: 'responsibilities',
    patterns: [
      /\b(?:key\s+)?responsibilities\b/i,
      /\b(?:what\s+you'?ll\s+be\s+doing|your\s+responsibilities|duties|day\s+to\s+day|in\s+this\s+role\s+you\s+will)\b/i,
    ],
  },
  {
    field: 'requirements',
    patterns: [
      /\b(?:requirements|minimum\s+qualifications|required\s+qualifications|must\s+have|who\s+you\s+are|what\s+you\s+bring|your\s+background)\b/i,
      /\b(?:what\s+we'?re\s+looking\s+for|what\s+you'?ll\s+need)\b/i,
    ],
  },
  {
    field: 'qualifications',
    patterns: [
      /\bqualifications\b/i,
    ],
  },
  {
    field: 'techStack',
    patterns: [
      /\b(?:tech\s+stack|technology\s+stack|our\s+stack|tools\s+we\s+use|technologies|technical\s+environment)\b/i,
    ],
  },
  {
    field: 'niceToHave',
    patterns: [
      /\b(?:nice\s+to\s+have|bonus|preferred\s+qualifications|preferred\s+experience|additional\s+qualifications|desired\s+qualifications)\b/i,
    ],
  },
];

const NOISE_HEADERS: SectionHeaderPattern[] = [
  {
    field: 'companyDescription',
    patterns: [
      /\b(?:about\s+the\s+company|about\s+us|who\s+we\s+are|our\s+mission|company\s+overview|about\s+the\s+team)\b/i,
    ],
  },
  {
    field: 'benefits',
    patterns: [
      /\b(?:benefits|perks|wellbeing|what\s+we\s+offer|total\s+rewards|benefits\/perks)\b/i,
    ],
  },
  {
    field: 'salary',
    patterns: [
      /\b(?:salary|pay\s+range|compensation\s+range|base\s+pay|compensation)\b/i,
    ],
  },
  {
    field: 'location',
    patterns: [
      /\b(?:location|where\s+you'?ll\s+work|office\s+locations|working\s+at)\b/i,
    ],
  },
  {
    field: 'eeo',
    patterns: [
      /\b(?:equal\s+opportunity|eeo|diversity|accessibility|we\s+want\s+our\s+interview\s+process|accommodation)\b/i,
    ],
  },
  {
    field: 'applicationProcess',
    patterns: [
      /\b(?:how\s+to\s+apply|application\s+process|to\s+apply)\b/i,
    ],
  },
];

interface DetectedSection {
  type: 'relevant' | 'noise';
  field: string;
  startIndex: number;
  content: string;
}

export function segmentJDSections(cleanedText: string): JDSections {
  const allHeaders = [
    ...RELEVANT_HEADERS.map(h => ({ ...h, type: 'relevant' as const })),
    ...NOISE_HEADERS.map(h => ({ ...h, type: 'noise' as const })),
  ];

  // Find all header positions
  const detectedPositions: { type: 'relevant' | 'noise'; field: string; index: number }[] = [];

  for (const header of allHeaders) {
    for (const pattern of header.patterns) {
      // Standard match
      const match = cleanedText.search(pattern);
      if (match !== -1) {
        // Avoid duplicates for the same field at the same position
        if (!detectedPositions.some(p => p.field === header.field && Math.abs(p.index - match) < 10)) {
          detectedPositions.push({ type: header.type, field: header.field, index: match });
        }
      }
    }
  }

  // Handle concatenated headers edge case: "Key ResponsibilitiesDesign..."
  // Look for header text immediately followed by a capital letter or digit
  const concatenatedPatterns = [
    { field: 'responsibilities', type: 'relevant' as const, re: /(?:Key\s+)?Responsibilities(?=[A-Z\d])/g },
    { field: 'requirements', type: 'relevant' as const, re: /Requirements(?=[A-Z\d])/g },
    { field: 'qualifications', type: 'relevant' as const, re: /Qualifications(?=[A-Z\d])/g },
    { field: 'techStack', type: 'relevant' as const, re: /Tech\s*Stack(?=[A-Z\d])/g },
    { field: 'niceToHave', type: 'relevant' as const, re: /Nice\s+to\s+Have(?=[A-Z\d])/g },
    { field: 'companyDescription', type: 'noise' as const, re: /About\s+(?:the\s+Company|Us)(?=[A-Z\d])/g },
    { field: 'benefits', type: 'noise' as const, re: /Benefits(?=[A-Z\d])/g },
  ];

  for (const cp of concatenatedPatterns) {
    let m;
    while ((m = cp.re.exec(cleanedText)) !== null) {
      if (!detectedPositions.some(p => p.field === cp.field && Math.abs(p.index - m!.index) < 10)) {
        detectedPositions.push({ type: cp.type, field: cp.field, index: m.index });
      }
    }
  }

  // Sort by position
  detectedPositions.sort((a, b) => a.index - b.index);

  // If no headers detected, use heuristic fallback (Step 19)
  if (detectedPositions.length === 0) {
    return heuristicSegmentation(cleanedText);
  }

  // Split text at header boundaries and classify
  const sections: DetectedSection[] = [];

  // Text before the first header — treat as relevant (could be role overview)
  if (detectedPositions.length > 0 && detectedPositions[0].index > 50) {
    sections.push({
      type: 'relevant',
      field: 'roleOverview',
      startIndex: 0,
      content: cleanedText.substring(0, detectedPositions[0].index).trim(),
    });
  }

  for (let i = 0; i < detectedPositions.length; i++) {
    const start = detectedPositions[i].index;
    const end = i + 1 < detectedPositions.length ? detectedPositions[i + 1].index : cleanedText.length;
    sections.push({
      type: detectedPositions[i].type,
      field: detectedPositions[i].field,
      startIndex: start,
      content: cleanedText.substring(start, end).trim(),
    });
  }

  // Build the result
  const result: JDSections = {
    relevant: {},
    noise: {},
    fullRelevantText: '',
  };

  const relevantTexts: string[] = [];

  for (const section of sections) {
    if (section.type === 'relevant') {
      (result.relevant as Record<string, string>)[section.field] = section.content;
      relevantTexts.push(section.content);
    } else {
      (result.noise as Record<string, string>)[section.field] = section.content;
    }
  }

  result.fullRelevantText = relevantTexts.join(' ');

  // If we ended up with no relevant text (all classified as noise), treat everything as relevant
  if (!result.fullRelevantText.trim()) {
    result.fullRelevantText = cleanedText;
  }

  return result;
}

function heuristicSegmentation(cleanedText: string): JDSections {
  // Step 19: Fallback for unstructured JDs
  const sentences = cleanedText.split(/(?<=[.!?])\s+/);
  const noiseSentences: string[] = [];
  const relevantSentences: string[] = [];

  for (const sentence of sentences) {
    if (isNoiseSentence(sentence)) {
      noiseSentences.push(sentence);
    } else {
      relevantSentences.push(sentence);
    }
  }

  const relevantText = relevantSentences.join(' ').trim();

  return {
    relevant: {
      roleOverview: relevantText,
    },
    noise: {
      otherNoise: noiseSentences.join(' ').trim() || undefined,
    },
    fullRelevantText: relevantText || cleanedText,
  };
}

function isNoiseSentence(sentence: string): boolean {
  const lower = sentence.toLowerCase();

  // Salary patterns
  if (/\$[\d,]+/.test(sentence)) return true;

  // Location lists: "City | City | City"
  if (/\w+\s*\|\s*\w+\s*\|\s*\w+/.test(sentence)) return true;

  // Benefits keywords
  const benefitsKeywords = ['401k', '401(k)', 'dental', 'vacation', 'pto', 'parental leave',
    'health insurance', 'medical insurance', 'vision insurance', 'life insurance',
    'disability insurance', 'wellness', 'stipend', 'tuition reimbursement'];
  if (benefitsKeywords.some(kw => lower.includes(kw))) return true;

  // EEO boilerplate
  const eeoKeywords = ['equal opportunity', 'regardless of race', 'accommodation',
    'affirmative action', 'protected veteran', 'disability status',
    'gender identity', 'sexual orientation'];
  if (eeoKeywords.some(kw => lower.includes(kw))) return true;

  return false;
}

// ---------------------------------------------------------------------------
// Step 3: Technical Skill Extraction (with Step 21 domain dictionaries)
// ---------------------------------------------------------------------------

const TECHNICAL_SKILLS_DICTIONARY: Record<string, string[]> = {
  languages: [
    'Python', 'JavaScript', 'TypeScript', 'Java', 'C++', 'C#', 'C',
    'Go', 'Golang', 'Rust', 'Ruby', 'PHP', 'Swift', 'Kotlin', 'Scala',
    'R', 'MATLAB', 'Perl', 'Dart', 'Elixir', 'Haskell', 'Lua',
    'Objective-C', 'Shell', 'Bash', 'PowerShell', 'SQL', 'HTML', 'CSS',
    'SASS', 'LESS', 'Solidity', 'COBOL', 'Fortran', 'Assembly',
  ],
  frameworks: [
    'React', 'Angular', 'Vue', 'Vue.js', 'Next.js', 'Nuxt.js', 'Svelte',
    'Django', 'Flask', 'FastAPI', 'Spring', 'Spring Boot', 'Express',
    'Express.js', 'Node.js', 'NestJS', 'Rails', 'Ruby on Rails',
    'Laravel', '.NET', 'ASP.NET', 'Gin', 'Echo', 'Fiber',
    'TensorFlow', 'PyTorch', 'Keras', 'scikit-learn', 'Pandas', 'NumPy',
    'Spark', 'PySpark', 'Hadoop', 'Flink', 'Beam',
    'React Native', 'Flutter', 'SwiftUI', 'Jetpack Compose',
    'jQuery', 'Bootstrap', 'Tailwind', 'Material UI', 'Chakra UI',
    'Redux', 'MobX', 'Zustand', 'Recoil',
    'GraphQL', 'Apollo', 'Prisma', 'SQLAlchemy', 'Hibernate',
    'Celery', 'RabbitMQ', 'Kafka',
  ],
  cloud: [
    'AWS', 'Amazon Web Services', 'Azure', 'Microsoft Azure', 'GCP',
    'Google Cloud', 'Google Cloud Platform',
    'Lambda', 'EC2', 'ECS', 'EKS', 'S3', 'RDS', 'DynamoDB',
    'CloudFormation', 'CloudWatch', 'SQS', 'SNS', 'API Gateway',
    'ElastiCache', 'Redshift', 'Kinesis', 'Step Functions',
    'CloudFront', 'Route 53', 'IAM', 'VPC', 'Fargate',
    'Azure Functions', 'Azure DevOps', 'Cosmos DB',
    'Cloud Functions', 'BigQuery', 'Cloud Run', 'Pub/Sub',
    'Heroku', 'Vercel', 'Netlify', 'DigitalOcean', 'Linode',
    'Cloudflare', 'Fastly',
  ],
  devops: [
    'Docker', 'Kubernetes', 'K8s', 'Terraform', 'Ansible', 'Puppet',
    'Chef', 'Vagrant', 'Packer', 'Helm',
    'Jenkins', 'GitHub Actions', 'GitLab CI', 'CircleCI', 'Travis CI',
    'ArgoCD', 'Flux', 'Spinnaker',
    'Datadog', 'Grafana', 'Prometheus', 'New Relic', 'Splunk',
    'PagerDuty', 'ELK Stack', 'Elasticsearch', 'Logstash', 'Kibana',
    'Nginx', 'Apache', 'Caddy', 'HAProxy',
    'Git', 'GitHub', 'GitLab', 'Bitbucket', 'SVN',
    'Jira', 'Confluence', 'Linear', 'Notion', 'Asana', 'Trello',
    'Airflow', 'Apache Airflow', 'Dagster', 'Prefect', 'Luigi',
    'Databricks', 'Snowflake', 'dbt',
  ],
  databases: [
    'PostgreSQL', 'MySQL', 'MariaDB', 'SQLite', 'Oracle', 'SQL Server',
    'MongoDB', 'Cassandra', 'CouchDB', 'CouchBase',
    'Redis', 'Memcached',
    'Neo4j', 'ArangoDB', 'DGraph',
    'InfluxDB', 'TimescaleDB',
    'Pinecone', 'Weaviate', 'Milvus', 'ChromaDB', 'Qdrant',
    'Firebase', 'Firestore', 'Supabase',
  ],
  methodologies: [
    'Agile', 'Scrum', 'Kanban', 'SAFe', 'Lean',
    'CI/CD', 'Continuous Integration', 'Continuous Deployment', 'Continuous Delivery',
    'TDD', 'Test-Driven Development', 'BDD',
    'DevOps', 'SRE', 'Site Reliability Engineering',
    'Infrastructure-as-Code', 'IaC',
    'Microservices', 'Monolith', 'Service-Oriented Architecture', 'SOA',
    'Event-Driven Architecture', 'Event-Driven',
    'REST', 'RESTful', 'gRPC', 'WebSocket', 'GraphQL',
    'OAuth', 'JWT', 'SAML', 'SSO', 'RBAC',
    'Machine Learning', 'ML', 'Deep Learning', 'DL',
    'Natural Language Processing', 'NLP',
    'Computer Vision',
    'LLM', 'Large Language Model', 'Generative AI', 'GenAI',
    'MLOps', 'Data Engineering', 'Data Pipeline',
    'ETL', 'ELT', 'Data Warehouse', 'Data Lake',
    'Distributed Systems', 'Scalable Systems',
    'System Design', 'API Design',
    'Performance Optimization', 'Load Testing',
    'Observability', 'Monitoring',
    'Data Integrity', 'Data Modeling', 'Schema Design',
  ],
  certifications: [
    'AWS Certified', 'AWS Solutions Architect', 'AWS Developer',
    'Azure Certified', 'Google Cloud Certified',
    'PMP', 'Scrum Master', 'CSM', 'CSPO',
    'CKA', 'CKAD', 'CKS',
    'CISSP', 'CompTIA', 'Security+',
  ],
};

// Step 21: Non-tech domain dictionaries
const MARKETING_SKILLS = [
  'SEO', 'SEM', 'Google Analytics', 'GA4', 'HubSpot', 'Salesforce',
  'Marketo', 'Mailchimp', 'A/B Testing', 'Content Strategy',
  'Social Media', 'PPC', 'CPC', 'CPM', 'Google Ads', 'Meta Ads', 'CRM',
  'Marketing Automation', 'Email Marketing', 'Brand Strategy', 'Copywriting',
  'Adobe Creative Suite', 'Figma', 'Canva',
];

const FINANCE_SKILLS = [
  'Financial Modeling', 'Excel', 'Bloomberg Terminal',
  'QuickBooks', 'SAP', 'Oracle Financials', 'NetSuite', 'GAAP', 'IFRS',
  'Valuation', 'DCF', 'M&A', 'Due Diligence', 'Risk Analysis', 'FP&A',
  'Budgeting', 'Forecasting', 'Audit', 'Compliance', 'SEC', 'SOX',
];

const DATA_SKILLS = [
  'SQL', 'Python', 'R', 'Tableau', 'Power BI', 'Looker',
  'Excel', 'Snowflake', 'Redshift', 'BigQuery', 'dbt', 'Airflow',
  'ETL', 'Data Modeling', 'Statistics', 'A/B Testing', 'Regression',
  'Machine Learning', 'Pandas', 'NumPy', 'Jupyter',
];

const DESIGN_SKILLS = [
  'Figma', 'Sketch', 'Adobe XD', 'Photoshop', 'Illustrator',
  'InDesign', 'After Effects', 'Premiere Pro', 'Wireframing', 'Prototyping',
  'User Research', 'Usability Testing', 'Design Systems', 'Typography',
];

const PM_SKILLS = [
  'Jira', 'Asana', 'Trello', 'Confluence', 'Monday.com',
  'Roadmapping', 'OKRs', 'KPIs', 'Sprint Planning', 'User Stories',
  'Stakeholder Management', 'Agile', 'Scrum', 'Kanban', 'PRD',
  'Product Strategy', 'Go-to-Market', 'A/B Testing', 'Analytics',
];

const SOFT_SKILLS_DICTIONARY = [
  'leadership', 'communication', 'collaboration', 'cross-functional',
  'teamwork', 'mentoring', 'mentorship', 'problem-solving',
  'critical thinking', 'analytical', 'strategic thinking',
  'project management', 'time management', 'stakeholder management',
  'presentation', 'negotiation', 'conflict resolution',
  'adaptability', 'initiative', 'ownership', 'accountability',
  'attention to detail', 'self-motivated', 'proactive',
];

// Short/ambiguous terms that need technical context to match
const AMBIGUOUS_SHORT_TERMS = new Set(['c', 'r', 'go', 'ml', 'dl', 'ai']);

// Build a flat lookup of all technical skills (lowercased -> canonical form)
function buildSkillLookup(dictionaries: Record<string, string[]>[]): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const dict of dictionaries) {
    for (const skills of Object.values(dict)) {
      for (const skill of skills) {
        lookup.set(skill.toLowerCase(), skill);
      }
    }
  }
  return lookup;
}

const TECH_SKILL_LOOKUP = buildSkillLookup([TECHNICAL_SKILLS_DICTIONARY]);

function buildDomainLookup(skills: string[]): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const skill of skills) {
    lookup.set(skill.toLowerCase(), skill);
  }
  return lookup;
}

function isInTechnicalContext(term: string, text: string, position: number): boolean {
  // Check surrounding context for technical indicators
  const windowStart = Math.max(0, position - 100);
  const windowEnd = Math.min(text.length, position + term.length + 100);
  const context = text.substring(windowStart, windowEnd).toLowerCase();

  const contextIndicators = [
    'experience with', 'proficiency in', 'knowledge of', 'familiar with',
    'hands-on', 'programming', 'language', 'framework', 'stack', 'tool',
    'technology', 'platform', 'skills:', 'tech stack', 'technologies:',
  ];

  // Check if surrounded by known skills (comma-separated list context)
  const beforeComma = text.substring(Math.max(0, position - 50), position);
  const afterComma = text.substring(position + term.length, Math.min(text.length, position + term.length + 50));
  const nearOtherSkills = TECH_SKILL_LOOKUP.has(beforeComma.split(/[,;]\s*/).pop()?.trim().toLowerCase() || '') ||
    TECH_SKILL_LOOKUP.has(afterComma.split(/[,;]/)[0]?.trim().toLowerCase() || '');

  return contextIndicators.some(ind => context.includes(ind)) || nearOtherSkills;
}

export function extractSkillsFromJD(relevantText: string): ExtractedSkills {
  const hardSkills = new Set<string>();
  const softSkills = new Set<string>();
  const extractionMethod: Record<string, 'dictionary' | 'pattern' | 'both'> = {};
  const textLower = relevantText.toLowerCase();

  // METHOD 1: Dictionary Matching
  for (const [skillLower, canonical] of TECH_SKILL_LOOKUP.entries()) {
    if (AMBIGUOUS_SHORT_TERMS.has(skillLower)) {
      // For short/ambiguous terms, use word boundary matching + context check
      const regex = new RegExp(`\\b${escapeRegex(skillLower)}\\b`, 'gi');
      let match;
      while ((match = regex.exec(relevantText)) !== null) {
        if (isInTechnicalContext(skillLower, relevantText, match.index)) {
          hardSkills.add(canonical);
          extractionMethod[canonical] = 'dictionary';
          break;
        }
      }
    } else {
      // For multi-word or longer terms, use case-insensitive search
      if (skillLower.length <= 3) {
        // Short terms: word boundary match
        const regex = new RegExp(`\\b${escapeRegex(skillLower)}\\b`, 'i');
        if (regex.test(relevantText)) {
          hardSkills.add(canonical);
          extractionMethod[canonical] = 'dictionary';
        }
      } else {
        // Longer terms: simple includes is sufficient
        if (textLower.includes(skillLower)) {
          hardSkills.add(canonical);
          extractionMethod[canonical] = 'dictionary';
        }
      }
    }
  }

  // If tech dictionary matched < 3 skills, try domain-specific dictionaries (Step 21)
  if (hardSkills.size < 3) {
    const domainDicts = [
      { name: 'marketing', lookup: buildDomainLookup(MARKETING_SKILLS) },
      { name: 'finance', lookup: buildDomainLookup(FINANCE_SKILLS) },
      { name: 'data', lookup: buildDomainLookup(DATA_SKILLS) },
      { name: 'design', lookup: buildDomainLookup(DESIGN_SKILLS) },
      { name: 'pm', lookup: buildDomainLookup(PM_SKILLS) },
    ];

    for (const domain of domainDicts) {
      for (const [skillLower, canonical] of domain.lookup.entries()) {
        if (textLower.includes(skillLower)) {
          hardSkills.add(canonical);
          extractionMethod[canonical] = extractionMethod[canonical] ? 'both' : 'dictionary';
        }
      }
    }
  }

  // METHOD 2: Pattern-Based Extraction
  const patternExtracted = extractSkillsFromPatterns(relevantText);
  for (const skill of patternExtracted) {
    const trimmed = skill.replace(/[.,;:!?)]+$/, '').trim();
    if (trimmed.length >= 2) {
      // Check if it's already in the dictionary (prefer canonical form)
      const canonical = TECH_SKILL_LOOKUP.get(trimmed.toLowerCase());
      if (canonical) {
        hardSkills.add(canonical);
        extractionMethod[canonical] = extractionMethod[canonical] === 'dictionary' ? 'both' : 'pattern';
      } else if (trimmed.length >= 3 && /^[A-Z]/.test(trimmed)) {
        // Capitalized term from a skill list context — likely a real skill
        hardSkills.add(trimmed);
        extractionMethod[trimmed] = extractionMethod[trimmed] ? 'both' : 'pattern';
      }
    }
  }

  // METHOD 3: Soft Skill Extraction
  for (const skill of SOFT_SKILLS_DICTIONARY) {
    if (textLower.includes(skill.toLowerCase())) {
      softSkills.add(skill);
    }
  }

  // Apply synonym normalization: group variants together, keep canonical form
  const normalizedHard = normalizeSynonyms(Array.from(hardSkills));

  return {
    hardSkills: normalizedHard,
    softSkills: Array.from(softSkills),
  };
}

function extractSkillsFromPatterns(text: string): string[] {
  const skills: string[] = [];

  // Pattern: "experience with X, Y, Z" / "proficiency in X, Y, Z" etc.
  const listIndicators = [
    /(?:experience\s+(?:with|in)|proficiency\s+in|knowledge\s+of|familiar\s+with|hands-on\s+(?:experience\s+)?with|tools?\s+like|such\s+as|including|technologies:\s*)\s*([^.]+)/gi,
  ];

  for (const pattern of listIndicators) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const listText = match[1];
      // Split by commas, "and", semicolons
      const items = listText.split(/,\s*|\s+and\s+|\s*;\s*/).map(s => s.trim()).filter(s => s.length >= 2 && s.length <= 40);
      skills.push(...items);
    }
  }

  // Pattern: parenthetical lists — "AWS services (ECS, Lambda, SQS)"
  const parenPattern = /\(([^)]+)\)/g;
  let parenMatch;
  while ((parenMatch = parenPattern.exec(text)) !== null) {
    const inner = parenMatch[1];
    // Only process if it looks like a skill list (multiple comma-separated items)
    if (inner.includes(',')) {
      const items = inner.split(/,\s*/).map(s => s.trim()).filter(s => s.length >= 2 && s.length <= 30);
      skills.push(...items);
    }
  }

  // Pattern: "X+ years of [skill area]"
  const yearsPattern = /\d+\+?\s*years?\s*(?:of\s+)?(?:professional\s+)?(?:experience\s+)?(?:in\s+|with\s+)?([^,.]+)/gi;
  let yearsMatch;
  while ((yearsMatch = yearsPattern.exec(text)) !== null) {
    const area = yearsMatch[1].trim();
    if (area.length >= 3 && area.length <= 50) {
      skills.push(area);
    }
  }

  return skills;
}

function normalizeSynonyms(skills: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const skill of skills) {
    const lower = skill.toLowerCase();
    if (seen.has(lower)) continue;

    // Check synonym map — if this skill is a synonym of another, keep both but don't duplicate
    const synonymKey = Object.entries(SYNONYM_MAP).find(
      ([key, values]) => key === lower || values.some(v => v === lower)
    );

    if (synonymKey) {
      // Add the canonical form (the key)
      const canonicalLower = synonymKey[0];
      if (!seen.has(canonicalLower)) {
        result.push(skill);
        seen.add(lower);
        seen.add(canonicalLower);
        // Also mark all synonym values as seen
        for (const syn of synonymKey[1]) {
          seen.add(syn.toLowerCase());
        }
      }
    } else {
      result.push(skill);
      seen.add(lower);
    }
  }

  return result;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------------------------------------------------------------------------
// Step 4: Years & Degree Extractor
// ---------------------------------------------------------------------------

export function extractRequirementMetadata(relevantText: string): RequirementMetadata {
  const yearsExperience: { min: number; area?: string }[] = [];
  const certifications: string[] = [];
  let degreeRequirement: { level: string; field?: string } | undefined;

  // Years patterns
  const yearsPattern = /(\d+)\+?\s*years?\s*(?:of\s+)?(?:professional\s+)?(?:experience\s+)?(?:in\s+|with\s+)?([^,.;]+)?/gi;
  let match;
  while ((match = yearsPattern.exec(relevantText)) !== null) {
    const min = parseInt(match[1], 10);
    const area = match[2]?.trim();
    if (min > 0 && min <= 30) {
      yearsExperience.push({
        min,
        area: area && area.length > 2 ? area : undefined,
      });
    }
  }

  // Degree patterns
  const degreePattern = /(Bachelor'?s?|Master'?s?|PhD|Doctorate|Associate'?s?)\s*(?:degree\s+)?(?:in\s+)?([^,.;]+)?/gi;
  const degreeMatch = degreePattern.exec(relevantText);
  if (degreeMatch) {
    degreeRequirement = {
      level: degreeMatch[1],
      field: degreeMatch[2]?.trim() || undefined,
    };
  }

  // Certification matching against dictionary
  const certDict = TECHNICAL_SKILLS_DICTIONARY.certifications || [];
  for (const cert of certDict) {
    if (relevantText.toLowerCase().includes(cert.toLowerCase())) {
      certifications.push(cert);
    }
  }

  return { yearsExperience, degreeRequirement, certifications };
}

// ---------------------------------------------------------------------------
// Step 5: Master Preprocessing Pipeline (with Step 20 short JD handling)
// ---------------------------------------------------------------------------

export function preprocessJobDescription(rawJDText: string, jobTitle?: string): ProcessedJD {
  const totalWordsInRaw = rawJDText.split(/\s+/).length;

  // Step 1: Clean
  const cleanedText = cleanJDText(rawJDText);

  // Step 2: Segment
  const sections = segmentJDSections(cleanedText);

  // Step 3: Extract skills from relevant sections
  const extractedSkills = extractSkillsFromJD(sections.fullRelevantText);

  // Step 4: Extract metadata
  const metadata = extractRequirementMetadata(sections.fullRelevantText);

  const totalWordsInRelevant = sections.fullRelevantText.split(/\s+/).length;
  const noisePercentageFiltered = totalWordsInRaw > 0
    ? Math.round(((totalWordsInRaw - totalWordsInRelevant) / totalWordsInRaw) * 100)
    : 0;

  // Step 20: Short JD handling
  let warning: string | undefined;
  if (extractedSkills.hardSkills.length < 3) {
    warning = 'Very few technical skills detected in JD. The ATS score may be less precise.';
  }

  return {
    cleanedText,
    sections,
    extractedSkills,
    metadata,
    jobTitle: jobTitle || '',
    debug: {
      totalWordsInRaw,
      totalWordsInRelevant,
      noisePercentageFiltered,
      extractionMethod: {},
    },
  };
}
