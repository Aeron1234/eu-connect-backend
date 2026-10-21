import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readPlacementCity } from '../features/internship-records/placementCity.js';

test('placement city fields are validated as a pair while older clients may omit both', () => {
  assert.deepEqual(readPlacementCity({}), { fields: { city_name: null, province_name: null } });
  assert.deepEqual(readPlacementCity({ city_name: '  Lucena   City ', province_name: ' Quezon ' }), { fields: { city_name: 'Lucena City', province_name: 'Quezon' } });
  for (const body of [{ city_name: 'Lucena' }, { province_name: 'Quezon' }, { city_name: ['Lucena'], province_name: 'Quezon' }, { city_name: 'A'.repeat(101), province_name: 'Quezon' }, { city_name: 'Lucena\nCity', province_name: 'Quezon' }]) assert.ok(readPlacementCity(body).error);
});

test('export backfill has one guarded update for every supplied record and leaves unrelated tables untouched', () => {
  const sql = readFileSync(new URL('../scripts/2026-10-21-map-city-backfill.sql', import.meta.url), 'utf8');
  const ids = [...sql.matchAll(/WHERE id = '([a-zA-Z0-9-]+)'/g)].map(match => match[1]);
  assert.equal(ids.length, 151); assert.equal(new Set(ids).size, 151);
  assert.equal((sql.match(/AND BINARY company_address = BINARY/g) || []).length, 151);
  assert.equal((sql.match(/AND lat <=>/g) || []).length, 151);
  assert.doesNotMatch(sql, /UPDATE (?!internship_records)|DROP TABLE|DELETE FROM|TRUNCATE/i);
  assert.match(sql, /START TRANSACTION/); assert.match(sql, /COMMIT/);
  assert.match(sql, /ADD COLUMN city_name VARCHAR\(100\) NULL/); assert.match(sql, /ADD COLUMN province_name VARCHAR\(100\) NULL/);
});
