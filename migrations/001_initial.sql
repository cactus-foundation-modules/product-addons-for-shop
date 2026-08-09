-- product-addons-for-shop: link real products to a main product as add-ons
-- ("Accessories" by default on the storefront - the noun is a setting).
--
-- One row per (main product -> add-on product) link. Everything about HOW the
-- add-on is offered - option mapping modes, quantity rule, model context key -
-- lives in `config` jsonb, deliberately: the shapes reference shop-variations
-- options and values BY SLUG (never by id - a catalogue re-import regenerates
-- ids and would silently break stored maps), and slugs are strings the schema
-- has no business enumerating. See lib/types.ts for the config shape.
CREATE TABLE IF NOT EXISTS "pad_links" (
  "id" TEXT PRIMARY KEY,
  -- The main listing (a parent product) this add-on is offered on.
  "product_id" TEXT NOT NULL,
  -- The add-on's own listing (also a parent product; its variants are what the
  -- shopper's choices resolve to and what the extra cart line carries).
  "addon_product_id" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT TRUE,
  "position" INTEGER NOT NULL DEFAULT 0,
  -- What this add-on contributes to the 3D model context when active
  -- (e.g. 'screens'). Empty = it never changes the model.
  "model_context_key" TEXT NOT NULL DEFAULT '',
  -- Whether the space planner may stage this add-on as its own placeable item
  -- when it cannot ride inside a combined model (screens yes, loose shelves no).
  "planner_standalone" BOOLEAN NOT NULL DEFAULT TRUE,
  "config" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "pad_links_product_addon_unique" UNIQUE ("product_id", "addon_product_id"),
  CONSTRAINT "pad_links_product_fkey" FOREIGN KEY ("product_id")
    REFERENCES "shp_products" ("id") ON DELETE CASCADE,
  CONSTRAINT "pad_links_addon_product_fkey" FOREIGN KEY ("addon_product_id")
    REFERENCES "shp_products" ("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "pad_links_product_idx" ON "pad_links" ("product_id", "position");
CREATE INDEX IF NOT EXISTS "pad_links_addon_product_idx" ON "pad_links" ("addon_product_id");

-- Sitewide settings singleton: what add-ons are CALLED on the storefront (the
-- owner's word - "Accessories" on a furniture shop), and where the showcase
-- appears (the automatic tab, a hand-placed block, or nowhere).
CREATE TABLE IF NOT EXISTS "pad_settings" (
  "id" TEXT PRIMARY KEY,
  "noun_singular" TEXT NOT NULL DEFAULT 'Add-on',
  "noun_plural" TEXT NOT NULL DEFAULT 'Add-ons',
  -- 'TAB' | 'BLOCK' | 'NONE'
  "showcase_surface" TEXT NOT NULL DEFAULT 'TAB',
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO "pad_settings" ("id") VALUES ('singleton')
ON CONFLICT ("id") DO NOTHING;
