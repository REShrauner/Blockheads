// End-to-end UI smoke test for the Blockheads app, run against a mocked
// Supabase client (test/mock-supabase.js) so it needs no real backend.
// Usage: node test/run.js   (run from the blockheads-app directory)
const path = require('path');
const fs = require('fs');
const os = require('os');
const { chromium } = require('playwright');

const PAGE_URL = 'file://' + path.join(__dirname, 'index.test.html');

const results = [];
let pass = 0, fail = 0;

function check(name, condition, detail) {
  if (condition) {
    pass++;
    results.push(`  PASS  ${name}`);
  } else {
    fail++;
    results.push(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`);
  }
}

// Builds an uncompressed-ish PNG (gradient + noise) so the test has a large
// photo to upload without needing any image files checked in.
function makeNoisyPng(w, h) {
  const zlib = require('zlib');
  const raw = Buffer.alloc((w * 3 + 1) * h);
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0;
    for (let x = 0; x < w; x++) {
      raw[o++] = (x * 255 / w + Math.random() * 40) & 255;
      raw[o++] = (y * 255 / h + Math.random() * 40) & 255;
      raw[o++] = (Math.random() * 60 + 100) & 255;
    }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    // This sandbox has no route to Google Fonts; that network failure is an
    // artifact of the test environment, not the app, so it's not a failure.
    if (/fonts\.(googleapis|gstatic)\.com/.test(text) || /ERR_TUNNEL_CONNECTION_FAILED/.test(text)) return;
    consoleErrors.push(text);
  });
  page.on('pageerror', (err) => consoleErrors.push('pageerror: ' + err.message));

  await page.goto(PAGE_URL);
  await page.waitForTimeout(150); // let INITIAL_SESSION fire

  // ---------------------------------------------------------------- gate --
  check('sign-in gate visible on load', await page.isVisible('#sign-in-view'));
  check('app view hidden on load', await page.isHidden('#app-view'));

  // Bad credentials
  await page.fill('#sign-in-email', 'rex@blockheads.test');
  await page.fill('#sign-in-password', 'wrong-password');
  await page.click('#sign-in-form button[type="submit"]');
  await page.waitForTimeout(100);
  check('bad password shows sign-in error', await page.isVisible('#sign-in-error'));

  // ---------------------------------------------------------- member role --
  await page.fill('#sign-in-password', 'memberpass');
  await page.fill('#sign-in-email', 'pat@blockheads.test');
  await page.click('#sign-in-form button[type="submit"]');
  await page.waitForTimeout(150);

  check('member: app view visible after sign-in', await page.isVisible('#app-view'));
  check('member: role badge reads Member', (await page.textContent('#user-role-badge')).trim() === 'Member');
  check('member: Members nav hidden', await page.isHidden('#nav-members'));
  await page.evaluate(() => window.Blockheads.showSection('members'));
  check('member: Members screen cannot be opened', await page.isHidden('#members-section'));
  await page.evaluate(() => window.Blockheads.showSection('calendar'));
  check('member: Add meeting button hidden', await page.isHidden('#add-event-button'));
  // Scheduled Meetings list: three months at a time starting this month.
  // Fixture meetings are 7 and 14 days from today, so both fall in the window.
  const cardText = async () => page.$$eval('#meeting-list .meeting-card', (els) => els.map((e) => e.textContent));
  const shown = await cardText();
  check('member: list shows the upcoming meetings', shown.some((t) => t.includes('HST Workshop')) && shown.some((t) => t.includes('Flying Geese Bee')), `found ${shown.length} cards`);
  const dateOk = await page.$eval('#meeting-list .meeting-card:not(.past) .meeting-date', (el) => /^[A-Z][a-z]+day, [A-Z][a-z]+ \d{1,2}, \d{4}/.test(el.textContent.trim()));
  check('member: dates read like "Saturday, October 3, 2026"', dateOk);
  const pastCards = await page.$$eval('#meeting-list .meeting-card.past', (els) => els.map((e) => e.textContent));
  check('member: any past meeting shown is greyed out', pastCards.every((t) => t.includes('Past Meeting')));
  check('member: no Edit buttons on meetings', (await page.$$('#meeting-list .meeting-edit')).length === 0);
  check('member: three months shown', (await page.$$('#meeting-list .month-group')).length === 3);

  for (let i = 0; i < 3; i++) { await page.click('#calendar-next-month'); await page.waitForTimeout(50); }
  check('member: three clicks forward shows three empty months', (await page.$$('#meeting-list .meeting-list-empty')).length === 3);
  for (let i = 0; i < 3; i++) { await page.click('#calendar-prev-month'); await page.waitForTimeout(50); }
  check('member: arrows come back to the upcoming meetings', (await cardText()).some((t) => t.includes('HST Workshop')));

  await page.click('#nav-projects');
  await page.waitForTimeout(100);
  check('member: Add project button hidden (in projects view)', await page.isHidden('#add-project-button'));
  const memberTiles = await page.$$('#projects-grid .project-tile');
  check('member: sees both projects', memberTiles.length === 2, `found ${memberTiles.length}`);
  check('member: no "add project" tile', (await page.$$('#projects-grid .project-tile-add')).length === 0);

  await memberTiles[0].click();
  await page.waitForTimeout(150);
  check('member: project detail admin actions hidden', await page.isHidden('#project-detail-admin-actions'));
  const memberFileDelete = await page.$$('#project-files-list .file-delete');
  check('member: no delete buttons on files', memberFileDelete.length === 0);
  const memberFileDownload = await page.$$('#project-files-list .file-download');
  check('member: download buttons present', memberFileDownload.length > 0, `found ${memberFileDownload.length}`);

  await page.click('#sign-out-button');
  await page.waitForTimeout(150);
  check('sign-out returns to gate', await page.isVisible('#sign-in-view'));

  // ----------------------------------------------------------- admin role --
  await page.fill('#sign-in-email', 'jane@blockheads.test');
  await page.fill('#sign-in-password', 'adminpass');
  await page.click('#sign-in-form button[type="submit"]');
  await page.waitForTimeout(150);

  check('admin: Members nav visible', await page.isVisible('#nav-members'));
  check('admin: Add meeting button visible', await page.isVisible('#add-event-button'));
  check('admin: Edit button on each meeting', (await page.$$('#meeting-list .meeting-edit')).length === (await page.$$('#meeting-list .meeting-card')).length);
  await page.click('#meeting-list .meeting-card:has-text("HST Workshop") .meeting-edit');
  await page.waitForTimeout(50);
  check('admin: Edit opens the meeting form with its details', (await page.inputValue('#event-title')) === 'HST Workshop' && (await page.inputValue('#event-start-time')) === '10:00');
  await page.click('#cancel-event-button');

  await page.click('#nav-members');
  await page.waitForTimeout(100);
  check('admin: no Make admin/member buttons (superuser-only)', (await page.$$('#members-list .role-change-button')).length === 0);
  check('admin: pending count shows 2', (await page.textContent('#pending-count')).trim() === '2');
  check('admin: no pending badge on Members nav (superuser-only)', await page.isHidden('#nav-members-badge'));
  const pendingRows = await page.$$('#pending-requests-list .request-row');
  check('admin: two pending request rows rendered', pendingRows.length === 2, `found ${pendingRows.length}`);
  const memberRows = await page.$$('#members-list .member-row');
  check('admin: three member rows rendered', memberRows.length === 3, `found ${memberRows.length}`);
  const removeButtons = await page.$$('#members-list .remove-member-button');
  check('admin: cannot remove members (superuser-only)', removeButtons.length === 0);

  // Approve a pending request via the (mocked) Edge Function
  await page.click('#pending-requests-list .request-row:first-child .approve-button');
  await page.waitForTimeout(200);
  check('admin: pending count drops to 1 after approve', (await page.textContent('#pending-count')).trim() === '1');
  const membersAfterApprove = await page.$$('#members-list .member-row');
  check('admin: member count grows to 4 after approve', membersAfterApprove.length === 4, `found ${membersAfterApprove.length}`);

  // Deny the remaining request
  page.once('dialog', (d) => d.accept());
  await page.click('#pending-requests-list .request-row:first-child .deny-button');
  await page.waitForTimeout(200);
  check('admin: pending count drops to 0 after deny', (await page.textContent('#pending-count')).trim() === '0');
  check('admin: empty-state message shown', await page.isVisible('#pending-empty'));

  // Add a project (name only, no icon file) then upload + delete a file on it
  await page.click('#nav-projects');
  await page.waitForTimeout(100);
  check('admin: Add project button visible (in projects view)', await page.isVisible('#add-project-button'));
  await page.click('#add-project-button');
  await page.fill('#project-name', 'Log Cabin');
  await page.fill('#project-description', 'A test project added by the automated check.');
  await page.click('#project-form button[type="submit"]');
  await page.waitForTimeout(150);
  const gridAfterAdd = await page.$$('#projects-grid .project-tile');
  check('admin: project count grows to 3 after add', gridAfterAdd.length === 3, `found ${gridAfterAdd.length}`);

  await gridAfterAdd[gridAfterAdd.length - 1].click();
  await page.waitForTimeout(150);
  check('admin: new project detail shows admin actions', await page.isVisible('#project-detail-admin-actions'));

  const tmpFile = path.join(os.tmpdir(), 'blockheads-test-upload.txt');
  fs.writeFileSync(tmpFile, 'test attachment contents');
  await page.setInputFiles('#attachment-file-input', tmpFile);
  await page.waitForTimeout(200);
  const uploadedRow = await page.$$('#project-files-list .file-row');
  check('admin: uploaded file appears in file list', uploadedRow.length === 1, `found ${uploadedRow.length}`);

  page.once('dialog', (d) => d.accept());
  await page.click('#project-files-list .file-delete');
  await page.waitForTimeout(150);
  check('admin: file removed after delete', await page.isVisible('#project-files-empty'));

  // A big photo uploaded as a file gets shrunk before it is stored
  const bigPng = path.join(os.tmpdir(), 'blockheads-big-photo.png');
  fs.writeFileSync(bigPng, makeNoisyPng(2600, 1800));
  await page.setInputFiles('#attachment-file-input', bigPng);
  await page.waitForTimeout(1500);
  const sizes = await page.evaluate((id) => {
    const out = {};
    window.__mockStorageKeys().filter((k) => k.startsWith(id + '/files/')).forEach((k) => { out[k.split('/').pop()] = window.__mockStorageSize(k); });
    return out;
  }, await page.evaluate(() => window.Blockheads.state.currentProjectId));
  const bigOriginal = fs.statSync(bigPng).size;
  check('admin: uploaded photo stored as JPEG with same name', 'blockheads-big-photo.jpg' in sizes, JSON.stringify(Object.keys(sizes)));
  check('admin: uploaded photo is much smaller than original',
    sizes['blockheads-big-photo.jpg'] > 0 && sizes['blockheads-big-photo.jpg'] < bigOriginal / 2,
    `${sizes['blockheads-big-photo.jpg']} vs ${bigOriginal}`);

  // Edit the project from its detail page
  check('admin: Edit button visible on project page', await page.isVisible('#edit-project-button'));
  check('admin: Delete button visible on project page', await page.isVisible('#delete-project-detail-button'));
  await page.click('#edit-project-button');
  await page.waitForTimeout(100);
  check('admin: edit dialog opens with current name', (await page.inputValue('#project-name')) === 'Log Cabin');
  check('admin: edit dialog title says Edit', (await page.textContent('#project-form-title')) === 'Edit project');
  await page.fill('#project-name', 'Log Cabin Revised');
  await page.click('#project-form button[type="submit"]');
  await page.waitForTimeout(200);
  check('admin: project page shows edited name', (await page.textContent('#project-detail-name')) === 'Log Cabin Revised');

  // Upload a file, then delete the whole project from its page
  await page.setInputFiles('#attachment-file-input', tmpFile);
  await page.waitForTimeout(200);
  const deletedId = await page.evaluate(() => window.Blockheads.state.currentProjectId);
  page.once('dialog', (d) => d.accept());
  await page.click('#delete-project-detail-button');
  await page.waitForTimeout(250);
  check('admin: back on projects list after delete', await page.isVisible('#projects-section'));
  const gridAfterDelete = await page.$$('#projects-grid .project-tile');
  check('admin: project count back to 2 after delete', gridAfterDelete.length === 2, `found ${gridAfterDelete.length}`);
  const leftoverFiles = await page.evaluate((id) => window.__mockStorageKeys().filter((k) => k.startsWith(id + '/')).length, deletedId);
  check('admin: deleted project leaves no stored files', leftoverFiles === 0, `found ${leftoverFiles}`);

  await page.click('#sign-out-button');
  await page.waitForTimeout(150);

  // -------------------------------------------------------- superuser role --
  await page.fill('#sign-in-email', 'rex@blockheads.test');
  await page.fill('#sign-in-password', 'superpass');
  await page.click('#sign-in-form button[type="submit"]');
  await page.waitForTimeout(150);

  await page.click('#nav-members');
  await page.waitForTimeout(100);
  check('superuser: no pending badge when zero requests', await page.isHidden('#nav-members-badge'));
  const removeButtonsSuper = await page.$$('#members-list .remove-member-button');
  check('superuser: remove buttons present for other members', removeButtonsSuper.length > 0, `found ${removeButtonsSuper.length}`);

  const patRole = () => page.textContent('#members-list .member-row:has-text("Pat Member") .role-pill');
  page.once('dialog', (d) => d.accept());
  await page.click('#members-list .member-row:has-text("Pat Member") .role-change-button');
  await page.waitForTimeout(200);
  check('superuser: Make admin promotes a member', (await patRole()).trim() === 'admin');
  page.once('dialog', (d) => d.accept());
  await page.click('#members-list .member-row:has-text("Pat Member") .role-change-button');
  await page.waitForTimeout(200);
  check('superuser: Make member steps an admin back down', (await patRole()).trim() === 'member');

  await page.click('#sign-out-button');
  await page.waitForTimeout(150);

  // --------------------------------------------------- request-access form --
  await page.click('#tab-request-access');
  check('request-access tab shows its form', await page.isVisible('#request-access-form'));
  check('request-access hides sign-in form', await page.isHidden('#sign-in-form'));
  await page.fill('#request-name', 'Test Requester');
  await page.fill('#request-email', 'tester@example.com');
  await page.fill('#request-password', 'testerpass1');
  await page.fill('#request-note', 'Automated test submission');
  await page.click('#request-access-form button[type="submit"]');
  await page.waitForTimeout(150);
  check('request-access shows success message', await page.isVisible('#request-success'));

  // ------------------------------------------------------------- js errors --
  check('no console/page errors across the whole run', consoleErrors.length === 0, consoleErrors.join(' | '));

  await browser.close();

  console.log(results.join('\n'));
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Test run crashed:', err);
  process.exit(1);
});
