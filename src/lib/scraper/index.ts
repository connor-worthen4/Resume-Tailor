import * as cheerio from 'cheerio';

export interface ScrapedJob {
  title: string;
  company: string;
  description: string;
  requirements: string[];
  url: string;
}

// LinkedIn job scraper
function scrapeLinkedIn($: cheerio.CheerioAPI, url: string): ScrapedJob {
  const title =
    $('.job-details-jobs-unified-top-card__job-title').text().trim() ||
    $('h1').first().text().trim();
  const company =
    $('.job-details-jobs-unified-top-card__company-name').text().trim() ||
    $('[data-tracking-control-name="public_jobs_topcard-org-name"]').text().trim();
  const description = $('.jobs-description__content').text().trim() ||
    $('.description__text').text().trim();

  const requirements: string[] = [];
  $('.jobs-description__content li, .description__text li').each((_, el) => {
    const text = $(el).text().trim();
    if (text) requirements.push(text);
  });

  return { title, company, description, requirements, url };
}

// Greenhouse job scraper
function scrapeGreenhouse($: cheerio.CheerioAPI, url: string): ScrapedJob {
  const title = $('h1.app-title').text().trim() || $('h1').first().text().trim();
  const company = $('.company-name').text().trim() || $('title').text().split(' at ')[1]?.split(' - ')[0]?.trim() || '';
  const description = $('#content').text().trim();

  const requirements: string[] = [];
  $('#content li').each((_, el) => {
    const text = $(el).text().trim();
    if (text) requirements.push(text);
  });

  return { title, company, description, requirements, url };
}

// Lever job scraper
function scrapeLever($: cheerio.CheerioAPI, url: string): ScrapedJob {
  const title = $('h2').first().text().trim() || $('h1').first().text().trim();
  const company = $('.posting-headline a').first().text().trim() || '';
  const description = $('.section-wrapper').text().trim();

  const requirements: string[] = [];
  $('.posting-requirements li').each((_, el) => {
    const text = $(el).text().trim();
    if (text) requirements.push(text);
  });

  return { title, company, description, requirements, url };
}

// Workday job scraper
function scrapeWorkday($: cheerio.CheerioAPI, url: string): ScrapedJob {
  const title =
    $('[data-automation-id="jobPostingHeader"] h2').text().trim() ||
    $('[data-automation-id="jobTitle"]').text().trim() ||
    $('h1').first().text().trim();

  const company =
    $('[data-automation-id="companyName"]').text().trim() ||
    $('title').text().split(' - ').slice(-1)[0]?.trim() ||
    '';

  const descriptionEl = $('[data-automation-id="jobPostingDescription"]');
  const description = descriptionEl.length
    ? descriptionEl.text().trim()
    : $('main').text().trim();

  const requirements: string[] = [];
  const descContainer = descriptionEl.length ? descriptionEl : $('main');
  descContainer.find('li').each((_, el) => {
    const text = $(el).text().trim();
    if (text && text.length > 10 && text.length < 500) {
      requirements.push(text);
    }
  });

  return { title, company, description, requirements: requirements.slice(0, 50), url };
}

// Generic fallback scraper
function scrapeGeneric($: cheerio.CheerioAPI, url: string): ScrapedJob {
  // Try common selectors for job title
  const titleSelectors = [
    'h1',
    '[class*="job-title"]',
    '[class*="jobTitle"]',
    '[class*="position-title"]',
    'title',
  ];

  let title = '';
  for (const selector of titleSelectors) {
    const text = $(selector).first().text().trim();
    if (text && text.length < 200) {
      title = text;
      break;
    }
  }

  // Try common selectors for company
  const companySelectors = [
    '[class*="company-name"]',
    '[class*="companyName"]',
    '[class*="employer"]',
    '[class*="organization"]',
  ];

  let company = '';
  for (const selector of companySelectors) {
    const text = $(selector).first().text().trim();
    if (text && text.length < 100) {
      company = text;
      break;
    }
  }

  // Get all text from main content areas
  const contentSelectors = [
    'main',
    'article',
    '[class*="job-description"]',
    '[class*="jobDescription"]',
    '[class*="description"]',
    '.content',
    '#content',
  ];

  let description = '';
  for (const selector of contentSelectors) {
    const text = $(selector).first().text().trim();
    if (text && text.length > description.length) {
      description = text;
    }
  }

  // Fallback to body if no specific content found
  if (!description) {
    description = $('body').text().trim();
  }

  // Extract requirements from lists
  const requirements: string[] = [];
  $('li').each((_, el) => {
    const text = $(el).text().trim();
    if (text && text.length > 10 && text.length < 500) {
      requirements.push(text);
    }
  });

  // Clean up title from page title if needed
  if (!title && $('title').length) {
    title = $('title').text().split('|')[0].split('-')[0].trim();
  }

  return { title, company, description, requirements: requirements.slice(0, 50), url };
}

export async function scrapeJobPosting(url: string): Promise<ScrapedJob> {
  const response = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.5',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch job posting: ${response.status}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  // Determine which scraper to use based on URL
  const hostname = new URL(url).hostname;

  if (hostname.includes('linkedin.com')) {
    return scrapeLinkedIn($, url);
  }

  if (hostname.includes('greenhouse.io') || hostname.includes('boards.greenhouse.io')) {
    return scrapeGreenhouse($, url);
  }

  if (hostname.includes('lever.co') || hostname.includes('jobs.lever.co')) {
    return scrapeLever($, url);
  }

  if (hostname.includes('myworkdayjobs.com') || hostname.includes('workday.com')) {
    return scrapeWorkday($, url);
  }

  // Use generic scraper for unknown sites
  return scrapeGeneric($, url);
}

// Clean and truncate job description
export function cleanJobDescription(description: string, maxLength = 8000): string {
  // Remove excessive whitespace
  let cleaned = description
    .replace(/\s+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // Truncate if too long
  if (cleaned.length > maxLength) {
    cleaned = cleaned.substring(0, maxLength) + '...';
  }

  return cleaned;
}
