import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { businessStatus, citext, linkType } from './enums';
import { users } from './identity';

export const businesses = pgTable(
  'businesses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // AMENDMENT-015 — cascades, like every other foreign key in the schema.
    // This was the one FK with no ON DELETE action, so deleting a user raised a constraint
    // violation instead of removing their business. Flow J's "irreversible purge" needs the
    // cascade, and without it test fixtures could not tear down either — which is how the gap
    // was found: cleanup failed silently and rows leaked between tests.
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 160 }).notNull(),
    category: varchar('category', { length: 100 }).notNull(),

    // AMENDMENT-009 — was varchar(1000); ONB-01 specifies a 0-500 short description.
    description: varchar('description', { length: 500 }),

    city: varchar('city', { length: 100 }),
    state: varchar('state', { length: 100 }),
    countryCode: char('country_code', { length: 2 }).notNull().default('IN'),

    // AMENDMENT-004 — AC-026 requires date filters in the business-local timezone, or a
    // documented default. No timezone column existed anywhere, which left every
    // analytics_daily_business.metric_date boundary undefined.
    timezone: varchar('timezone', { length: 64 }).notNull().default('Asia/Kolkata'),

    status: businessStatus('status').notNull().default('DRAFT'),
    logoAssetId: uuid('logo_asset_id').references((): AnyPgColumn => assets.id),
    coverAssetId: uuid('cover_asset_id').references((): AnyPgColumn => assets.id),
    brandAccent: varchar('brand_accent', { length: 7 }),
    configVersion: bigint('config_version', { mode: 'number' }).notNull().default(1),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('idx_businesses_owner').on(t.ownerUserId),
    index('idx_businesses_status').on(t.status),
  ],
);

/**
 * AMENDMENT-005 — one slug namespace.
 *
 * 06_Database_Schema.sql put live slugs on businesses.slug and retired ones in
 * business_slug_aliases, each with its own UNIQUE. Two independent constraints do not
 * compose into one namespace, so a new business could claim a slug still serving as another
 * business's 180-day redirect (04_User_Flows.md Flow I). Both now live in this one table,
 * where the primary key IS the namespace.
 *
 * It also makes the public route a single indexed lookup answering "which business, and is
 * this a redirect?" in one query — exactly what PUB-01 needs.
 */
export const businessSlugs = pgTable(
  'business_slugs',
  {
    slug: citext('slug').primaryKey(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    isPrimary: boolean('is_primary').notNull().default(false),
    redirectUntil: timestamp('redirect_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_one_primary_slug_per_business')
      .on(t.businessId)
      .where(sql`is_primary`),
    index('idx_business_slugs_business').on(t.businessId),
    check('ck_alias_has_expiry', sql`is_primary OR redirect_until IS NOT NULL`),
  ],
);

export const assets = pgTable('assets', {
  id: uuid('id').primaryKey().defaultRandom(),
  businessId: uuid('business_id').references((): AnyPgColumn => businesses.id, {
    onDelete: 'cascade',
  }),
  storageKey: text('storage_key').notNull().unique(),
  mimeType: varchar('mime_type', { length: 100 }).notNull(),
  bytes: bigint('bytes', { mode: 'number' }).notNull(),
  width: integer('width'),
  height: integer('height'),
  checksumSha256: char('checksum_sha256', { length: 64 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

/**
 * Public profile sections — presentation only.
 *
 * AMENDMENT-003 resolves an ownership conflict: 20_Test_Data_Seed.json seeded GOOGLE_REVIEW
 * as a link carrying its own url, while 06_Database_Schema.sql put the Google URL in
 * review_destinations. Two writable copies of one URL is how AC-017 ("changing the Google
 * review URL immediately changes every QR's destination") silently half-works.
 *
 * Resolution: review_destinations owns the URL. A GOOGLE_REVIEW row here owns only whether
 * and where the button renders, so it still participates in hide/reorder (D-015).
 */
export const businessLinks = pgTable(
  'business_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    linkType: linkType('link_type').notNull(),
    label: varchar('label', { length: 80 }).notNull(),
    url: text('url'),
    phone: varchar('phone', { length: 20 }),
    isEnabled: boolean('is_enabled').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    metadata: jsonb('metadata').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_business_link').on(t.businessId, t.linkType, t.label),
    index('idx_business_links_public').on(t.businessId, t.isEnabled, t.sortOrder),
    uniqueIndex('uq_one_google_review_link')
      .on(t.businessId)
      .where(sql`link_type = 'GOOGLE_REVIEW'`),
    check('ck_google_review_has_no_url', sql`link_type <> 'GOOGLE_REVIEW' OR url IS NULL`),
    check(
      'ck_enabled_link_has_target',
      sql`NOT is_enabled OR link_type = 'GOOGLE_REVIEW' OR url IS NOT NULL OR phone IS NOT NULL`,
    ),
  ],
);

/** Single source of truth for external review destinations (AC-017). */
export const reviewDestinations = pgTable(
  'review_destinations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id, { onDelete: 'cascade' }),
    platform: varchar('platform', { length: 40 }).notNull(),
    label: varchar('label', { length: 80 }).notNull(),
    url: text('url').notNull(),
    isPrimary: boolean('is_primary').notNull().default(false),
    isEnabled: boolean('is_enabled').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('uq_one_primary_review_destination')
      .on(t.businessId)
      .where(sql`is_primary`),
    index('idx_review_destinations_business').on(t.businessId),
  ],
);

export type Business = typeof businesses.$inferSelect;
export type BusinessSlug = typeof businessSlugs.$inferSelect;
export type Asset = typeof assets.$inferSelect;
export type BusinessLink = typeof businessLinks.$inferSelect;
export type ReviewDestination = typeof reviewDestinations.$inferSelect;
