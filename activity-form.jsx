// Activity form (create + edit) shown in modal
const ActivityForm = ({ activity, clients, defaultDay, onSave, onCancel, onDelete, currentYear, currentMonth }) => {
  const isNew = !activity;
  const mKey = monthKey(currentYear, currentMonth);
  const today = new Date();
  const defaultDayValue = defaultDay?.day ||
    (currentYear === today.getFullYear() && currentMonth === today.getMonth() ? today.getDate() : 1);
  const firstClient = clients[0];

  const [data, setData] = useState(activity || {
    id: "act" + Date.now(),
    clientId: defaultDay?.clientId || firstClient.id,
    commessa: defaultDay?.commessa || firstClient.commesse[0]?.code || "",
    day: defaultDayValue,
    dayEnd: defaultDay?.dayEnd || defaultDayValue,
    skipWeekends: true,
    hours: 1,
    desc: "",
    monthKey: mKey,
  });

  const update = (patch) => setData(d => {
    const next = { ...d, ...patch };
    if (patch.clientId && patch.clientId !== d.clientId) {
      const c = clients.find(c => c.id === patch.clientId);
      next.commessa = c?.commesse[0]?.code || "";
    }
    return next;
  });

  const client = clients.find(c => c.id === data.clientId) || firstClient;
  const monthShort = MONTHS_IT[currentMonth].slice(0, 3).toLowerCase();
  const yearShort = String(currentYear).slice(2);
  const dim = daysInMonth(currentYear, currentMonth);

  const isRange = isNew && data.dayEnd > data.day;
  const rangeDays = isRange
    ? Array.from({ length: data.dayEnd - data.day + 1 }, (_, i) => data.day + i)
        .filter(d => !data.skipWeekends || ![0, 6].includes(dowOfDay(currentYear, currentMonth, d)))
    : [];
  const totalDays = isRange ? rangeDays.length : 1;
  const importo = data.hours * totalDays * client.hourlyRate;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div className="form-grid">
        <div className="field">
          <label>{t('af.client')}</label>
          <select className="select" value={data.clientId} onChange={e => update({ clientId: e.target.value })}>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label>{t('af.commessa')}</label>
          <select className="select" value={data.commessa} onChange={e => update({ commessa: e.target.value })}>
            {client.commesse.length === 0
              ? <option value="">{t('af.noCommesse')}</option>
              : client.commesse.map(co => (
                <option key={co.code} value={co.code}>{co.code} — {co.name}</option>
              ))}
          </select>
        </div>
        <div className="field full">
          <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
            <div style={{ flex: 1 }}>
              <label>{t('af.day')}</label>
              <div className="input-group">
                <div className="addon left">{monthShort} '{yearShort}</div>
                <input
                  type="number"
                  className="input mono"
                  min="1"
                  max={dim}
                  value={data.day}
                  onChange={e => {
                    const d = Math.min(dim, Math.max(1, +e.target.value));
                    update({ day: d, dayEnd: Math.max(d, data.dayEnd) });
                  }}
                />
              </div>
            </div>
            {isNew && (
              <div style={{ flex: 1 }}>
                <label>{t('af.until')}</label>
                <div className="input-group">
                  <div className="addon left">{monthShort} '{yearShort}</div>
                  <input
                    type="number"
                    className="input mono"
                    min={data.day}
                    max={dim}
                    value={data.dayEnd}
                    onChange={e => update({ dayEnd: Math.min(dim, Math.max(data.day, +e.target.value)) })}
                  />
                </div>
              </div>
            )}
            <div style={{ flex: 1 }}>
              <label>{t('af.hours')}</label>
              <div className="input-group">
                <input
                  type="number"
                  step="0.25"
                  min="0.25"
                  className="input mono"
                  value={data.hours}
                  onChange={e => update({ hours: +e.target.value })}
                />
                <div className="addon">h</div>
              </div>
              <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                {[0.5, 1, 2, 4, 8].map(v => (
                  <button key={v} type="button" className={"chip" + (data.hours === v ? " active" : "")}
                    style={{ padding: "2px 8px", fontSize: 11 }} onClick={() => update({ hours: v })}>
                    {v}h
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
        {isNew && isRange && (
          <div className="field full">
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", background: "var(--accent-soft)", borderRadius: "var(--radius-sm)", fontSize: 13 }}>
              <span style={{ color: "var(--accent-text)", fontWeight: 600 }}>
                {t('af.rangeCount', { n: rangeDays.length })}
              </span>
              <label style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto", cursor: "pointer", color: "var(--accent-text)" }}>
                <input
                  type="checkbox"
                  checked={data.skipWeekends}
                  onChange={e => update({ skipWeekends: e.target.checked })}
                />
                {t('af.skipWeekends')}
              </label>
            </div>
          </div>
        )}
        <div className="field full">
          <label>{t('af.description')}</label>
          <textarea
            className="textarea"
            rows={3}
            value={data.desc}
            onChange={e => update({ desc: e.target.value })}
            placeholder={t('af.descPlaceholder')}
          />
        </div>
      </div>

      {/* Live amount */}
      <div className="calc-summary" style={{ background: "var(--accent-soft)", border: "none" }}>
        <div className="calc-row">
          <span className="label" style={{ color: "var(--accent-text)" }}>
            <Icon name="euro" size={14} style={{ verticalAlign: "middle", marginRight: 6 }} />
            {fmtH(data.hours)} × {fmtEUR(client.hourlyRate)}/h{isRange && rangeDays.length > 0 ? ` × ${rangeDays.length}gg` : ""}
          </span>
          <span style={{ color: "var(--accent-text)", fontWeight: 700, fontSize: 16 }}>
            {fmtEUR(importo)}
          </span>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
        {!isNew ? (
          <button className="btn btn-danger btn-sm" onClick={() => onDelete(data.id)}>
            <Icon name="trash" size={12} /> {t('action.delete')}
          </button>
        ) : <span />}
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" onClick={onCancel}>{t('action.cancel')}</button>
          <button className="btn btn-primary" onClick={() => {
            if (isRange && rangeDays.length > 0) {
              onSave({ ...data, days: rangeDays });
            } else {
              const { dayEnd: _de, skipWeekends: _sw, ...single } = data;
              onSave(single);
            }
          }}>
            <Icon name="check" size={14} /> {isNew && isRange && rangeDays.length > 0
              ? t('af.registerRange', { n: rangeDays.length })
              : isNew ? t('af.register') : t('af.saveChanges')}
          </button>
        </div>
      </div>
    </div>
  );
};

window.ActivityForm = ActivityForm;
