/**
 * The images function: copies lead images from Wikimedia into the public
 * "assets" bucket, so pages load them from Neon instead.
 *
 * A Function Trigger (`copy-images` in neon.ts) POSTs here every minute. Each
 * run drains `image_queue` in priority order (articles people viewed, then the
 * backfill of every image, largest articles first) in batches until it is empty
 * or the run has used its time budget. For each article it fetches the 250px
 * thumbnail from Wikimedia's thumbnail CDN (through Wikipedia's file redirect
 * when the file is not on Commons) and uploads it as it came. Only once it is
 * uploaded does `article_images.stored` point at the copy, so a page never
 * links to a missing object. A 404 or 410 means the file is gone from Wikimedia
 * (deleted or renamed since the dump), so the article's image row is dropped at
 * once and its page shows no image instead of a broken one. Other failures are
 * kept on the queue row and retried after 10 minutes, up to 5 attempts.
 *
 * Wikimedia is the limit, not this function: its Robot policy allows 2 media
 * downloads at a time, and its servers answer 429 with a Retry-After when a
 * client asks for too many uncached thumbnails. Every worker pauses for that
 * long and carries on, so a run keeps copying for most of its minute. When a
 * pause would outlast the run, the run hands its unfinished claims back without
 * counting them as attempts.
 */

import { attachDatabasePool } from '@neon/functions'
import { parseTriggerInvocation } from '@neon/functions/triggers'
import { AwsClient } from 'aws4fetch'
import { Pool } from 'pg'
import { createHash } from 'node:crypto'

const BUCKET = 'assets'
/** The one width copied, a standard Wikimedia thumbnail size. The app shows it everywhere (see `imageSrc` in src/lib/links.ts). */
const WIDTH = 250
/** Articles claimed at a time. Each batch's database writes go out as one statement. */
const BATCH = 50
/**
 * Images copied at once, which is also the number of requests open to
 * Wikimedia. Its Robot policy caps media downloads at a total concurrency of 2:
 * https://wikitech.wikimedia.org/wiki/Robot_policy
 */
const CONCURRENCY = 2
/** No new batch starts after this, so a run ends around the next one-minute tick. */
const BUDGET_MS = 50_000
/** Waiting out a 429 stops here: past it, the run hands its remaining claims back instead. */
const DEADLINE_MS = 58_000
const MAX_ATTEMPTS = 5
// Wikimedia asks every client to identify itself.
const USER_AGENT = 'WikiFaster/1.0 (https://github.com/rishi-raj-jain/WikiFaster)'

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 })
attachDatabasePool(pool)

// Signs S3 requests (SigV4) with the injected AWS_* credentials. It retries 5xx and 429 responses with backoff.
const s3 = new AwsClient({ accessKeyId: process.env.AWS_ACCESS_KEY_ID!, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!, region: process.env.AWS_REGION, service: 's3', retries: 3 })
// Neon storage uses path-style URLs: <endpoint>/<bucket>/<key>.
const BUCKET_URL = `${process.env.AWS_ENDPOINT_URL_S3}/${BUCKET}`

class RateLimited extends Error {}

/** The file no longer exists on Wikimedia. Retrying cannot help. */
class Missing extends Error {}

/**
 * When Wikimedia next accepts requests, after a 429. Shared by every worker
 * (and every run on this isolate), so one 429 pauses them all.
 */
let resumeAt = 0

/** Thumbnails fetched through Special:Redirect because the direct Commons URL failed, for the run log. */
let redirects = 0

type Claim = { id: string; file: string; stored: string | null }

/** A finished queue row: `stored` is the new copy's key, or null when the article already had one. */
type Done = { id: string; file: string; stored: string | null }

/** Claims up to BATCH queued articles: unclaimed rows, and claims left over from a run that died. */
async function claim(): Promise<Claim[]> {
  const { rows } = await pool.query<Claim>(
    `UPDATE image_queue q SET claimed_at = now(), attempts = q.attempts + 1
     FROM article_images i
     WHERE i.id = q.id AND q.id IN (
       SELECT id FROM image_queue
       WHERE attempts < $2 AND (claimed_at IS NULL OR claimed_at < now() - interval '10 minutes')
       ORDER BY priority, queued_at LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING q.id::text AS id, i.file, i.stored`,
    [BATCH, MAX_ATTEMPTS],
  )
  return rows
}

type Image = { body: Uint8Array<ArrayBuffer>; type: string }

/** Formats whose Commons thumbnail is named `<width>px-<file>` (SVGs add `.png`). TIFFs, PDFs and videos are named differently, so they go through Special:Redirect. */
const DIRECT = new Set(['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp'])

/**
 * The thumbnail's address on Wikimedia's thumbnail CDN if the file is on
 * Commons, built the way MediaWiki builds it (the folder is the MD5 of the file
 * name). One request, where Special:Redirect is two: an uncached index.php hit,
 * then the CDN. The host is thumb.wikimedia.org, where Special:Redirect sends
 * browsers: upload.wikimedia.org answers 429 after about 10 thumbnails. Null
 * for formats named differently.
 */
function commonsUrl(file: string, width: number): string | null {
  const extension = file.slice(file.lastIndexOf('.') + 1).toLowerCase()
  if (!DIRECT.has(extension)) return null
  const md5 = createHash('md5').update(file).digest('hex')
  const name = encodeURIComponent(file)
  return `https://thumb.wikimedia.org/wikipedia/commons/thumb/${md5[0]}/${md5.slice(0, 2)}/${name}/${width}px-${name}${extension === 'svg' ? '.png' : ''}`
}

/** Wikipedia's file redirect, the same URL the app falls back to: it finds the file on Commons or English Wikipedia, and serves the original when it is narrower than `width`. */
function redirectUrl(file: string, width: number): string {
  return `https://en.wikipedia.org/w/index.php?title=Special:Redirect/file/${encodeURIComponent(file)}&width=${width}`
}

/** GETs `url` from Wikimedia. A 429 pauses every worker for its Retry-After and then tries again, until the pause would pass `deadline`. */
async function wikimedia(url: string, deadline: number): Promise<Response> {
  for (;;) {
    const wait = resumeAt - Date.now()
    if (wait > 0) {
      if (resumeAt > deadline) throw new RateLimited(`429 from Wikimedia for ${url}`)
      await new Promise((resolve) => setTimeout(resolve, wait))
    }
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(30_000) })
    if (response.status !== 429) return response
    await response.body?.cancel()
    resumeAt = Math.max(resumeAt, Date.now() + (Number(response.headers.get('retry-after')) || 10) * 1000)
  }
}

/**
 * The thumbnail of `file` at `width`: straight from the Commons CDN, or
 * through Special:Redirect when that fails (a file uploaded only to English
 * Wikipedia, or one narrower than `width`).
 */
async function thumbnail(file: string, width: number, deadline: number): Promise<Image> {
  const direct = commonsUrl(file, width)
  let response = direct ? await wikimedia(direct, deadline) : null
  if (!response?.ok) {
    await response?.body?.cancel()
    redirects++
    response = await wikimedia(redirectUrl(file, width), deadline)
  }
  if (response.status === 404 || response.status === 410) throw new Missing(`${response.status} from Wikimedia for ${width}px`)
  if (!response.ok) throw new Error(`${response.status} from Wikimedia for ${width}px`)
  const type = response.headers.get('content-type') ?? ''
  if (!type.startsWith('image/')) throw new Error(`Wikimedia sent ${type || 'no content type'} for ${width}px`)
  return { body: new Uint8Array(await response.arrayBuffer()), type }
}

/** A PutObject. Keys are plain ASCII (`thumbs/<sha1>/<width>`), so they need no encoding. */
async function put(key: string, { body, type }: Image): Promise<void> {
  const response = await s3.fetch(`${BUCKET_URL}/${key}`, { method: 'PUT', body, headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=31536000, immutable' } })
  if (!response.ok) throw new Error(`${response.status} from storage for ${key}: ${(await response.text()).slice(0, 200)}`)
}

/** Uploads the thumbnail of one image as it came and returns its key prefix, or null when the article already has a copy. */
async function copy({ file, stored }: Claim, deadline: number): Promise<string | null> {
  if (stored) return null
  // Keyed by file name, so articles that share an image share its objects. The hash keeps keys plain ASCII.
  const key = `thumbs/${createHash('sha1').update(file).digest('hex')}`
  await put(`${key}/${WIDTH}`, await thumbnail(file, WIDTH, deadline))
  return key
}

/**
 * Points every article that uses a finished file at its copy, not only the
 * claimed one, and takes them all off the queue, in one statement for the
 * whole batch. A file is then never downloaded twice (article_images_file_idx).
 * Matching on the file skips an article whose image changed (a newer dump)
 * while its copy ran. Returns how many other articles shared the batch's files.
 */
async function finish(done: Done[]): Promise<number> {
  if (done.length === 0) return 0
  const { rows } = await pool.query<{ shared: number }>(
    `WITH done AS (SELECT * FROM unnest($1::bigint[], $2::text[], $3::text[]) AS d(id, file, stored)),
     pointed AS (
       UPDATE article_images i SET stored = done.stored FROM done
       WHERE i.file = done.file AND done.stored IS NOT NULL AND i.stored IS NULL
       RETURNING i.id
     ),
     dequeued AS (
       DELETE FROM image_queue q WHERE q.id IN (SELECT id FROM done UNION ALL SELECT id FROM pointed)
     )
     SELECT count(*)::int AS shared FROM pointed WHERE id NOT IN (SELECT id FROM done)`,
    [done.map((d) => d.id), done.map((d) => d.file), done.map((d) => d.stored)],
  )
  return rows[0]?.shared ?? 0
}

/**
 * Drops the image rows of files that are gone from Wikimedia, for every
 * article that uses them, and their queue rows, in one statement. A later load
 * of the dump can bring a row back, and its next view drops it again.
 */
async function drop(missing: Claim[]): Promise<void> {
  if (missing.length === 0) return
  await pool.query(
    `WITH gone AS (SELECT * FROM unnest($1::bigint[], $2::text[]) AS g(id, file)),
     dropped AS (DELETE FROM article_images i USING gone WHERE i.file = gone.file RETURNING i.id)
     DELETE FROM image_queue q WHERE q.id IN (SELECT id FROM gone UNION ALL SELECT id FROM dropped)`,
    [missing.map((m) => m.id), missing.map((m) => m.file)],
  )
}

/** Copies one batch, CONCURRENCY images at a time. Returns what happened, with the claims left when a 429 outlasted the run. */
async function copyBatch(claims: Claim[], deadline: number) {
  const done: Done[] = []
  const failures: { id: string; error: string }[] = []
  const missing: Claim[] = []
  const released: string[] = []
  let limited = false

  const next = claims.values()
  async function worker() {
    for (const item of next) {
      if (limited) {
        released.push(item.id)
        continue
      }
      try {
        done.push({ id: item.id, file: item.file, stored: await copy(item, deadline) })
      } catch (error) {
        if (error instanceof RateLimited) {
          limited = true
          released.push(item.id)
          continue
        }
        if (error instanceof Missing) {
          console.log(`[images] ${item.id} ${item.file}: ${error.message}, dropping the image`)
          missing.push(item)
          continue
        }
        const message = error instanceof Error ? error.message : String(error)
        console.error(`[images] ${item.id} ${item.file}: ${message}`)
        failures.push({ id: item.id, error: message.slice(0, 500) })
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))

  const shared = await finish(done)
  await drop(missing)
  if (failures.length > 0) {
    await pool.query(`UPDATE image_queue q SET error = f.error FROM unnest($1::bigint[], $2::text[]) AS f(id, error) WHERE q.id = f.id`, [failures.map((f) => f.id), failures.map((f) => f.error)])
  }
  // Work cut off by a 429 was not really attempted, so it does not count against its retries.
  if (released.length > 0) {
    await pool.query(`UPDATE image_queue SET claimed_at = NULL, attempts = attempts - 1 WHERE id = ANY($1::bigint[])`, [released])
  }
  return { copied: done.length, shared, missing: missing.length, failed: failures.length, released: released.length, limited }
}

export default {
  async fetch(request: Request): Promise<Response> {
    // Only Neon's trigger delivery carries a matching x-neon-trigger-invocation-id. The proxy strips it from outside requests.
    const parsed = await parseTriggerInvocation(request)
    if (!parsed.ok) return new Response(parsed.error, { status: parsed.error === 'invalid_body' ? 400 : 401 })

    const started = Date.now()
    const deadline = started + DEADLINE_MS
    const redirectsBefore = redirects
    const result = { batches: 0, claimed: 0, copied: 0, shared: 0, missing: 0, failed: 0, released: 0, rateLimited: false, ms: 0 }
    // Runs that overlap are safe: SKIP LOCKED and the claim time keep two runs off the same row.
    while (Date.now() - started < BUDGET_MS) {
      const claims = await claim()
      if (claims.length === 0) break
      const batch = await copyBatch(claims, deadline)
      result.batches++
      result.claimed += claims.length
      result.copied += batch.copied
      result.shared += batch.shared
      result.missing += batch.missing
      result.failed += batch.failed
      result.released += batch.released
      if (batch.limited) {
        result.rateLimited = true
        break
      }
    }
    result.ms = Date.now() - started
    const redirected = redirects - redirectsBefore
    console.log('[images]', JSON.stringify({ ...result, redirected }))
    return Response.json({ ...result, redirected })
  },
}
