// Shared layout components: Sidebar, Topbar
const { useState, useEffect, useMemo, useRef } = React;

const COMMESSA_COLORS = [
  "oklch(0.6 0.13 250)", "oklch(0.65 0.12 180)", "oklch(0.65 0.13 50)",
  "oklch(0.6 0.13 320)", "oklch(0.7 0.13 100)", "oklch(0.65 0.13 30)",
  "oklch(0.6 0.12 280)", "oklch(0.7 0.10 220)", "oklch(0.55 0.14 15)",
];

function getClientContacts(client) {
  if (client?.contacts?.length) return client.contacts;
  if (client?.contact || client?.email) {
    return [{ name: client.contact || "", role: "Principale", email: client.email || "" }];
  }
  return [];
}

function getClientInvoiceContact(client) {
  const cts = getClientContacts(client);
  return cts.find(c => c.role === "Fatturazione") || cts[0] || null;
}

window.COMMESSA_COLORS = COMMESSA_COLORS;
window.getClientContacts = getClientContacts;
window.getClientInvoiceContact = getClientInvoiceContact;

const Sidebar = ({ active, onNav, clientCount, expenseCount, studio }) => {
  const u = studio || window.APP_DATA.user;
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="sidebar-brand-mark">P</div>
        <div>
          <div>Parcella</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400 }}>v {window.APP_VERSION || '1.0.0'}</div>
        </div>
      </div>

      <button className={"nav-item " + (active === "dashboard" ? "active" : "")} onClick={() => onNav("dashboard")}>
        <Icon name="dashboard" /> {t('nav.dashboard')}
      </button>
      <button className={"nav-item " + (active === "clients" ? "active" : "")} onClick={() => onNav("clients")}>
        <Icon name="users" /> {t('nav.clients')}
        <span className="badge">{clientCount}</span>
      </button>
      <button className={"nav-item " + (active === "timesheet" ? "active" : "")} onClick={() => onNav("timesheet")}>
        <Icon name="calendar" /> {t('nav.timesheet')}
      </button>
      <button className={"nav-item " + (active === "expenses" ? "active" : "")} onClick={() => onNav("expenses")}>
        <Icon name="euro" /> {t('nav.expenses')}
        {expenseCount > 0 && <span className="badge">{expenseCount}</span>}
      </button>
      <button className={"nav-item " + (active === "taxes" ? "active" : "")} onClick={() => onNav("taxes")}>
        <Icon name="invoice" /> {t('nav.taxes')}
      </button>
      <button className={"nav-item " + (active === "export" ? "active" : "")} onClick={() => onNav("export")}>
        <Icon name="download" /> {t('nav.export')}
      </button>

      <div className="sidebar-section">{t('nav.settings')}</div>
      <button className={"nav-item " + (active === "settings" ? "active" : "")} onClick={() => onNav("settings")}>
        <Icon name="settings" /> {t('nav.settings')}
      </button>

      <div className="sidebar-footer">
        <div className="avatar">{u.initials}</div>
        <div className="user-meta">
          <div className="name">{u.name}</div>
          <div className="role">{u.role}</div>
        </div>
      </div>
    </aside>
  );
};

const Topbar = ({ title, crumb, actions }) => (
  <div className="topbar">
    <div className="topbar-title">
      {crumb && <div className="crumb">{crumb}</div>}
      <h1>{title}</h1>
    </div>
    <div className="topbar-actions">{actions}</div>
  </div>
);

const Modal = ({ open, onClose, title, children, footer, size = "md" }) => {
  if (!open) return null;
  const sizeClass = size === "lg" ? "modal-lg" : size === "xl" ? "modal-xl" : "";
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className={"modal " + sizeClass} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="btn btn-ghost btn-icon" onClick={onClose}>
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
};

// Desktop chrome (Electron-style)
const DesktopTitlebar = ({ studio }) => (
  <div className="titlebar">
    <div className="traffic-lights">
      <button className="traffic-light close" aria-label="Chiudi" onClick={() => window.electronAPI?.windowClose()}>
        <svg width="6" height="6" viewBox="0 0 6 6"><path d="M1 1 5 5 M5 1 1 5" stroke="#7a0c0a" strokeWidth="1" /></svg>
      </button>
      <button className="traffic-light minimize" aria-label="Minimizza" onClick={() => window.electronAPI?.windowMinimize()}>
        <svg width="6" height="6" viewBox="0 0 6 6"><path d="M1 3 H5" stroke="#a64a04" strokeWidth="1" /></svg>
      </button>
      <button className="traffic-light maximize" aria-label="Ingrandisci" onClick={() => window.electronAPI?.windowMaximize()}>
        <svg width="6" height="6" viewBox="0 0 6 6"><path d="M1.5 3 L4.5 3" stroke="#0a691f" strokeWidth="1" /></svg>
      </button>
    </div>
    <div className="titlebar-title">
      <div className="titlebar-title-mark">P</div>
      Parcella — {studio.firm}
    </div>
  </div>
);

const DesktopMenubar = ({ onNav, onAction }) => {
  const [open, setOpen] = useState(null);
  const close = () => setOpen(null);

  useEffect(() => {
    if (open) {
      const h = (e) => { if (!e.target.closest(".menubar")) close(); };
      document.addEventListener("click", h);
      return () => document.removeEventListener("click", h);
    }
  }, [open]);

  const menus = {
    File: [
      { label: "Nuovo cliente", shortcut: "⌘N", action: () => onAction("newClient") },
      { label: "Registra attività", shortcut: "⇧⌘N", action: () => onAction("newActivity") },
      { label: "Registra spesa", shortcut: "⌥⌘N", action: () => onAction("newExpense") },
      { type: "sep" },
      { label: "Importa CSV…", action: () => {} },
      { label: "Esporta…", shortcut: "⌘E", action: () => onNav("export") },
    ],
    Vai: [
      { label: "Dashboard", shortcut: "⌘1", action: () => onNav("dashboard") },
      { label: "Clienti", shortcut: "⌘2", action: () => onNav("clients") },
      { label: "Timesheet", shortcut: "⌘3", action: () => onNav("timesheet") },
      { label: "Spese", shortcut: "⌘4", action: () => onNav("expenses") },
      { label: "Tasse & contributi", shortcut: "⌘5", action: () => onNav("taxes") },
      { label: "Documenti", shortcut: "⌘6", action: () => onNav("export") },
    ],
    Visualizza: [
      { label: "Mese precedente", shortcut: "⌘←" },
      { label: "Mese corrente", shortcut: "⌘0" },
      { label: "Mese successivo", shortcut: "⌘→" },
      { type: "sep" },
      { label: "Mostra weekend" },
      { label: "Compatta righe" },
    ],
    Strumenti: [
      { label: "Profilo & impostazioni", shortcut: "⌘,", action: () => onAction("settings") },
      { label: "Backup dati…" },
      { label: "Verifica calcoli" },
    ],
    Aiuto: [
      { label: "Documentazione" },
      { label: "Scorciatoie da tastiera", shortcut: "⌘?" },
      { type: "sep" },
      { label: "Informazioni su Parcella" },
    ],
  };

  return (
    <div className="menubar">
      <span className="menubar-item first">Parcella</span>
      {Object.entries(menus).map(([name, items]) => (
        <div key={name} style={{ position: "relative" }}>
          <span
            className="menubar-item"
            style={{ background: open === name ? "var(--bg-hover)" : "" }}
            onClick={(e) => { e.stopPropagation(); setOpen(open === name ? null : name); }}
            onMouseEnter={() => open && setOpen(name)}
          >{name}</span>
          {open === name && (
            <div style={{
              position: "absolute",
              top: "100%",
              left: 0,
              minWidth: 240,
              background: "var(--bg-elevated)",
              border: "1px solid var(--border-strong)",
              borderRadius: "var(--radius-sm)",
              boxShadow: "var(--shadow-lg)",
              padding: 4,
              zIndex: 100,
              marginTop: 2,
            }}>
              {items.map((it, i) => (
                it.type === "sep"
                  ? <div key={i} style={{ height: 1, background: "var(--border)", margin: "4px 8px" }} />
                  : (
                    <div
                      key={i}
                      style={{
                        padding: "5px 10px",
                        borderRadius: 4,
                        fontSize: 12.5,
                        cursor: it.action ? "pointer" : "default",
                        opacity: it.action ? 1 : 0.5,
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 24,
                        color: "var(--text)",
                      }}
                      onMouseEnter={(e) => { if (it.action) e.currentTarget.style.background = "var(--accent)"; if (it.action) e.currentTarget.style.color = "white"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = ""; e.currentTarget.style.color = "var(--text)"; }}
                      onClick={() => { if (it.action) { it.action(); close(); } }}
                    >
                      <span>{it.label}</span>
                      {it.shortcut && <span style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 11 }}>{it.shortcut}</span>}
                    </div>
                  )
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

const DesktopStatusbar = ({ view, clientsCount, activitiesCount, hoursTotal, studio }) => (
  <div className="statusbar">
    <div className="status-group">
      <div className="status-item"><span className="status-dot" /> Sincronizzato</div>
      <div className="status-item">{studio.firm}</div>
    </div>
    <div className="status-group">
      <div className="status-item">{clientsCount} clienti</div>
      <div className="status-item">{activitiesCount} attività · {fmtH(hoursTotal)}</div>
      <div className="status-item">Parcella v{window.APP_VERSION || '1.0.0'}</div>
    </div>
  </div>
);

window.DesktopTitlebar = DesktopTitlebar;
window.DesktopMenubar = DesktopMenubar;
window.DesktopStatusbar = DesktopStatusbar;

// ── Toast notification system ────────────────────────────────────────────────
// Usage: window.showToast('Salvato', 'success' | 'error' | 'info' | 'warning')
const TOAST_EVENT = 'parcella-toast';

window.showToast = (message, type = 'info', duration = 3800) => {
  const id = Date.now() + Math.random();
  document.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: { id, message, type, duration } }));
};

const TOAST_STYLES = {
  success: { bg: 'oklch(0.96 0.06 145)', border: 'oklch(0.80 0.14 145)', color: 'oklch(0.32 0.14 145)', icon: '✓' },
  error:   { bg: 'oklch(0.96 0.06 25)',  border: 'oklch(0.82 0.14 25)',  color: 'oklch(0.38 0.18 25)',  icon: '✕' },
  warning: { bg: 'oklch(0.97 0.06 80)',  border: 'oklch(0.84 0.12 80)',  color: 'oklch(0.45 0.14 75)',  icon: '⚠' },
  info:    { bg: 'oklch(0.97 0.03 250)', border: 'oklch(0.84 0.08 250)', color: 'oklch(0.38 0.12 250)', icon: 'ℹ' },
};

const ToastContainer = () => {
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    const handler = (e) => {
      const toast = { ...e.detail, entering: true };
      setToasts(prev => [...prev.slice(-4), toast]);
      // Start exit animation then remove
      setTimeout(() => {
        setToasts(prev => prev.map(t => t.id === toast.id ? { ...t, leaving: true } : t));
        setTimeout(() => setToasts(prev => prev.filter(t => t.id !== toast.id)), 320);
      }, toast.duration);
    };
    document.addEventListener(TOAST_EVENT, handler);
    return () => document.removeEventListener(TOAST_EVENT, handler);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div style={{
      position: 'fixed', bottom: 28, right: 24, zIndex: 9999,
      display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-end',
      pointerEvents: 'none',
    }}>
      {toasts.map(toast => {
        const s = TOAST_STYLES[toast.type] || TOAST_STYLES.info;
        return (
          <div key={toast.id} onClick={() => setToasts(prev => prev.filter(t => t.id !== toast.id))}
            style={{
              background: s.bg,
              border: `1px solid ${s.border}`,
              color: s.color,
              borderRadius: 10,
              padding: '10px 16px',
              fontSize: 13.5,
              fontWeight: 500,
              maxWidth: 380,
              boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
              display: 'flex', alignItems: 'center', gap: 10,
              pointerEvents: 'all',
              cursor: 'pointer',
              opacity: toast.leaving ? 0 : 1,
              transform: toast.leaving ? 'translateX(16px)' : 'translateX(0)',
              transition: 'opacity 0.28s ease, transform 0.28s ease',
              userSelect: 'none',
            }}>
            <span style={{ fontSize: 15, flexShrink: 0 }}>{s.icon}</span>
            <span>{toast.message}</span>
          </div>
        );
      })}
    </div>
  );
};
window.ToastContainer = ToastContainer;

// P.IVA helpers — store bare number, display with prefix
const normalizePIVA = (raw) => raw.replace(/^p\.?\s*iva\s*/i, '').trim();
const fmtPIVA = (piva) => piva ? 'P.IVA ' + piva : '';

window.normalizePIVA = normalizePIVA;
window.fmtPIVA = fmtPIVA;

// Currency format — locale-aware
const fmtEUR = (n) => new Intl.NumberFormat(window._lang === 'en' ? 'en-GB' : 'it-IT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 }).format(n);
const fmtNum = (n, d = 2) => new Intl.NumberFormat(window._lang === 'en' ? 'en-GB' : 'it-IT', { minimumFractionDigits: d, maximumFractionDigits: d }).format(n);
const fmtH = (n) => `${fmtNum(n, n % 1 === 0 ? 0 : 1)}h`;

// Date helpers — arrays managed by i18n.js, fallback if i18n not loaded
const MONTHS_IT    = window.MONTHS_IT    || ["gennaio","febbraio","marzo","aprile","maggio","giugno","luglio","agosto","settembre","ottobre","novembre","dicembre"];
const DOW_IT_SHORT = window.DOW_IT_SHORT || ["Dom","Lun","Mar","Mer","Gio","Ven","Sab"];
const DOW_IT_1     = window.DOW_IT_1     || ["D","L","M","M","G","V","S"];

const monthKey = (year, month) => `${year}-${String(month + 1).padStart(2, "0")}`;
const daysInMonth = (year, month) => new Date(year, month + 1, 0).getDate();
const dowOfDay = (year, month, day) => new Date(year, month, day).getDay();

// Compute amounts for a given client + hours
function computeInvoiceAmounts(client, hours) {
  const baseImponibile = hours * client.hourlyRate; // before cassa
  let imponibile, cassa, iva, total;

  if (client.cassaIncluded) {
    // tariff includes cassa - the imponibile reported is the base
    imponibile = baseImponibile;
    cassa = 0; // cassa is "internal" and not billed separately
    const ivaBase = imponibile;
    iva = (ivaBase * client.vatPct) / 100;
  } else {
    imponibile = baseImponibile;
    cassa = (imponibile * client.cassaPct) / 100;
    const ivaBase = imponibile + cassa;
    iva = (ivaBase * client.vatPct) / 100;
  }

  let withholding = 0;
  if (client.withholding) {
    withholding = (imponibile + cassa) * 0.20;
  }

  total = imponibile + cassa + iva - withholding;
  return { imponibile, cassa, iva, withholding, total };
}

window.Sidebar = Sidebar;
window.Topbar = Topbar;
window.Modal = Modal;
window.fmtEUR = fmtEUR;
window.fmtNum = fmtNum;
window.fmtH = fmtH;
window.MONTHS_IT = MONTHS_IT;
window.DOW_IT_SHORT = DOW_IT_SHORT;
window.DOW_IT_1 = DOW_IT_1;
window.monthKey = monthKey;
window.daysInMonth = daysInMonth;
window.dowOfDay = dowOfDay;
window.computeInvoiceAmounts = computeInvoiceAmounts;
