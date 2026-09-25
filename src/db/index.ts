import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import * as schema from './schema'

if (!process.env.DATABASE_URL_UNPOOLED) throw new Error('Set DATABASE_URL_UNPOOLED to a Neon connection string.')

/**
 * Drizzle on Neon's serverless driver (SQL over HTTP): every query is one
 * self-contained round trip, with no connection to pool. `db.batch` sends
 * several statements as one transaction, still one round trip.
 */
export const db = drizzle(neon(process.env.DATABASE_URL_UNPOOLED), { schema })
