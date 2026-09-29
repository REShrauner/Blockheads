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
  check('member: Add meeting button hidden', await page.isHidden('#add-event-button'));
  // Fixture events are set relative to today: one in the past (this month)
  // and two in the future (next month), so the current month's grid should
  // show exactly the one past event as a chip.
  const memberEventChips = await page.$$('#calendar-grid .event-chip');
  check('member: calendar shows this month\'s event', memberEventChips.length === 1, `found ${memberEventChips.length}`);

  const memberUpcoming = await page.$$('#upcoming-list .upcoming-item');
  check('member: upcoming list shows only future events', memberUpcoming.length === 2, `found ${memberUpcoming.length}`);

  await page.click('#calendar-next-month');
  await page.waitForTimeout(100);
  const nextMonthChips = await page.$$('#calendar-grid .event-chip');
  check('member: next month shows the two future events', nextMonthChips.length === 2, `found ${nextMonthChips.length}`);
  await page.click('#calendar-prev-month');
  await page.waitForTimeout(100);

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

  await page.click('#nav-members');
  await page.waitForTimeout(100);
  check('admin: Add admin button hidden (superuser-only)', await page.isHidden('#add-admin-button'));
  check('admin: pending count shows 2', (await page.textContent('#pending-count')).trim() === '2');
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

  // Delete the project itself to leave state clean-ish, then confirm redirect
  await page.click('#back-to-projects');
  await page.waitForTimeout(100);

  await page.click('#sign-out-button');
  await page.waitForTimeout(150);

  // -------------------------------------------------------- superuser role --
  await page.fill('#sign-in-email', 'rex@blockheads.test');
  await page.fill('#sign-in-password', 'superpass');
  await page.click('#sign-in-form button[type="submit"]');
  await page.waitForTimeout(150);

  await page.click('#nav-members');
  await page.waitForTimeout(100);
  check('superuser: Add admin button visible', await page.isVisible('#add-admin-button'));
  const removeButtonsSuper = await page.$$('#members-list .remove-member-button');
  check('superuser: remove buttons present for other members', removeButtonsSuper.length > 0, `found ${removeButtonsSuper.length}`);

  await page.click('#add-admin-button');
  await page.fill('#admin-name', 'New Admin');
  await page.fill('#admin-email', 'newadmin@blockheads.test');
  await page.fill('#admin-password', 'newadminpass');
  await page.click('#admin-form button[type="submit"]');
  await page.waitForTimeout(200);
  const memberRowsAfterCreate = await page.$$('#members-list .member-row');
  check('superuser: member count grows after createAdmin', memberRowsAfterCreate.length === 5, `found ${memberRowsAfterCreate.length}`);

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
