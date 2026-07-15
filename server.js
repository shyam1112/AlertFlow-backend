import express from 'express';
import appMiddleware from './middlewares/app';
import authMiddleware from './middlewares/auth';
import connectToDB from './common/db';
import logger from './common/logger';
import { startScheduledJobs } from './common/scheduledJobs';

import SettingsRoutes from './api/settings/settingsRoutes';
import ShopsRoutes from './api/shops/shopsRoutes';
import ShopSecretsRoutes from './api/shopSecrets/shopSecretsRoutes';
import GlobalPlansRoutes from './api/globalPlans/globalPlansRoutes';
import DiscountsRoutes from './api/discounts/discountsRoutes';
import PlansRoutes from './api/plans/plansRoutes';
import installationRoutes from './api/installation/installationRoutes';
import webhookRoutes from './api/webhooks/webhooksRoutes';
import RulesRoutes from './api/rules/rulesRoutes';
import ViolationsRoutes from './api/violations/violationsRoutes';
import DashboardRoutes from './api/dashboard/dashboardRoutes';
import ScanRoutes from './api/scan/scanRoutes';
import MetafieldsRoutes from './api/metafields/metafieldsRoutes';
import ContactRoutes from './api/contact/contactRoutes';
import { activate } from './api/plans/plansController';

const app = express();

connectToDB();

app.use(
  '/webhooks',
  express.raw({ type: 'application/json', limit: '2mb' }),
  webhookRoutes,
);

appMiddleware(app);

// Routes without authentication
app.use('/init', installationRoutes);
app.use('/discounts', DiscountsRoutes);
app.get('/plans/activate', activate);

app.use('*', authMiddleware);

// Core Shopify data
app.use('/settings', SettingsRoutes);
app.use('/shops', ShopsRoutes);
app.use('/shop-secrets', ShopSecretsRoutes);
app.use('/global-plans', GlobalPlansRoutes);
app.use('/plans', PlansRoutes);

// AlertFlow feature routes
app.use('/rules', RulesRoutes);
app.use('/violations', ViolationsRoutes);
app.use('/dashboard', DashboardRoutes);
app.use('/scan', ScanRoutes);
app.use('/metafields', MetafieldsRoutes);
app.use('/contact', ContactRoutes);

app.use((err, req, res, _next) => {
  if (
    err.name === 'ValidationError' ||
    err.name === 'MongoError' ||
    err.name === 'MongoServerError'
  ) {
    logger.error(`Error from main mongo error handler`, { error: err, payload: req.body });
    res.status(422).json({ error: err });
  } else if (err.isAxiosError) {
    logger.error(`Error from main axios error handler`, {
      stack: err.stack,
      payload: req.body,
      url: err.config && err.config.url ? err.config.url : '',
    });
    res.status((err.response && err.response.status) || 500).json({
      error: err.response && err.response.data ? err.response.data : 'Something went wrong!',
    });
  } else {
    logger.error(`Error from main error handler`, { stack: err.stack, payload: req.body });
    res.status(500).send({ error: 'Something went wrong!' });
  }
});

app.listen(process.env.PORT || 3022, () => {
  console.log(`AlertFlow backend listening on http://localhost:${process.env.PORT || 3022}`);
  startScheduledJobs();
});

export default app;
