import { defineConfig } from '@neon/config/v1'

/**
 * Neon services beside the database: the public bucket that holds copies of
 * lead images, the function that copies them, and the trigger that runs it
 * every minute. Apply with `neon deploy`.
 */
export default defineConfig({
  buckets: {
    assets: { access: 'public_read' },
  },
  functions: {
    images: { name: 'copy lead images', source: 'functions/images.ts' },
  },
  triggers: {
    'copy-images': { type: 'schedule', function: 'images', cron: '* * * * *' },
  },
})
