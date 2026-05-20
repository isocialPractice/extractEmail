// IMAP folder utilities — pure helpers for resolving and operating on IMAP folder paths.

/**
 * Flatten all IMAP boxes into an array of { name, fullPath, attribs }.
 */
export function collectAllFolders(boxes: any, prefix = '', delimiter = '/'): any[] {
  const result: any[] = [];
  for (const [boxName, box] of Object.entries<any>(boxes || {})) {
    const sep = (box && box.delimiter) || delimiter;
    const fullPath = prefix ? `${prefix}${sep}${boxName}` : boxName;
    result.push({ name: boxName, fullPath, attribs: (box && box.attribs) || [] });
    if (box && box.children) {
      result.push(...collectAllFolders(box.children, fullPath, sep));
    }
  }
  return result;
}

// Maps common shorthand folder names to their RFC 6154 IMAP special-use flag.
export const FOLDER_SPECIAL_USE: Record<string, string> = {
  'sent':      '\\Sent',
  'drafts':    '\\Drafts',
  'draft':     '\\Drafts',
  'trash':     '\\Trash',
  'deleted':   '\\Trash',
  'junk':      '\\Junk',
  'spam':      '\\Junk',
  'archive':   '\\Archive',
  'flagged':   '\\Flagged',
  'starred':   '\\Flagged',
  'all':       '\\All',
  'allmail':   '\\All',
  'important': '\\Important',
};

/**
 * Search IMAP boxes for a folder matching targetName using three-pass priority:
 *   1. Exact name match (case-insensitive).
 *   2. IMAP special-use attribute match (e.g. "Sent" → \Sent flag, finds "[Gmail]/Sent Mail").
 *   3. Partial contains match (e.g. "Sent" matches "Sent Items", "Sent Mail").
 * Returns the full IMAP path needed for openBox / moveMessage, or null if not found.
 */
export function findFolderPath(boxes: any, targetName: string): string | null {
  const folders = collectAllFolders(boxes);
  const nameLower = targetName.toLowerCase();

  // Pass 1: exact name match
  const exact = folders.find(f => f.name.toLowerCase() === nameLower);
  if (exact) return exact.fullPath;

  // Pass 2: IMAP special-use attribute match (RFC 6154)
  const specialFlag = FOLDER_SPECIAL_USE[nameLower];
  if (specialFlag) {
    const byAttr = folders.find(f =>
      f.attribs.some((a: string) => a.toLowerCase() === specialFlag.toLowerCase())
    );
    if (byAttr) return byAttr.fullPath;
  }

  // Pass 3: partial contains match (case-insensitive)
  const partial = folders.find(f => f.name.toLowerCase().includes(nameLower));
  if (partial) return partial.fullPath;

  return null;
}

/**
 * Move an email (by UID) to a destination folder using the IMAP connection.
 * Supports both imap-simple's moveMessage() and raw node-imap connection.imap.move().
 */
export async function moveEmailToFolder(connection: any, uid: number | string, folderPath: string): Promise<void> {
  if (typeof connection.moveMessage === 'function') {
    return connection.moveMessage(uid, folderPath);
  }
  if (connection.imap && typeof connection.imap.move === 'function') {
    return new Promise<void>((resolve, reject) => {
      connection.imap.move(uid, folderPath, (err: any) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
  throw new Error('Move operation not supported by current IMAP connection');
}
