import { useEffect, useState } from 'react';
import * as api from './api';

const emptyValues = (fields) =>
  Object.fromEntries(fields.map((f) => [f.key, f.type === 'select' ? f.options[0] : '']));

// Generic add/edit/delete list for one resource (badges or articles) — both
// share the same CRUD shape, just different fields.
export default function ResourceManager({ resource, idKey, fields, token, onAuthError, onData }) {
  const [items, setItems] = useState([]);
  const [editingId, setEditingId] = useState(null); // null = adding new
  const [values, setValues] = useState(emptyValues(fields));
  const [error, setError] = useState(null);

  useEffect(() => {
    // onData deliberately left out of the dep array — it's a one-time report
    // of the initial fetch, not something that should re-run the fetch.
    api.list(resource).then((data) => {
      setItems(data);
      onData?.(data);
    }).catch((err) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // The update endpoint only SETs whatever's in the payload, it never
    // clears anything omitted — so a field hidden by showIf (e.g. progress,
    // after switching to a badge with no target) needs an explicit null
    // here, or its old value would silently survive in DynamoDB.
    const visibleKeys = new Set(visibleFields().map((f) => f.key));
    const payload = Object.fromEntries(fields.map((f) => [f.key, visibleKeys.has(f.key) ? values[f.key] : null]));
    try {
      if (editingId) {
        const updated = await api.update(resource, editingId, payload, token);
        setItems((prev) => prev.map((it) => (it[idKey] === editingId ? updated : it)));
      } else {
        const created = await api.create(resource, payload, token);
        // The backend upserts badges by name, so `created` can be an
        // existing item rather than a new one — replace it in place instead
        // of appending a second copy under the same key.
        setItems((prev) =>
          prev.some((it) => it[idKey] === created[idKey])
            ? prev.map((it) => (it[idKey] === created[idKey] ? created : it))
            : [...prev, created]
        );
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
