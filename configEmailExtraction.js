// configEmailExtraction.js
// Configuration for extractEmil.

export const configEmail = {
  imap: {
    user: 'user@site.com',        // CHANGE per project
    password: 'passwd',           // CHANGE per project
    host: 'protocol.server.tld',  // CHANGE per project
    port: 993,
    tls: true,
    authTimeout: 3000,
    tlsOptions: { rejectUnauthorized: false }
  }
};
