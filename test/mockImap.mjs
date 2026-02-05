// test/mockImap.mjs
// Mock IMAP connection for testing without real email credentials.

/**
 * Sample test emails with various scenarios.
 */
export const testEmails = [
  {
    attributes: {
      uid: 1,
      struct: [
        { type: 'text', subtype: 'plain', partID: '1' }
      ]
    },
    parts: [
      {
        which: 'HEADER.FIELDS (FROM TO SUBJECT DATE)',
        body: {
          from: ['sender1@example.com'],
          to: ['recipient@test.com'],
          subject: ['Welcome to the service'],
          date: ['Mon, 01 Jan 2024 10:00:00 +0000']
        }
      }
    ],
    bodyText: 'Thank you for signing up! Your account is now active.'
  },
  {
    attributes: {
      uid: 2,
      struct: [
        { type: 'text', subtype: 'plain', partID: '1' }
      ]
    },
    parts: [
      {
        which: 'HEADER.FIELDS (FROM TO SUBJECT DATE)',
        body: {
          from: ['noreply@company.com'],
          to: ['recipient@test.com'],
          subject: ['Monthly Report - January 2024'],
          date: ['Tue, 15 Jan 2024 09:30:00 +0000']
        }
      }
    ],
    bodyText: 'Please find attached the monthly report for January 2024.'
  },
  {
    attributes: {
      uid: 3,
      struct: [
        { type: 'text', subtype: 'plain', partID: '1' }
      ]
    },
    parts: [
      {
        which: 'HEADER.FIELDS (FROM TO SUBJECT DATE)',
        body: {
          from: ['user@messaging.com'],
          to: ['recipient@test.com'],
          subject: ['STOP'],
          date: ['Wed, 20 Jan 2024 14:22:00 +0000']
        }
      }
    ],
    bodyText: 'Please remove me from the messaging list.'
  },
  {
    attributes: {
      uid: 4,
      struct: [
        {
          type: 'multipart',
          subtype: 'mixed',
          parts: [
            { type: 'text', subtype: 'plain', partID: '1' },
            {
              type: 'application',
              subtype: 'pdf',
              partID: '2',
              disposition: { type: 'attachment', params: { filename: 'invoice.pdf' } },
              params: { name: 'invoice.pdf' }
            }
          ]
        }
      ]
    },
    parts: [
      {
        which: 'HEADER.FIELDS (FROM TO SUBJECT DATE)',
        body: {
          from: ['billing@invoices.com'],
          to: ['recipient@test.com'],
          subject: ['Invoice #12345'],
          date: ['Thu, 25 Jan 2024 08:00:00 +0000']
        }
      }
    ],
    bodyText: 'Please find attached your invoice for this month.',
    rawEmail: [
      'From: billing@invoices.com',
      'To: recipient@test.com',
      'Subject: Invoice #12345',
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="BOUNDARY"',
      '',
      '--BOUNDARY',
      'Content-Type: text/plain; charset="utf-8"',
      '',
      'Please find attached your invoice for this month.',
      '--BOUNDARY',
      'Content-Type: application/pdf; name="invoice.pdf"',
      'Content-Disposition: attachment; filename="invoice.pdf"',
      'Content-Transfer-Encoding: base64',
      '',
      'JVBERi0xLjQK',
      '--BOUNDARY--',
      ''
    ].join('\r\n'),
    attachments: {
      '2': Buffer.from('Mock PDF content for testing')
    }
  },
  {
    attributes: {
      uid: 5,
      struct: [
        { type: 'text', subtype: 'plain', partID: '1' }
      ]
    },
    parts: [
      {
        which: 'HEADER.FIELDS (FROM TO SUBJECT DATE)',
        body: {
          from: ['support@helpdesk.com'],
          to: ['recipient@test.com'],
          subject: ['Re: Your support ticket #789'],
          date: ['Fri, 26 Jan 2024 16:45:00 +0000']
        }
      }
    ],
    bodyText: 'Your issue has been resolved. Please let us know if you need further assistance.'
  }
];

/**
 * Mock IMAP connection that simulates imap-simple interface.
 */
class MockConnection {
  constructor(emails = testEmails) {
    this.emails = emails;
    this.isOpen = false;
    this.boxName = null;
  }

  async openBox(boxName) {
    this.boxName = boxName;
    this.isOpen = true;
    return { name: boxName, messages: { total: this.emails.length } };
  }

  async search(searchCriteria, fetchOptions) {
    // Return all mock emails
    return this.emails.map(email => ({
      attributes: email.attributes,
      parts: [
        ...email.parts,
        { which: 'TEXT', body: email.bodyText || '' },
        { which: '', body: email.rawEmail || email.bodyText || '' }
      ]
    }));
  }

  async getPartData(msg, part) {
    // Find the original email with body/attachment data
    const email = this.emails.find(e => e.attributes.uid === msg.attributes.uid);
    if (!email) return '';

    // Check if requesting attachment
    if (part.partID && email.attachments && email.attachments[part.partID]) {
      return email.attachments[part.partID];
    }

    // Return body text
    return email.bodyText || '';
  }

  async end() {
    this.isOpen = false;
  }
}

/**
 * Mock imap-simple module interface.
 */
export const mockImaps = {
  async connect(config) {
    // Simulate connection delay
    await new Promise(resolve => setTimeout(resolve, 10));
    return new MockConnection();
  }
};

/**
 * Create a mock connection with custom test emails.
 */
export function createMockConnection(customEmails) {
  return {
    async connect(config) {
      await new Promise(resolve => setTimeout(resolve, 10));
      return new MockConnection(customEmails || testEmails);
    }
  };
}
