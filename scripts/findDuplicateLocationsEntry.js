#!/usr/bin/env node

/**
 * Find Duplicate Company Locations - Entry Point
 *
 * Usage:
 *   node scripts/findDuplicateLocationsEntry.js
 *   node scripts/findDuplicateLocationsEntry.js --batch-size 50
 *   node scripts/findDuplicateLocationsEntry.js --delay 300
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

require('./findDuplicateLocations');
