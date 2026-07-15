/**
 * Company Sync Runner
 * Syncs Salesforce accounts (Net Terms = true) to Shopify companies.
 *
 * Usage:
 *   node scripts/companySyncRunner.js --count 100 --record-type "B2B Customer"
 *   node scripts/companySyncRunner.js --count 50 --offset 100
 *   node scripts/companySyncRunner.js --count 10 --skip-existing false
 *   node scripts/companySyncRunner.js --dry-run
 *
 * Options:
 *   --count N              Number of accounts to fetch (default: 10)
 *   --offset N             Offset to start from (default: 0)
 *   --record-type NAME     Filter by Salesforce record type name
 *   --skip-existing        Skip accounts already in Shopify (default: true)
 *   --no-skip-existing     Don't skip existing accounts
 *   --delay N              ms between company creations (default: 500)
 *   --dry-run              Fetch and log only, no Shopify writes
 */

import path from 'path';
import fs from 'fs';
import XLSX from 'xlsx';

import {
  fetchSalesforceAccounts,
  fetchAccountSiteLocations,
  fetchAccountInstalledProducts,
  fetchContactsByAccountIds,
} from '../common/salesforceService';
import {
  createShopifyCompaniesBatch,
  ensureCompanyMetafieldDefinitions,
  ensureCompanyLocationMetafieldDefinitions,
  clearCompanyMetafieldDefinitionsCache,
  clearCompanyLocationMetafieldDefinitionsCache,
  clearMarketsCache,
  getCountryCodeFromRegion,
} from '../common/shopifyProductService';
import { transformAccountToCompany } from '../api/accounts/accountController';

// ==================== CLI ARGS ====================

const parseArgs = () => {
  const args = process.argv.slice(2);
  const opts = {
    count: 10,
    offset: 0,
    recordTypeName: null,
    accountId: null,
    skipExisting: true,
    delay: 500,
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--count':            opts.count          = parseInt(args[++i], 10) || 10;   break;
      case '--offset':           opts.offset         = parseInt(args[++i], 10) || 0;    break;
      case '--record-type':      opts.recordTypeName = args[++i];                        break;
      case '--account-id':       opts.accountId      = args[++i];                        break;
      case '--delay':            opts.delay          = parseInt(args[++i], 10) || 500;  break;
      case '--skip-existing':    opts.skipExisting   = true;                             break;
      case '--no-skip-existing': opts.skipExisting   = false;                            break;
      case '--dry-run':          opts.dryRun         = true;                             break;
    }
  }

  return opts;
};

// ==================== MAIN ====================

const main = async () => {
  const { count, offset, recordTypeName, skipExisting, delay, dryRun } = parseArgs();

  console.log('\n' + '═'.repeat(60));
  console.log('  🔄 SALESFORCE ACCOUNT → SHOPIFY COMPANY SYNC');
  console.log('═'.repeat(60));
  console.log(`  Count:          ${count}`);
  console.log(`  Offset:         ${offset}`);
  console.log(`  Skip Existing:  ${skipExisting}`);
  console.log(`  Delay:          ${delay}ms`);
  console.log(`  Dry Run:        ${dryRun}`);
  if (recordTypeName) console.log(`  Record Type:    ${recordTypeName}`);
  console.log('═'.repeat(60) + '\n');

  // Build filters
  const filters = { netTerms: true };
  if (recordTypeName) filters.recordTypeName = recordTypeName;

  if (!dryRun) {
    // Ensure company metafield definitions exist in Shopify
    console.log('🔧 Ensuring company metafield definitions...');
    clearCompanyMetafieldDefinitionsCache();
    clearMarketsCache();
    await ensureCompanyMetafieldDefinitions();
  }

  // Fetch accounts from Salesforce
  console.log('\n📥 Fetching Net Terms accounts from Salesforce...');
  const accounts_b2b = await fetchSalesforceAccounts(count, offset, filters);

  if (accounts_b2b.length === 0) {
    console.log('✅ No Net Terms accounts found matching the criteria.');
    process.exit(0);
  }

  console.log(`\n📊 Found ${accounts_b2b.length} Net Terms account(s) to sync as companies`);

  // Fetch site locations, installed products, and contacts in parallel.
  // Contacts are fetched via a separate paginated query (fetchContactsByAccountIds)
  // instead of relying on the SOQL subquery inside fetchSalesforceAccounts, which
  // is hard-capped at 200 records by Salesforce regardless of actual count.
  const accountIds = accounts_b2b.map(a => a.Id);
  const [siteLocationsByAccountId, installedProductsByAccountId, contactsByAccountId] = await Promise.all([
    fetchAccountSiteLocations(accountIds),
    fetchAccountInstalledProducts(accountIds),
    fetchContactsByAccountIds(accountIds),
  ]);

  const totalContacts = Object.values(contactsByAccountId).reduce((s, c) => s + c.length, 0);
  console.log(`👥 Total active contacts fetched (paginated): ${totalContacts}`);

  accounts_b2b.forEach(a => {
    a._siteLocations        = siteLocationsByAccountId[a.Id] || [];
    a._installedProductModels = installedProductsByAccountId[a.Id] || [];
    a._contacts             = contactsByAccountId[a.Id] || [];
    // Log if the subquery was capped vs full count
    const subqueryCount = a.Contacts?.records?.length || 0;
    const fullCount     = a._contacts.length;
    if (fullCount > subqueryCount) {
      console.log(`  ⚠️  ${a.Name}: subquery returned ${subqueryCount} contacts, paginated query found ${fullCount} — using full list`);
    }
  });

  const totalSiteLocations = Object.values(siteLocationsByAccountId).reduce((sum, locs) => sum + locs.length, 0);
  const totalInstalledProducts = Object.values(installedProductsByAccountId).reduce((sum, m) => sum + m.length, 0);
  console.log(`📍 Total active site locations to sync: ${totalSiteLocations}`);
  console.log(`🔧 Total installed product models to sync: ${totalInstalledProducts}`);

  // Filter: skip accounts with no installed product models
  const accountsToSync    = accounts_b2b.filter(a => a._installedProductModels.length > 0);
  const accountsNoModels  = accounts_b2b.filter(a => a._installedProductModels.length === 0);
  if (accountsNoModels.length > 0) {
    console.log(`⚠️  Skipping ${accountsNoModels.length} account(s) with no installed product models: ${accountsNoModels.map(a => a.Name).join(', ')}`);
  }

  // Transform to Shopify company format
  const transformedAccounts = accountsToSync.map(transformAccountToCompany);

  if (dryRun) {
    console.log('\n🔍 DRY RUN — accounts that would be synced:\n');
    transformedAccounts.forEach((a, i) => {
      console.log(`  ${i + 1}. ${a.name} (${a.salesforceId}) — ${a.contacts?.length || 0} contacts, ${a.siteLocations?.length || 0} site locations`);
    });
    console.log('\n✅ Dry run complete. No changes made.');
    process.exit(0);
  }

  // Sync to Shopify
  console.log(`\n🏢 Creating ${transformedAccounts.length} companies in Shopify...`);
  const results = await createShopifyCompaniesBatch(transformedAccounts, delay, skipExisting);

  // Build account map for report
  const accountMap = {};
  transformedAccounts.forEach(a => { accountMap[a.salesforceId] = a; });

  const updatedSkipped = results.skipped.filter(r => r.updated);
  const pureSkipped    = results.skipped.filter(r => !r.updated);

  // ==================== EXCEL REPORT ====================

  const buildRow = (r, status, acct) => ({
    'Status':                            status,
    // ── Company / Account Identity ────────────────────────────
    'Salesforce ID':                     r.salesforceId || '',
    'Account Name':                      r.name || acct.name || '',
    'Shopify Company ID':                r.shopifyCompanyId || r.existingCompanyId || '',
    'Shopify Location ID':               r.shopifyLocationId || '',
    'Account Number':                    acct.accountNumber || '',
    'Account Number (Candela-Oracle)':   acct.accountNumberCandelaOracle || '',
    'Type':                              acct.type || '',
    'Industry':                          acct.industry || '',
    'Record Type':                       acct.recordTypeName || '',
    'Owner':                             acct.ownerName || '',
    'Parent Name':                       acct.parentName || '',
    'Region':                            acct.region || '',
    // ── Status Fields ─────────────────────────────────────────
    'Account Activity Status':           acct.accountActivityStatus || '',
    'Account Status':                    acct.accountStatus || '',
    'Credit Hold':                       acct.creditHold ?? '',
    'Pay In Advance':                    acct.payInAdvance ?? '',
    'Tax Exempt':                        acct.taxExempt ?? '',
    'Net 30 Online Orders':              acct.net30OnlineOrders ?? '',
    // ── Contact & Pricing ─────────────────────────────────────
    'Phone':                             acct.phone || '',
    'Office Email':                      acct.officeEmail || '',
    'Shop Price Book':                   acct.shopPriceBookName || acct.shopPriceBook || '',
    'Primary Operating Unit':            acct.primaryOperatingUnit || '',
    // ── Billing Address ───────────────────────────────────────
    'Billing Street':                    acct.billingAddress?.street || '',
    'Billing Additional Info':           acct.billingAddress?.additionalInfo || '',
    'Billing City':                      acct.billingAddress?.city || '',
    'Billing State':                     acct.billingAddress?.state || '',
    'Billing Zip':                       acct.billingAddress?.postalCode || '',
    'Billing Country':                   acct.billingAddress?.country || '',
    // ── Shipping Address ──────────────────────────────────────
    'Shipping Street':                   acct.shippingAddress?.street || '',
    'Shipping City':                     acct.shippingAddress?.city || '',
    'Shipping State':                    acct.shippingAddress?.state || '',
    'Shipping Zip':                      acct.shippingAddress?.postalCode || '',
    'Shipping Country':                  acct.shippingAddress?.country || '',
    // ── Contacts & Locations ──────────────────────────────────
    'Contacts Count':                    acct.contacts?.length || 0,
    'Site Locations (Salesforce)':       acct.siteLocations?.length || 0,
    'Locations Created':                 r.locationsCreated?.join(', ') || '',
    'Locations Already Existed':         r.locationsAlreadyExisted?.join(', ') || '',
    'Main Contact Email':                r.mainContactReport?.mainContactEmail || '',
    'Main Contact Source':               r.mainContactReport?.source || '',
    // ── Installed Products ────────────────────────────────────
    'Installed Products Count':          acct.installedProductModels?.length || 0,
    'Installed Products':                acct.installedProductModels?.join(', ') || '',
    // ── Oracle / Legal ────────────────────────────────────────
    'Legal Operating Account Name':      acct.legalOperatingAccountName || '',
    'Oracle Cloud Account Number':       acct.oracleCloudAccountNumber || '',
    'Oracle Cust Account ID':            acct.oracleCustAccountId || '',
    'Oracle Party ID':                   acct.oraclePartyId || '',
    // ── Taxonomy ─────────────────────────────────────────────
    'Speciality':                        acct.speciality || '',
    'Sub Category':                      acct.subCategory || '',
    // ── Tax / VAT ─────────────────────────────────────────────
    'Tax ID':                            acct.taxId || '',
    'VAT Number':                        acct.vatNumber || '',
    'VAT Registration Country':          acct.vatRegistrationCountry || '',
    // ── Interface ─────────────────────────────────────────────
    'Interface Status':                  acct.interfaceStatus || '',
    'Interface Update':                  acct.interfaceUpdate || '',
    'Bill To Additional Address Info':   acct.billToAdditionalAddressInfo || '',
    'Ship To Additional Address Info':   acct.shipToAdditionalAddressInfo || '',
    'Bill To Address Validated':         acct.billToAddressValidated || '',
    'Ship To Address Validated':         acct.shipToAddressValidated || '',
    // ── Geo ───────────────────────────────────────────────────
    'Latitude':                          acct.latitude || '',
    'Longitude':                         acct.longitude || '',
    // ── Audit ─────────────────────────────────────────────────
    'Created Date':                      acct.createdDate || '',
    'Last Modified Date':                acct.lastModifiedDate || '',
    'Notes':                             r.reason || r.error || '',
  });

  const createdRows   = results.successful.map(r => buildRow(r, 'Created (Fresh)',                 accountMap[r.salesforceId] || {}));
  const updatedRows   = updatedSkipped.map(r =>    buildRow(r, 'Updated (Missing Locations Added)', accountMap[r.salesforceId] || {}));
  const skippedRows   = pureSkipped.map(r =>       buildRow(r, 'Skipped (No Changes)',              accountMap[r.salesforceId] || {}));
  const failedRows    = results.failed.map(r =>    buildRow(r, 'Failed',                            accountMap[r.salesforceId] || {}));
  const noModelRows   = accountsNoModels.map(a => buildRow(
    { salesforceId: a.Id, name: a.Name, reason: 'No installed product models found' },
    'Skipped (No Models)',
    transformAccountToCompany(a),
  ));

  const summaryRows = [
    { 'Metric': 'Total Fetched (Net Terms)',     'Value': accounts_b2b.length },
    { 'Metric': 'Skipped (No Models)',           'Value': accountsNoModels.length },
    { 'Metric': 'Created (Fresh)',               'Value': results.successful.length },
    { 'Metric': 'Updated (Missing Locations)',   'Value': updatedSkipped.length },
    { 'Metric': 'Skipped (No Changes)',          'Value': pureSkipped.length },
    { 'Metric': 'Failed',                        'Value': results.failed.length },
    { 'Metric': '',                              'Value': '' },
    { 'Metric': 'Sync Date',                     'Value': new Date().toISOString() },
    { 'Metric': 'Filters',                       'Value': JSON.stringify(filters) },
  ];

  // Build contacts sheet (all contacts across all synced accounts)
  const contactRows = [];
  [...accountsToSync.map(transformAccountToCompany)].forEach(acct => {
    (acct.contacts || []).forEach(c => {
      contactRows.push({
        'Account Name':              acct.name || '',
        'Account Salesforce ID':     acct.salesforceId || '',
        'Contact Salesforce ID':     c.salesforceId || '',
        'Salesforce Tag':            c.salesforceId ? `sf_contact_${c.salesforceId}` : '',
        'Salutation':                c.salutation || '',
        'First Name':                c.firstName || '',
        'Last Name':                 c.lastName || '',
        'Full Name':                 [c.salutation, c.firstName, c.lastName].filter(Boolean).join(' '),
        'Email':                     c.email || '',
        'Phone':                     c.phone || '',
        'Mobile Phone':              c.mobilePhone || '',
        'Title':                     c.title || '',
        'Department':                c.department || '',
        'Record Type':               c.recordTypeName || '',
        'Primary':                   c.primary ? 'Yes' : 'No',
        'Contact Purpose':           c.contactPurpose || '',
        'Contact Status':            c.contactStatus || '',
        'Mailing Street':            c.mailingAddress?.street || '',
        'Mailing City':              c.mailingAddress?.city || '',
        'Mailing State':             c.mailingAddress?.state || '',
        'Mailing Zip':               c.mailingAddress?.postalCode || '',
        'Mailing Country':           c.mailingAddress?.country || '',
      });
    });
  });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summaryRows), 'Summary');
  if (createdRows.length > 0)   XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(createdRows),   'Created (Fresh)');
  if (updatedRows.length > 0)   XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(updatedRows),   'Updated');
  if (skippedRows.length > 0)   XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(skippedRows),   'Skipped');
  if (noModelRows.length > 0)   XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(noModelRows),   'Skipped (No Models)');
  if (failedRows.length > 0)    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(failedRows),    'Failed');
  if (contactRows.length > 0)   XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(contactRows),   'Contacts');

  const reportsDir = path.resolve('reports');
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const fileName = `company_sync_report_${timestamp}.xlsx`;
  const filePath = path.join(reportsDir, fileName);
  XLSX.writeFile(workbook, filePath);

  // Write main contact resolution report (.txt)
  const allResults = [...results.successful, ...results.skipped];
  const mainContactEntries = allResults
    .map(r => r.mainContactReport)
    .filter(Boolean);

  if (mainContactEntries.length > 0) {
    const txtLines = [
      `Main Contact Resolution Report — ${new Date().toISOString()}`,
      '='.repeat(70),
      '',
      ...mainContactEntries.map(e =>
        `Account:        ${e.accountName}\n` +
        `Office Email:   ${e.officeEmail || '(none)'}\n` +
        `Main Contact:   ${e.mainContactEmail || '(none)'}\n` +
        `Source:         ${e.source}\n` +
        '-'.repeat(50)
      ),
    ];
    const txtPath = path.join(reportsDir, `main_contact_report_${timestamp}.txt`);
    fs.writeFileSync(txtPath, txtLines.join('\n'), 'utf8');
    console.log(`✅ Main contact report saved: ${txtPath}`);
  }

  // Write contact reconciliation mismatch report (.txt)
  const mismatches = results.successful
    .map(r => r.reconciliationMismatch)
    .filter(Boolean);

  if (mismatches.length > 0) {
    const mismatchLines = [
      `Contact Reconciliation Mismatch Report — ${new Date().toISOString()}`,
      '='.repeat(70),
      `Total mismatches: ${mismatches.length}`,
      '',
      ...mismatches.map(m => {
        const notAttached = m.missingEmails.length > 0
          ? `Not attached (${m.missingEmails.length}): ${m.missingEmails.join(', ')}`
          : 'No specific missing emails identified';
        return (
          `⚠️  Contact reconciliation MISMATCH for "${m.accountName}":\n` +
          `    Salesforce ID:  ${m.salesforceId}\n` +
          `    Salesforce ${m.sfCount} active+email contacts → Shopify attached ${m.shopifyCount}\n` +
          `    ${notAttached}\n` +
          '-'.repeat(60)
        );
      }),
    ];
    const mismatchPath = path.join(reportsDir, `contact_reconciliation_${timestamp}.txt`);
    fs.writeFileSync(mismatchPath, mismatchLines.join('\n'), 'utf8');
    console.log(`⚠️  Contact reconciliation report saved: ${mismatchPath} (${mismatches.length} mismatches)`);
  } else {
    console.log(`✅ No contact reconciliation mismatches found.`);
  }

  // Write location creation errors report (.txt)
  const allLocationErrors = results.successful
    .flatMap(r => r.locationErrors || []);

  if (allLocationErrors.length > 0) {
    const locErrLines = [
      `Location Creation Errors Report — ${new Date().toISOString()}`,
      '='.repeat(70),
      `Total failed locations: ${allLocationErrors.length}`,
      '',
      ...allLocationErrors.map(e =>
        `Account:   ${e.accountName}\n` +
        `Location:  ${e.locationName}\n` +
        `Error:     ${e.error}\n` +
        '-'.repeat(60)
      ),
    ];
    const locErrPath = path.join(reportsDir, `location_errors_${timestamp}.txt`);
    fs.writeFileSync(locErrPath, locErrLines.join('\n'), 'utf8');
    console.log(`⚠️  Location errors report saved: ${locErrPath} (${allLocationErrors.length} failed locations)`);
  } else {
    console.log(`✅ No location creation errors.`);
  }

  console.log(`\n✅ Report saved: ${filePath}`);

  // Final summary
  console.log('\n' + '═'.repeat(60));
  console.log('  📊 SYNC COMPLETE');
  console.log('═'.repeat(60));
  console.log(`  Total Fetched:        ${accounts_b2b.length}`);
  console.log(`  Created (Fresh):      ${results.successful.length}`);
  console.log(`  Updated (Locations):  ${updatedSkipped.length}`);
  console.log(`  Skipped (No Changes): ${pureSkipped.length}`);
  console.log(`  Failed:               ${results.failed.length}`);
  console.log(`  Location Errors:      ${allLocationErrors.length}`);
  console.log(`  Report:               ${filePath}`);
  console.log('═'.repeat(60) + '\n');

  process.exit(results.failed.length > 0 ? 1 : 0);
};

main().catch((err) => {
  console.error('\n❌ Fatal error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
