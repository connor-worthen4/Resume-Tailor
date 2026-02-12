import { google } from 'googleapis';

const APPLICATIONS_FOLDER_NAME = 'Job Applications';

export interface UploadResult {
  fileId: string;
  webViewLink: string;
}

// Get or create the applications folder
async function getOrCreateApplicationsFolder(
  drive: ReturnType<typeof google.drive>,
  accessToken: string
): Promise<string> {
  // Search for existing folder
  const response = await drive.files.list({
    q: `name='${APPLICATIONS_FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id, name)',
    spaces: 'drive',
  });

  if (response.data.files && response.data.files.length > 0) {
    return response.data.files[0].id!;
  }

  // Create new folder
  const folder = await drive.files.create({
    requestBody: {
      name: APPLICATIONS_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
    },
    fields: 'id',
  });

  return folder.data.id!;
}

// Get or create a job-specific subfolder
async function getOrCreateJobFolder(
  drive: ReturnType<typeof google.drive>,
  parentFolderId: string,
  folderName: string
): Promise<string> {
  // Sanitize folder name
  const sanitizedName = folderName.replace(/[^a-zA-Z0-9-_ ]/g, '').substring(0, 100);

  // Search for existing folder
  const response = await drive.files.list({
    q: `name='${sanitizedName}' and '${parentFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id, name)',
    spaces: 'drive',
  });

  if (response.data.files && response.data.files.length > 0) {
    return response.data.files[0].id!;
  }

  // Create new folder
  const folder = await drive.files.create({
    requestBody: {
      name: sanitizedName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentFolderId],
    },
    fields: 'id',
  });

  return folder.data.id!;
}

export async function uploadToDrive(
  accessToken: string,
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
  company: string,
  jobTitle: string
): Promise<UploadResult> {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });

  const drive = google.drive({ version: 'v3', auth });

  // Get or create the applications folder
  const applicationsFolderId = await getOrCreateApplicationsFolder(drive, accessToken);

  // Create company-specific subfolder
  const jobFolderId = await getOrCreateJobFolder(drive, applicationsFolderId, company);

  // Sanitize file name
  const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9-_.]/g, '_');

  // Check if file already exists and delete it (to replace)
  const existingFiles = await drive.files.list({
    q: `name='${sanitizedFileName}' and '${jobFolderId}' in parents and trashed=false`,
    fields: 'files(id)',
    spaces: 'drive',
  });

  if (existingFiles.data.files && existingFiles.data.files.length > 0) {
    for (const file of existingFiles.data.files) {
      await drive.files.delete({ fileId: file.id! });
    }
  }

  // Upload file
  const response = await drive.files.create({
    requestBody: {
      name: sanitizedFileName,
      parents: [jobFolderId],
    },
    media: {
      mimeType,
      body: require('stream').Readable.from(fileBuffer),
    },
    fields: 'id, webViewLink',
  });

  // Make file viewable via link
  await drive.permissions.create({
    fileId: response.data.id!,
    requestBody: {
      role: 'reader',
      type: 'anyone',
    },
  });

  return {
    fileId: response.data.id!,
    webViewLink: response.data.webViewLink!,
  };
}

export interface DriveBaseFile {
  text: string;
  fileName: string;
  fileType: 'pdf' | 'docx';
}

/**
 * Search Google Drive for base resume/CV/cover-letter files named base_resume, base_cv, or base_cl.
 * Downloads and parses any matching PDF or DOCX files.
 */
export async function searchBaseFiles(
  accessToken: string
): Promise<{ resume?: DriveBaseFile; cv?: DriveBaseFile; coverLetterTemplate?: DriveBaseFile }> {
  const { parseDocument } = await import('@/lib/document/parser');

  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });

  const drive = google.drive({ version: 'v3', auth });

  const query = `(name contains 'base_resume' or name contains 'base_cv' or name contains 'base_cl') and (mimeType='application/pdf' or mimeType='application/vnd.openxmlformats-officedocument.wordprocessingml.document') and trashed=false`;

  const response = await drive.files.list({
    q: query,
    fields: 'files(id, name, mimeType)',
    spaces: 'drive',
  });

  const files = response.data.files || [];
  const result: { resume?: DriveBaseFile; cv?: DriveBaseFile; coverLetterTemplate?: DriveBaseFile } = {};

  for (const file of files) {
    if (!file.id || !file.name || !file.mimeType) continue;

    const lowerName = file.name.toLowerCase();
    const isResume = lowerName.includes('base_resume');
    const isCV = lowerName.includes('base_cv');
    const isCL = lowerName.includes('base_cl');

    if (!isResume && !isCV && !isCL) continue;
    // Skip if we already found this type
    if (isResume && result.resume) continue;
    if (isCV && result.cv) continue;
    if (isCL && result.coverLetterTemplate) continue;

    // Download file content
    const fileResponse = await drive.files.get(
      { fileId: file.id, alt: 'media' },
      { responseType: 'arraybuffer' }
    );

    const buffer = Buffer.from(fileResponse.data as ArrayBuffer);
    const text = await parseDocument(buffer, file.mimeType);
    const fileType = file.mimeType === 'application/pdf' ? 'pdf' : 'docx';

    const parsed: DriveBaseFile = { text, fileName: file.name, fileType };

    if (isResume) {
      result.resume = parsed;
    } else if (isCV) {
      result.cv = parsed;
    } else {
      result.coverLetterTemplate = parsed;
    }
  }

  return result;
}
