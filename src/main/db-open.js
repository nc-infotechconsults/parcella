// Opening the database is a two-step decision and BOTH steps can fail.
//
// better-sqlite3 resolves fine at require() and only dlopens its native addon
// inside the Database constructor (lib/database.js: `require('bindings')(...)`).
// So a version-mismatched addon — the ordinary state after an Electron upgrade,
// before `npm run rebuild` has run — sails through a require-only guard and
// throws at construction instead. In createWindow that happens before
// `new BrowserWindow()`, so the app dies with no window at all and the JSON
// fallback, which exists for exactly this case, never gets a chance to run.
//
// The guard therefore has to cover construction, not just resolution.
function openDatabase(dbPath, deps = {}) {
  const loadSqlite = deps.loadSqlite || (() => require('./db'));
  const loadJson   = deps.loadJson   || (() => require('./db-json'));
  const warn       = deps.warn       || console.warn;

  try {
    const Sqlite = loadSqlite();
    const db = new Sqlite(dbPath);
    db._type = 'sqlite';
    return db;
  } catch (err) {
    warn('[main] SQLite unavailable, using JSON fallback:', err.message);
    const Json = loadJson();
    const db = new Json(dbPath);
    db._type = 'json';
    return db;
  }
}

module.exports = { openDatabase };
