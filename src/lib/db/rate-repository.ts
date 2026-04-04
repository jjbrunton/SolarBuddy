import { getDb } from '.';
import type { AgileRate } from '../octopus/rates';

function upsertRates(table: 'rates' | 'export_rates', rates: AgileRate[]) {
  const db = getDb();
  const upsert = db.prepare(`
    INSERT INTO ${table} (valid_from, valid_to, price_inc_vat, price_exc_vat, fetched_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(valid_from) DO UPDATE SET
      price_inc_vat = excluded.price_inc_vat,
      price_exc_vat = excluded.price_exc_vat,
      fetched_at = excluded.fetched_at
  `);
  const now = new Date().toISOString();
  const transaction = db.transaction((rates: AgileRate[]) => {
    for (const rate of rates) {
      upsert.run(rate.valid_from, rate.valid_to, rate.price_inc_vat, rate.price_exc_vat, now);
    }
  });
  transaction(rates);
}

function getStoredRatesFromTable(table: 'rates' | 'export_rates', from?: string, to?: string): AgileRate[] {
  const db = getDb();
  let query = `SELECT valid_from, valid_to, price_inc_vat, price_exc_vat FROM ${table}`;
  const conditions: string[] = [];
  const params: string[] = [];

  if (from) {
    conditions.push('valid_from >= ?');
    params.push(from);
  }
  if (to) {
    conditions.push('valid_to <= ?');
    params.push(to);
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }
  query += ' ORDER BY valid_from ASC';

  return db.prepare(query).all(...params) as AgileRate[];
}

export function storeImportRates(rates: AgileRate[]) {
  upsertRates('rates', rates);
  console.log(`[Octopus] Stored ${rates.length} rates`);
}

export function storeExportRates(rates: AgileRate[]) {
  upsertRates('export_rates', rates);
  console.log(`[Octopus] Stored ${rates.length} export rates`);
}

export function getStoredImportRates(from?: string, to?: string): AgileRate[] {
  return getStoredRatesFromTable('rates', from, to);
}

export function getStoredExportRates(from?: string, to?: string): AgileRate[] {
  return getStoredRatesFromTable('export_rates', from, to);
}
