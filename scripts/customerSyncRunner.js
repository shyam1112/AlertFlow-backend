/**
 * Customer Sync Runner
 * Syncs Salesforce accounts (Net Terms = false) to Shopify as B2C customers,
 * plus each account's contacts as separate customers.
 *
 * Usage:
 *   node scripts/customerSyncEntry.js --count 100
 *   node scripts/customerSyncEntry.js --count 50 --offset 100 --record-type "USA record type"
 *   node scripts/customerSyncEntry.js --dry-run
 *
 * Options:
 *   --count N              Number of accounts to fetch (default: 10)
 *   --offset N             Offset to start from (default: 0)
 *   --record-type NAME     Filter by Salesforce record type name
 *   --skip-existing        Skip accounts already in Shopify (default: true)
 *   --no-skip-existing     Don't skip existing
 *   --delay N              ms between customer creations (default: 500)
 *   --dry-run              Fetch and log only, no Shopify writes
 */

import path from 'path';
import fs from 'fs';
import XLSX from 'xlsx';

import {
  fetchSalesforceAccounts,
  fetchAccountInstalledProducts,
  fetchContactsByAccountIds,
} from '../common/salesforceService';
import { createShopifyCustomer } from '../common/shopifyProductService';
import { transformAccountToCustomer, SALUTATION_MAP, REGION_MAP, SPECIALITY_MAP, mapValue } from '../api/accounts/accountController';
import { transformContactForCustomer } from '../api/contacts/contactController';

// ==================== CLI ARGS ====================

const parseArgs = () => {
  const args = process.argv.slice(2);
  const opts = {
    count: 10,
    offset: 0,
    recordTypeName: null,
    skipExisting: true,
    delay: 500,
    dryRun: false,
    netTerms: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--count':           opts.count          = parseInt(args[++i], 10) || 10;  break;
      case '--offset':          opts.offset         = parseInt(args[++i], 10) || 0;   break;
      case '--record-type':     opts.recordTypeName = args[++i];                       break;
      case '--delay':           opts.delay          = parseInt(args[++i], 10) || 500; break;
      case '--skip-existing':   opts.skipExisting   = true;                            break;
      case '--no-skip-existing':opts.skipExisting   = false;                           break;
      case '--dry-run':         opts.dryRun         = true;                            break;
      case '--net-terms':       opts.netTerms       = true;                            break;
    }
  }

  return opts;
};

// ==================== MAIN ====================

const main = async () => {
  const { count, offset, recordTypeName, skipExisting, delay, dryRun, netTerms } = parseArgs();

  console.log('\n' + '═'.repeat(60));
  console.log('  👤 SALESFORCE ACCOUNT → SHOPIFY CUSTOMER SYNC');
  console.log('═'.repeat(60));
  console.log(`  Count:          ${count}`);
  console.log(`  Offset:         ${offset}`);
  console.log(`  Skip Existing:  ${skipExisting}`);
  console.log(`  Delay:          ${delay}ms`);
  console.log(`  Dry Run:        ${dryRun}`);
  if (recordTypeName) console.log(`  Record Type:    ${recordTypeName}`);
  console.log('═'.repeat(60) + '\n');

  const filters = { netTerms, usOnly: true, activeStatus: true, requireContacts: true, requireInstalledProducts: true };
  if (recordTypeName) filters.recordTypeName = recordTypeName;

  console.log(`📥 Fetching ${netTerms ? 'Net 30' : 'non-Net 30'} accounts from Salesforce...`);
  const accounts = await fetchSalesforceAccounts(count, offset, filters);

  if (accounts.length === 0) {
    console.log('✅ No non-Net Terms accounts found matching the criteria.');
    process.exit(0);
  }

  console.log(`\n📊 Found ${accounts.length} account(s) to sync as customers`);

  // Fetch installed products and contacts in parallel
  const accountIds = accounts.map(a => a.Id);
  console.log('🔧 Fetching installed products and contacts in parallel...');
  const [installedProductsByAccountId, contactsByAccountId] = await Promise.all([
    fetchAccountInstalledProducts(accountIds),
    fetchContactsByAccountIds(accountIds),
  ]);

  // Attach installed products to accounts before transform
  accounts.forEach(a => {
    a._installedProductModels = installedProductsByAccountId[a.Id] || [];
  });

  const allTransformed = accounts.map(transformAccountToCustomer);

  // Filter: skip accounts with no installed product models
  const transformedAccounts = allTransformed.filter(a => (a.installedProductModels || []).length > 0);
  const noModelAccounts     = allTransformed.filter(a => (a.installedProductModels || []).length === 0);
  if (noModelAccounts.length > 0) {
    console.log(`⚠️  Skipping ${noModelAccounts.length} account(s) with no installed product models: ${noModelAccounts.map(a => a.name).join(', ')}`);
  }
  console.log(`📊 Syncing contacts for ${transformedAccounts.length}/${allTransformed.length} account(s) with installed products`);

  const totalContacts = transformedAccounts.reduce((s, a) => s + (contactsByAccountId[a.salesforceId] || []).length, 0);
  console.log(`📋 Found ${totalContacts} contact(s) across filtered accounts`);

  if (dryRun) {
    console.log('\n🔍 DRY RUN — contacts that would be synced as customers:\n');
    transformedAccounts.forEach((a, i) => {
      const contacts = contactsByAccountId[a.salesforceId] || [];
      console.log(`  ${i + 1}. [Account] ${a.name} — ${contacts.length} contact(s), models: ${a.installedProductModels?.length || 0}`);
      contacts.forEach(c => {
        const salutation = c.Salutation ? `${c.Salutation} ` : '';
        console.log(`       [Contact] ${salutation}${c.FirstName || ''} ${c.LastName || ''} — email: ${c.Email || '(no email)'}`);
      });
    });
    console.log('\n✅ Dry run complete. No changes made.');
    process.exit(0);
  }

  const results = { successful: [], skipped: [], failed: [] };

  for (let i = 0; i < transformedAccounts.length; i++) {
    const acct = transformedAccounts[i];
    const contacts = contactsByAccountId[acct.salesforceId] || [];
    console.log(`\n[${i + 1}/${transformedAccounts.length}] ${acct.name} — ${contacts.length} contact(s)`);

    if (contacts.length === 0) {
      console.log(`  ⏭️ No contacts found, skipping.`);
      continue;
    }

    // Create a customer for each contact linked to this account
    for (const rawContact of contacts) {
      const contactData = transformContactForCustomer(rawContact);
      // Attach parent account's installed product models and tax exempt to the contact
      contactData.installedProductModels = acct.installedProductModels || [];
      contactData.taxExempt = acct.taxExempt === true;
      // Apply value mappings for custom metafields
      contactData.salutation = mapValue(contactData.salutation || null, SALUTATION_MAP);
      contactData.region     = mapValue(acct.region     || null, REGION_MAP);
      contactData.speciality = mapValue(acct.speciality || null, SPECIALITY_MAP);

      const contactResult = await createShopifyCustomer(contactData, skipExisting);
      contactResult.parentAccountName = acct.name;
      contactResult.parentAccountId = acct.salesforceId;
      contactResult.contactDetails = { ...contactData };

      if (contactResult.skipped) {
        results.skipped.push(contactResult);
      } else if (contactResult.success) {
        results.successful.push(contactResult);
      } else {
        results.failed.push(contactResult);
      }

      if (delay > 0) await new Promise(r => setTimeout(r, delay));
    }
  }

  // Build account map for report
  const accountMap = {};
  transformedAccounts.forEach(a => { accountMap[a.salesforceId] = a; });

  const buildRow = (r, status) => {
    const c    = r.contactDetails || {};
    const acct = accountMap[r.parentAccountId] || {};
    return {
      'Status':                        status,
      // ── Contact Identity ──────────────────────────────────────
      'Salesforce Contact ID':         r.salesforceId || c.salesforceId || '',
      'Salesforce Tag':                c.salesforceId ? `sf_contact_${c.salesforceId}` : '',
      'Salutation':                    c.salutation || '',
      'First Name':                    c.firstName || '',
      'Last Name':                     c.lastName || '',
      'Contact Name':                  r.name || [c.salutation, c.firstName, c.lastName].filter(Boolean).join(' ') || '',
      'Email':                         r.email || c.email || '',
      'Phone':                         c.phone || '',
      'Mobile Phone':                  c.mobilePhone || '',
      'Title':                         c.title || '',
      'Department':                    c.department || '',
      'Contact Purpose':               c.contactPurpose || '',
      'Contact Status':                c.contactStatus || '',
      'Contact Record Type':           c.recordTypeName || '',
      'Contact Record Type ID':        c.recordTypeId || '',
      // ── Contact Address ───────────────────────────────────────
      'Mailing Street':                c.mailingAddress?.street || '',
      'Mailing Additional Info':       c.mailingAdditionalInfo || c.mailingAddress?.additionalInfo || '',
      'Mailing City':                  c.mailingAddress?.city || '',
      'Mailing State':                 c.mailingAddress?.state || '',
      'Mailing Zip':                   c.mailingAddress?.postalCode || '',
      'Mailing Country':               c.mailingAddress?.country || '',
      // ── Shopify ───────────────────────────────────────────────
      'Shopify Customer ID':           r.shopifyCustomerId || r.existingCustomerId || '',
      // ── Installed Products ────────────────────────────────────
      'Installed Products Count':      (c.installedProductModels || []).length,
      'Installed Products':            (c.installedProductModels || []).join(', '),
      // ── Parent Account ────────────────────────────────────────
      'Parent Account':                r.parentAccountName || '',
      'Parent Account SF ID':          r.parentAccountId || acct.salesforceId || '',
      'Account Number':                acct.accountNumber || '',
      'Account Number (Candela-Oracle)': acct.accountNumberCandelaOracle || '',
      'Account Type':                  acct.type || '',
      'Account Industry':              acct.industry || '',
      'Account Record Type':           acct.recordTypeName || '',
      'Account Owner':                 acct.ownerName || '',
      'Account Region':                acct.region || '',
      'Account Activity Status':       acct.accountActivityStatus || '',
      'Account Status':                acct.accountStatus || '',
      'Account Phone':                 acct.phone || '',
      'Account Office Email':          acct.officeEmail || '',
      'Billing Street':                acct.billingAddress?.street || '',
      'Billing City':                  acct.billingAddress?.city || '',
      'Billing State':                 acct.billingAddress?.state || '',
      'Billing Zip':                   acct.billingAddress?.postalCode || '',
      'Billing Country':               acct.billingAddress?.country || '',
      // ── Audit ─────────────────────────────────────────────────
      'Created By ID':                 c.createdById || '',
      'Created Date':                  c.createdDate || '',
      'Last Modified By ID':           c.lastModifiedById || '',
      'Last Modified Date':            c.lastModifiedDate || '',
      'Notes':                         [r.reason, r.warning, r.error].filter(Boolean).join(' | ') || '',
    };
  };

  const createdRows = results.successful.map(r => buildRow(r, 'Created'));
  const skippedRows = results.skipped.map(r => buildRow(r, 'Skipped (Exists)'));
  const failedRows  = results.failed.map(r => buildRow(r, 'Failed'));

  const noModelRows = noModelAccounts.map(a => ({
    'Account Name':       a.name,
    'Salesforce ID':      a.salesforceId || '',
    'Account Type':       a.type || '',
    'Account Record Type': a.recordTypeName || '',
    'Region':             a.region || '',
    'Reason':             'No installed product models',
  }));

  const summaryRows = [
    { 'Metric': 'Accounts Fetched',          'Value': accounts.length },
    { 'Metric': 'Accounts Skipped (No Models)', 'Value': noModelAccounts.length },
    { 'Metric': 'Accounts Synced',           'Value': transformedAccounts.length },
    { 'Metric': 'Contacts Fetched',          'Value': totalContacts },
    { 'Metric': 'Created',                   'Value': results.successful.length },
    { 'Metric': 'Skipped (Exists)',          'Value': results.skipped.length },
    { 'Metric': 'Failed',                    'Value': results.failed.length },
    { 'Metric': '',                          'Value': '' },
    { 'Metric': 'Sync Date',                 'Value': new Date().toISOString() },
    { 'Metric': 'Filters',                   'Value': JSON.stringify(filters) },
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summaryRows), 'Summary');
  if (createdRows.length > 0)  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(createdRows),  'Created');
  if (skippedRows.length > 0)  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(skippedRows),  'Skipped');
  if (noModelRows.length > 0)  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(noModelRows),  'Skipped (No Models)');
  if (failedRows.length > 0)   XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(failedRows),   'Failed');

  const reportsDir = path.resolve('reports');
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const fileName = `customer_sync_report_${timestamp}.xlsx`;
  const filePath = path.join(reportsDir, fileName);
  XLSX.writeFile(workbook, filePath);

  console.log('\n' + '═'.repeat(60));
  console.log('  📊 CUSTOMER SYNC COMPLETE');
  console.log('═'.repeat(60));
  console.log(`  Accounts Fetched:       ${accounts.length}`);
  console.log(`  Skipped (No Models):    ${noModelAccounts.length}`);
  console.log(`  Accounts Synced:        ${transformedAccounts.length}`);
  console.log(`  Contacts Fetched:       ${totalContacts}`);
  console.log(`  Created:                ${results.successful.length}`);
  console.log(`  Skipped (Exists):       ${results.skipped.length}`);
  console.log(`  Failed:                 ${results.failed.length}`);
  console.log(`  Report:           ${filePath}`);
  console.log('═'.repeat(60) + '\n');

  process.exit(results.failed.length > 0 ? 1 : 0);
};

main().catch((err) => {
  console.error('\n❌ Fatal error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
