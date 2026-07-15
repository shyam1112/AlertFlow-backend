#!/usr/bin/env node

/**
 * Delete All Shopify Customers - Entry Point
 *
 * Usage:
 *   node scripts/deleteAllCustomers.js               # Delete all customers
 *   node scripts/deleteAllCustomers.js --dry-run     # Preview only, no deletions
 *   node scripts/deleteAllCustomers.js --limit 100   # Delete first 100 only
 *   node scripts/deleteAllCustomers.js --delay 200   # Custom delay between deletes (ms)
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

require('./deleteAllCustomersRunner');
