#!/usr/bin/env node

/**
 * Bulk Product Sync Script - Entry Point
 * Sets up Babel and runs the sync
 *
 * Usage:
 *   node scripts/bulkSync.js                     # Uses .env.local by default
 *   NODE_ENV=production node scripts/bulkSync.js # Uses .env.production
 */

const path = require('path');

// Determine which .env file to use
const envFile = process.env.NODE_ENV
  ? `.env.${process.env.NODE_ENV}`
  : '.env.local';

const envPath = path.join(process.cwd(), envFile);

console.log(`📁 Loading environment from: ${envFile}`);

// Load environment variables
const result = require('dotenv').config({ path: envPath });

if (result.error) {
  console.log(`⚠️ Could not load ${envFile}, trying .env.local...`);
  require('dotenv').config({ path: path.join(process.cwd(), '.env.local') });
}

// Fallback to default .env if still no credentials
if (!process.env.STORE_URL) {
  console.log(`⚠️ Still missing credentials, trying .env...`);
  require('dotenv').config({ path: path.join(process.cwd(), '.env') });
}

// Setup Babel
require('@babel/register')({
  presets: ['@babel/preset-env'],
});
require('@babel/polyfill');

// Run the actual sync script
require('./bulkSyncRunner.js');
