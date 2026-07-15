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

require('@babel/register')({ presets: ['@babel/preset-env'] });
require('@babel/polyfill');
require('./customerSyncRunner');
