// Client form (new + edit) - shown in modal
const ClientForm = ({ client, onSave, onCancel }) => {
  const isNew = !client;
  const [data, setData] = useState(client || {
    id: "c" + Date.now(),
    name: "",
    shortName: "",
    piva: "",
    address: "",
    contact: "",
    email: "",
    status: "active",
    hourlyRate: 80,
    billingType: "hourly",
    monthlyRate: 0,
    monthlyHours: 160,
    projectFee: 0,
    projectEstimatedHours: 0,
    projectMonthlyAmount: 0,
    hoursPlafond: 30,
    cassaPct: 4,
    cassaIncluded: false,
    vatPct: 22,
    withholding: false,
    paymentDays: 30,
    contractStart: "2026-05-01",
    contractEnd: "",
    commesse: [],
    notes: "",
  });

  const update = (patch) => setData(d => ({ ...d, ...patch }));

  const exampleAmounts = computeInvoiceAmounts(data, 10);
  const previewLabel = data.billingType === 'monthly'
    ? `Canone mensile ${fmtEUR(data.monthlyRate)}`
    : data.billingType === 'project'
    ? `Acconto ${fmtEUR(data.projectMonthlyAmount)}`
    : `10 ore × ${fmtEUR(data.hourlyRate)}/h`;

  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 32 }}>
        {/* Left: form */}
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div>
            <h3 className="section-title">Dati anagrafici</h3>
            <div className="form-grid">
              <div className="field full">
                <label>Ragione sociale</label>
                <input className="input" value={data.name} onChange={e => update({ name: e.target.value })} placeholder="Es. Acme S.p.A." />
              </div>
              <div className="field">
                <label>Partita IVA</label>
                <input className="input mono" value={data.piva} onChange={e => update({ piva: e.target.value })} placeholder="IT12345678901" />
              </div>
              <div className="field">
                <label>Stato</label>
                <select className="select" value={data.status} onChange={e => update({ status: e.target.value })}>
                  <option value="active">Attivo</option>
                  <option value="paused">In pausa</option>
                  <option value="archived">Archiviato</option>
                </select>
              </div>
              <div className="field full">
                <label>Indirizzo</label>
                <input className="input" value={data.address} onChange={e => update({ address: e.target.value })} placeholder="Via, civico, città" />
              </div>
              <div className="field">
                <label>Referente</label>
                <input className="input" value={data.contact} onChange={e => update({ contact: e.target.value })} />
              </div>
              <div className="field">
                <label>Email referente</label>
                <input className="input" value={data.email} onChange={e => update({ email: e.target.value })} type="email" />
              </div>
            </div>
          </div>

          <div>
            <h3 className="section-title">Condizioni economiche</h3>
            <div className="form-grid">
              <div className="field full">
                <label>Tipo fatturazione</label>
                <div style={{ display: "flex", background: "var(--bg-sunken)", borderRadius: "var(--radius-sm)", padding: 3, gap: 3 }}>
                  {[["hourly","A ore"],["monthly","Canone mensile"],["project","A progetto"]].map(([v, label]) => (
                    <button
                      key={v}
                      type="button"
                      className={"btn btn-sm" + (data.billingType === v ? " btn-primary" : "")}
                      style={{ flex: 1, justifyContent: "center" }}
                      onClick={() => update({ billingType: v })}
                    >{label}</button>
                  ))}
                </div>
              </div>

              {data.billingType === "hourly" && (
                <>
                  <div className="field">
                    <label>Tariffa oraria</label>
                    <div className="input-group">
                      <input className="input mono" type="number" value={data.hourlyRate} onChange={e => update({ hourlyRate: +e.target.value })} />
                      <div className="addon">€/h</div>
                    </div>
                  </div>
                  <div className="field">
                    <label>Ore plafond mensile</label>
                    <div className="input-group">
                      <input className="input mono" type="number" value={data.hoursPlafond} onChange={e => update({ hoursPlafond: +e.target.value })} />
                      <div className="addon">h/mese</div>
                    </div>
                    <div className="hint">Limite mensile da contratto. Lascia 0 per illimitato.</div>
                  </div>
                </>
              )}

              {data.billingType === "monthly" && (
                <>
                  <div className="field">
                    <label>Canone mensile (imponibile)</label>
                    <div className="input-group">
                      <input className="input mono" type="number" value={data.monthlyRate} onChange={e => update({ monthlyRate: +e.target.value })} />
                      <div className="addon">€/mese</div>
                    </div>
                  </div>
                  <div className="field">
                    <label>Ore contratto mensile</label>
                    <div className="input-group">
                      <input className="input mono" type="number" value={data.monthlyHours} onChange={e => update({ monthlyHours: +e.target.value })} />
                      <div className="addon">h/mese</div>
                    </div>
                    <div className="hint">
                      Tariffa implicita: {data.monthlyHours > 0 ? fmtEUR(data.monthlyRate / data.monthlyHours) : "—"}/h
                    </div>
                  </div>
                </>
              )}

              {data.billingType === "project" && (
                <>
                  <div className="field">
                    <label>Compenso totale progetto</label>
                    <div className="input-group">
                      <input className="input mono" type="number" value={data.projectFee} onChange={e => update({ projectFee: +e.target.value })} />
                      <div className="addon">€</div>
                    </div>
                  </div>
                  <div className="field">
                    <label>Ore stimate totali</label>
                    <div className="input-group">
                      <input className="input mono" type="number" value={data.projectEstimatedHours} onChange={e => update({ projectEstimatedHours: +e.target.value })} />
                      <div className="addon">h</div>
                    </div>
                    <div className="hint">
                      Tariffa stimata: {data.projectEstimatedHours > 0 ? fmtEUR(data.projectFee / data.projectEstimatedHours) : "—"}/h
                    </div>
                  </div>
                  <div className="field">
                    <label>Acconto mensile (imponibile)</label>
                    <div className="input-group">
                      <input className="input mono" type="number" value={data.projectMonthlyAmount} onChange={e => update({ projectMonthlyAmount: +e.target.value })} />
                      <div className="addon">€/mese</div>
                    </div>
                    <div className="hint">Importo fatturato ogni mese per questo progetto.</div>
                  </div>
                </>
              )}

              <div className="field">
                <label>Cassa previdenza</label>
                <div className="input-group">
                  <input className="input mono" type="number" step="0.5" value={data.cassaPct} onChange={e => update({ cassaPct: +e.target.value })} />
                  <div className="addon">%</div>
                </div>
                <label className="checkbox-row" style={{ marginTop: 4 }}>
                  <input type="checkbox" checked={data.cassaIncluded} onChange={e => update({ cassaIncluded: e.target.checked })} />
                  Inclusa nella tariffa (non addebitata in fattura)
                </label>
              </div>
              <div className="field">
                <label>IVA</label>
                <div className="input-group">
                  <input className="input mono" type="number" value={data.vatPct} onChange={e => update({ vatPct: +e.target.value })} />
                  <div className="addon">%</div>
                </div>
                <div className="hint">0% per esenzione (es. art. 10).</div>
              </div>
              <div className="field">
                <label>Ritenuta d'acconto</label>
                <label className="checkbox-row">
                  <input type="checkbox" checked={data.withholding} onChange={e => update({ withholding: e.target.checked })} />
                  Applica ritenuta 20% sull'imponibile
                </label>
              </div>
              <div className="field">
                <label>Termini di pagamento</label>
                <div className="input-group">
                  <input className="input mono" type="number" value={data.paymentDays} onChange={e => update({ paymentDays: +e.target.value })} />
                  <div className="addon">gg DF FM</div>
                </div>
              </div>
              <div className="field">
                <label>Inizio contratto</label>
                <input className="input mono" type="date" value={data.contractStart} onChange={e => update({ contractStart: e.target.value })} />
              </div>
              <div className="field">
                <label>Scadenza contratto</label>
                <input className="input mono" type="date" value={data.contractEnd || ""} onChange={e => update({ contractEnd: e.target.value })} />
                <div className="hint">Lascia vuoto per durata indeterminata.</div>
              </div>
            </div>
          </div>

          <div>
            <h3 className="section-title">Note</h3>
            <textarea
              className="textarea"
              rows={3}
              value={data.notes}
              onChange={e => update({ notes: e.target.value })}
              placeholder="Note operative, modalità di consegna, riunioni ricorrenti…"
            />
          </div>
        </div>

        {/* Right: live calculation preview */}
        <div style={{ position: "sticky", top: 0, alignSelf: "start" }}>
          <div className="card">
            <div className="card-header" style={{ padding: "12px 16px" }}>
              <h3 style={{ fontSize: 12.5 }}>Anteprima calcolo</h3>
            </div>
            <div className="card-body" style={{ padding: 16 }}>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
                Anteprima: <strong style={{ color: "var(--text)" }}>{previewLabel}</strong>
              </div>
              <div className="calc-summary">
                <div className="calc-row">
                  <span className="label">Imponibile</span>
                  <span>{fmtEUR(exampleAmounts.imponibile)}</span>
                </div>
                {!data.cassaIncluded && data.cassaPct > 0 && (
                  <div className="calc-row">
                    <span className="label">Cassa {data.cassaPct}%</span>
                    <span>+{fmtEUR(exampleAmounts.cassa)}</span>
                  </div>
                )}
                {data.cassaIncluded && (
                  <div className="calc-row">
                    <span className="label" style={{ fontStyle: "italic", opacity: 0.7 }}>Cassa inclusa</span>
                    <span style={{ opacity: 0.7 }}>—</span>
                  </div>
                )}
                <div className="calc-row">
                  <span className="label">IVA {data.vatPct}%</span>
                  <span>+{fmtEUR(exampleAmounts.iva)}</span>
                </div>
                {data.withholding && (
                  <div className="calc-row">
                    <span className="label">Ritenuta 20%</span>
                    <span style={{ color: "var(--danger)" }}>−{fmtEUR(exampleAmounts.withholding)}</span>
                  </div>
                )}
                <div className="calc-row total">
                  <span className="label">Totale</span>
                  <span>{fmtEUR(exampleAmounts.total)}</span>
                </div>
              </div>

              <div style={{ marginTop: 16, fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.5 }}>
                I valori si aggiornano in tempo reale al cambio dei parametri.
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

window.ClientForm = ClientForm;
