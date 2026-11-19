import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const schemaPath = resolve(dirname(fileURLToPath(import.meta.url)), '../db/schema.sql');
export function openDatabase(path = process.env.DATABASE_PATH || './data/proof.sqlite') {
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  db.exec(readFileSync(schemaPath,'utf8'));
  return db;
}
export function transaction(db,fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch(err) { db.exec('ROLLBACK'); throw err; }
}
export function one(db,sql,...args) { return db.prepare(sql).get(...args) || null; }
export function all(db,sql,...args) { return db.prepare(sql).all(...args); }
export function run(db,sql,...args) { return db.prepare(sql).run(...args); }
