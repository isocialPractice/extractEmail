// Parse utilities: HTML sanitization, HTML-to-JSON, message-part traversal,
// attachment summaries, and body normalization. All functions are pure.

import { simpleParser } from 'mailparser';
import { convert as htmlToText } from 'html-to-text';
import { parseDocument } from 'htmlparser2';
export const sanitizeHtml = (htmlContent) => {
  if (!htmlContent) return htmlContent;
  const text = String(htmlContent);

  // Use html-to-text with options that respect basic HTML formatting
  const sanitized = htmlToText(text, {
    wordwrap: false,
    preserveNewlines: true,
    selectors: [
      { selector: 'p', options: { leadingLineBreaks: 1, trailingLineBreaks: 1 } },
      { selector: 'div', options: { leadingLineBreaks: 1, trailingLineBreaks: 1 } },
      { selector: 'br', options: { leadingLineBreaks: 1 } },
      { selector: 'h1', options: { uppercase: false, leadingLineBreaks: 2, trailingLineBreaks: 2 } },
      { selector: 'h2', options: { uppercase: false, leadingLineBreaks: 2, trailingLineBreaks: 2 } },
      { selector: 'h3', options: { uppercase: false, leadingLineBreaks: 2, trailingLineBreaks: 1 } },
      {
        selector: 'table',
        format: 'dataTable'
      },
      { selector: 'a', options: { ignoreHref: true } }
    ],
    formatters: {
      // Custom table formatter with pipe delimiters
      // Converts HTML tables to pipe-delimited format: | cell | cell |
      // Example output:
      // | Field | Response |
      // | Name | John Doe |
      'dataTable': function (elem, walk, builder, formatOptions) {
        builder.openBlock({ leadingLineBreaks: 1 });

        const rows = [];

        // Helper to extract text from a cell
        const getCellText = (cell) => {
          let text = '';
          const extractText = (node) => {
            if (!node) return;
            if (node.type === 'text') {
              text += node.data;
            } else if (node.children) {
              node.children.forEach(extractText);
            }
          };
          if (cell.children) {
            cell.children.forEach(extractText);
          }
          return text.replace(/\s+/g, ' ').trim();
        };

        // Process all rows
        const processRows = (node) => {
          if (!node) return;

          if (node.name === 'tr') {
            const cells = [];
            if (node.children) {
              node.children.forEach(child => {
                if (child.name === 'td' || child.name === 'th') {
                  cells.push(getCellText(child));
                }
              });
            }
            if (cells.length > 0) {
              rows.push('| ' + cells.join(' | ') + ' |');
            }
          } else if (node.children) {
            node.children.forEach(processRows);
          }
        };

        processRows(elem);

        if (rows.length > 0) {
          builder.addInline(rows.join('\n'));
        }

        builder.closeBlock({ trailingLineBreaks: 1 });
      }
    }
  });

  return sanitized;
};

// Parse HTML to hierarchical JSON preserving DOM structure.
// Uses htmlparser2 for proper DOM parsing instead of regex.
export const parseHtmlToHierarchicalJson = (htmlContent) => {
  if (!htmlContent) return {};

  const doc = parseDocument(htmlContent);

  const SKIP_TAGS = new Set(['style', 'script', 'head', 'meta', 'link', 'noscript']);
  const TRANSPARENT_TAGS = new Set(['html', 'body', 'tbody', 'thead', 'tfoot']);
  const VOID_TAGS = new Set(['img', 'br', 'hr', 'input', 'wbr', 'col', 'area', 'base', 'embed', 'source', 'track']);

  /** Get all text content recursively from a node. */
  function getTextContent(node) {
    if (node.type === 'text') return (node.data || '').replace(/\u00a0/g, ' ');
    if (!node.children) return '';
    return node.children.map(getTextContent).join('');
  }

  /** Extract table as array of row arrays. */
  function processTable(tableNode) {
    const rows = [];
    function findRows(node) {
      if (!node.children) return;
      for (const child of node.children) {
        if (child.type === 'tag' && child.name === 'tr') {
          const cells = [];
          for (const cell of (child.children || [])) {
            if (cell.type === 'tag' && (cell.name === 'td' || cell.name === 'th')) {
              cells.push(getTextContent(cell).trim());
            }
          }
          if (cells.length > 0) rows.push(cells);
        } else if (child.type === 'tag') {
          findRows(child);
        }
      }
    }
    findRows(tableNode);
    return rows;
  }

  /** Add value to result object, converting to array for duplicate keys. */
  function addToResult(obj, key, value) {
    if (key in obj) {
      if (Array.isArray(obj[key]) && !Array.isArray(value)) {
        obj[key].push(value);
      } else {
        obj[key] = [obj[key], value];
      }
    } else {
      obj[key] = value;
    }
  }

  /** Get meaningful children (non-empty text or non-skip/void tags). */
  function getMeaningfulChildren(node) {
    return (node.children || []).filter(c => {
      if (c.type === 'text') return (c.data || '').trim().length > 0;
      if (c.type === 'tag') return !SKIP_TAGS.has(c.name) && !VOID_TAGS.has(c.name);
      return false;
    });
  }

  /**
   * Collapse single-child wrappers to the deepest meaningful tag.
   * e.g. <div><p><span>text</span></p></div> → { tag: 'span', node: spanNode }
   */
  function collapseWrappers(node) {
    const meaningful = getMeaningfulChildren(node);
    if (meaningful.length === 1 && meaningful[0].type === 'tag') {
      const child = meaningful[0];
      if (child.name === 'table') return { tag: 'table', node: child };
      if (TRANSPARENT_TAGS.has(child.name)) return collapseWrappers(child);
      // If this child also has a single element child, keep collapsing
      const grandchildren = getMeaningfulChildren(child);
      if (grandchildren.length === 1 && grandchildren[0].type === 'tag') {
        return collapseWrappers(child);
      }
      return { tag: child.name, node: child };
    }
    return { tag: node.name || 'root', node };
  }

  /** Process children of a node into a result object. */
  function processChildren(children) {
    const result = {};
    let pendingText = '';

    for (const child of children) {
      if (child.type === 'text') {
        const text = (child.data || '').replace(/\u00a0/g, ' ').trim();
        if (text) {
          pendingText += (pendingText ? ' ' : '') + text;
        }
        continue;
      }

      if (child.type !== 'tag') continue;
      if (SKIP_TAGS.has(child.name)) continue;
      if (VOID_TAGS.has(child.name)) continue;

      // Flush pending text before a tag element
      if (pendingText) {
        addToResult(result, 'tag-data', pendingText);
        pendingText = '';
      }

      // Table → extract as row arrays
      if (child.name === 'table') {
        addToResult(result, 'table', processTable(child));
        continue;
      }

      // Transparent containers → merge children into current level
      if (TRANSPARENT_TAGS.has(child.name)) {
        const inner = processChildren(child.children || []);
        for (const [k, v] of Object.entries(inner)) {
          addToResult(result, k, v);
        }
        continue;
      }

      // Regular element → collapse single-child wrappers then process
      const { tag, node: deepNode } = collapseWrappers(child);

      if (tag === 'table') {
        addToResult(result, 'table', processTable(deepNode));
        continue;
      }

      const childResult = processElement(deepNode);
      if (childResult !== null) {
        addToResult(result, tag, childResult);
      }
    }

    // Flush remaining text
    if (pendingText) {
      addToResult(result, 'tag-data', pendingText);
    }

    return result;
  }

  /** Process a single element node, returning its value. */
  function processElement(node) {
    const meaningful = getMeaningfulChildren(node);

    // Leaf node or all-text children → return text content
    if (meaningful.length === 0 || meaningful.every(c => c.type === 'text')) {
      const text = getTextContent(node).trim();
      return text || null;
    }

    // Mixed or element children → recurse
    return processChildren(node.children || []);
  }

  // Process from document root
  const result = processChildren(doc.children || []);

  // Unwrap single top-level key that maps to an object (e.g. lone <html> wrapper)
  const keys = Object.keys(result);
  if (keys.length === 1 && typeof result[keys[0]] === 'object' && !Array.isArray(result[keys[0]])) {
    return result[keys[0]];
  }

  return result;
};

// Parse HTML tables to columnar JSON format
export const parseHtmlTablesToColumnarJson = (htmlContent) => {
  if (!htmlContent) return {};

  // Find all tables in the HTML
  const tableRegex = /<table[^>]*>(.*?)<\/table>/gis;
  const tables = [];
  let match;

  while ((match = tableRegex.exec(htmlContent)) !== null) {
    tables.push(match[1]);
  }

  if (tables.length === 0) {
    // No tables found, return empty object
    return {};
  }

  const result = {};

  // Process each table (if multiple tables, merge columns)
  tables.forEach((tableHtml, tableIndex) => {
    const rowRegex = /<tr[^>]*>(.*?)<\/tr>/gis;
    const rows = [];
    let rowMatch;

    while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
      rows.push(rowMatch[1]);
    }

    if (rows.length === 0) return;

    // Extract cells from each row
    const cellRegex = /<(th|td)[^>]*>(.*?)<\/\1>/gis;
    const parsedRows = rows.map(row => {
      const cells = [];
      let cellMatch;
      // Reset regex for each row
      const rowCellRegex = /<(th|td)[^>]*>(.*?)<\/\1>/gis;
      while ((cellMatch = rowCellRegex.exec(row)) !== null) {
        // Remove HTML tags and decode entities
        let cellText = cellMatch[2]
          .replace(/<[^>]+>/g, '') // Remove HTML tags
          .replace(/&nbsp;/g, ' ') // Replace &nbsp; with space
          .replace(/&amp;/g, '&')  // Replace &amp; with &
          .replace(/&lt;/g, '<')   // Replace &lt; with <
          .replace(/&gt;/g, '>')   // Replace &gt; with >
          .replace(/&quot;/g, '"') // Replace &quot; with "
          .replace(/&#39;/g, "'")  // Replace &#39; with '
          .replace(/\r\n/g, ' ')   // Replace CRLF with space
          .replace(/\n/g, ' ')     // Replace LF with space
          .replace(/\s+/g, ' ')    // Collapse multiple spaces
          .trim();
        cells.push(cellText);
      }
      return cells;
    });

    if (parsedRows.length === 0) return;

    // Use first row as headers (whether th or td)
    const headers = parsedRows[0];
    if (!headers || headers.length === 0) return;

    // Initialize columns if not already present (for multiple tables)
    headers.forEach(header => {
      if (!result[header]) {
        result[header] = [];
      }
    });

    // Add data rows (skip first row which contains headers)
    for (let i = 1; i < parsedRows.length; i++) {
      const row = parsedRows[i];
      headers.forEach((header, colIndex) => {
        result[header].push(row[colIndex] || '');
      });
    }
  });

  return result;
};


export const hasBodyContent = (body) => {
  if (!body) return false;
  if (typeof body === 'string') return body.trim().length > 0;
  if (typeof body === 'object') return Object.keys(body).length > 0;
  return true;
};

export const findTextPart = (parts) => {
  for (const part of parts) {
    if (Array.isArray(part)) {
      const nested = findTextPart(part);
      if (nested) return nested;
      continue;
    }
    if (part.type === 'text' && part.subtype === 'plain') {
      return part;
    }
    if (part.parts) {
      const nested = findTextPart(part.parts);
      if (nested) return nested;
    }
  }
  return null;
};

export const findHtmlPart = (parts) => {
  for (const part of parts) {
    if (Array.isArray(part)) {
      const nested = findHtmlPart(part);
      if (nested) return nested;
      continue;
    }
    if (part.type === 'text' && part.subtype === 'html') {
      return part;
    }
    if (part.parts) {
      const nested = findHtmlPart(part.parts);
      if (nested) return nested;
    }
  }
  return null;
};

export const findAttachmentsInStruct = (parts, attachments = []) => {
  if (!parts) return attachments;

  const partList = Array.isArray(parts) ? parts : [parts];
  for (const part of partList) {
    if (Array.isArray(part)) {
      findAttachmentsInStruct(part, attachments);
      continue;
    }

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
    } else if (isApplication && part.subtype) {
      attachments.push(part);
    }

    if (part.parts) {
      findAttachmentsInStruct(part.parts, attachments);
    }
  }

  return attachments;
};

export const getAttachmentFilename = (attachment) => {
  if (attachment.disposition && attachment.disposition.params && attachment.disposition.params.filename) {
    return attachment.disposition.params.filename;
  }
  if (attachment.params && attachment.params.name) {
    return attachment.params.name;
  }
  if (attachment.params && attachment.params.filename) {
    return attachment.params.filename;
  }
  if (attachment.subtype) {
    return `attachment.${attachment.subtype.toLowerCase()}`;
  }
  return 'attachment';
};

export const getAttachmentSummary = (struct) => {
  const attachments = findAttachmentsInStruct(struct);
  if (!attachments.length) return false;
  const names = attachments.map(getAttachmentFilename).filter(Boolean);
  if (!names.length) return true;
  return names.length === 1 ? names[0] : names.join(', ');
};

export const getRawMessagePart = (msg) => {
  if (!msg || !Array.isArray(msg.parts)) return null;
  return msg.parts.find(part => part.which === '' || part.which === 'RFC822' || part.which === 'BODY[]') || null;
};

export const getAttachmentSummaryFromMessage = async (msg, connection = null) => {
  const struct = msg && msg.attributes ? msg.attributes.struct : null;
  const structSummary = getAttachmentSummary(struct);
  if (structSummary) return structSummary;

  // Try pre-fetched raw message part first
  let rawPart = getRawMessagePart(msg);

  // If no raw part available and we have a connection, re-fetch the full message
  if (!rawPart && connection && msg.attributes && msg.attributes.uid) {
    try {
      const uid = msg.attributes.uid;
      const refetch = await connection.search([['UID', uid]], { bodies: [''], struct: false });
      if (refetch && refetch.length > 0) {
        rawPart = getRawMessagePart(refetch[0]);
      }
    } catch (err) {
      // Silently fall through — struct-based detection is the primary method
    }
  }

  if (!rawPart) return false;

  try {
    const rawText = normalizePartBody(rawPart.body);
    if (!rawText.trim()) return false;
    const parsed = await simpleParser(rawText);
    if (!parsed.attachments || parsed.attachments.length === 0) return false;
    const names = parsed.attachments
      .map(attachment => attachment.filename)
      .filter(Boolean);
    if (!names.length) return true;
    return names.length === 1 ? names[0] : names.join(', ');
  } catch (err) {
    console.error('Error parsing message attachments:', err);
    return false;
  }
};

export const normalizePartBody = (partBody) => {
  if (Buffer.isBuffer(partBody)) return partBody.toString('utf8');
  if (typeof partBody === 'string') return partBody;
  if (Array.isArray(partBody)) return partBody.join('\n');
  return String(partBody || '');
};

// Recursively find plain text body from message parts
export const getPlainTextBody = async (message) => {
  try {
    const rawText = message.parts
      .filter(part => typeof part.which === 'string')
      .filter(part => part.which === 'TEXT' || part.which === 'BODY[]' || part.which.startsWith('TEXT') || part.which.startsWith('BODY'))
      .map(part => normalizePartBody(part.body))
      .filter(text => text && text.trim())
      .join('\n');

    if (!rawText.trim()) return '';

    const parsed = await simpleParser(rawText);
    return parsed.text || parsed.html || '';
  } catch (err) {
    console.error('Error parsing message body:', err);
    return '';
  }
};
