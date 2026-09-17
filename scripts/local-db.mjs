import {DatabaseSync} from 'node:sqlite';
import {readFileSync, readdirSync, mkdirSync} from 'node:fs';
export function localDB(path = ':memory:') {
  if (path !== ':memory:') mkdirSync('.local', {recursive: true});
  const sqlite = new DatabaseSync(path);
  sqlite.exec('CREATE TABLE IF NOT EXISTS _local_migrations (name TEXT PRIMARY KEY)');
  for (const name of readdirSync('drizzle')
    .filter(n => n.endsWith('.sql'))
    .sort()) {
    if (!sqlite.prepare('SELECT name FROM _local_migrations WHERE name = ?').get(name)) {
      sqlite.exec(readFileSync('drizzle/' + name, 'utf8'));
      sqlite.prepare('INSERT INTO _local_migrations VALUES (?)').run(name);
    }
  }
  const wrapper = {
    sqlite,
    prepare(sql) {
      let args = [];
      return {
        bind(...values) {
          args = values;
          return this;
        },
        async first() {
          return sqlite.prepare(sql).get(...args) ?? null;
        },
        async all() {
          return {results: sqlite.prepare(sql).all(...args)};
        },
        runSync() {
          return {success: true, meta: sqlite.prepare(sql).run(...args)};
        },
        async run() {
          return this.runSync();
        },
      };
    },
    // Like a D1 batch: one transaction, all or nothing. It runs synchronously so that two callers
    // awaiting in parallel can never interleave inside each other's transaction.
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const result = statements.map(s => s.runSync());
        sqlite.exec('COMMIT');
        return result;
      } catch (e) {
        sqlite.exec('ROLLBACK');
        throw e;
      }
    },
  };
  return wrapper;
}
