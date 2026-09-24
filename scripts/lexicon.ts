/**
 * Rebuild the `search_terms` typo lexicon from article titles: every plain
 * lowercase word of 3+ letters and how many titles contain it. Runs in one
 * transaction, so searches keep using the old lexicon until it commits.
 *
 *   npm run db:lexicon
 */

import { Client } from 'pg'
import { describeUrl, unpooledUrl } from './env'

async function main() {
  const url = unpooledUrl()
  console.log(`› connecting ${describeUrl(url)}`)
  const client = new Client({ connectionString: url, statement_timeout: 0, query_timeout: 0, keepAlive: true })
  await client.connect()
  try {
    const started = performance.now()
    await client.query('BEGIN')
    await client.query(`SET LOCAL work_mem = '512MB'`)
    await client.query('TRUNCATE search_terms')
    // 'simple' keeps words unstemmed, so suggestions are real spellings.
    const { rowCount } = await client.query(
      `INSERT INTO search_terms (word, ndoc)
       SELECT word, ndoc FROM ts_stat($$SELECT to_tsvector('simple', title) FROM articles$$)
       WHERE word ~ '^[a-z]{3,}$'`,
    )
    await client.query('COMMIT')
    await client.query('ANALYZE search_terms')
    console.log(`✓ ${rowCount?.toLocaleString()} words in ${((performance.now() - started) / 1000).toFixed(0)}s`)
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    await client.end()
  }
}

main()
