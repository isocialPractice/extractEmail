// extractEmailTasks/downloadAttachments
// Download attachments from emails that match specific filter criteria.
// Modify the FILTER_CONFIG below to customize which emails to process.

import fs from 'fs';
import path from 'path';
import { simpleParser } from 'mailparser';

/*******************************************************************************
 * FILTER CONFIGURATION - Modify these values to filter emails
 *
 * Set any filter to null or empty string to skip that filter.
 * All specified filters must match for an email to be processed.
 ******************************************************************************/
const FILTER_CONFIG = {
  // Filter by sender email address (case-insensitive, partial match)
  // Example: "noreply@example.com" or "example.com"
  fromPattern: null,

  // Filter by subject line (case-insensitive, partial match)
  // Example: "Invoice" or "Monthly Report"
  subjectPattern: null,

  // Filter by body text (case-insensitive, partial match)
  // Example: "attached" or "please find"
  bodyPattern: null,
};

// Output folder is controlled by -o/--output-folder (defaults to current working directory).

/*******************************************************************************
 * END OF CONFIGURATION
 ******************************************************************************/

/**
 * Check if email matches all specified filter criteria.
 */
function matchesFilters(headersPart, subject, body) {
  const from = Array.isArray(headersPart.from)
    ? headersPart.from.join(' ')
    : (headersPart.from || '');

  // Check fromPattern
  if (FILTER_CONFIG.fromPattern) {
    if (!from.toLowerCase().includes(FILTER_CONFIG.fromPattern.toLowerCase())) {
      return false;
    }
  }

  // Check subjectPattern
  if (FILTER_CONFIG.subjectPattern) {
    if (!subject.toLowerCase().includes(FILTER_CONFIG.subjectPattern.toLowerCase())) {
      return false;
    }
  }

  // Check bodyPattern
  if (FILTER_CONFIG.bodyPattern) {
    if (!body.toLowerCase().includes(FILTER_CONFIG.bodyPattern.toLowerCase())) {
      return false;
    }
  }

  return true;
}

/**
 * Recursively find all attachment parts in the email structure.
 */
function findAttachments(parts, attachments = []) {
  if (!parts) return attachments;

  const partList = Array.isArray(parts) ? parts : [parts];

  for (const part of partList) {
    // Check if this part is an attachment or inline with filename
    const disposition = part.disposition;
    const dispositionType = disposition && disposition.type
      ? disposition.type.toLowerCase()
      : '';
    const hasDispositionFilename = Boolean(
      disposition && disposition.params && disposition.params.filename
    );
    const hasPartName = Boolean(part.params && (part.params.name || part.params.filename));
    const isApplication = part.type && part.type.toLowerCase() === 'application';

    if (dispositionType === 'attachment') {
      attachments.push(part);
    } else if (hasDispositionFilename || hasPartName) {
      attachments.push(part);
    } else if (dispositionType === 'inline' && (hasDispositionFilename || isApplication)) {
      attachments.push(part);
    } else if (isApplication && part.subtype && part.size) {
      attachments.push(part);
    }

    // Recurse into nested parts
    if (part.parts) {
      findAttachments(part.parts, attachments);
    }
  }

  return attachments;
}

/**
 * Sanitize filename to remove illegal characters.
 */
function sanitizeFilename(filename) {
  // Replace illegal characters with underscore
  return filename.replace(/[\/\\:*?"<>|]/g, '_');
}

function normalizePartBody(partBody) {
  if (Buffer.isBuffer(partBody)) return partBody.toString('utf8');
  if (typeof partBody === 'string') return partBody;
  if (Array.isArray(partBody)) return partBody.join('\n');
  return String(partBody || '');
}

function getRawMessagePart(msg) {
  if (!msg || !Array.isArray(msg.parts)) return null;
  return msg.parts.find(part => part.which === '' || part.which === 'RFC822' || part.which === 'BODY[]') || null;
}

async function getParsedAttachments(msg) {
  const rawPart = getRawMessagePart(msg);
  if (!rawPart) return [];

  try {
    const rawText = normalizePartBody(rawPart.body);
    if (!rawText.trim()) return [];
    const parsed = await simpleParser(rawText);
    return Array.isArray(parsed.attachments) ? parsed.attachments : [];
  } catch (err) {
    console.error('Error parsing message attachments:', err);
    return [];
  }
}

function getAttachmentFilename(attachment) {
  let filename = 'attachment';
  if (attachment.disposition && attachment.disposition.params && attachment.disposition.params.filename) {
    filename = attachment.disposition.params.filename;
  } else if (attachment.params && attachment.params.name) {
    filename = attachment.params.name;
  } else if (attachment.params && attachment.params.filename) {
    filename = attachment.params.filename;
  } else if (attachment.subtype) {
    filename = `attachment.${attachment.subtype.toLowerCase()}`;
  }

  return sanitizeFilename(filename);
}

function resolveOutputBase(outputOptions) {
  if (outputOptions && outputOptions.type === 'file') {
    return { type: 'file', path: outputOptions.path };
  }
  if (outputOptions && outputOptions.type === 'directory') {
    return { type: 'directory', path: outputOptions.path };
  }
  return { type: 'directory', path: process.cwd() };
}

function buildAttachmentTargets(attachmentEntries, outputBase) {

  if (outputBase.type === 'file') {
    const baseFilePath = outputBase.path;
    const baseDir = path.dirname(baseFilePath);
    const baseFileName = path.basename(baseFilePath);
    const baseExt = path.extname(baseFilePath).toLowerCase();

    if (attachmentEntries.length > 1) {
      const sorted = attachmentEntries.sort((a, b) => a.filename.localeCompare(b.filename, undefined, { sensitivity: 'base' }));
      return sorted.map((entry, index) => {
        const attachmentExt = path.extname(entry.filename).toLowerCase();
        const extMatches = Boolean(attachmentExt) && attachmentExt === baseExt;
        let targetName = `${index + 1}_${baseFileName}`;
        if (!extMatches && attachmentExt) {
          targetName += attachmentExt;
        }
        return {
          attachment: entry.attachment,
          targetPath: path.join(baseDir, targetName)
        };
      });
    }

    const entry = attachmentEntries[0];
    const attachmentExt = path.extname(entry.filename).toLowerCase();
    const extMatches = Boolean(attachmentExt) && attachmentExt === baseExt;
    const targetPath = extMatches || !attachmentExt
      ? baseFilePath
      : `${baseFilePath}${attachmentExt}`;

    return [{ attachment: entry.attachment, targetPath }];
  }

  return attachmentEntries.map(entry => ({
    attachment: entry.attachment,
    targetPath: path.join(outputBase.path, entry.filename)
  }));
}

/**
 * Main task function - called for each email.
 */
export default async function downloadAttachmentsTask(
  headersPart,
  subject,
  body,
  setVal,
  outputToTerminal,
  context
) {
  const { connection, msg, outputOptions } = context;

  // Check if email matches filter criteria
  if (!matchesFilters(headersPart, subject, body)) {
    return;
  }

  // Find attachments in the email structure
  const struct = msg.attributes.struct;
  const structAttachments = findAttachments(struct);
  const parsedAttachments = structAttachments.length === 0
    ? await getParsedAttachments(msg)
    : [];

  const attachmentEntries = parsedAttachments.length > 0
    ? parsedAttachments.map(attachment => ({
        attachment,
        filename: sanitizeFilename(attachment.filename || 'attachment'),
        isParsed: true
      }))
    : structAttachments.map(attachment => ({
        attachment,
        filename: getAttachmentFilename(attachment),
        isParsed: false
      }));

  if (attachmentEntries.length === 0) {
    return;
  }

  // Output email info
  outputToTerminal('subject', subject, 0);
  const from = Array.isArray(headersPart.from)
    ? headersPart.from.join(', ')
    : headersPart.from;
  outputToTerminal('from', from, 1);
  console.log(`  Found ${attachmentEntries.length} attachment(s)`);

  const outputBase = resolveOutputBase(outputOptions);
  const attachmentTargets = buildAttachmentTargets(attachmentEntries, outputBase);

  const outputDir = outputBase.type === 'file'
    ? path.dirname(outputBase.path)
    : outputBase.path;
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Download each attachment
  for (const { attachment, targetPath } of attachmentTargets) {
    try {
      if (fs.existsSync(targetPath)) {
        console.log(`  Skipping existing file: ${targetPath}`);
        continue;
      }

      let partData = null;
      if (attachment.content) {
        partData = attachment.content;
      } else {
        partData = await connection.getPartData(msg, attachment);
      }

      if (!partData) {
        console.log(`  Skipping empty attachment for: ${path.basename(targetPath)}`);
        continue;
      }

      // Write to file
      if (Buffer.isBuffer(partData)) {
        fs.writeFileSync(targetPath, partData);
      } else {
        fs.writeFileSync(targetPath, partData, 'binary');
      }

      console.log(`  Downloaded: ${path.basename(targetPath)}`);
    } catch (err) {
      console.error(`  Error downloading attachment:`, err.message);
    }
  }
}
