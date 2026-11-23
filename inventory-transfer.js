/* Portable inventory backup: non-destructive, includes IndexedDB attachments. */
(() => {
  'use strict';
  const exportBtn = document.getElementById('exportBtn');
  const importBtn = document.getElementById('importBtn');
  const fileInput = document.getElementById('importFile');
  if (!exportBtn || !importBtn || !fileInput ||
      typeof data === 'undefined' || typeof STORAGE_KEY === 'undefined') return;

  const FORMAT = 'firemni-inventar-kompletni-zaloha';
  const VERSION = 1;
  const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
  const clone = obj => JSON.parse(JSON.stringify(obj));
  const uuid = () => (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID() : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);

  const readAsBase64 = blob => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || Error('Nepodařilo se přečíst přílohu.'));
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.readAsDataURL(blob);
  });
  function fromBase64(encoded, mime) {
    const binary = atob(encoded);
    const parts = [];
    for (let i = 0; i < binary.length; i += 32768) {
      const part = binary.slice(i, i + 32768);
      const bytes = new Uint8Array(part.length);
      for (let j = 0; j < part.length; j++) bytes[j] = part.charCodeAt(j);
      parts.push(bytes);
    }
    return new Blob(parts, {type: mime || 'application/octet-stream'});
  }
  function allDocs(state) {
    const docs = [];
    for (const branch of Object.values(state.branches || {})) {
      for (const item of branch.items || []) {
        for (const prop of ['photoDoc', 'claimDoc', 'serviceDoc', 'invoiceDoc']) {
          if (item[prop]?.key) docs.push({item, prop, key: item[prop].key});
        }
      }
    }
    return docs;
  }
  function validate(state) {
    if (!state || typeof state !== 'object' || !state.branches ||
        typeof state.branches !== 'object' || !state.branches.praha ||
        !state.branches.zlin || !Array.isArray(state.branches.praha.items) ||
        !Array.isArray(state.branches.zlin.items)) {
      throw Error('Soubor nemá platnou strukturu inventáře.');
    }
    for (const b of Object.values(state.branches)) {
      if (!Array.isArray(b.items)) throw Error('Neplatný seznam položek.');
      for (const i of b.items) {
        if (!i || typeof i.id !== 'string' || typeof i.inventoryNo !== 'string' ||
            typeof i.name !== 'string') throw Error('Neplatný záznam položky.');
      }
    }
    if (state.users && !Array.isArray(state.users)) throw Error('Neplatný seznam uživatelů.');
    if (state.history && !Array.isArray(state.history)) throw Error('Neplatná historie.');
  }
  async function downloadSnapshot(state, {showSuccess = false} = {}) {
    validate(state);
    const files = {};
    const unique = [...new Set(allDocs(state).map(d => d.key))];
    for (const key of unique) {
      const file = await getFile(key);
      if (!file?.blob) {
        throw Error('Příloha "' + key + '" nebyla nalezena. Kompletní záloha proto nebyla vytvořena.');
      }
      files[key] = {
        name: file.name || 'soubor',
        type: file.type || file.blob.type || 'application/octet-stream',
        size: file.blob.size,
        base64: await readAsBase64(file.blob)
      };
    }
    const backup = {format: FORMAT, version: VERSION, exportedAt: new Date().toISOString(),
      data: state, files};
    const blob = new Blob([JSON.stringify(backup)], {type:'application/json;charset=utf-8'});
    downloadBlob(blob, 'firemni-inventar-kompletni-' + stamp() + '.json');
    if (showSuccess) alert('Kompletní záloha se stáhla. Obsahuje ' +
      Object.values(state.branches).reduce((n, b) => n + b.items.length, 0) +
      ' položek a ' + unique.length + ' příloh. Soubor uschovej na bezpečném místě.');
  }

  exportBtn.textContent = 'Export všech dat';
  importBtn.textContent = 'Import dat';
  exportBtn.onclick = async () => {
    exportBtn.disabled = true;
    const label = exportBtn.textContent;
    exportBtn.textContent = 'Vytvářím zálohu…';
    try { await downloadSnapshot(clone(data), {showSuccess: true}); }
    catch (err) { alert('Export selhal. ' + err.message); console.error(err); }
    finally { exportBtn.disabled = false; exportBtn.textContent = label; }
  };

  importBtn.onclick = () => fileInput.click();
  fileInput.onchange = async event => {
    const input = event.target;
    const file = input.files && input.files[0];
    if (!file) return;
    importBtn.disabled = true;
    const originalLabel = importBtn.textContent;
    importBtn.textContent = 'Kontroluji soubor…';
    try {
      const decoded = JSON.parse(await file.text());
      const portable = decoded?.format === FORMAT && decoded.version === VERSION;
      if (decoded?.format && !portable) throw Error('Nepodporovaný formát zálohy.');
      const source = portable ? decoded.data : decoded;
      validate(source);
      const sourceFiles = portable ? decoded.files || {} : {};
      const sourceDocs = allDocs(source);
      if (sourceDocs.length && !portable) {
        throw Error('Tato starší záloha neobsahuje fotografie a dokumenty. Pro přenos všeho použij novou kompletní zálohu.');
      }
      const sourceKeys = new Set(sourceDocs.map(x => x.key));
      for (const key of sourceKeys) {
        if (!sourceFiles[key] || typeof sourceFiles[key].base64 !== 'string') {
          throw Error('V záloze chybí soubor: ' + key);
        }
      }

      const current = clone(data);
      const incomingCount = Object.values(source.branches).reduce((n,b)=>n+b.items.length,0);
      const existingCount = Object.values(current.branches).reduce((n,b)=>n+b.items.length,0);
      if (!confirm('IMPORT BEZ MAZÁNÍ\n\nV souboru: ' + incomingCount +
        ' položek, ' + sourceKeys.size + ' příloh.\nV tomto počítači: ' + existingCount +
        ' položek.\n\nImport přidá pouze chybějící položky. Existující položky, uživatele ani historii nesmaže.\n\nPokračovat?')) return;

      // Always download an untouched snapshot before making any changes.
      // If an existing attachment cannot be read, stop rather than risk modifying data.
      importBtn.textContent = 'Zálohuji aktuální data…';
      await downloadSnapshot(current);
      if (!confirm('Bezpečnostní záloha současných dat se právě stáhla.\n\nZkontroluj prosím, že je uložená v počítači. Teprve potom potvrď import.')) return;

      const next = clone(current);
      next.users = Array.isArray(next.users) ? next.users : [];
      next.history = Array.isArray(next.history) ? next.history : [];
      const knownUsers = new Set(next.users.map(u => u.id));
      const knownHistory = new Set(next.history.map(h => h.id));
      for (const user of source.users || []) {
        if (user && user.id && !knownUsers.has(user.id)) {
          next.users.push(clone(user)); knownUsers.add(user.id);
        }
      }
      const imported = [];
      let skipped = 0;
      const fileCopies = [];
      for (const branchKey of ['praha', 'zlin']) {
        const targetBranch = next.branches[branchKey];
        const sourceBranch = source.branches[branchKey];
        const knownIds = new Set(targetBranch.items.map(i => i.id));
        const knownNumbers = new Set(targetBranch.items.map(i => String(i.inventoryNo).toUpperCase()));
        targetBranch.categories = Array.isArray(targetBranch.categories) ? targetBranch.categories : [];
        targetBranch.groups = Array.isArray(targetBranch.groups) ? targetBranch.groups : [];
        for (const cat of sourceBranch.categories || []) {
          if (!targetBranch.categories.includes(cat)) targetBranch.categories.push(cat);
        }
        for (const original of sourceBranch.items) {
          const number = String(original.inventoryNo).toUpperCase();
          if (knownIds.has(original.id) || knownNumbers.has(number)) { skipped++; continue; }
          const item = clone(original);
          for (const prop of ['photoDoc', 'claimDoc', 'serviceDoc', 'invoiceDoc']) {
            if (item[prop]?.key) {
              const fromKey = item[prop].key;
              const toKey = 'import:' + uuid() + ':' + prop;
              fileCopies.push({fromKey, toKey});
              item[prop].key = toKey;
            }
          }
          targetBranch.items.push(item);
          knownIds.add(item.id); knownNumbers.add(number);
          imported.push({item, branchKey});
        }
        // Preserve existing groups, add only new groups with relevant IDs.
        const knownGroupIds = new Set(targetBranch.groups.map(g => g.id));
        for (const group of sourceBranch.groups || []) {
          if (knownGroupIds.has(group.id)) continue;
          const newGroup = clone(group);
          const importedIds = new Set(targetBranch.items.map(i => i.id));
          newGroup.itemIds = (newGroup.itemIds || []).filter(id => importedIds.has(id));
          targetBranch.groups.push(newGroup);
          knownGroupIds.add(newGroup.id);
        }
      }
      for (const entry of source.history || []) {
        if (entry && entry.id && !knownHistory.has(entry.id)) {
          next.history.push(clone(entry)); knownHistory.add(entry.id);
        }
      }
      // Ensure all attachment files are written before saving inventory metadata.
      importBtn.textContent = 'Importuji přílohy…';
      for (const {fromKey, toKey} of fileCopies) {
        const f = sourceFiles[fromKey];
        const blob = fromBase64(f.base64, f.type);
        if (Number.isFinite(f.size) && blob.size !== f.size)
          throw Error('Velikost přílohy nesouhlasí: ' + f.name);
        await saveFile(toKey, new File([blob], f.name || 'soubor', {type: f.type || blob.type}));
      }

      // Never replace an item already present in the current inventory.
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      data = next;
      renderHome();
      if (typeof currentBranch !== 'undefined' && currentBranch) renderBranch();
      alert('Import dokončen. Přidáno ' + imported.length + ' položek, ' +
        fileCopies.length + ' příloh. Přeskočeno ' + skipped +
        ' již existujících položek. Nic ze stávajícího inventáře nebylo smazáno.');
    } catch (error) {
      console.error(error);
      alert('Import nebyl dokončen: ' + (error.message || String(error)) +
        '\nDosavadní inventář zůstal beze změny.');
    } finally {
      input.value = '';
      importBtn.disabled = false;
      importBtn.textContent = originalLabel;
    }
  };
})();