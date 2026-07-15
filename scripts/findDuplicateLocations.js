/**
 * Find Shopify companies that have duplicate location names.
 *
 * Paginates through all companies, fetches ALL locations per company
 * (with nested pagination), and reports duplicates (case-insensitive).
 *
 * Usage:
 *   node scripts/findDuplicateLocationsEntry.js
 *   node scripts/findDuplicateLocationsEntry.js --delay 300
 */

import axios from 'axios';
import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';

// ==================== CONFIG ====================

const STORE_URL   = process.env.STORE_URL;
const STORE_TOKEN = process.env.STORE_TOKEN;
const API_VERSION = process.env.SHOPIFY_SYNC_API_VERSION || '2026-01';

// ==================== SHOPIFY GRAPHQL ====================

const shopifyGraphQL = async (query, variables = {}) => {
  const response = await axios.post(
    `https://${STORE_URL}/admin/api/${API_VERSION}/graphql.json`,
    { query, variables },
    {
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': STORE_TOKEN,
      },
    }
  );

  if (response.data.errors) {
    return { success: false, errors: response.data.errors };
  }

  return { success: true, data: response.data.data };
};

// ==================== FETCH ALL LOCATIONS FOR A COMPANY ====================

const fetchAllLocationsForCompany = async (companyId) => {
  const locations = [];
  let cursor = null;
  let hasNextPage = true;

  const query = `
    query getCompanyLocations($id: ID!, $after: String) {
      company(id: $id) {
        locations(first: 250, after: $after) {
          edges {
            node { id name externalId createdAt }
            cursor
          }
          pageInfo { hasNextPage }
        }
      }
    }
  `;

  while (hasNextPage) {
    const result = await shopifyGraphQL(query, { id: companyId, after: cursor });
    if (!result.success) break;

    const edges = result.data.company?.locations?.edges || [];
    hasNextPage = result.data.company?.locations?.pageInfo?.hasNextPage || false;

    for (const edge of edges) locations.push(edge.node);
    cursor = edges.length > 0 ? edges[edges.length - 1].cursor : null;
    if (!cursor) break;
  }

  return locations;
};

// ==================== FETCH ALL COMPANIES (PAGINATED) ====================

const fetchAllCompanies = async (delay = 300) => {
  const companies = [];
  let cursor = null;
  let hasNextPage = true;
  let page = 1;

  // Fetch companies with first page of locations (250); paginate locations separately if needed
  const query = `
    query getCompanies($after: String) {
      companies(first: 250, after: $after) {
        edges {
          node {
            id
            name
            externalId
            locations(first: 250) {
              edges { node { id name externalId createdAt } cursor }
              pageInfo { hasNextPage }
            }
          }
          cursor
        }
        pageInfo { hasNextPage }
      }
    }
  `;

  while (hasNextPage) {
    process.stdout.write(`\r  Fetching page ${page} (${companies.length} companies so far)...`);

    const result = await shopifyGraphQL(query, { after: cursor });

    if (!result.success) {
      console.error('\n❌ Failed to fetch companies:', result.errors);
      break;
    }

    const edges = result.data.companies.edges;
    hasNextPage = result.data.companies.pageInfo.hasNextPage;

    for (const edge of edges) {
      const company = edge.node;
      let locations = company.locations.edges.map(e => e.node);

      // If company has more than 250 locations, paginate to get the rest
      if (company.locations.pageInfo.hasNextPage) {
        const lastCursor = company.locations.edges[company.locations.edges.length - 1]?.cursor;
        const extraLocations = await fetchAllLocationsForCompany(company.id, lastCursor);
        locations = [...locations, ...extraLocations];
      }

      companies.push({ ...company, allLocations: locations });
    }

    cursor = edges.length > 0 ? edges[edges.length - 1].cursor : null;
    page++;

    if (!hasNextPage || !cursor) break;
    await new Promise(r => setTimeout(r, delay));
  }

  process.stdout.write('\n');
  return companies;
};

// ==================== FIND DUPLICATES ====================

export const findDuplicateLocations = async (filterDate = null) => {
  const filterDatePrefix = filterDate ? filterDate.slice(0, 10) : null;
  console.log('📥 Fetching all companies with their locations...');
  const companies = await fetchAllCompanies();
  console.log(`✅ Fetched ${companies.length} companies total\n`);

  console.log('🔍 Scanning for duplicate location names...');
  const results = [];

  for (const company of companies) {
    const locations = company.allLocations || [];

    const nameGroups = {};
    for (const loc of locations) {
      const key = loc.name.toLowerCase().trim();
      if (!nameGroups[key]) nameGroups[key] = [];
      nameGroups[key].push(loc);
    }

    const duplicateGroups = [];
    for (const [normalizedName, locs] of Object.entries(nameGroups)) {
      if (locs.length <= 1) continue;
      // All have different non-null externalIds → different SF sites with same name → not duplicates
      const externalIds = locs.map(l => l.externalId).filter(Boolean);
      const allDifferentNonNull = externalIds.length === locs.length && new Set(externalIds).size === locs.length;
      if (allDifferentNonNull) continue;
      const annotatedLocs = locs.map(l => ({
        ...l,
        createdAtDate: l.createdAt ? l.createdAt.slice(0, 10) : null,
        matchesDateFilter: filterDatePrefix ? (l.createdAt ? l.createdAt.startsWith(filterDatePrefix) : false) : null,
      }));

      if (filterDatePrefix && !annotatedLocs.some(l => l.matchesDateFilter)) continue;

      duplicateGroups.push({ normalizedName, count: locs.length, locations: annotatedLocs });
    }

    if (duplicateGroups.length > 0) {
      results.push({
        companyId: company.id,
        companyName: company.name,
        companySalesforceId: company.externalId || '',
        totalLocations: locations.length,
        duplicateGroups,
      });
    }
  }

  const totalDuplicateGroups = results.reduce((s, c) => s + c.duplicateGroups.length, 0);
  const totalDuplicateLocations = results.reduce(
    (s, c) => s + c.duplicateGroups.reduce((ss, g) => ss + g.count, 0), 0
  );

  return { companies: results, totalCompanies: companies.length, totalDuplicateGroups, totalDuplicateLocations };
};

// ==================== CLI ARGS ====================

const parseArgs = () => {
  const args = process.argv.slice(2);
  const opts = { delay: 300, filterDate: null };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--delay') { const v = parseInt(args[++i], 10); if (!isNaN(v)) opts.delay = v; }
    if (args[i] === '--date')  { opts.filterDate = args[++i]; }
  }
  return opts;
};

// ==================== MAIN ====================

const main = async () => {
  const { delay, filterDate } = parseArgs();

  console.log('\n' + '═'.repeat(60));
  console.log('  🔍 FIND DUPLICATE COMPANY LOCATIONS IN SHOPIFY');
  console.log('═'.repeat(60));
  console.log(`  Delay:       ${delay}ms between pages`);
  if (filterDate) console.log(`  Date filter: ${filterDate}`);
  console.log('═'.repeat(60) + '\n');

  const { companies: duplicates, totalCompanies, totalDuplicateGroups, totalDuplicateLocations } = await findDuplicateLocations(filterDate);

  console.log('\n' + '═'.repeat(60));
  console.log('  📊 RESULTS');
  console.log('═'.repeat(60));
  console.log(`  Total companies scanned:   ${totalCompanies}`);
  console.log(`  Companies with duplicates: ${duplicates.length}`);
  console.log(`  Total duplicate groups:    ${totalDuplicateGroups}`);
  console.log(`  Total duplicate locations: ${totalDuplicateLocations}`);
  console.log('═'.repeat(60) + '\n');

  if (duplicates.length === 0) {
    console.log('✅ No duplicate locations found!');
    return;
  }

  for (const company of duplicates) {
    console.log(`\n🏢 ${company.companyName} (${company.companyId})`);
    if (company.companySalesforceId) console.log(`   SF ID: ${company.companySalesforceId}`);
    console.log(`   Total locations: ${company.totalLocations}`);
    for (const group of company.duplicateGroups) {
      console.log(`   ⚠️  "${group.normalizedName}" — ${group.count} duplicates`);
      for (const loc of group.locations) {
        console.log(`      • ${loc.name} (${loc.id}) externalId: ${loc.externalId || 'none'}`);
      }
    }
  }

  // Build Excel report
  const summaryRows = [
    { 'Metric': 'Total Companies Scanned',   'Value': totalCompanies },
    { 'Metric': 'Companies with Duplicates', 'Value': duplicates.length },
    { 'Metric': 'Total Duplicate Groups',    'Value': totalDuplicateGroups },
    { 'Metric': 'Total Duplicate Locations', 'Value': totalDuplicateLocations },
    { 'Metric': 'Generated At',              'Value': new Date().toISOString() },
  ];

  const companyRows = duplicates.map(c => ({
    'Company Name':             c.companyName,
    'Company Shopify ID':       c.companyId,
    'Company Salesforce ID':    c.companySalesforceId,
    'Total Locations':          c.totalLocations,
    'Duplicate Groups Count':   c.duplicateGroups.length,
    'Duplicate Location Names': c.duplicateGroups.map(g => g.normalizedName).join(' | '),
  }));

  const detailRows = [];
  for (const company of duplicates) {
    for (const group of company.duplicateGroups) {
      for (const loc of group.locations) {
        detailRows.push({
          'Company Name':          company.companyName,
          'Company Shopify ID':    company.companyId,
          'Company Salesforce ID': company.companySalesforceId,
          'Duplicate Group':       group.normalizedName,
          'Duplicate Count':       group.count,
          'Location Name':         loc.name,
          'Location Shopify ID':   loc.id,
          'Location External ID':  loc.externalId || '',
        });
      }
    }
  }

  const reportsDir = path.resolve('reports');
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const fileName = `duplicate_locations_${timestamp}.xlsx`;
  const filePath = path.join(reportsDir, fileName);

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(summaryRows), 'Summary');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(companyRows), 'Companies');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(detailRows),  'Duplicate Locations');
  XLSX.writeFile(workbook, filePath);

  console.log(`\n📄 Report saved: ${filePath}`);
};

main().catch(err => {
  console.error('\n❌ Fatal error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
