// Load environment variables from the matching .env file before anything else.
// In production: expects a .env file on the server (never committed to git).
// In local dev:  reads .env.local
const env = process.env.NODE_ENV || 'production';
if (env === 'local') {
  require('dotenv').config({ path: '.env.local' });
} else {
  require('dotenv').config(); // loads .env
}

require('@babel/register')({
  presets: ['@babel/preset-env'],
});
require('@babel/polyfill');

module.exports = require('./server.js');
