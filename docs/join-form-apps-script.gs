/**
 * Evandale Panthers – Join form receiver
 * ------------------------------------------------------------
 * IMPORTANT: use a SEPARATE, PRIVATE Google Sheet for sign-ups (e.g.
 * "Panthers sign-ups"), not the website content sheet. The content sheet
 * is shared by link, so anything in it can be seen by anyone with the link.
 *
 * Paste this into the private sign-ups sheet: Extensions → Apps Script.
 * Then Deploy → New deployment → type "Web app":
 *   Execute as: Me
 *   Who has access: Anyone
 * Copy the web app URL (ends in /exec) into Vercel as JOIN_WEBHOOK_URL.
 *
 * Set SECRET below to the same text as JOIN_WEBHOOK_SECRET in Vercel,
 * and NOTIFY_EMAIL to whoever should hear about new sign-ups.
 */

const SECRET = 'change-me-to-a-long-random-phrase';
const NOTIFY_EMAIL = 'club-secretary@example.com';
const TAB_NAME = 'Join requests';

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    if (data.secret !== SECRET) return reply({ ok: false, error: 'bad secret' });

    const sheet = getTab_();
    sheet.appendRow([
      new Date(),
      data.name || '',
      data.email || '',
      data.phone || '',
      (data.interests || []).join(', '),
      data.message || '',
      'New',
    ]);

    if (NOTIFY_EMAIL && NOTIFY_EMAIL.indexOf('@example.com') === -1) {
      MailApp.sendEmail({
        to: NOTIFY_EMAIL,
        replyTo: data.email,
        subject: 'New Panthers sign-up: ' + data.name,
        body:
          'Someone wants to join the Panthers.\n\n' +
          'Name: ' + data.name + '\n' +
          'Email: ' + data.email + '\n' +
          'Phone: ' + (data.phone || '-') + '\n' +
          'Interested in: ' + ((data.interests || []).join(', ') || '-') + '\n\n' +
          (data.message || '') + '\n\n' +
          'All sign-ups are in the "' + TAB_NAME + '" tab of the club sheet.',
      });
    }
    return reply({ ok: true });
  } catch (err) {
    return reply({ ok: false, error: String(err) });
  }
}

function getTab_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(TAB_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(TAB_NAME);
    sheet.appendRow(['Received', 'Name', 'Email', 'Phone', 'Interested in', 'Message', 'Status']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function reply(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
