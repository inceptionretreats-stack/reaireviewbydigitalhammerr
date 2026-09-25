/** Keep the public picker and the generation endpoint on the same bounded service list. */
export const MAX_CUSTOMER_SERVICES = 30;
export const MAX_CUSTOMER_SERVICE_LENGTH = 80;
/** Leave enough of the 1,200-character editor budget for natural sentences. */
export const MAX_SELECTED_SERVICE_CHARACTERS = 600;

export function getSelectableServices(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter((item) => item.length > 0 && item.length <= MAX_CUSTOMER_SERVICE_LENGTH),
    ),
  ].slice(0, MAX_CUSTOMER_SERVICES);
}

export type ServiceSelectionResult =
  { ok: true; services: string[] } | { ok: false; message: string };

/**
 * Only choices configured by this resolved business are accepted. In particular, the public
 * request cannot add free-form text to the prompt or select another business's services.
 * Older clients must refresh and choose a service; silently selecting every service would
 * wrongly claim the customer used all of them. Businesses without a list keep the general flow.
 */
export function validateSelectedServices(
  value: unknown,
  configuredServices: unknown,
): ServiceSelectionResult {
  const available = getSelectableServices(configuredServices);
  if (value === undefined && available.length === 0) return { ok: true, services: [] };
  if (
    !Array.isArray(value) ||
    value.length > MAX_CUSTOMER_SERVICES ||
    value.some(
      (item) =>
        typeof item !== 'string' || item.length === 0 || item.length > MAX_CUSTOMER_SERVICE_LENGTH,
    )
  ) {
    return {
      ok: false,
      message: 'Choose the services you used from the list, then create your draft.',
    };
  }
  if (available.length > 0 && value.length === 0) {
    return { ok: false, message: 'Choose at least one service you used before creating a draft.' };
  }
  if (value.some((item) => !available.includes(item as string))) {
    return {
      ok: false,
      message: 'The service choices have changed. Refresh this page and choose again.',
    };
  }
  // Canonical configured order makes equivalent selections stable across clicks/regenerations.
  const services = available.filter((service) => value.includes(service));
  if (services.join(', ').length > MAX_SELECTED_SERVICE_CHARACTERS) {
    return {
      ok: false,
      message: 'Choose fewer services for one draft so there is room for your own experience.',
    };
  }
  return { ok: true, services };
}
