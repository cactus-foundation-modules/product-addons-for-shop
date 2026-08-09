import { prisma } from '@/lib/db/prisma'
import { PAD_DEFAULT_SETTINGS, type PadSettings } from '@/modules/product-addons-for-shop/lib/types'

// Settings singleton, defensively read: a missing row (or a table that has not
// migrated yet) answers with the defaults rather than an error, so nothing on
// the storefront ever depends on this module's own migration timing.

type Row = { noun_singular: string; noun_plural: string; showcase_surface: string }

export async function getPadSettings(): Promise<PadSettings> {
  try {
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT "noun_singular", "noun_plural", "showcase_surface" FROM "pad_settings" WHERE "id" = 'singleton' LIMIT 1
    `
    const row = rows[0]
    if (!row) return PAD_DEFAULT_SETTINGS
    const surface = row.showcase_surface === 'BLOCK' || row.showcase_surface === 'NONE' ? row.showcase_surface : 'TAB'
    return {
      nounSingular: row.noun_singular.trim() || PAD_DEFAULT_SETTINGS.nounSingular,
      nounPlural: row.noun_plural.trim() || PAD_DEFAULT_SETTINGS.nounPlural,
      showcaseSurface: surface,
    }
  } catch {
    return PAD_DEFAULT_SETTINGS
  }
}

export async function savePadSettings(settings: PadSettings): Promise<void> {
  await prisma.$executeRaw`
    INSERT INTO "pad_settings" ("id", "noun_singular", "noun_plural", "showcase_surface", "updated_at")
    VALUES ('singleton', ${settings.nounSingular}, ${settings.nounPlural}, ${settings.showcaseSurface}, NOW())
    ON CONFLICT ("id") DO UPDATE SET
      "noun_singular" = ${settings.nounSingular},
      "noun_plural" = ${settings.nounPlural},
      "showcase_surface" = ${settings.showcaseSurface},
      "updated_at" = NOW()
  `
}
