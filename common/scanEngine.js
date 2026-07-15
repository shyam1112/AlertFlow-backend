import Rules from '../api/rules/rulesModel';
import Violations from '../api/violations/violationsModel';
import ScanLog from '../api/scan/scanLogModel';
import Settings from '../api/settings/settingsModel';
import { fetchAllProducts } from './shopifyGraphqlService';
import { sendViolationAlert, sendScanSummaryEmail } from './emailService';
import logger from './logger';

function getProductFieldValue(product, fieldName) {
  switch (fieldName) {
    case 'title': return product.title || '';
    case 'vendor': return product.vendor || '';
    case 'product_type': return product.productType || '';
    case 'status': return product.status || '';
    case 'tags': return Array.isArray(product.tags) ? product.tags.join(',') : (product.tags || '');
    case 'images_count': return String(product.images_count || 0);
    default: return '';
  }
}

function getVariantFieldValue(variant, fieldName) {
  switch (fieldName) {
    case 'sku': return variant.sku || '';
    case 'barcode': return variant.barcode || '';
    case 'price': return String(variant.price || '0');
    case 'compare_at_price': return String(variant.compareAtPrice || '0');
    case 'inventory_quantity': return String(variant.inventory_quantity ?? '0');
    default: return '';
  }
}

function getMetafieldValue(product, namespace, key) {
  const mf = product.metafields.find(m => m.namespace === namespace && m.key === key);
  return mf ? mf.value : '';
}

function evaluateCondition(rawValue, operator, comparisonValue) {
  const value = rawValue == null ? '' : String(rawValue).trim();
  const isEmpty = value === '' || value === 'null' || value === 'undefined';

  switch (operator) {
    case 'IS_EMPTY':      return isEmpty;
    case 'IS_NOT_EMPTY':  return !isEmpty;
    case 'EQUALS':        return value.toLowerCase() === (comparisonValue || '').toLowerCase();
    case 'NOT_EQUALS':    return value.toLowerCase() !== (comparisonValue || '').toLowerCase();
    case 'CONTAINS':      return value.toLowerCase().includes((comparisonValue || '').toLowerCase());
    case 'GREATER_THAN':  return parseFloat(value) > parseFloat(comparisonValue || '0');
    case 'LESS_THAN':     return parseFloat(value) < parseFloat(comparisonValue || '0');
    default:              return false;
  }
}

function buildReason(rule, fieldLabel, currentValue) {
  switch (rule.operator) {
    case 'IS_EMPTY':     return `${fieldLabel} is empty`;
    case 'IS_NOT_EMPTY': return `${fieldLabel} must be empty but has value: ${currentValue}`;
    case 'EQUALS':       return `${fieldLabel} is "${currentValue}", expected "${rule.comparison_value}"`;
    case 'NOT_EQUALS':   return `${fieldLabel} equals "${currentValue}" (should not equal "${rule.comparison_value}")`;
    case 'CONTAINS':     return `${fieldLabel} "${currentValue}" does not contain "${rule.comparison_value}"`;
    case 'GREATER_THAN': return `${fieldLabel} is ${currentValue}, must be > ${rule.comparison_value}`;
    case 'LESS_THAN':    return `${fieldLabel} is ${currentValue}, must be < ${rule.comparison_value}`;
    default:             return `${fieldLabel} violation`;
  }
}

function getFieldLabel(rule) {
  if (rule.resource_type === 'Metafield') return `${rule.namespace}.${rule.key}`;
  return rule.field_name || rule.resource_type;
}

function evaluateProductAgainstRule(product, rule) {
  const violations = [];

  if (rule.resource_type === 'Product') {
    const rawValue = getProductFieldValue(product, rule.field_name);
    if (evaluateCondition(rawValue, rule.operator, rule.comparison_value)) {
      violations.push({
        product_id: product.id,
        product_title: product.title,
        product_handle: product.handle,
        current_value: rawValue,
        reason: buildReason(rule, getFieldLabel(rule), rawValue),
      });
    }
  } else if (rule.resource_type === 'Variant') {
    for (const variant of product.variants) {
      const rawValue = getVariantFieldValue(variant, rule.field_name);
      if (evaluateCondition(rawValue, rule.operator, rule.comparison_value)) {
        violations.push({
          product_id: product.id,
          product_title: `${product.title} (SKU: ${variant.sku || variant.id})`,
          product_handle: product.handle,
          current_value: rawValue,
          reason: buildReason(rule, getFieldLabel(rule), rawValue),
        });
        break; // one violation per product for variant rules
      }
    }
  } else if (rule.resource_type === 'Metafield') {
    const rawValue = getMetafieldValue(product, rule.namespace, rule.key);
    if (evaluateCondition(rawValue, rule.operator, rule.comparison_value)) {
      violations.push({
        product_id: product.id,
        product_title: product.title,
        product_handle: product.handle,
        current_value: rawValue,
        reason: buildReason(rule, getFieldLabel(rule), rawValue),
      });
    }
  }

  return violations;
}

export async function evaluateProductWebhook(shopName, product) {
  try {
    const rules = await Rules.find({ shopName, is_active: true });
    const settings = await Settings.findOne({ shopName });
    const now = new Date();

    for (const rule of rules) {
      const triggered = evaluateProductAgainstRule(product, rule);

      if (triggered.length > 0) {
        const vd = triggered[0];
        const existing = await Violations.findOne({
          shopName, product_id: vd.product_id, rule_id: rule._id, status: 'active',
        });
        if (!existing) {
          const violation = await Violations.create({
            shopName,
            product_id: vd.product_id,
            product_title: vd.product_title,
            product_handle: vd.product_handle,
            rule_id: rule._id,
            rule_name: rule.name,
            resource_type: rule.resource_type,
            current_value: vd.current_value,
            reason: vd.reason,
            status: 'active',
            first_detected_at: now,
            last_detected_at: now,
          });
          if (rule.alert_email && settings && settings.alert_email) {
            await sendViolationAlert(settings.alert_email, violation).catch(e =>
              logger.error(`Email send failed: ${e.message}`),
            );
          }
        } else {
          await Violations.findByIdAndUpdate(existing._id, { last_detected_at: now, current_value: vd.current_value });
        }
      } else {
        // Rule no longer triggered — resolve any active violation
        await Violations.updateMany(
          { shopName, product_id: product.id, rule_id: rule._id, status: 'active' },
          { status: 'resolved', resolved_at: now },
        );
      }
    }
  } catch (error) {
    logger.error(`evaluateProductWebhook error: ${error.message}`, { shopName, stack: error.stack });
  }
}

export async function runScan(shopName, { sendSummaryEmail = false } = {}) {
  const log = await ScanLog.create({ shopName, started_at: new Date(), status: 'running' });
  const start = Date.now();

  try {
    const [products, rules, settings] = await Promise.all([
      fetchAllProducts(shopName),
      Rules.find({ shopName, is_active: true }),
      Settings.findOne({ shopName }),
    ]);

    const now = new Date();
    let violationsFound = 0;
    let violationsResolved = 0;
    const newViolationsList = [];
    const resolvedViolationsList = [];

    // Track which product+rule combos are currently violating
    const activeViolationKeys = new Set();

    for (const product of products) {
      for (const rule of rules) {
        const triggered = evaluateProductAgainstRule(product, rule);
        const key = `${product.id}::${rule._id}`;

        if (triggered.length > 0) {
          activeViolationKeys.add(key);
          const vd = triggered[0];
          const existing = await Violations.findOne({
            shopName, product_id: product.id, rule_id: rule._id, status: 'active',
          });
          if (!existing) {
            const violation = await Violations.create({
              shopName,
              product_id: product.id,
              product_title: vd.product_title,
              product_handle: vd.product_handle,
              rule_id: rule._id,
              rule_name: rule.name,
              resource_type: rule.resource_type,
              current_value: vd.current_value,
              reason: vd.reason,
              status: 'active',
              first_detected_at: now,
              last_detected_at: now,
            });
            violationsFound++;
            newViolationsList.push(violation);
            if (rule.alert_email && settings && settings.alert_email) {
              await sendViolationAlert(settings.alert_email, violation).catch(e =>
                logger.error(`Email send failed: ${e.message}`),
              );
            }
          } else {
            await Violations.findByIdAndUpdate(existing._id, { last_detected_at: now, current_value: vd.current_value });
          }
        }
      }
    }

    // Resolve violations for products/rules no longer triggering
    const allActive = await Violations.find({ shopName, status: 'active' });
    for (const v of allActive) {
      const key = `${v.product_id}::${v.rule_id}`;
      if (!activeViolationKeys.has(key)) {
        await Violations.findByIdAndUpdate(v._id, { status: 'resolved', resolved_at: now });
        violationsResolved++;
        resolvedViolationsList.push(v);
      }
    }

    const duration = Date.now() - start;
    await ScanLog.findByIdAndUpdate(log._id, {
      status: 'completed',
      completed_at: new Date(),
      products_scanned: products.length,
      violations_found: violationsFound,
      violations_resolved: violationsResolved,
      duration_ms: duration,
    });

    logger.info(`Scan complete for ${shopName}: ${products.length} products, ${violationsFound} new violations, ${violationsResolved} resolved in ${duration}ms`);

    // Send scan summary email with Excel report attached (manual scans only)
    if (sendSummaryEmail && settings && settings.alert_email) {
      const activeViolations = await Violations.find({ shopName, status: 'active' })
        .select('product_title rule_name resource_type current_value reason first_detected_at last_detected_at');
      await sendScanSummaryEmail(settings.alert_email, {
        shopName,
        scanned_at: now,
        products_scanned: products.length,
        violations_found: violationsFound,
        violations_resolved: violationsResolved,
        duration_ms: duration,
        active_violations: activeViolations,
        new_violations: newViolationsList,
        resolved_violations: resolvedViolationsList,
      }).catch(e => logger.error(`Scan summary email failed: ${e.message}`));
    }

    return { products_scanned: products.length, violations_found: violationsFound, violations_resolved: violationsResolved, duration_ms: duration };
  } catch (error) {
    await ScanLog.findByIdAndUpdate(log._id, { status: 'failed', error: error.message, completed_at: new Date() });
    logger.error(`Scan failed for ${shopName}: ${error.message}`, { stack: error.stack });
    throw error;
  }
}
