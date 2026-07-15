/**
 * Entry point for companySyncRunner — loads dotenv then runs the script via babel.
 * Mirrors the pattern in index.js so env vars are available before any imports resolve.
 */
const path = require('path');

// Project root is one level up from scripts/
const projectRoot = path.resolve(__dirname, '..');

// Load .env.local for local dev, .env for server
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

require('./companySyncRunner');
