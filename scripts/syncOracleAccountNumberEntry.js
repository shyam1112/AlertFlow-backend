/**
 * Entry point for syncOracleAccountNumberRunner — loads dotenv then runs via babel.
 *
 * Usage:
 *   NODE_ENV=local node scripts/syncOracleAccountNumberEntry.js
 *   NODE_ENV=local node scripts/syncOracleAccountNumberEntry.js --dry-run
 *   NODE_ENV=local node scripts/syncOracleAccountNumberEntry.js --delay 200
 */
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');

const envFile = process.env.NODE_ENV === 'local'
  ? path.join(projectRoot, '.env.local')
  : path.join(projectRoot, '.env');

const result = require('dotenv').config({ path: envFile });
if (result.error) {
  console.warn(`⚠️  Could not load env file at ${envFile}:`, result.error.message);
} else {
  console.log(`✅ Loaded env from: ${envFile}`);
}

require('@babel/register')({
  presets: ['@babel/preset-env'],
});
require('@babel/polyfill');

require('./syncOracleAccountNumberRunner');
