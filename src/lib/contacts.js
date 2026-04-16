const KEY = 'chantierai_contacts_v1';

export function loadGlobalContacts() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function saveGlobalContact(contact) {
  const contacts = loadGlobalContacts();
  const idx = contacts.findIndex(c =>
    c.id === contact.id || (contact.email && contact.email !== '' && c.email === contact.email)
  );
  if (idx >= 0) {
    contacts[idx] = { ...contacts[idx], ...contact };
  } else {
    contacts.push({ ...contact, id: contact.id || crypto.randomUUID() });
  }
  try { localStorage.setItem(KEY, JSON.stringify(contacts)); } catch {}
}

export function deleteGlobalContact(id) {
  const contacts = loadGlobalContacts().filter(c => c.id !== id);
  try { localStorage.setItem(KEY, JSON.stringify(contacts)); } catch {}
}
