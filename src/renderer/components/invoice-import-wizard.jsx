// ============ Import wizard ============
// Three steps: pick source → review the manifest → commit.
// Steps 1–2 never write: the scan is a dry run (P2).
const InvoiceImportWizard = ({ open, onClose, onImported }) => {
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [manifest, setManifest] = useState(null);
  const [decisions, setDecisions] = useState({});
  const [result, setResult] = useState(null);

  const pick = async () => {
    setError(null);
    const paths = await window.api.invoices.chooseSource();
    if (!paths || !paths.length) return;
    setBusy(true);
    try {
      const m = await window.api.invoices.scan(paths);
      setManifest(m);
      // Pre-select the new documents; duplicates and already-imported stay off.
      const initial = {};
      m.items.forEach(it => {
        initial[it.id] = {
          accept: it.status === 'new',
          clientId: it.proposal.clientId,
          linkedMonthKey: it.proposal.linkedMonthKey,
          fiscal: it.proposal.fiscal,
          rememberSupplier: it.direction === 'passive',
        };
      });
      setDecisions(initial);
      setStep(2);
    } catch (err) {
      setError(/studioIds/.test(err.message) ? t('imp.noStudio') : err.message);
    } finally {
      setBusy(false);
    }
  };

  const setDecision = (id, patch) => setDecisions(d => ({ ...d, [id]: { ...d[id], ...patch } }));

  const commit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await window.api.invoices.commit({ items: manifest.items, decisions });
      setResult(res);
      onImported(res);
      setStep(3);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    setStep(1); setManifest(null); setDecisions({}); setResult(null); setError(null);
    onClose();
  };

  const groups = manifest ? [
    { key: 'new', label: t('imp.new'), rows: manifest.items.filter(i => i.status === 'new' && !i.needsReview) },
    { key: 'review', label: t('imp.toReview'), rows: manifest.items.filter(i => i.status === 'new' && i.needsReview) },
    { key: 'already', label: t('imp.already'), rows: manifest.items.filter(i => i.status === 'imported') },
  ].filter(g => g.rows.length) : [];

  const acceptedCount = Object.values(decisions).filter(d => d.accept).length;

  return (
    <Modal open={open} onClose={close} size="lg" title={t('imp.title')}
      footer={step === 2
        ? <>
            <button className="btn" onClick={close}>{t('action.cancel')}</button>
            <button className="btn btn-primary" disabled={busy || !acceptedCount} onClick={commit}>
              {t('imp.confirm')} ({acceptedCount})
            </button>
          </>
        : <button className="btn" onClick={close}>{t('action.close')}</button>}>

      {error && <div className="badge badge-warning" style={{ display: 'block', marginBottom: 12 }}>{error}</div>}

      {step === 1 && (
        <div style={{ textAlign: 'center', padding: 24 }}>
          <button className="btn btn-primary" disabled={busy} onClick={pick}>{t('imp.pick')}</button>
          <div className="hint" style={{ marginTop: 12 }}>{t('imp.hint')}</div>
          {busy && <div className="hint" style={{ marginTop: 8 }}>{t('imp.scanning')}</div>}
        </div>
      )}

      {step === 2 && manifest && (
        <>
          <div className="filter-row" style={{ gap: 16 }}>
            <span className="badge">{t('imp.new')}: {manifest.counts.nuove}</span>
            <span className="badge">{t('imp.duplicates')}: {manifest.counts.duplicati}</span>
            <span className="badge">{t('imp.already')}: {manifest.counts.giaImportate}</span>
            <span className="badge badge-warning">{t('imp.toReview')}: {manifest.counts.daRivedere}</span>
            <span className="badge">{t('imp.discarded')}: {manifest.skipped.length}</span>
          </div>

          {groups.map(g => (
            <div className="card" key={g.key} style={{ marginTop: 16 }}>
              <div className="card-header">
                <strong>{g.label}</strong>
                <button className="btn btn-ghost btn-sm" onClick={() =>
                  g.rows.forEach(r => setDecision(r.id, { accept: true }))}>{t('imp.selectAll')}</button>
              </div>
              <table className="data">
                <thead>
                  <tr>
                    <th style={{ width: 36 }} />
                    <th style={{ width: 90 }}>{t('inv.date')}</th>
                    <th>{t('inv.counterparty')}</th>
                    <th className="num" style={{ width: 100 }}>{t('inv.total')}</th>
                    <th style={{ width: 190 }}>{t('inv.classification')}</th>
                    <th style={{ width: 150 }} />
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map(it => {
                    const d = decisions[it.id] || {};
                    return (
                      <tr key={it.id}>
                        <td><input type="checkbox" checked={!!d.accept}
                          onChange={e => setDecision(it.id, { accept: e.target.checked })} /></td>
                        <td className="mono">{it.doc.date}</td>
                        <td>
                          {it.counterparty.name}
                          <span className="badge" style={{ marginLeft: 6 }}>{it.doc.tipoDoc}</span>
                          {it.reverseCharge && <span className="badge badge-warning badge-dot">{t('inv.reverseCharge')}</span>}
                          {it.reviewReason && <div className="hint">{it.reviewReason}</div>}
                        </td>
                        <td className="num mono">{fmtEUR(it.doc.totals.documento)}</td>
                        <td>
                          {it.direction === 'passive' && d.fiscal ? (
                            <select className="select" value={d.fiscal.category}
                              onChange={e => {
                                const cat = e.target.value;
                                const r = window.CATEGORY_RULES[cat];
                                setDecision(it.id, { fiscal: { ...d.fiscal, category: cat, deductPct: r ? r.deductPct : 100 } });
                              }}>
                              {Object.keys(window.CATEGORY_RULES).map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                          ) : (
                            <div style={{ display: 'flex', gap: 6 }}>
                              <select className="select" value={d.clientId || ''}
                                onChange={e => setDecision(it.id, { clientId: e.target.value || null })}>
                                <option value="">{t('imp.selectClient')}</option>
                                {(window.__clients || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                              </select>
                              {/* The covered month is proposed from the document date, which is
                                  right when you invoice at month end and wrong when you invoice
                                  August 5th for July's work. It decides whether that month's
                                  timesheet still counts as "to invoice", so it is correctable
                                  here rather than buried in the detail drawer. */}
                              <input className="input mono" style={{ width: 96 }} placeholder="2026-07"
                                title={t('inv.linkedMonth')}
                                value={d.linkedMonthKey || ''}
                                onChange={e => setDecision(it.id, { linkedMonthKey: e.target.value || null })} />
                            </div>
                          )}
                        </td>
                        <td>
                          {it.direction === 'passive' && (
                            <label className="hint" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                              <input type="checkbox" checked={!!d.rememberSupplier}
                                onChange={e => setDecision(it.id, { rememberSupplier: e.target.checked })} />
                              {t('imp.remember')}
                            </label>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}

          {manifest.skipped.length > 0 && (
            <div className="card" style={{ marginTop: 16 }}>
              <div className="card-header"><strong>{t('imp.discarded')}</strong></div>
              <table className="data">
                <tbody>
                  {manifest.skipped.map((s, i) => (
                    <tr key={i}><td className="mono">{s.file}</td><td>{s.reason}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {step === 3 && result && (
        <div className="empty-state">
          <div className="title">{t('imp.done').replace('{n}', result.records.length)}</div>
        </div>
      )}
    </Modal>
  );
};
