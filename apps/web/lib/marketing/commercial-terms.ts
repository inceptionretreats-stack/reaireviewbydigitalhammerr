import { PLATFORM_SETTING_DEFAULTS, PlatformSettingsService } from '@ai-review/core';
import { db } from '@/lib/infra/db';
import { safeError } from '@/lib/infra/safe-error';

/**
 * The commercial numbers the public pages advertise, read from platform_settings.
 *
 * They used to be string literals in the marketing components. An admin changing the Pro price
 * in /admin/settings — a field the screen describes as "Charged at checkout from now on" —
 * therefore changed what a tenant is charged without changing a single number on the pricing
 * page or the landing hero, which went on saying "The standard Pro price is ₹999 for 12
 * calendar months" while checkout asked for something else. Advertising one price and charging
 * another is a consumer-law problem in India, not a display bug, and the same applied to the
 * free and Pro draft allowances.
 *
 * Read once per render. These pages are already dynamic, and the settings service is a single
 * indexed row.
 */

export interface CommercialTerms {
  pricePaise: number;
  /** "₹999" — whole rupees when the price is whole, two decimals when it is not. */
  priceLabel: string;
  freeDrafts: number;
  proDrafts: number;
  /** "10" and "2,000" — grouped for prose, in the Indian digit grouping. */
  freeDraftsLabel: string;
  proDraftsLabel: string;
}

export function formatRupees(paise: number): string {
  const rupees = paise / 100;
  return `₹${rupees.toLocaleString('en-IN', {
    minimumFractionDigits: Number.isInteger(rupees) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

export function commercialTermsFrom(values: {
  annual_price_paise: number;
  free_generation_limit: number;
  pro_generation_limit: number;
}): CommercialTerms {
  return {
    pricePaise: values.annual_price_paise,
    priceLabel: formatRupees(values.annual_price_paise),
    freeDrafts: values.free_generation_limit,
    proDrafts: values.pro_generation_limit,
    freeDraftsLabel: values.free_generation_limit.toLocaleString('en-IN'),
    proDraftsLabel: values.pro_generation_limit.toLocaleString('en-IN'),
  };
}

/**
 * Falls back to the bootstrap defaults if the settings row cannot be read. A marketing page
 * that 500s because of a database blip is worse than one showing the shipped defaults, and
 * those defaults are the same values that were hardcoded here before.
 */
export async function loadCommercialTerms(): Promise<CommercialTerms> {
  try {
    const values = await new PlatformSettingsService(db()).values();
    return commercialTermsFrom(values);
  } catch (error) {
    console.error('[marketing] could not read commercial terms', safeError(error));
    return commercialTermsFrom(PLATFORM_SETTING_DEFAULTS);
  }
}
