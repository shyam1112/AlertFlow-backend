#!/usr/bin/env node

/**
 * Check Contact ID Mismatch - Entry Point
 *
 * Compares sf_contact_XXXX tag vs salesforce.salesforce_contact_id metafield
 * for every Shopify customer and reports any differences.
 *
 * Usage:
 *   node scripts/checkContactIdMismatchEntry.js
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

require('./checkContactIdMismatch');
