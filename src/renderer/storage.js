// localStorage persistence layer
window.AppStorage = {
  KEYS: {
    clients:    'ts_clients',
    activities: 'ts_activities',
    expenses:   'ts_expenses',
    studio:     'ts_studio',
    fiscal:     'ts_fiscal',
  },
  load(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v !== null ? JSON.parse(v) : fallback;
    } catch { return fallback; }
  },
  save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch (e) { console.warn('[Storage] save failed:', key, e); }
  },
  reset() {
    Object.values(this.KEYS).forEach(k => localStorage.removeItem(k));
    location.reload();
  },
};
