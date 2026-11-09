// Where the app keeps its data. PARCELLA_DB opens a different database than
// the standard one, which is what lets a copy be worked on while the real
// file stays closed and untouched. Pure, so it carries regression tests.
const path = require('path');

function resolveDbPath(userData, env) {
  const override = String(((env || {}).PARCELLA_DB) || '').trim();
  if (!override) return path.join(userData, 'timesheet.db');
  // Relative overrides resolve inside userData: the invoice archive and the
  // auto-backups live there too, so a bare filename keeps them together.
  return path.isAbsolute(override) ? override : path.join(userData, override);
}

module.exports = { resolveDbPath };
