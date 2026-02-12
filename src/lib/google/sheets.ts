import { google } from 'googleapis';

const SPREADSHEET_NAME = 'Job Applications';
const HEADERS = [
  'Date',
  'Company',
  'Job Title',
  'Job URL',
  'Resume Link',
  'CV Link',
  'Cover Letter Link',
  'Status',
  'Response/Heard Back',
  'HR Screen',
  '1st Interview',
  '2nd Interview',
  'Technical Interview',
  'Final Round',
  'Offer',
  'Notes',
];

export interface SheetEntry {
  company: string;
  jobTitle: string;
  url?: string;
  resumeLink?: string;
  cvLink?: string;
  coverLetterLink?: string;
  documentType?: 'resume' | 'cv' | 'cover_letter';
}

// Get or create the job applications spreadsheet
async function getOrCreateSpreadsheet(
  sheets: ReturnType<typeof google.sheets>,
  drive: ReturnType<typeof google.drive>
): Promise<string> {
  // Search for existing spreadsheet
  const response = await drive.files.list({
    q: `name='${SPREADSHEET_NAME}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
    fields: 'files(id, name)',
    spaces: 'drive',
  });

  if (response.data.files && response.data.files.length > 0) {
    const spreadsheetId = response.data.files[0].id!;
    await ensureHeaders(sheets, spreadsheetId);
    return spreadsheetId;
  }

  // Create new spreadsheet
  const spreadsheet = await sheets.spreadsheets.create({
    requestBody: {
      properties: {
        title: SPREADSHEET_NAME,
      },
      sheets: [
        {
          properties: {
            title: 'Applications',
            gridProperties: {
              frozenRowCount: 1,
            },
          },
        },
      ],
    },
    fields: 'spreadsheetId,sheets.properties.sheetId',
  });

  const spreadsheetId = spreadsheet.data.spreadsheetId!;
  const sheetId = spreadsheet.data.sheets![0].properties!.sheetId!;

  // Add headers
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: 'Applications!A1:P1',
    valueInputOption: 'RAW',
    requestBody: {
      values: [HEADERS],
    },
  });

  // Format headers
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 0,
              endRowIndex: 1,
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red: 0.2, green: 0.2, blue: 0.2 },
                textFormat: {
                  bold: true,
                  foregroundColor: { red: 1, green: 1, blue: 1 },
                },
              },
            },
            fields: 'userEnteredFormat(backgroundColor,textFormat)',
          },
        },
        {
          updateDimensionProperties: {
            range: {
              sheetId,
              dimension: 'COLUMNS',
              startIndex: 0,
              endIndex: 16,
            },
            properties: {
              pixelSize: 150,
            },
            fields: 'pixelSize',
          },
        },
      ],
    },
  });

  return spreadsheetId;
}

/**
 * Ensures an existing spreadsheet has the updated 16-column header layout.
 * If the current header row has fewer columns, it updates to match.
 */
async function ensureHeaders(
  sheets: ReturnType<typeof google.sheets>,
  spreadsheetId: string
): Promise<void> {
  try {
    const headerResponse = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Applications!A1:P1',
    });

    const currentHeaders = headerResponse.data.values?.[0] || [];

    // If we already have 16 columns, no migration needed
    if (currentHeaders.length >= 16) return;

    // Update headers to the full 16-column layout
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: 'Applications!A1:P1',
      valueInputOption: 'RAW',
      requestBody: {
        values: [HEADERS],
      },
    });
  } catch {
    // Silently fail — the sheet may be in an unexpected state
  }
}

export async function addSheetEntry(
  accessToken: string,
  entry: SheetEntry
): Promise<{ spreadsheetId: string; spreadsheetUrl: string }> {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });

  const sheets = google.sheets({ version: 'v4', auth });
  const drive = google.drive({ version: 'v3', auth });

  // Get or create spreadsheet
  const spreadsheetId = await getOrCreateSpreadsheet(sheets, drive);

  // Format date
  const date = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  // Deduplication: check if a row with the same Job URL already exists
  let existingRowIndex = -1;
  if (entry.url) {
    const existing = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: 'Applications!A:P',
    });

    const rows = existing.data.values || [];
    for (let i = 1; i < rows.length; i++) {
      // Column D (index 3) is Job URL
      if (rows[i][3] && rows[i][3] === entry.url) {
        existingRowIndex = i + 1; // 1-based row number
        break;
      }
    }
  }

  if (existingRowIndex > 0) {
    // Update existing row: set Resume Link (E), CV Link (F), or Cover Letter Link (G)
    if (entry.documentType === 'cover_letter' && entry.coverLetterLink) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `Applications!G${existingRowIndex}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[entry.coverLetterLink]] },
      });
    } else if (entry.documentType === 'cv' && entry.cvLink) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `Applications!F${existingRowIndex}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[entry.cvLink]] },
      });
    } else if (entry.resumeLink) {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `Applications!E${existingRowIndex}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[entry.resumeLink]] },
      });
    }

    // Also update cover letter link if provided alongside resume/cv
    if (entry.coverLetterLink && entry.documentType !== 'cover_letter') {
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `Applications!G${existingRowIndex}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [[entry.coverLetterLink]] },
      });
    }
  } else {
    // Determine which link columns to populate based on documentType
    const resumeLink = entry.documentType === 'cv' ? '' : (entry.resumeLink || '');
    const cvLink = entry.documentType === 'cv' ? (entry.cvLink || entry.resumeLink || '') : (entry.cvLink || '');
    const coverLetterLink = entry.coverLetterLink || '';

    // Append new row
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Applications!A:P',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [
          [
            date,                    // A. Date
            entry.company,           // B. Company
            entry.jobTitle,          // C. Job Title
            entry.url || '',         // D. Job URL
            resumeLink,              // E. Resume Link
            cvLink,                  // F. CV Link
            coverLetterLink,         // G. Cover Letter Link
            'Not Applied',           // H. Status (default)
            '',                      // I. Response/Heard Back
            '',                      // J. HR Screen
            '',                      // K. 1st Interview
            '',                      // L. 2nd Interview
            '',                      // M. Technical Interview
            '',                      // N. Final Round
            '',                      // O. Offer
            '',                      // P. Notes
          ],
        ],
      },
    });
  }

  return {
    spreadsheetId,
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}`,
  };
}
