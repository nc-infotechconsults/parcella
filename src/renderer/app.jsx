// Main app — state, routing, i18n, SQLite persistence

// ── Persistence helpers ──────────────────────────────────────────────────────
async function dbLoadAll() {
  if (window.api?.db) return window.api.db.loadAll();
  return {
    clients:    AppStorage.load(AppStorage.KEYS.clients, null),
    activities: AppStorage.load(AppStorage.KEYS.activities, null),
    expenses:   AppStorage.load(AppStorage.KEYS.expenses, null),
    studio:     AppStorage.load(AppStorage.KEYS.studio, null),
    fiscal:     AppStorage.load(AppStorage.KEYS.fiscal, null),
    empty:      !AppStorage.load(AppStorage.KEYS.clients, null),
  };
}

function dbSave(key, data) {
  if (window.api?.db) {
    const isKV = key === 'studio' || key === 'fiscal';
    (isKV ? window.api.db.saveKV(key, data) : window.api.db.saveCollection(key, data)).catch(console.error);
  } else {
    AppStorage.save(AppStorage.KEYS[key] || key, data);
  }
}

// ── Loading screen ────────────────────────────────────────────────────────────
const LoadingScreen = () => (
  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "var(--bg)", flexDirection: "column", gap: 16 }}>
    <div style={{ width: 36, height: 36, borderRadius: "50%", border: "3px solid var(--accent)", borderTopColor: "transparent", animation: "ts-spin 0.8s linear infinite" }} />
    <div style={{ color: "var(--text-secondary)", fontSize: 13, fontFamily: "var(--font-mono)" }}>{t('status.loading')}</div>
  </div>
);

// ── Welcome screen (first launch) ─────────────────────────────────────────────
const WelcomeScreen = ({ lang, onSetLang, onLoadDemo, onStartEmpty }) => (
  <div style={{ position: "fixed", inset: 0, background: "var(--bg)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", zIndex: 200, gap: 0 }}>
    {/* Logo */}
    <div style={{ width: 64, height: 64, borderRadius: 18, background: "var(--text)", display: "grid", placeItems: "center", marginBottom: 24 }}>
      <span style={{ color: "var(--bg)", fontSize: 30, fontWeight: 700, fontFamily: "var(--font-mono)" }}>P</span>
    </div>
    <h1 style={{ fontSize: 28, fontWeight: 700, margin: "0 0 8px", letterSpacing: "-0.02em" }}>{t('welcome.title')}</h1>
    <p style={{ color: "var(--text-muted)", fontSize: 14, margin: "0 0 32px", textAlign: "center", maxWidth: 400, lineHeight: 1.5 }}>{t('welcome.subtitle')}</p>

    {/* Language selector */}
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, marginBottom: 36 }}>
      <div style={{ fontSize: 12, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{t('welcome.chooseLang')}</div>
      <div style={{ display: "flex", gap: 8 }}>
        {(window.SUPPORTED_LANGS || []).map(l => (
          <button key={l.code} className={"btn " + (lang === l.code ? "btn-primary" : "")} onClick={() => onSetLang(l.code)}>
            {l.flag} {l.name}
          </button>
        ))}
      </div>
    </div>

    {/* Action cards */}
    <div style={{ display: "flex", gap: 20, maxWidth: 560, width: "100%", padding: "0 24px" }}>
      {[
        { icon: "📊", key: "loadDemo", action: onLoadDemo },
        { icon: "✨", key: "startEmpty", action: onStartEmpty },
      ].map(({ icon, key, action }) => (
        <div key={key} onClick={action} style={{
          flex: 1, padding: 24, border: "1.5px solid var(--border)", borderRadius: 14,
          cursor: "pointer", textAlign: "center", transition: "border-color 0.15s, background 0.15s",
          background: "var(--bg-elevated)",
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.background = "var(--accent-soft)"; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border)"; e.currentTarget.style.background = "var(--bg-elevated)"; }}
        >
          <div style={{ fontSize: 28, marginBottom: 12 }}>{icon}</div>
          <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 15 }}>{t('welcome.' + key)}</div>
          <div style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5 }}>{t('welcome.' + key + 'Desc')}</div>
        </div>
      ))}
    </div>
  </div>
);

// ── Main App ──────────────────────────────────────────────────────────────────
const App = () => {
  const [t2, setTweak] = useTweaks(/*EDITMODE-BEGIN*/{
    "theme": "light",
    "density": "balanced",
    "accent": "#3a82d6"
  }/*EDITMODE-END*/);

  const [lang, setLangState] = useState(window._lang || 'it');

  const handleSetLang = (l) => {
    window.setLang(l);
    setLangState(l);
  };

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", t2.theme);
    document.documentElement.setAttribute("data-density", t2.density);
    document.documentElement.style.setProperty("--accent", t2.accent);
    document.documentElement.style.setProperty("--accent-hover", t2.accent);
  }, [t2.theme, t2.density, t2.accent]);

  const [loaded, setLoaded] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);
  const [view, setView] = useState("timesheet");
  const [selectedClientId, setSelectedClientId] = useState(null);
  const [editingClient, setEditingClient] = useState(null);
  const [editingActivity, setEditingActivity] = useState(null);
  const [editingExpense, setEditingExpense] = useState(null);
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());

  const [clients, setClients] = useState([]);
  const [activities, setActivities] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [studio, setStudio] = useState(null);
  const [fiscal, setFiscal] = useState(null);

  // ── Initial load ────────────────────────────────────────────────────────────
  useEffect(() => {
    async function init() {
      const data = await dbLoadAll();

      if (data.empty) {
        // First launch — show welcome screen (no data yet)
        setLoaded(true);
        setShowWelcome(true);
        return;
      }

      // Data exists — load it
      setClients(data.clients    || []);
      setActivities(data.activities || []);
      setExpenses(data.expenses  || []);
      setStudio(data.studio    || window.APP_DATA.user);
      setFiscal(data.fiscal    || window.APP_DATA.fiscal);
      setLoaded(true);
    }
    init();
  }, []);

  const seedDemo = async () => {
    const d = window.APP_DATA;
    setClients(d.clients);
    setActivities(d.activities);
    setExpenses(d.expenses);
    setStudio(d.user);
    setFiscal(d.fiscal);
    if (window.api?.db) {
      await window.api.db.saveCollection('clients', d.clients);
      await window.api.db.saveCollection('activities', d.activities);
      await window.api.db.saveCollection('expenses', d.expenses);
      await window.api.db.saveKV('studio', d.user);
      await window.api.db.saveKV('fiscal', d.fiscal);
    }
    setShowWelcome(false);
  };

  const startEmpty = async () => {
    const emptyStudio = window.APP_DATA.user; // use template but user will fill it in settings
    const emptyFiscal = window.APP_DATA.fiscal;
    setClients([]);
    setActivities([]);
    setExpenses([]);
    setStudio(emptyStudio);
    setFiscal(emptyFiscal);
    if (window.api?.db) {
      await window.api.db.saveCollection('clients', []);
      await window.api.db.saveCollection('activities', []);
      await window.api.db.saveCollection('expenses', []);
      await window.api.db.saveKV('studio', emptyStudio);
      await window.api.db.saveKV('fiscal', emptyFiscal);
    } else {
      AppStorage.save(AppStorage.KEYS.studio, emptyStudio);
      AppStorage.save(AppStorage.KEYS.fiscal, emptyFiscal);
    }
    setShowWelcome(false);
  };

  // ── Persist on change ────────────────────────────────────────────────────────
  useEffect(() => { if (loaded && !showWelcome) dbSave('clients',    clients); }, [clients, loaded, showWelcome]);
  useEffect(() => { if (loaded && !showWelcome) dbSave('activities', activities); }, [activities, loaded, showWelcome]);
  useEffect(() => { if (loaded && !showWelcome) dbSave('expenses',   expenses); }, [expenses, loaded, showWelcome]);
  useEffect(() => { if (loaded && !showWelcome && studio) dbSave('studio', studio); }, [studio, loaded, showWelcome]);
  useEffect(() => { if (loaded && !showWelcome && fiscal) dbSave('fiscal', fiscal); }, [fiscal, loaded, showWelcome]);

  const currentMonthKey = monthKey(year, month);
  const navMonth = (delta) => {
    let m = month + delta, y = year;
    if (m > 11) { m = 0; y++; }
    if (m < 0) { m = 11; y--; }
    setMonth(m); setYear(y);
  };

  const handleNav = (v) => { setView(v); setSelectedClientId(null); };

  const handleSaveClient = (data) => {
    const norm = { ...data, shortName: data.shortName || data.name.split(" ")[0] };
    const isNew = !clients.find(c => c.id === norm.id);
    setClients(cs => isNew ? [...cs, norm] : cs.map(c => c.id === norm.id ? norm : c));
    setEditingClient(null);
    window.showToast(isNew ? `Cliente "${norm.name}" aggiunto` : `"${norm.name}" aggiornato`, 'success');
  };

  const handleDeleteClient = (id) => {
    const c = clients.find(x => x.id === id);
    setClients(cs => cs.filter(c => c.id !== id));
    setActivities(as => as.filter(a => a.clientId !== id));
    setExpenses(es => es.filter(e => e.clientId !== id));
    setSelectedClientId(null);
    setView("clients");
    window.showToast(`"${c?.name}" eliminato`, 'warning');
  };

  const handleSaveActivity = (data) => {
    if (data.days) {
      const newActs = data.days.map(d => ({
        id: "act" + Date.now() + Math.random().toString(36).slice(2),
        clientId: data.clientId,
        commessa: data.commessa,
        day: d,
        hours: data.hours,
        desc: data.desc,
        monthKey: data.monthKey,
      }));
      setActivities(as => [...as, ...newActs]);
      setEditingActivity(null);
      window.showToast(`${newActs.length} attività registrate`, 'success');
      return;
    }
    const isNew = !activities.find(a => a.id === data.id);
    setActivities(as => isNew ? [...as, data] : as.map(a => a.id === data.id ? data : a));
    setEditingActivity(null);
    window.showToast(isNew ? 'Attività registrata' : 'Attività aggiornata', 'success');
  };

  const handleDeleteActivity = (id) => {
    setActivities(as => as.filter(a => a.id !== id));
    setEditingActivity(null);
    window.showToast('Attività eliminata', 'warning');
  };

  const handleDeleteActivities = (ids) => {
    const idSet = new Set(ids);
    setActivities(as => as.filter(a => !idSet.has(a.id)));
    window.showToast(`${ids.length} attività eliminate`, 'warning');
  };

  const handleSaveExpense = (data) => {
    const isNew = !expenses.find(e => e.id === data.id);
    setExpenses(es => isNew ? [...es, data] : es.map(e => e.id === data.id ? data : e));
    setEditingExpense(null);
    window.showToast(isNew ? 'Spesa registrata' : 'Spesa aggiornata', 'success');
  };

  const handleDeleteExpense = (id) => {
    setExpenses(es => es.filter(e => e.id !== id));
    setEditingExpense(null);
    window.showToast('Spesa eliminata', 'warning');
  };

  const handleResetData = () => {
    if (!confirm(t('data.resetDesc'))) return;
    const d = window.APP_DATA;
    setClients(d.clients); setActivities(d.activities); setExpenses(d.expenses);
    setStudio(d.user); setFiscal(d.fiscal);
    window.showToast('Dati ripristinati ai valori demo', 'info');
  };

  // MONTHS_IT is a global updated by setLang() — reading it inline gets current locale
  const monthName = () => (window.MONTHS_IT || MONTHS_IT)[month];

  if (!loaded) return <LoadingScreen />;
  if (showWelcome) {
    return (
      <div className="desktop-window" style={{ height: "100vh" }}>
        <DesktopTitlebar studio={{ firm: "Parcella" }} />
        <WelcomeScreen lang={lang} onSetLang={handleSetLang} onLoadDemo={seedDemo} onStartEmpty={startEmpty} />
      </div>
    );
  }

  const s = studio || window.APP_DATA.user;

  // Use lang as key on inner app so all children re-render on language change
  return (
    <div className="desktop-window">
      <DesktopTitlebar studio={s} />
      <DesktopMenubar onNav={handleNav} onAction={(act) => {
        if (act === "newClient")   setEditingClient("new");
        if (act === "newActivity") { setView("timesheet"); setTimeout(() => setEditingActivity({}), 50); }
        if (act === "newExpense")  { setView("expenses");  setTimeout(() => setEditingExpense({ __billable: true }), 50); }
        if (act === "settings")    setView("settings");
      }} />

      <div className="app" key={lang}>
        <Sidebar active={view} onNav={handleNav} clientCount={clients.length}
          expenseCount={expenses.filter(e => e.monthKey === currentMonthKey).length} studio={s} />
        <div className="main">
          <Topbar title={t('nav.' + view) || view} crumb={(() => {
            if (view === 'dashboard') return `${t('dash.hoursThisMonth')} · ${monthName()} ${year}`;
            if (view === 'timesheet') return `${monthName()} ${year}`;
            if (view === 'expenses')  return `${monthName()} ${year}`;
            if (view === 'taxes')     return `${year} · ${s.cassaName || 'Inarcassa'}`;
            if (view === 'clients' && selectedClientId) return `${t('nav.clients')} / ${t('cd.overview')}`;
            if (view === 'settings')  return s.firm;
            return null;
          })()} actions={(() => {
            if (view === 'timesheet') return <button className="btn" onClick={() => setView("export")}><Icon name="download" size={14} /> {t('action.download')}</button>;
            if (view === 'dashboard') return <button className="btn" onClick={() => { setView("timesheet"); setTimeout(() => setEditingActivity({}), 50); }}><Icon name="plus" size={14} /> {t('af.register')}</button>;
            return null;
          })()}
          />
          {/* Route */}
          {view === "dashboard" && <Dashboard clients={clients} activities={activities} currentMonthKey={currentMonthKey} onNav={handleNav} />}
          {view === "clients" && (selectedClientId
            ? <ClientDetail client={clients.find(c => c.id === selectedClientId)} activities={activities}
                currentMonthKey={currentMonthKey}
                onEdit={() => setEditingClient(clients.find(c => c.id === selectedClientId))}
                onBack={() => setSelectedClientId(null)} onDelete={handleDeleteClient}
                onSaveCommesse={(id, commesse) => setClients(cs => cs.map(c => c.id === id ? { ...c, commesse } : c))} />
            : <ClientsList clients={clients} activities={activities} currentMonthKey={currentMonthKey}
                onSelect={id => setSelectedClientId(id)} onAddNew={() => setEditingClient("new")} />
          )}
          {view === "timesheet" && <Timesheet clients={clients.filter(c => c.status === "active")} activities={activities}
            currentYear={year} currentMonth={month} onNavMonth={navMonth}
            onAddActivity={p => setEditingActivity(p || {})} onEditActivity={a => setEditingActivity(a)}
            onDeleteActivities={handleDeleteActivities} />}
          {view === "export" && <Export clients={clients} activities={activities} expenses={expenses}
            currentMonthKey={currentMonthKey} studio={s}
            currentYear={year} currentMonth={month} onNavMonth={navMonth} />}
          {view === "expenses" && <Expenses clients={clients} expenses={expenses} currentMonthKey={currentMonthKey}
            onAdd={billable => setEditingExpense({ __billable: billable })} onEdit={e => setEditingExpense(e)}
            onDelete={handleDeleteExpense} />}
          {view === "settings" && <Settings user={s} onSave={d => setStudio(d)} onResetData={handleResetData} />}
          {view === "taxes" && <Taxes activities={activities} expenses={expenses} fiscal={fiscal || window.APP_DATA.fiscal}
            clients={clients} studio={s} year={year}
            onUpdateFiscal={f => setFiscal(f)} />}
        </div>
      </div>

      <DesktopStatusbar view={view} clientsCount={clients.length}
        activitiesCount={activities.filter(a => a.monthKey === currentMonthKey).length}
        hoursTotal={activities.filter(a => a.monthKey === currentMonthKey).reduce((s, a) => s + a.hours, 0)}
        studio={s} />

      {/* Modals */}
      <Modal open={!!editingClient} onClose={() => setEditingClient(null)} size="xl"
        title={editingClient === "new" ? t('client.new') : `${t('action.edit')} · ${editingClient?.name || ""}`}>
        {editingClient && (
          <ClientFormWrapper client={editingClient === "new" ? null : editingClient}
            onSave={handleSaveClient} onCancel={() => setEditingClient(null)} />
        )}
      </Modal>

      <Modal open={!!editingActivity} onClose={() => setEditingActivity(null)} size="md"
        title={editingActivity?.id ? t('action.edit') + ' ' + t('nav.timesheet').toLowerCase() : t('af.register')}>
        {editingActivity && (
          <ActivityForm activity={editingActivity?.id ? editingActivity : null}
            defaultDay={editingActivity?.id ? null : editingActivity}
            clients={clients.filter(c => c.status === "active")}
            currentYear={year} currentMonth={month}
            onSave={handleSaveActivity} onCancel={() => setEditingActivity(null)} onDelete={handleDeleteActivity} />
        )}
      </Modal>

      <Modal open={!!editingExpense} onClose={() => setEditingExpense(null)} size="md"
        title={editingExpense?.id ? t('action.edit') : t('exp.newExpense')}>
        {editingExpense && (
          <ExpenseForm expense={editingExpense?.id ? editingExpense : null}
            defaultBillable={editingExpense?.__billable !== false}
            clients={clients} currentYear={year} currentMonth={month}
            onSave={handleSaveExpense} onCancel={() => setEditingExpense(null)} onDelete={handleDeleteExpense} />
        )}
      </Modal>

      <ToastContainer />

      {/* Tweaks */}
      <TweaksPanel title="Tweaks">
        <TweakSection label="Aspetto">
          <TweakRadio label="Tema" value={t2.theme} onChange={v => setTweak("theme", v)}
            options={[{ value: "light", label: "Chiaro" }, { value: "dark", label: "Scuro" }]} />
          <TweakRadio label="Densità" value={t2.density} onChange={v => setTweak("density", v)}
            options={[{ value: "compact", label: "Compatta" }, { value: "balanced", label: "Bilanciata" }, { value: "spacious", label: "Spaziosa" }]} />
          <TweakColor label="Accent" value={t2.accent} onChange={v => setTweak("accent", v)}
            options={["#3a82d6", "#1c1917", "#0e7c66", "#b4541d", "#7e3aed"]} />
        </TweakSection>
        <TweakSection label="Lingua">
          {(window.SUPPORTED_LANGS || []).map(l => (
            <TweakButton key={l.code} label={l.flag + " " + l.name + (lang === l.code ? " ✓" : "")} onClick={() => handleSetLang(l.code)} />
          ))}
        </TweakSection>
      </TweaksPanel>
    </div>
  );
};

// ── ClientFormWrapper ─────────────────────────────────────────────────────────
const ClientFormWrapper = ({ client, onSave, onCancel }) => {
  const [data, setData] = useState(client || {
    id: "c" + Date.now(),
    name: "", piva: "", address: "", contacts: [], status: "active",
    hourlyRate: 80, hoursPlafond: 30, cassaPct: 4, cassaIncluded: false,
    vatPct: 22, withholding: false, paymentDays: 30,
    contractStart: new Date().toISOString().slice(0, 10),
    contractEnd: "", commesse: [], notes: "", shortName: "",
    ibanOverride: "", bankOverride: "", bicOverride: "", paymentRef: "",
  });

  return (
    <>
      <ClientFormInner data={data} setData={setData} />
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 24, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
        <button className="btn" onClick={onCancel}>{t('action.cancel')}</button>
        <button className="btn btn-primary" onClick={() => {
          if (!data.name.trim()) { alert(t('cf.firmNamePlaceholder')); return; }
          onSave({ ...data, shortName: data.shortName || data.name.split(" ")[0] });
        }}>
          <Icon name="check" size={14} /> {client ? t('action.saveChanges') : t('cf.addClient')}
        </button>
      </div>
    </>
  );
};

// ── ClientFormInner ───────────────────────────────────────────────────────────
const ClientFormInner = ({ data, setData }) => {
  const update = (patch) => setData(d => ({ ...d, ...patch }));
  const ex = computeInvoiceAmounts(data, 10);

  const contacts = data.contacts || [];
  const addContact = () => update({ contacts: [...contacts, { name: "", role: "Principale", email: "" }] });
  const updContact = (i, patch) => update({ contacts: contacts.map((c, j) => j === i ? { ...c, ...patch } : c) });
  const rmContact = (i) => update({ contacts: contacts.filter((_, j) => j !== i) });

  const addCommessa = () => {
    const color = COMMESSA_COLORS[data.commesse.length % COMMESSA_COLORS.length];
    update({ commesse: [...data.commesse, { code: "", name: "", color }] });
  };
  const updC = (i, patch) => update({ commesse: data.commesse.map((c, j) => j === i ? { ...c, ...patch } : c) });
  const rmC  = (i) => update({ commesse: data.commesse.filter((_, j) => j !== i) });
  const cycleColor = (i) => {
    const idx = COMMESSA_COLORS.indexOf(data.commesse[i].color);
    updC(i, { color: COMMESSA_COLORS[(idx + 1) % COMMESSA_COLORS.length] });
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 28 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>

        <div>
          <h3 className="section-title">{t('cf.registry')}</h3>
          <div className="form-grid">
            <div className="field full"><label>{t('cf.firmName')}</label>
              <input className="input" value={data.name} onChange={e => update({ name: e.target.value })} placeholder={t('cf.firmNamePlaceholder')} /></div>
            <div className="field"><label>{t('cf.piva')}</label>
              <input className="input mono" value={data.piva} onChange={e => update({ piva: normalizePIVA(e.target.value) })} placeholder="IT12345678901" /></div>
            <div className="field"><label>{t('cf.status')}</label>
              <select className="select" value={data.status} onChange={e => update({ status: e.target.value })}>
                <option value="active">{t('status.active')}</option>
                <option value="paused">{t('status.paused')}</option>
                <option value="archived">{t('status.archived')}</option>
              </select></div>
            <div className="field full"><label>{t('cf.address')}</label>
              <input className="input" value={data.address} onChange={e => update({ address: e.target.value })} /></div>
          </div>
        </div>

        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h3 className="section-title" style={{ margin: 0 }}>Referenti</h3>
            <button type="button" className="btn btn-sm" onClick={addContact}><Icon name="plus" size={12} /> Aggiungi referente</button>
          </div>
          {contacts.length === 0
            ? <div style={{ fontSize: 12.5, color: "var(--text-muted)", padding: "6px 0" }}>Nessun referente — aggiungine uno.</div>
            : <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {contacts.map((ct, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input className="input" style={{ flex: 1 }} placeholder="Nome referente" value={ct.name} onChange={e => updContact(i, { name: e.target.value })} />
                    <select className="select" style={{ width: 150, flexShrink: 0 }} value={ct.role} onChange={e => updContact(i, { role: e.target.value })}>
                      <option value="Principale">Principale</option>
                      <option value="Fatturazione">Fatturazione</option>
                      <option value="Tecnico">Tecnico</option>
                      <option value="Amministrativo">Amministrativo</option>
                    </select>
                    <input className="input" type="email" style={{ flex: 1 }} placeholder="email@esempio.it" value={ct.email} onChange={e => updContact(i, { email: e.target.value })} />
                    <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => rmContact(i)}><Icon name="trash" size={12} /></button>
                  </div>
                ))}
              </div>}
        </div>

        <div>
          <h3 className="section-title">{t('cf.economics')}</h3>
          <div className="form-grid">
            <div className="field"><label>{t('cf.hourlyRate')}</label>
              <div className="input-group"><input className="input mono" type="number" value={data.hourlyRate} onChange={e => update({ hourlyRate: +e.target.value })} /><div className="addon">€/h</div></div></div>
            <div className="field"><label>{t('cf.hoursPlafond')}</label>
              <div className="input-group"><input className="input mono" type="number" value={data.hoursPlafond} onChange={e => update({ hoursPlafond: +e.target.value })} /><div className="addon">h/mese</div></div>
              <div className="hint">{t('cf.hoursPlafondHint')}</div></div>
            <div className="field"><label>{t('cf.cassa')}</label>
              <div className="input-group"><input className="input mono" type="number" step="0.5" value={data.cassaPct} onChange={e => update({ cassaPct: +e.target.value })} /><div className="addon">%</div></div>
              <label className="checkbox-row" style={{ marginTop: 4 }}><input type="checkbox" checked={data.cassaIncluded} onChange={e => update({ cassaIncluded: e.target.checked })} /> {t('cf.cassaIncluded')}</label></div>
            <div className="field"><label>{t('cf.vat')}</label>
              <div className="input-group"><input className="input mono" type="number" value={data.vatPct} onChange={e => update({ vatPct: +e.target.value })} /><div className="addon">%</div></div>
              <label className="checkbox-row" style={{ marginTop: 4 }}><input type="checkbox" checked={data.withholding} onChange={e => update({ withholding: e.target.checked })} /> {t('cf.withholding')}</label></div>
            <div className="field"><label>{t('cf.contractStart')}</label>
              <input className="input mono" type="date" value={data.contractStart} onChange={e => update({ contractStart: e.target.value })} /></div>
            <div className="field"><label>{t('cf.paymentDays')}</label>
              <div className="input-group"><input className="input mono" type="number" value={data.paymentDays} onChange={e => update({ paymentDays: +e.target.value })} /><div className="addon">gg</div></div></div>
            <div className="field"><label>{t('cf.contractEnd')}</label>
              <input className="input mono" type="date" value={data.contractEnd || ""} onChange={e => update({ contractEnd: e.target.value })} />
              <div className="hint">{t('cf.contractEndHint')}</div></div>
          </div>
        </div>

        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h3 className="section-title" style={{ margin: 0 }}>{t('cf.commesse')}</h3>
            <button type="button" className="btn btn-sm" onClick={addCommessa}><Icon name="plus" size={12} /> {t('cf.newCommessa')}</button>
          </div>
          {data.commesse.length === 0
            ? <div style={{ fontSize: 12.5, color: "var(--text-muted)", padding: "10px 0" }}>{t('cf.noCommesse')}</div>
            : <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {data.commesse.map((co, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <div style={{ width: 22, height: 22, borderRadius: 5, background: co.color, cursor: "pointer", border: "1.5px solid rgba(0,0,0,0.12)", flexShrink: 0 }} onClick={() => cycleColor(i)} />
                    <input className="input mono" style={{ width: 160, flexShrink: 0 }} placeholder={t('cf.commessaCode')} value={co.code} onChange={e => updC(i, { code: e.target.value })} />
                    <input className="input" style={{ flex: 1 }} placeholder={t('cf.commessaDesc')} value={co.name} onChange={e => updC(i, { name: e.target.value })} />
                    <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => rmC(i)}><Icon name="trash" size={12} /></button>
                  </div>
                ))}
              </div>}
        </div>

        <div>
          <h3 className="section-title">{t('cf.notes')}</h3>
          <textarea className="textarea" rows={3} value={data.notes} onChange={e => update({ notes: e.target.value })} placeholder={t('cf.notesPlaceholder')} />
        </div>

        <div>
          <h3 className="section-title">Coordinate pagamento cliente</h3>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
            Opzionale — sovrascrive le coordinate dello studio su questo cliente.
          </div>
          <div className="form-grid">
            <div className="field full">
              <label>IBAN (override)</label>
              <input className="input mono" value={data.ibanOverride || ""} onChange={e => update({ ibanOverride: e.target.value })} placeholder="IT60 X054 ... (lascia vuoto = usa IBAN studio)" />
            </div>
            <div className="field">
              <label>Banca</label>
              <input className="input" value={data.bankOverride || ""} onChange={e => update({ bankOverride: e.target.value })} placeholder="Es. Banca Sella" />
            </div>
            <div className="field">
              <label>BIC / SWIFT</label>
              <input className="input mono" value={data.bicOverride || ""} onChange={e => update({ bicOverride: e.target.value })} />
            </div>
            <div className="field full">
              <label>Riferimento pagamento</label>
              <input className="input" value={data.paymentRef || ""} onChange={e => update({ paymentRef: e.target.value })} placeholder="Es. PO-2026-001, fattura n. …" />
            </div>
          </div>
        </div>
      </div>

      {/* Right: live preview */}
      <div style={{ position: "sticky", top: 0, alignSelf: "start" }}>
        <div className="card">
          <div className="card-header" style={{ padding: "12px 16px" }}><h3 style={{ fontSize: 12.5 }}>{t('cf.preview')}</h3></div>
          <div className="card-body" style={{ padding: 16 }}>
            <div className="calc-summary">
              <div className="calc-row"><span className="label">{t('cd.imponibile')}</span><span>{fmtEUR(ex.imponibile)}</span></div>
              {!data.cassaIncluded && data.cassaPct > 0 && <div className="calc-row"><span className="label">{t('cf.cassa')} {data.cassaPct}%</span><span>+{fmtEUR(ex.cassa)}</span></div>}
              <div className="calc-row"><span className="label">{t('cf.vat')} {data.vatPct}%</span><span>+{fmtEUR(ex.iva)}</span></div>
              {data.withholding && <div className="calc-row"><span className="label">{t('cf.withholding')}</span><span>−{fmtEUR(ex.withholding)}</span></div>}
              <div className="calc-row total"><span className="label">Totale</span><span>{fmtEUR(ex.total)}</span></div>
            </div>
            <div style={{ marginTop: 12, fontSize: 11.5, color: "var(--text-muted)" }}>{t('cf.previewLive')}</div>
          </div>
        </div>
      </div>
    </div>
  );
};

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
