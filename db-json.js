// JSON file-based storage — fallback if better-sqlite3 unavailable
const fs = require('fs');
const path = require('path');

class AppDBJson {
  constructor(dbPath) {
    this.filePath = dbPath.replace(/\.db$/, '.json');
    this._empty = true;
    this._data = { clients: [], activities: [], expenses: [], studio: null, fiscal: null };
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.filePath)) {
        this._data = { ...this._data, ...JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) };
        this._empty = this._data.clients.length === 0 && !this._data.studio;
      }
    } catch (e) { console.error('[db-json] load error', e); }
  }

  _save() {
    try { fs.writeFileSync(this.filePath, JSON.stringify(this._data, null, 2), 'utf-8'); }
    catch (e) { console.error('[db-json] save error', e); }
  }

  loadAll() {
    return { ...this._data, empty: this._empty };
  }

  saveCollection(key, data) {
    this._data[key] = data;
    this._empty = false;
    this._save();
  }

  saveKV(key, value) {
    this._data[key] = value;
    this._empty = false;
    this._save();
  }

  exportJSON() {
    return JSON.stringify(this._data, null, 2);
  }

  importJSON(json) {
    const data = JSON.parse(json);
    this._data = { ...this._data, ...data };
    this._empty = false;
    this._save();
  }

  stats() {
    const size = fs.existsSync(this.filePath) ? fs.statSync(this.filePath).size : 0;
    return {
      clients:    this._data.clients.length,
      activities: this._data.activities.length,
      expenses:   this._data.expenses.length,
      sizeBytes:  size,
    };
  }

  close() {}
}

module.exports = AppDBJson;
