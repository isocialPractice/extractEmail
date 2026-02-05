// accounts/example.mjs
// Example account configuration file.
// Copy this file and rename to your account name (e.g., work.mjs, personal.mjs).
// Fill in your IMAP credentials below.

export const configEmail = {
  imap: {
    user: 'user@site.com',        // Your email address
    password: 'passwd',           // Your email password or app password
    host: 'protocol.server.tld',  // IMAP server (e.g., imap.gmail.com)
    port: 993,
    tls: true,
    authTimeout: 3000,
    tlsOptions: { rejectUnauthorized: false }
  }
};
