#!/usr/bin/env node

/**
 * Delete All Shopify Companies - Entry Point
 *
 * Usage:
 *   node scripts/deleteAllCompanies.js               # Delete all companies
 *   node scripts/deleteAllCompanies.js --dry-run     # Preview only, no deletions
 *   node scripts/deleteAllCompanies.js --limit 10    # Delete first 10 only
 *   node scripts/deleteAllCompanies.js --delay 200   # Custom delay between deletes (ms)
 */

const path = require('path');

const envFile = process.env.NODE_ENV
  ? `.env.${process.env.NODE_ENV}`
  : '.env.local';

const envPath = path.join(process.cwd(), envFile);

console.log(`📁 Loading environment from: ${envFile}`);

const result = require('dotenv').config({ path: envPath });

if (result.error) {
  console.log(`⚠️ Could not load ${envFile}, trying .env.local...`);
  require('dotenv').config({ path: path.join(process.cwd(), '.env.local') });
}

if (!process.env.STORE_URL) {
  console.log(`⚠️ Still missing credentials, trying .env...`);
  require('dotenv').config({ path: path.join(process.cwd(), '.env') });
}

require('@babel/register')({
  presets: ['@babel/preset-env'],
});

require('./deleteAllCompaniesRunner');
