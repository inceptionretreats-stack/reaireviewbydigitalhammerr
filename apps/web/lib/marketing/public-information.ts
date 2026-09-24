/** Public contact details published at https://digitalhammerr.com/contact-us/. */
export const PUBLIC_CONTACT = {
  name: 'Digital Hammerr',
  email: 'info@digitalhammerr.com',
  phone: '+91 99297 53194',
  phoneHref: 'tel:+919929753194',
  website: 'https://digitalhammerr.com/contact-us/',
} as const;

// Keep these pages under the already-reserved /legal namespace so they cannot
// take over the public URL of an existing business profile.
export const PUBLIC_INFORMATION_LINKS = [
  { href: '/legal/privacy', label: 'Privacy' },
  { href: '/legal/terms', label: 'Terms' },
  { href: '/legal/cancellation-refunds', label: 'Cancellation / Refunds' },
  { href: '/legal/contact', label: 'Contact' },
] as const;
