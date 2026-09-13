import { useEffect, useState } from 'react';
import * as api from './api';

const emptyValues = (fields) =>
  Object.fromEntries(fields.map((f) => [f.key, f.type === 'select' ? f.options[0] : '']));

// Generic add/edit/delete list for one resource (badges or articles) — both
// share the same CRUD shape, just different fields.
export default function ResourceManager({ resource, idKey, fields, token, onAuthError }) {
  const [items, setItems] = useState([]);
  const [editingId, setEditingId] = useState(null); // null = adding new
  const [values, setValues] = useState(emptyValues(fields));
  const [error, setError] = useState(null);

  useEffect(() => {
    api.list(resource).then(setItems).catch((err) => setError(err.message));
  }, [resource]);

  function startEdit(item) {
    setEditingId(item[idKey]);
    setValues(Object.fromEntries(fields.map((f) => [f.key, item[f.key] ?? ''])));
  }

  function startAdd() {
    setEditingId(null);
    setValues(emptyValues(fields));
  }

  function visibleFields() {
    return fields.filter((f) => !f.showIf || f.showIf(values));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    // Drop fields hidden by showIf so switching (e.g. badge name) doesn't
    // carry over a stale value from a field that's no longer shown.
    const payload = Object.fromEntries(visibleFields().map((f) => [f.key, values[f.key]]));
    try {
      if (editingId) {
        const updated = await api.update(resource, editingId, payload, token);
        setItems((prev) => prev.map((it) => (it[idKey] === editingId ? updated : it)));
      } else {
        const created = await api.create(resource, payload, token);
        setItems((prev) => [...prev, created]);
      }
      startAdd();
    } catch (err) {
      if (err.message.startsWith('401')) return onAuthError();
      setError(err.message);
    }
  }

  async function handleDelete(id) {
    setError(null);
    try {
      await api.remove(resource, id, token);
      setItems((prev) => prev.filter((it) => it[idKey] !== id));
      if (editingId === id) startAdd();
    } catch (err) {
      if (err.message.startsWith('401')) return onAuthError();
      setError(err.message);
    }
  }

  return (
    <div className="resource-manager">
      {error && <p className="error">{error}</p>}
      <ul className="admin-list">
        {items.map((item) => (
          <li key={item[idKey]}>
            <span>{fields.map((f) => item[f.key]).filter(Boolean).join(' — ')}</span>
            <span className="row-actions">
              <button type="button" onClick={() => startEdit(item)}>Edit</button>
              <button type="button" onClick={() => handleDelete(item[idKey])}>Delete</button>
            </span>
          </li>
        ))}
      </ul>

      <form onSubmit={handleSubmit} className="admin-form">
        {visibleFields().map((f) => (
          <label key={f.key}>
            {f.label}
            {f.type === 'select' ? (
              <select
                value={values[f.key]}
                onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
              >
                {f.options.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            ) : (
              <input
                type={f.type}
                min={f.min}
                max={typeof f.max === 'function' ? f.max(values) : f.max}
                value={values[f.key]}
                onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
              />
            )}
            {f.helpText && f.helpText(values) && <small className="field-hint">{f.helpText(values)}</small>}
          </label>
        ))}
        <div className="row-actions">
          <button type="submit">{editingId ? 'Save' : 'Add'}</button>
          {editingId && <button type="button" onClick={startAdd}>Cancel</button>}
        </div>
      </form>
    </div>
  );
}
