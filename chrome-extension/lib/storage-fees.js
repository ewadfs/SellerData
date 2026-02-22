/**
 * Amazon AWD (Amazon Warehousing and Distribution) Storage Fee Calculator
 *
 * Calculates monthly storage costs based on Amazon's 2025 AWD fee structure.
 * AWD uses a flat per-cubic-foot rate regardless of product size tier, with
 * optional discounts for Smart Storage and Managed Service enrollment.
 *
 * Sources:
 *   - https://sellercentral.amazon.com/help/hub/reference/GAYG62Q3MPE6STFS
 *   - https://sellercentral.amazon.com/help/hub/reference/GPB467PZW3AZC4V3
 */

const StorageFeeCalculator = (() => {
  // ============================================================
  // 2025 AWD MONTHLY STORAGE RATES (per cubic foot)
  // ============================================================
  //
  // AWD uses a single flat rate — no standard vs oversize distinction.
  // Discount tiers:
  //   - Base: manual replenishment to fulfillment centers
  //   - Smart Storage: >=70% of SKU inventory auto-replenished via AWD
  //                    in the preceding 90 days (10% off base)
  //   - Managed: enrolled in Supply Chain by Amazon Managed Service
  //             (20% off base storage, 10% off AWD transportation)

  const RATES = {
    base: {
      offPeak: 0.48,   // Jan–Sep, per cu ft/month
      peak: 0.80       // Oct–Dec, per cu ft/month
    },
    smartStorage: {
      offPeak: 0.43,   // 10% discount
      peak: 0.72
    },
    managed: {
      offPeak: 0.384,  // 20% discount
      peak: 0.64
    }
  };

  // 2026 regional adjustments (effective Jan 15, 2026)
  // West region increases to $0.57 off-peak; East/Central stay at $0.48
  const RATES_2026 = {
    west: {
      base: { offPeak: 0.57, peak: 0.80 },
      smartStorage: { offPeak: 0.513, peak: 0.72 },
      managed: { offPeak: 0.456, peak: 0.64 }
    },
    eastCentral: {
      base: { offPeak: 0.48, peak: 0.80 },
      smartStorage: { offPeak: 0.43, peak: 0.72 },
      managed: { offPeak: 0.384, peak: 0.64 }
    }
  };

  // Rate tier labels for display
  const RATE_TIER_LABELS = {
    base: 'Base',
    smartStorage: 'Smart Storage',
    managed: 'Managed Service'
  };

  // ============================================================
  // CUBIC FEET CALCULATION
  // ============================================================

  /**
   * Calculate cubic feet from dimensions in inches.
   */
  function calcCubicFeet(length, width, height) {
    return (length * width * height) / 1728;
  }

  // ============================================================
  // MONTHLY STORAGE RATE
  // ============================================================

  /**
   * Determine whether the given month falls in peak season.
   * Peak = October (10) through December (12).
   *
   * @param {number} month - 1-12
   * @returns {boolean}
   */
  function isPeakMonth(month) {
    return month >= 10 && month <= 12;
  }

  /**
   * Get the AWD storage rate per cubic foot for a given month and rate tier.
   *
   * @param {Object}  [options]
   * @param {number}  [options.month]    - 1-12, defaults to current month
   * @param {string}  [options.rateTier] - 'base' | 'smartStorage' | 'managed'
   * @param {string}  [options.region]   - 'east' | 'central' | 'west' (only relevant for 2026+)
   * @param {number}  [options.year]     - defaults to current year
   * @returns {number} rate per cubic foot per month
   */
  function getMonthlyRate({ month, rateTier = 'base', region, year } = {}) {
    const now = new Date();
    if (!month) month = now.getMonth() + 1;
    if (!year) year = now.getFullYear();

    const season = isPeakMonth(month) ? 'peak' : 'offPeak';

    // Use 2026 regional rates if applicable
    if (year >= 2026 && region === 'west') {
      const tierRates = RATES_2026.west[rateTier] || RATES_2026.west.base;
      return tierRates[season];
    }
    if (year >= 2026) {
      const tierRates = RATES_2026.eastCentral[rateTier] || RATES_2026.eastCentral.base;
      return tierRates[season];
    }

    // 2025 rates (no regional distinction)
    const tierRates = RATES[rateTier] || RATES.base;
    return tierRates[season];
  }

  // ============================================================
  // STORAGE COST CALCULATION
  // ============================================================

  /**
   * Calculate the monthly AWD storage cost for a given number of units.
   *
   * @param {Object}  params
   * @param {number}  params.length    - item package length in inches
   * @param {number}  params.width     - item package width in inches
   * @param {number}  params.height    - item package height in inches
   * @param {number}  params.units     - number of units in AWD
   * @param {number}  [params.month]   - 1-12, defaults to current month
   * @param {number}  [params.year]    - defaults to current year
   * @param {string}  [params.rateTier] - 'base' | 'smartStorage' | 'managed'
   * @param {string}  [params.region]  - 'east' | 'central' | 'west' (2026+)
   * @returns {Object|null} { monthlyCostPerUnit, monthlyCostTotal, cubicFeetPerUnit,
   *                          cubicFeetTotal, rate, rateTier, rateTierLabel, isPeak, month }
   */
  function calculateStorageCost({
    length, width, height, units,
    month, year, rateTier = 'base', region
  }) {
    if (!length || !width || !height) {
      return null;
    }

    const cubicFeetPerUnit = calcCubicFeet(length, width, height);
    const cubicFeetTotal = cubicFeetPerUnit * (units || 1);
    const now = new Date();
    const currentMonth = month || (now.getMonth() + 1);
    const currentYear = year || now.getFullYear();
    const rate = getMonthlyRate({ month: currentMonth, rateTier, region, year: currentYear });
    const peak = isPeakMonth(currentMonth);

    const monthlyCostPerUnit = cubicFeetPerUnit * rate;
    const monthlyCostTotal = cubicFeetTotal * rate;

    return {
      monthlyCostPerUnit: Math.round(monthlyCostPerUnit * 100) / 100,
      monthlyCostTotal: Math.round(monthlyCostTotal * 100) / 100,
      cubicFeetPerUnit: Math.round(cubicFeetPerUnit * 1000) / 1000,
      cubicFeetTotal: Math.round(cubicFeetTotal * 1000) / 1000,
      rate,
      rateTier,
      rateTierLabel: RATE_TIER_LABELS[rateTier] || rateTier,
      isPeak: peak,
      month: currentMonth,
      year: currentYear
    };
  }

  /**
   * Compare storage costs across all rate tiers for a given product.
   * Useful for showing sellers potential savings from Smart Storage or Managed enrollment.
   *
   * @param {Object} params - same as calculateStorageCost (rateTier is ignored)
   * @returns {Object} { base, smartStorage, managed } each containing a cost breakdown
   */
  function compareRateTiers(params) {
    return {
      base: calculateStorageCost({ ...params, rateTier: 'base' }),
      smartStorage: calculateStorageCost({ ...params, rateTier: 'smartStorage' }),
      managed: calculateStorageCost({ ...params, rateTier: 'managed' })
    };
  }

  /**
   * Format currency.
   */
  function formatCost(amount) {
    if (amount === null || amount === undefined) return '--';
    return '$' + amount.toFixed(2);
  }

  // Public API
  return {
    calculateStorageCost,
    compareRateTiers,
    calcCubicFeet,
    getMonthlyRate,
    isPeakMonth,
    formatCost,
    RATES,
    RATES_2026,
    RATE_TIER_LABELS
  };
})();
