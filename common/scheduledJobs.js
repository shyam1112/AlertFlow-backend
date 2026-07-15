import cron from 'node-cron';
import Settings from '../api/settings/settingsModel';
import ShopSecrets from '../api/shopSecrets/shopSecretsModel';
import Violations from '../api/violations/violationsModel';
import { runScan } from './scanEngine';
import { sendDailyDigest } from './emailService';
import logger from './logger';

async function getActiveShops() {
  const secrets = await ShopSecrets.find({ chargeStatus: { $ne: 'uninstalled' } }).select('shopName');
  return secrets.map(s => s.shopName);
}

// Every hour — re-scan all active shops to keep violations up to date.
// Sends the summary email only for shops that have hourly email opted in.
function startHourlyRecheck() {
  cron.schedule('0 * * * *', async () => {
    logger.info('Hourly recheck started');
    const shops = await getActiveShops().catch(e => {
      logger.error(`Hourly recheck: failed to get shops: ${e.message}`);
      return [];
    });

    for (const shopName of shops) {
      try {
        const settings = await Settings.findOne({ shopName });
        const sendSummaryEmail = !!(settings && settings.hourly_email_enabled && settings.alert_email);
        await runScan(shopName, { sendSummaryEmail });
      } catch (e) {
        logger.error(`Hourly recheck failed for ${shopName}: ${e.message}`);
      }
    }
  });
}

// Every day at 00:00 UTC (midnight) — send daily digest to shops that have it enabled.
function startDailyDigest() {
  cron.schedule('0 0 * * *', async () => {
    logger.info('Daily digest job started');
    const shops = await getActiveShops().catch(e => {
      logger.error(`Daily digest: failed to get shops: ${e.message}`);
      return [];
    });

    for (const shopName of shops) {
      try {
        const settings = await Settings.findOne({ shopName });
        if (!settings || !settings.digest_enabled || !settings.alert_email) continue;

        const activeViolations = await Violations.find({ shopName, status: 'active' });
        await sendDailyDigest(settings.alert_email, shopName, activeViolations);
      } catch (e) {
        logger.error(`Daily digest failed for ${shopName}: ${e.message}`);
      }
    }
  });
}

export function startScheduledJobs() {
  startHourlyRecheck();
  startDailyDigest();
  logger.info('Scheduled jobs started: hourly recheck + daily digest at 00:00 UTC');
}
