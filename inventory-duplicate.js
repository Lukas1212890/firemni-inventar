/* Firemní inventář: kopírování existujících položek.
   Používá původní formulář, validaci inventárního čísla a ukládání. */
(() => {
  'use strict';

  if (typeof itemCard !== 'function' || typeof renderBranch !== 'function' ||
      typeof nextNumber !== 'function' || typeof addItem !== 'function') {
    console.error('Kopírování položek: aplikace není připravená.');
    return;
  }

  // Položky bez výrobního čísla musí jít uložit také.
  const serialInput = document.getElementById('serialNumber');
  if (serialInput) serialInput.required = false;

  const renderOriginalItemCard = itemCard;
  itemCard = function(item) {
    const html = renderOriginalItemCard(item);
    const deleteButton = `<button class="btn small danger" onclick="deleteItem('${item.id}')">`;
    const copyButton = `<button class="btn small" onclick="duplicateItem('${item.id}')">Kopírovat</button>`;
    return html.replace(deleteButton, copyButton + deleteButton);
  };

  window.duplicateItem = function(id) {
    const source = branch()?.items.find(item => item.id === id);
    if (!source) {
      alert('Původní položku se nepodařilo najít.');
      return;
    }

    // addItem vytvoří nový záznam, přidělí další číslo a ponechá editingId = null.
    addItem(source.category);
    document.getElementById('itemModalTitle').textContent = 'Kopírovat položku';
    document.getElementById('itemName').value = source.name || '';
    document.getElementById('serialNumber').value = source.serialNumber || '';
    document.getElementById('itemNote').value = source.note || '';
    document.getElementById('assignedUser').value = source.assignedUserId || '';

    // Každá kopie má vlastní seznam příslušenství, aby editace neměnila originál.
    accessoryDraft = JSON.parse(JSON.stringify(source.accessories || []));
    renderAccessoryEditor();

    const newNo = nextNumber();
    document.getElementById('inventoryNo').value = newNo;
    document.getElementById('numberNotice').textContent =
      'Kopie položky ' + source.inventoryNo + '. Nové inventární číslo: ' +
      newNo + '. Před uložením ho můžeš upravit. Původní položka zůstane zachována.';
    // Souborové přílohy jsou svázané s originálem a kvůli riziku jejich
    // společného smazání je do kopie nepřebíráme.
  };

  // Překreslení vytvoří tlačítka i na položkách, které už jsou na stránce.
  if (typeof currentBranch !== 'undefined' && currentBranch) renderBranch();
})();
