/**
 * Apply the extension, table and index SQL from drizzle/. Safe to re-run (IF NOT EXISTS).
 * The full-text BM25 and GIN indexes over every article each take the better
 * part of an hour to build. Each statement runs and commits on its own, so a
 * finished index is kept even if a later statement fails, and no transaction
 * holds locks across several index builds. Pass file paths to apply only those.
 *
 *   npm run db:migrate
 *   npm run db:migrate -- drizzle/0002_search.sql
 */

import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { Client } from 'pg'
import { describeUrl, unpooledUrl } from './env'

/**
 * Splits a migration file into statements at `;` line ends, keeping `$$ … $$`
 * function bodies whole, and drops comment-only chunks.
 */
function statements(text: string): string[] {
  const out: string[] = []
  let current = ''
  let inBody = false
  for (const line of text.split('\n')) {
    current += `${line}\n`
    if ((line.match(/\$\$/g) ?? []).length % 2 === 1) inBody = !inBody
    if (!inBody && /;\s*$/.test(line)) {
      out.push(current)
      current = ''
    }
  }
  out.push(current)
  return out.map((chunk) => chunk.trim().replace(/;$/, '')).filter((chunk) => chunk.replace(/^--.*$/gm, '').trim().length > 0)
}

/** The first line of a statement that is not a comment, for the log. */
function summary(statement: string): string {
  return (statement.split('\n').find((line) => line.trim() && !line.trim().startsWith('--')) ?? '').trim().slice(0, 100)
}

async function main() {
  const args = process.argv.slice(2)
  const files = args.length
    ? args
    : (await readdir('drizzle'))
        .filter((name) => name.endsWith('.sql'))
        .sort()
        .map((name) => `drizzle/${name}`)
  const url = unpooledUrl()
  console.log(`› connecting ${describeUrl(url)}`)
  const client = new Client({ connectionString: url, statement_timeout: 0, query_timeout: 0, keepAlive: true })
  await client.connect()
  try {
    await client.query(`SET maintenance_work_mem = '1GB'`)
    // Postgres 18 builds GIN indexes in parallel.
    await client.query(`SET max_parallel_maintenance_workers = 4`)
    for (const file of files) {
      console.log(`› ${file}`)
      for (const statement of statements(await readFile(path.join(process.cwd(), file), 'utf8'))) {
        const started = performance.now()
        await client.query(statement)
        console.log(`  ${summary(statement)} (${((performance.now() - started) / 1000).toFixed(0)}s)`)
      }
    }
    const { rows } = await client.query<{ name: string; size: string }>(
      `SELECT indexrelid::regclass::text AS name, pg_size_pretty(pg_relation_size(indexrelid)) AS size FROM pg_index WHERE indrelid = 'articles'::regclass ORDER BY 1`,
    )
    for (const row of rows) console.log(`✓ ${row.name} ${row.size}`)
    console.log('✓ migrations applied')
  } finally {
    await client.end()
  }
}

main()
