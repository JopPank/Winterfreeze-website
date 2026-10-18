import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

(function () {
  const T = window.TRIP;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const STORE = 'wtf2027:checks';
  const EXPENSE_CATEGORIES = ['Dépôt', 'Activité', 'Boisson', 'Chalet', 'Collation', 'Divers', 'Gaz', 'Repas'];
  const ARCHIVE_GALLERY_PHOTOS = [
    '1000321.jpg',
    '1000336.jpg',
    'IMG_20120203_143727.jpg',
    'IMG_20130118_171001.jpg',
    'IMG_20130118_193930.jpg',
    'IMG_20190125_094813.jpg',
    'MVIMG_20200222_135109-EFFECTS.jpg',
  ];
  const money = (amount) => Number(amount).toLocaleString('fr-CA', { style: 'currency', currency: 'CAD' });
  const supabaseConfig = window.WTF_SUPABASE || {};
  const supabase = supabaseConfig.url && supabaseConfig.anonKey
    ? createClient(supabaseConfig.url, supabaseConfig.anonKey)
    : null;

  let legacyChecks = {};
  try { legacyChecks = JSON.parse(localStorage.getItem(STORE) || '{}'); } catch { legacyChecks = {}; }
  let expenses = [];
  let checklistItems = [];
  let checklistChecks = [];
  let checkedItemIds = new Set();
  let meals = [];
  let galleryPhotos = [];
  let expenseError = '';
  let checklistError = '';
  let mealError = '';
  let galleryError = '';
  let siteAuthError = '';
  let currentUser = null;
  let authChecked = false;
  let authBusy = false;
  let authStateEventReceived = false;
  let expensesLoading = false;
  let mealsLoading = true;
  let mealSaving = false;
  let editingMealSlot = null;
  let mealDraft = null;
  let galleryLoading = true;
  let galleryUploading = false;
  let checklistLoading = false;
  let checklistLoaded = false;
  let checklistEditMode = false;
  let editingChecklistItem = null;
  let financeChannel = null;
  let financeRefreshTimer = null;
  let mealsChannel = null;
  let mealsRefreshTimer = null;
  let mealLoadPromise = null;
  let galleryChannel = null;
  let galleryRefreshTimer = null;
  let checklistChannel = null;
  let checklistRefreshTimer = null;
  let checklistLoadPromise = null;
  const REPAS_DAYS = [
    { number: 1, name: 'Jeudi 28 janvier' },
    { number: 2, name: 'Vendredi 29 janvier' },
    { number: 3, name: 'Samedi 30 janvier' },
    { number: 4, name: 'Dimanche 31 janvier' },
  ];
  const REPAS_TYPES = ['Déjeuner', 'Dîner', 'Souper', 'Collation'];
  const REPAS_MAIN_TYPES = ['Déjeuner', 'Dîner', 'Souper'];
  const REPAS_DAY_NUMBERS = { Jeudi: 1, Vendredi: 2, Samedi: 3, Dimanche: 4 };
  const repasTypesForDay = (dayNumber) => REPAS_TYPES.filter((type) =>
    !(dayNumber === 1 && type === 'Déjeuner')
    && !(dayNumber === 4 && ['Dîner', 'Souper'].includes(type)));

  function defaultMealRows() {
    const rows = [];
    const add = (day, type, menu, responsible = '', notes = '') => rows.push({
      day_number: day,
      meal_type: type,
      menu,
      responsible,
      notes,
    });
    for (const [type, entries] of [
      ['Déjeuner', T.repas.dejeuners],
      ['Souper', T.repas.soupers],
    ]) {
      entries.forEach((entry) => add(
        REPAS_DAY_NUMBERS[entry.j],
        type,
        entry.t,
        entry.q,
        entry.d,
      ));
    }
    add(1, 'Dîner', 'Resto Pub O’Max', '', '11 h – 11 h 30; réserver d’avance au pub.');
    const thursdaySnack = T.repas.collations.find((entry) => entry.j.startsWith('Jeudi'));
    if (thursdaySnack) add(1, 'Collation', thursdaySnack.t, thursdaySnack.q, thursdaySnack.d);
    const weekendSnacks = T.repas.collations.find((entry) => entry.j.startsWith('Vendredi'));
    if (weekendSnacks) {
      add(2, 'Collation', weekendSnacks.t, weekendSnacks.q, weekendSnacks.d);
      add(3, 'Collation', weekendSnacks.t, weekendSnacks.q, weekendSnacks.d);
    }
    return rows;
  }
  function defaultChecklistRows() {
    const rows = [];
    T.avantDepart.forEach((item, index) => rows.push({
      list_key: 'depart', group_name: '', label: item.t, quantity: '', detail: item.q || '', status: '',
      sort_order: index, seed_key: `depart:${index}`,
    }));
    T.epicerie.forEach((section, sectionIndex) => section.items.forEach((item, index) => rows.push({
      list_key: 'epicerie', group_name: section.magasin, label: item[1], quantity: String(item[0]), detail: item[2] || '', status: '',
      sort_order: index, seed_key: `epi:${sectionIndex}:${index}`,
    })));
    Object.entries(window.EQUIP).forEach(([person, items]) => items.forEach((label, index) => rows.push({
      list_key: 'equipement', group_name: person, label, quantity: '', detail: '', status: '',
      sort_order: index, seed_key: `eq:${person}:${index}`,
    })));
    window.WTFBOX.forEach((item, index) => rows.push({
      list_key: 'box', group_name: '', label: item.item, quantity: '', detail: '', status: item.apres2026 || '',
      sort_order: index, seed_key: `box:${index}`,
    }));
    return rows;
  }

  async function refreshChecklists() {
    if (!supabase || !currentUser) return;
    const requestedBy = currentUser.id;
    checklistLoading = true;
    if (['survol', 'epicerie', 'equipement', 'box'].includes(location.hash.slice(1))) show(location.hash.slice(1));
    try {
      const [{ data: items, error: itemsError }, { data: checksData, error: checksError }] = await Promise.all([
        supabase.from('winterfreeze_checklist_items')
          .select('id, list_key, group_name, label, quantity, detail, status, sort_order, seed_key, created_at, updated_at')
          .order('list_key').order('group_name').order('sort_order').order('created_at'),
        supabase.from('winterfreeze_checklist_checks').select('item_id, checked, updated_at'),
      ]);
      if (currentUser?.id !== requestedBy) return;
      if (itemsError || checksError) {
        checklistError = `Impossible de charger les listes partagées : ${(itemsError || checksError).message}`;
        checklistItems = [];
        checklistChecks = [];
        checkedItemIds = new Set();
        checklistLoaded = false;
      } else {
        checklistItems = items || [];
        checklistChecks = checksData || [];
        checkedItemIds = new Set((checksData || []).filter((row) => row.checked).map((row) => row.item_id));
        checklistError = '';
        checklistLoaded = true;
      }
    } catch (error) {
      if (currentUser?.id !== requestedBy) return;
      checklistError = `Impossible de charger les listes partagées : ${error instanceof Error ? error.message : String(error)}`;
      checklistItems = [];
      checklistChecks = [];
      checkedItemIds = new Set();
      checklistLoaded = false;
    } finally {
      if (currentUser?.id === requestedBy) checklistLoading = false;
    }
    if (currentUser?.id === requestedBy && ['survol', 'epicerie', 'equipement', 'box'].includes(location.hash.slice(1))) show(location.hash.slice(1));
  }

  async function initializeChecklists() {
    if (!supabase || !currentUser || checklistLoadPromise) return checklistLoadPromise;
    const requestedBy = currentUser.id;
    checklistLoadPromise = (async () => {
      checklistLoading = true;
      checklistError = '';
      if (['survol', 'epicerie', 'equipement', 'box'].includes(location.hash.slice(1))) show(location.hash.slice(1));
      try {
        const checkedSeedKeys = Object.keys(legacyChecks).filter((key) => legacyChecks[key]);
        const { data: seededNow, error } = await supabase.rpc('seed_winterfreeze_checklists', {
          p_items: defaultChecklistRows(),
          p_checked_seed_keys: checkedSeedKeys,
        });
        if (currentUser?.id !== requestedBy) return;
        if (error) {
          checklistError = `Impossible d’initialiser les listes partagées : ${error.message}`;
          return;
        }
        if (seededNow) {
          try { localStorage.removeItem(STORE); } catch { /* stockage indisponible */ }
        }
        legacyChecks = {};
        await refreshChecklists();
        startChecklistSync();
      } catch (error) {
        if (currentUser?.id === requestedBy) checklistError = `Impossible d’initialiser les listes partagées : ${error instanceof Error ? error.message : String(error)}`;
      } finally {
        if (currentUser?.id === requestedBy) {
          checklistLoading = false;
          if (['survol', 'epicerie', 'equipement', 'box'].includes(location.hash.slice(1))) show(location.hash.slice(1));
        }
      }
    })().finally(() => {
      checklistLoadPromise = null;
    });
    return checklistLoadPromise;
  }

  function stopChecklistSync() {
    if (checklistRefreshTimer) clearInterval(checklistRefreshTimer);
    checklistRefreshTimer = null;
    if (checklistChannel && supabase) void supabase.removeChannel(checklistChannel);
    checklistChannel = null;
  }

  function startChecklistSync() {
    if (!supabase || !currentUser) return;
    stopChecklistSync();
    checklistChannel = supabase
      .channel('winterfreeze-checklists')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'winterfreeze_checklist_items' }, () => void refreshChecklists())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'winterfreeze_checklist_checks' }, () => void refreshChecklists())
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          checklistError = 'La mise à jour en direct des listes est indisponible. Les listes seront actualisées automatiquement.';
          if (['survol', 'epicerie', 'equipement', 'box'].includes(location.hash.slice(1))) show(location.hash.slice(1));
        }
      });
    checklistRefreshTimer = setInterval(() => void refreshChecklists(), 30000);
  }

  function expenseParticipants(expense) {
    return Array.isArray(expense.split_between)
      ? T.participants.filter((person) => expense.split_between.includes(person))
      : T.participants;
  }
  function calculateSettlements() {
    const totalCents = expenses.reduce((sum, expense) => sum + Math.round(expense.amount * 100), 0);
    const shares = Object.fromEntries(T.participants.map((person) => [person, 0]));
    for (const expense of expenses) {
      const participants = expenseParticipants(expense);
      if (!participants.length) continue;
      const cents = Math.round(expense.amount * 100);
      const baseShare = Math.floor(cents / participants.length);
      let extraCents = cents % participants.length;
      for (const person of participants) {
        shares[person] += baseShare + (extraCents > 0 ? 1 : 0);
        if (extraCents > 0) extraCents -= 1;
      }
    }
    const balances = T.participants.map((person) => {
      const paid = expenses.reduce((sum, expense) =>
        sum + (expense.payer === person ? Math.round(expense.amount * 100) : 0), 0);
      return { person, paid, balance: paid - shares[person] };
    });
    const debtors = balances.filter((person) => person.balance < 0).map((person) => ({ person: person.person, amount: -person.balance }));
    const creditors = balances.filter((person) => person.balance > 0).map((person) => ({ person: person.person, amount: person.balance }));
    const transfers = [];
    while (debtors.length && creditors.length) {
      const debtor = debtors[0];
      const creditor = creditors[0];
      const amount = Math.min(debtor.amount, creditor.amount);
      transfers.push({ from: debtor.person, to: creditor.person, cents: amount });
      debtor.amount -= amount;
      creditor.amount -= amount;
      if (debtor.amount === 0) debtors.shift();
      if (creditor.amount === 0) creditors.shift();
    }
    return { totalCents, balances, transfers };
  }
  function updateSiteAccess() {
    const shell = $('#site-shell');
    const authScreen = $('#site-auth');
    shell.hidden = true;

    if (!supabase) {
      authScreen.hidden = false;
      authScreen.innerHTML = `<section class="site-auth-card"><span class="eyebrow">Configuration requise</span><h1>Winterfreeze 2027</h1><p>La connexion privée n’est pas configurée. Vérifiez les paramètres Supabase du site.</p></section>`;
      return;
    }
    if (!authChecked) {
      authScreen.hidden = false;
      authScreen.innerHTML = '<section class="site-auth-card"><p class="muted">Vérification de votre session…</p></section>';
      return;
    }
    if (!currentUser) {
      authScreen.hidden = false;
      authScreen.innerHTML = `<section class="site-auth-card">
        <span class="eyebrow">Espace privé des participants</span>
        <h1>Winterfreeze 2027</h1>
        <p>Connectez-vous avec le compte que l’organisateur vous a créé pour accéder aux détails du voyage et aux finances partagées.</p>
        ${siteAuthError ? `<p class="site-auth-error" role="alert">${esc(siteAuthError)}</p>` : ''}
        <form id="site-login" class="site-login-form">
          <label>Courriel<input name="email" type="email" autocomplete="username" required></label>
          <label>Mot de passe<input name="password" type="password" autocomplete="current-password" required></label>
          <button class="btn" type="submit"${authBusy ? ' disabled' : ''}>${authBusy ? 'Connexion…' : 'Se connecter'}</button>
        </form>
      </section>`;
      $('#site-shell').querySelector('#view').innerHTML = '';
      return;
    }

    authScreen.hidden = true;
    shell.hidden = false;
    $('#site-user').textContent = currentUser.email || 'Participant connecté';
    $('#site-notice').hidden = !siteAuthError;
    $('#site-notice').textContent = siteAuthError;
    show(location.hash.slice(1));
  }

  async function checkSiteSession() {
    if (!supabase) {
      authChecked = true;
      updateSiteAccess();
      return;
    }
    try {
      const { data, error } = await supabase.auth.getSession();
      if (authStateEventReceived) return;
      if (error) siteAuthError = `Impossible de vérifier la session : ${error.message}`;
      currentUser = data.session?.user || null;
    } catch (error) {
      if (authStateEventReceived) return;
      siteAuthError = `Impossible de vérifier la session : ${error instanceof Error ? error.message : String(error)}`;
    }
    authChecked = true;
    updateSiteAccess();
    if (currentUser) {
      await refreshExpenses();
      startFinanceSync();
      await initializeMeals();
      await refreshGallery();
      startGallerySync();
      await initializeChecklists();
    }
  }
  async function refreshExpenses() {
    if (!supabase || !currentUser) return;
    expensesLoading = true;
    if (location.hash === '#finances') show('finances');
    const { data, error } = await supabase
      .from('winterfreeze_expenses')
      .select('id, description, category, amount, payer, split_between, created_by, created_at')
      .order('created_at', { ascending: false });
    expensesLoading = false;
    meals = [];
    mealsLoading = true;
    mealSaving = false;
    editingMealSlot = null;
    mealDraft = null;
    mealError = '';
    if (error) {
      expenseError = `Impossible de charger les dépenses : ${error.message}`;
    } else {
      expenses = data || [];
      expenseError = '';
    }
    if (location.hash === '#finances') show('finances');
  }
  async function refreshMeals() {
    if (!supabase || !currentUser) return;
    const requestedBy = currentUser.id;
    mealsLoading = true;
    if (location.hash === '#repas') show('repas');
    try {
      const { data, error } = await supabase.from('winterfreeze_meals')
        .select('day_number, meal_type, menu, responsible, notes, updated_at')
        .order('day_number').order('meal_type');
      if (currentUser?.id !== requestedBy) return;
      if (error) throw new Error(error.message);
      meals = data || [];
      mealError = '';
    } catch (error) {
      if (currentUser?.id !== requestedBy) return;
      meals = [];
      mealError = `Impossible de charger le plan des repas : ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      if (currentUser?.id === requestedBy) mealsLoading = false;
    }
    if (currentUser?.id === requestedBy && location.hash === '#repas') show('repas');
  }
  async function initializeMeals() {
    if (!supabase || !currentUser || mealLoadPromise) return mealLoadPromise;
    const requestedBy = currentUser.id;
    mealLoadPromise = (async () => {
      mealsLoading = true;
      mealError = '';
      if (location.hash === '#repas') show('repas');
      try {
        const { error } = await supabase.from('winterfreeze_meals')
          .upsert(defaultMealRows(), { onConflict: 'day_number,meal_type', ignoreDuplicates: true });
        if (currentUser?.id !== requestedBy) return;
        if (error) throw new Error(error.message);
        await refreshMeals();
        startMealsSync();
      } catch (error) {
        if (currentUser?.id === requestedBy) {
          meals = [];
          mealsLoading = false;
          mealError = `Impossible d’initialiser le plan des repas : ${error instanceof Error ? error.message : String(error)}`;
          if (location.hash === '#repas') show('repas');
        }
      }
    })().finally(() => {
      mealLoadPromise = null;
    });
    return mealLoadPromise;
  }
  function stopMealsSync() {
    if (mealsRefreshTimer) clearInterval(mealsRefreshTimer);
    mealsRefreshTimer = null;
    if (mealsChannel && supabase) void supabase.removeChannel(mealsChannel);
    mealsChannel = null;
  }
  function startMealsSync() {
    if (!supabase || !currentUser) return;
    stopMealsSync();
    mealsChannel = supabase
      .channel('winterfreeze-meals')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'winterfreeze_meals' }, () => void refreshMeals())
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          mealError = 'La mise à jour en direct est indisponible. Le plan des repas sera actualisé automatiquement.';
          if (location.hash === '#repas') show('repas');
        }
      });
    mealsRefreshTimer = setInterval(() => void refreshMeals(), 30000);
  }
  async function refreshGallery() {
    if (!supabase || !currentUser) return;
    const requestedBy = currentUser.id;
    galleryLoading = true;
    if (location.hash === '#galerie') show('galerie');
    try {
      const { data, error } = await supabase
        .from('winterfreeze_gallery_photos')
        .select('id, photo_path, caption, uploaded_by, created_at')
        .order('created_at', { ascending: false });
      if (currentUser?.id !== requestedBy) return;
      if (error) throw new Error(error.message);
      const photos = await Promise.all((data || []).map(async (photo) => {
        const { data: signedPhoto, error: signedPhotoError } = await supabase.storage
          .from('winterfreeze-gallery')
          .createSignedUrl(photo.photo_path, 3600);
        if (signedPhotoError) throw new Error(signedPhotoError.message);
        return { ...photo, url: signedPhoto.signedUrl };
      }));
      if (currentUser?.id !== requestedBy) return;
      galleryPhotos = photos;
      galleryError = '';
    } catch (error) {
      if (currentUser?.id !== requestedBy) return;
      galleryPhotos = [];
      galleryError = `Impossible de charger la galerie : ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      if (currentUser?.id === requestedBy) galleryLoading = false;
    }
    if (currentUser?.id === requestedBy && location.hash === '#galerie') show('galerie');
  }
  function stopGallerySync() {
    if (galleryRefreshTimer) clearInterval(galleryRefreshTimer);
    galleryRefreshTimer = null;
    if (galleryChannel && supabase) void supabase.removeChannel(galleryChannel);
    galleryChannel = null;
  }
  function startGallerySync() {
    if (!supabase || !currentUser) return;
    stopGallerySync();
    galleryChannel = supabase
      .channel('winterfreeze-gallery')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'winterfreeze_gallery_photos' }, () => void refreshGallery())
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          galleryError = 'La mise à jour en direct est indisponible. La galerie sera actualisée automatiquement.';
          if (location.hash === '#galerie') show('galerie');
        }
      });
    galleryRefreshTimer = setInterval(() => void refreshGallery(), 30000);
  }
  function stopFinanceSync() {
    if (financeRefreshTimer) clearInterval(financeRefreshTimer);
    financeRefreshTimer = null;
    if (financeChannel && supabase) void supabase.removeChannel(financeChannel);
    financeChannel = null;
  }
  function startFinanceSync() {
    if (!supabase || !currentUser) return;
    stopFinanceSync();
    financeChannel = supabase
      .channel('winterfreeze-expenses')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'winterfreeze_expenses' }, () => void refreshExpenses())
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          expenseError = 'La mise à jour en direct est indisponible. Les dépenses seront actualisées automatiquement.';
          if (location.hash === '#finances') show('finances');
        }
      });
    financeRefreshTimer = setInterval(() => void refreshExpenses(), 30000);
  }
  if (supabase) {
    supabase.auth.onAuthStateChange((_event, session) => {
      authStateEventReceived = true;
      currentUser = session?.user || null;
      authChecked = true;
      siteAuthError = '';
      updateSiteAccess();
      if (currentUser) {
        void refreshExpenses().then(startFinanceSync);
        void initializeMeals();
        void refreshGallery().then(startGallerySync);
        void initializeChecklists();
      } else {
        stopFinanceSync();
        stopMealsSync();
        stopGallerySync();
        stopChecklistSync();
        expenses = [];
        expensesLoading = false;
        galleryPhotos = [];
        galleryLoading = true;
        galleryUploading = false;
        galleryError = '';
        checklistItems = [];
        checklistChecks = [];
        checkedItemIds = new Set();
        checklistLoading = false;
        checklistLoaded = false;
        checklistEditMode = false;
        editingChecklistItem = null;
      }
    });
  }

  const checkItem = (item, html, extra = '', controls = '') => `
    <div class="check-row">
      <label class="check">
        <input type="checkbox" data-check-item="${esc(item.id)}"${checkedItemIds.has(item.id) ? ' checked' : ''}>
        ${extra}<span>${html}</span>
      </label>${controls}
    </div>`;

  const progressBar = (items, id) => {
    const done = items.filter((item) => checkedItemIds.has(item.id)).length;
    const pct = items.length ? Math.round((done / items.length) * 100) : 0;
    return `<div class="heading"><span class="count" data-count="${id}">${done} SUR ${items.length} COMPLÉTÉS</span></div>
      <div class="progress"><i data-bar="${id}" style="width:${pct}%"></i></div>`;
  };

  const listItemsFor = (listKey, groupName) => checklistItems.filter((item) =>
    item.list_key === listKey && (groupName === undefined || item.group_name === groupName));

  const sharedUpdateLabel = (timestamp) => {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    if (!Number.isFinite(date.getTime())) return '';
    const formatted = new Intl.DateTimeFormat('fr-CA', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    }).format(date);
    return `<time class="shared-update" datetime="${esc(date.toISOString())}">Mis à jour le ${esc(formatted)}</time>`;
  };

  function latestTimestamp(timestamps) {
    const latest = timestamps.reduce((max, timestamp) => {
      const time = Date.parse(timestamp || '');
      return Number.isFinite(time) ? Math.max(max, time) : max;
    }, 0);
    return latest ? new Date(latest).toISOString() : '';
  }

  function checklistActivity(listKey, groupName) {
    const items = listItemsFor(listKey, groupName);
    const itemIds = new Set(items.map((item) => item.id));
    const timestamps = [
      ...items.map((item) => item.updated_at || item.created_at),
      ...checklistChecks.filter((check) => itemIds.has(check.item_id)).map((check) => check.updated_at),
    ].filter(Boolean);
    return sharedUpdateLabel(latestTimestamp(timestamps));
  }

  function checklistGroupOptions(listKey) {
    if (listKey === 'epicerie') return T.epicerie.map((section) => section.magasin);
    if (listKey === 'equipement') return Object.keys(window.EQUIP);
    return [];
  }

  function checklistFieldMarkup(item, listKey, groupName, editing) {
    const itemValue = editing ? item.label : '';
    const detailValue = editing ? item.detail : '';
    const quantityValue = editing ? item.quantity : '';
    const statusValue = editing ? item.status : '';
    const groupValue = editing ? item.group_name : groupName;
    const groupOptions = checklistGroupOptions(listKey);
    return `
      <input type="hidden" name="list_key" value="${esc(listKey)}">
      ${groupOptions.length ? `<label>${listKey === 'epicerie' ? 'Magasin' : 'Personne'}
        <select name="group_name" required>${groupOptions.map((name) => `<option value="${esc(name)}"${name === groupValue ? ' selected' : ''}>${esc(name === 'Tous' ? 'Pour tous' : name)}</option>`).join('')}</select>
      </label>` : `<input type="hidden" name="group_name" value="${esc(groupValue)}">`}
      <label>Article<input name="label" maxlength="180" required value="${esc(itemValue)}"></label>
      ${listKey === 'epicerie' ? `<label>Quantité<input name="quantity" value="${esc(quantityValue)}" placeholder="1"></label>` : ''}
      ${listKey === 'epicerie' ? `<label>Note<input name="detail" value="${esc(detailValue)}"></label>` : ''}
      ${listKey === 'depart' ? `<label>Responsable<input name="detail" value="${esc(detailValue)}"></label>` : ''}
      ${listKey === 'box' ? `<label>Statut<input name="status" value="${esc(statusValue)}" placeholder="GOOD, MAYBE…"></label>` : ''}`;
  }

  function renderChecklistEditForm(item) {
    return `<form class="checklist-edit-form" data-checklist-update="${esc(item.id)}">
      ${checklistFieldMarkup(item, item.list_key, item.group_name, true)}
      <div class="checklist-form-actions"><button class="btn" type="submit">Enregistrer</button><button class="text-button" type="button" data-cancel-list-edit>Annuler</button></div>
    </form>`;
  }

  function renderChecklistControls(item) {
    if (!checklistEditMode) return '';
    if (editingChecklistItem === item.id) return renderChecklistEditForm(item);
    return `<div class="checklist-item-actions"><button class="text-button" type="button" data-edit-list-item="${esc(item.id)}">Modifier</button>
      <button class="text-button checklist-delete" type="button" data-delete-list-item="${esc(item.id)}">Supprimer</button></div>`;
  }

  function renderChecklistManager(listKey, groupName) {
    return `<section class="checklist-manager">
      <button class="btn ghost" type="button" data-toggle-list-editor>${checklistEditMode ? 'Terminer la modification' : 'Modifier la liste'}</button>
      ${checklistEditMode ? `<form class="checklist-add-form" data-checklist-add>
        ${checklistFieldMarkup(null, listKey, groupName, false)}
        <button class="btn" type="submit">Ajouter à la liste</button>
      </form>` : ''}
    </section>`;
  }

  const tabs = [
    { id: 'survol', label: 'Survol', render: renderSurvol },
    { id: 'repas', label: 'Repas', render: renderRepas },
    { id: 'epicerie', label: 'Épicerie', render: renderEpicerie },
    { id: 'equipement', label: 'Équipement', render: renderEquipement },
    { id: 'box', label: 'WTF Box', render: renderBox },
    { id: 'finances', label: 'Finances', render: renderFinances },
    { id: 'galerie', label: 'Galerie', render: renderGallery },
    { id: 'dnd', label: 'D&D', render: renderDnd },
    { id: 'bilan', label: 'Notes 2026', render: renderBilan },
  ];

  function renderSurvol() {
    const c = T.chalet;
    const departureActivity = checklistActivity('depart');
    return `
    <div class="grid">
      <section class="block">
        <span class="eyebrow">Notre base</span><h2>${esc(c.nom)}</h2>
        <dl class="kv">
          <dt>Adresse</dt><dd>${esc(c.adresse)} · <a href="${esc(c.carte)}" target="_blank" rel="noopener">Carte</a></dd>
          <dt>Séjour</dt><dd>28 au 31 janvier 2027 · ${c.nuits} nuits</dd>
          <dt>Arrivée</dt><dd>Jeudi vers 13 h</dd>
          <dt>Départ</dt><dd>Dimanche à 11 h</dd>
          <dt>WiFi</dt><dd>${esc(c.wifi)}</dd>
        </dl>
      </section>
    </div>

    <section class="block">
      <span class="eyebrow">Jour par jour</span><h2>Horaire</h2>
      <div class="grid">${T.horaire.map((h) => `<div><h3>${esc(h.jour)}</h3><ul class="bullets">${h.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div>`).join('')}</div>
    </section>

    <div class="grid">
      <section class="block">
        <span class="eyebrow">Aller au chalet</span><h2>Transport</h2>
        ${T.transport.map((r) => `<div class="card-row"><b>${esc(r.t)}</b><span>${esc(r.d)}</span></div>`).join('')}
      </section>
      <section class="block">
        <span class="eyebrow">Qui s’en occupe</span><h2>Achats</h2>
        ${T.courses.map((r) => `<div class="card-row"><b>${esc(r.t)}</b><span>${esc(r.d)}</span></div>`).join('')}
      </section>
    </div>

    <div class="grid">
      <section class="block">
        <span class="eyebrow">Dodo</span><h2>Chambres</h2>
        ${T.chambres.map((r) => `<div class="card-row"><b>${esc(r.qui)}</b><span>${esc(r.lit)}</span></div>`).join('')}
      </section>
      <section class="block">
        <span class="eyebrow">Santé!</span><h2>Boissons et activités</h2>
        ${T.boissons.map((r) => `<div class="card-row"><b>${esc(r.t)}</b><span>${esc(r.d)}</span></div>`).join('')}
        <h3>Activités</h3>
        ${T.activites.map((r) => `<div class="card-row"><b>${esc(r.t)}</b><span>${esc(r.d)}</span></div>`).join('')}
      </section>
    </div>

    <section class="block">
      <span class="eyebrow">Pour se rendre</span><h2>Directions</h2>
      <ol class="steps">${T.directions.map((d) => `<li>${esc(d)}</li>`).join('')}</ol>
      <p><a class="btn" href="${esc(T.chalet.carte)}" target="_blank" rel="noopener">Ouvrir dans Google Maps</a></p>
    </section>

    <section class="block">
      <span class="eyebrow">À faire avant le départ du chalet</span><h2>Ménage du dimanche</h2>
      ${departureActivity}
      ${checklistLoading && !checklistLoaded ? '<p class="muted">Chargement de la liste partagée…</p>' : ''}
      ${checklistError ? `<p class="finance-error" role="alert">${esc(checklistError)}</p>` : ''}
      ${(() => {
        const items = listItemsFor('depart');
        return `${progressBar(items, 'depart')}${items.map((item) => checkItem(item, esc(item.label) + (item.detail ? ` <span class="pill">${esc(item.detail)}</span>` : ''), '', renderChecklistControls(item))).join('')}`;
      })()}
      ${renderChecklistManager('depart', '')}
    </section>`;
  }

  function renderRepas() {
    const editingMeal = editingMealSlot && meals.find((meal) =>
      meal.day_number === editingMealSlot.day_number && meal.meal_type === editingMealSlot.meal_type);
    const existingSlot = editingMealSlot || { day_number: null, meal_type: null };
    const slotMarkup = (dayNumber, type) => {
      const meal = meals.find((item) => item.day_number === dayNumber && item.meal_type === type);
      return `<article class="meal-slot">
        <div class="meal-slot-heading"><span class="eyebrow">${esc(type)}</span>
          <button class="text-button" type="button" data-edit-meal-day="${dayNumber}" data-edit-meal-type="${esc(type)}">${meal ? 'Modifier' : 'Planifier'}</button>
        </div>
        <h3>${esc(meal?.menu || 'Menu à déterminer')}</h3>
        ${meal?.responsible ? `<span class="pill meal-responsible">${esc(meal.responsible)}</span>` : ''}
        ${meal?.notes ? `<p class="muted">${esc(meal.notes)}</p>` : ''}
        ${meal?.updated_at ? sharedUpdateLabel(meal.updated_at) : ''}
      </article>`;
    };
    const dayMarkup = REPAS_DAYS.map((day) => {
      const snacks = meals.filter((meal) => meal.day_number === day.number && meal.meal_type === 'Collation');
      return `<section class="meal-day">
        <div class="meal-day-heading"><span class="eyebrow">Jour ${day.number}</span><h2>${esc(day.name)}</h2></div>
        <div class="meal-slots">${REPAS_MAIN_TYPES.filter((type) => repasTypesForDay(day.number).includes(type)).map((type) => slotMarkup(day.number, type)).join('')}
          ${snacks.map((snack) => slotMarkup(day.number, snack.meal_type)).join('')}
        </div>
      </section>`;
    }).join('');
    const plannedCount = meals.filter((meal) => repasTypesForDay(meal.day_number).includes(meal.meal_type)
      && meal.menu.trim().toLocaleLowerCase('fr-CA') !== 'menu à déterminer').length;
    const editingDay = REPAS_DAYS.find((day) => day.number === existingSlot.day_number);
    const formDay = Number(mealDraft?.day_number || 1);
    const formMealTypes = repasTypesForDay(formDay);
    const selectedFormMealType = formMealTypes.includes(mealDraft?.meal_type)
      ? mealDraft.meal_type
      : formMealTypes[0];
    return `
    <div class="meals-layout">
      <section class="meals-main">
        <div class="heading"><div><span class="eyebrow">Autour de la table</span><h2>Plan des repas</h2>${sharedUpdateLabel(latestTimestamp(meals.map((meal) => meal.updated_at)))}</div><span class="count">${plannedCount} PLANIFIÉ${plannedCount === 1 ? '' : 'S'}</span></div>
        <p class="lead">Du jeudi 28 au dimanche 31 janvier 2027. Les repas sont partagés et modifiables par tous les participants.</p>
        ${mealError ? `<p class="finance-error" role="alert">${esc(mealError)}</p>` : ''}
        ${mealsLoading ? '<p class="muted">Chargement du plan des repas…</p>' : `<div class="meal-days">${dayMarkup}</div>`}
      </section>
      <aside class="meal-form-card">
        <span class="eyebrow">${editingMeal ? 'Mise à jour partagée' : editingMealSlot ? 'Créneau sélectionné' : 'À table!'}</span>
        <h3>${editingMeal ? 'Modifier le repas' : editingMealSlot ? 'Planifier ce repas' : 'Ajouter au menu'}</h3>
        <form id="meal-form" class="meal-form">
          <label>Jour du voyage
            ${editingMealSlot
              ? `<select disabled>${REPAS_DAYS.map((day) => `<option value="${day.number}"${day.number === existingSlot.day_number ? ' selected' : ''}>${esc(`${day.number} — ${day.name}`)}</option>`).join('')}</select><input type="hidden" name="day_number" value="${existingSlot.day_number}">`
              : `<select name="day_number" required>${REPAS_DAYS.map((day) => `<option value="${day.number}"${Number(mealDraft?.day_number || 1) === day.number ? ' selected' : ''}>${esc(`${day.number} — ${day.name}`)}</option>`).join('')}</select>`}
          </label>
          <label>Repas
            ${editingMealSlot
              ? `<select disabled>${REPAS_TYPES.map((type) => `<option${type === existingSlot.meal_type ? ' selected' : ''}>${esc(type)}</option>`).join('')}</select><input type="hidden" name="meal_type" value="${esc(existingSlot.meal_type)}">`
              : `<select name="meal_type" required>${formMealTypes.map((type) => `<option${selectedFormMealType === type ? ' selected' : ''}>${esc(type)}</option>`).join('')}</select>`}
          </label>
          <label>Responsable<input name="responsible" type="text" maxlength="100" placeholder="Nom ou équipe" value="${esc(mealDraft?.responsible ?? editingMeal?.responsible ?? '')}"></label>
          <label>Qu’y a-t-il au menu?<textarea name="menu" maxlength="180" placeholder="Décrivez le repas…" required>${esc(mealDraft?.menu ?? editingMeal?.menu ?? '')}</textarea></label>
          <label>Notes (facultatif)<textarea name="notes" maxlength="1000" placeholder="Détails, accompagnements…">${esc(mealDraft?.notes ?? editingMeal?.notes ?? '')}</textarea></label>
          <button class="btn submit-meal" type="submit"${mealSaving ? ' disabled' : ''}>${mealSaving ? 'Enregistrement…' : 'Enregistrer le repas'} <span aria-hidden="true">↗</span></button>
          ${editingMealSlot ? '<button class="text-button meal-cancel" type="button" data-cancel-meal-edit>Annuler la modification</button>' : ''}
        </form>
        <p class="form-hint">Un repas par jour et par type. Modifier un créneau met à jour le menu partagé pour tout le monde.</p>
        ${editingDay ? `<p class="form-hint">Créneau sélectionné : jour ${editingDay.number}, ${esc(existingSlot.meal_type.toLocaleLowerCase('fr-CA'))}.</p>` : ''}
      </aside>
    </div>
    <section class="block">
      <span class="eyebrow">Aide-mémoire</span><h2>Recettes</h2>
      <div class="grid">${T.recettes.map((r) => `<div><h3>${esc(r.nom)}</h3><ol class="steps">${r.etapes.map((e) => `<li>${esc(e)}</li>`).join('')}</ol></div>`).join('')}</div>
    </section>`;
  }

  function renderEpicerie() {
    const items = listItemsFor('epicerie');
    const activity = checklistActivity('epicerie');
    const sections = T.epicerie.map((section) => {
      const groupItems = listItemsFor('epicerie', section.magasin);
      const html = groupItems.map((item) => checkItem(
        item,
        `${esc(item.label)}${item.detail ? `<small>${esc(item.detail)}</small>` : ''}`,
        item.quantity ? `<span class="qty">${esc(item.quantity)}×</span>` : '',
        renderChecklistControls(item),
      )).join('');
      return `<section class="block"><h2>${esc(section.magasin)}</h2>${html || '<p class="muted">Aucun article dans cette liste.</p>'}</section>`;
    }).join('');
    return `
    <section class="block">
      <div class="heading"><div><span class="eyebrow">Magasiner</span><h2>Liste d’épicerie</h2></div></div>
      ${activity}
      ${checklistLoading && !checklistLoaded ? '<p class="muted">Chargement de la liste partagée…</p>' : ''}
      ${checklistError ? `<p class="finance-error" role="alert">${esc(checklistError)}</p>` : ''}
      ${progressBar(items, 'epi')}
      <button class="btn ghost" id="reset-epi" type="button">Tout décocher</button>
    </section>
    ${renderChecklistManager('epicerie', T.epicerie[0]?.magasin || '')}
    <div class="grid">${sections}</div>`;
  }

  function renderEquipement() {
    const names = Object.keys(window.EQUIP);
    const active = renderEquipement.active && names.includes(renderEquipement.active) ? renderEquipement.active : names[0];
    const items = listItemsFor('equipement', active);
    const activity = checklistActivity('equipement', active);
    const label = (n) => (n === 'Tous' ? 'Pour tous' : n);
    return `
    <section class="block">
      <span class="eyebrow">Apportons l’essentiel</span><h2>Équipement</h2>
      <div class="chips" role="group" aria-label="Personne">${names.map((n) => `<button type="button" class="chip" data-eq="${esc(n)}" aria-pressed="${n === active}">${esc(label(n))}</button>`).join('')}</div>
      ${activity}
      ${checklistLoading && !checklistLoaded ? '<p class="muted">Chargement de la liste partagée…</p>' : ''}
      ${checklistError ? `<p class="finance-error" role="alert">${esc(checklistError)}</p>` : ''}
      ${renderChecklistManager('equipement', active)}
      ${progressBar(items, 'eq')}
      ${items.map((item) => checkItem(item, esc(item.label), '', renderChecklistControls(item))).join('') || '<p class="muted">Aucun article dans cette liste.</p>'}
    </section>`;
  }

  function renderBox() {
    const items = listItemsFor('box');
    const activity = checklistActivity('box');
    const status = (s) => {
      const u = s.toUpperCase();
      if (u.startsWith('BUY') || u.includes('NO MORE') || u.includes('NO WAND')) return 'hot';
      if (u.startsWith('GOOD')) return 'ok';
      return '';
    };
    return `
    <section class="block">
      <span class="eyebrow">Inventaire après WTF 2026</span><h2>La WTF Box</h2>
      <p class="lead">État de la boîte à la fin de 2026. Les items « À acheter » sont à ajouter avant de partir.</p>
      ${activity}
      ${checklistLoading && !checklistLoaded ? '<p class="muted">Chargement de la liste partagée…</p>' : ''}
      ${checklistError ? `<p class="finance-error" role="alert">${esc(checklistError)}</p>` : ''}
      ${renderChecklistManager('box', '')}
      ${progressBar(items, 'box')}
      ${items.map((item) => checkItem(item, `${esc(item.label)} ${item.status ? `<span class="pill ${status(item.status)}">${esc(item.status)}</span>` : ''}`, '', renderChecklistControls(item))).join('') || '<p class="muted">Aucun article dans cette liste.</p>'}
    </section>`;
  }

  function renderFinances() {
    if (!supabase) {
      return `<section class="block"><span class="eyebrow">Configuration requise</span><h2>Finances</h2>
        <p class="lead">Le partage privé des dépenses n’est pas encore configuré. Ajoutez l’URL et la clé publique du projet Supabase dans <code>supabase-config.js</code> et appliquez le schéma décrit dans README.md.</p></section>`;
    }
    if (!authChecked || !currentUser) {
      return '<section class="block"><p class="muted">Vérification de la session sécurisée…</p></section>';
    }
    if (expensesLoading) return '<section class="block"><p class="muted">Chargement des dépenses partagées…</p></section>';
    const { totalCents, balances, transfers } = calculateSettlements();
    const share = totalCents / T.participants.length;
    const fmtCents = (cents) => money(cents / 100);
    const dateFmt = new Intl.DateTimeFormat('fr-CA', { day: 'numeric', month: 'short' });
    return `
    <div class="finance-layout">
      <div class="finance-main">
        <section class="finance-section">
          <div class="heading"><div><span class="eyebrow">Simple et équitable</span><h2>Dépenses partagées</h2></div><span class="count">${expenses.length} ENTRÉE${expenses.length === 1 ? '' : 'S'}</span></div>
          ${expenseError ? `<p class="finance-error" role="alert">${esc(expenseError)}</p>` : ''}
          <div class="expense-summary">
            <div class="expense-total"><span>TOTAL DU VOYAGE</span><strong>${fmtCents(totalCents)}</strong><small>${money(share / 100)} en moyenne par personne</small></div>
            <div class="participant-balances">${balances.map((person) => `<div><span>${esc(person.person)}</span><small>${fmtCents(person.paid)} payé</small><strong class="${person.balance < 0 ? 'owes' : person.balance > 0 ? 'owed' : ''}">${person.balance > 0 ? '+' : ''}${fmtCents(person.balance)}</strong></div>`).join('')}</div>
          </div>
          <section class="reimbursements">
            <h3>Remboursements suggérés</h3>
            <p class="muted">${transfers.length ? 'Répartition calculée selon les participants sélectionnés pour chaque dépense.' : 'Les remboursements apparaîtront ici dès qu’une dépense est ajoutée.'}</p>
            ${transfers.length ? transfers.map((transfer) => `<div class="transfer-row"><span>${esc(transfer.from)} rembourse ${esc(transfer.to)}</span><strong>${fmtCents(transfer.cents)}</strong></div>`).join('') : '<div class="transfer-row"><span>Aucun remboursement à effectuer pour le moment.</span></div>'}
          </section>
          <p class="finance-private">Ces dépenses sont partagées en privé entre les huit comptes autorisés. Les dépenses ne sont jamais stockées dans ce navigateur.</p>
          ${expenseError ? `<p class="finance-error" role="alert">${esc(expenseError)}</p>` : ''}
          <div class="expense-list">
            ${expenses.length ? expenses.map((expense) => `<article class="expense-row">
              <span class="expense-icon" aria-hidden="true">↗</span>
              <span class="expense-description">${esc(expense.description)}<small>${esc(expense.category)} · Payé par ${esc(expense.payer)} · Partagé entre ${esc(expenseParticipants(expense).join(', '))} · ${esc(dateFmt.format(new Date(expense.created_at)))}</small></span>
              <strong>${money(expense.amount)}</strong>
              ${expense.created_by === currentUser.id ? `<button class="delete-button" type="button" data-delete-expense="${esc(expense.id)}" aria-label="Supprimer ${esc(expense.description)}">×</button>` : ''}
            </article>`).join('') : '<p class="muted">Aucune dépense pour l’instant. Ajoutez les frais au fur et à mesure.</p>'}
          </div>
        </section>
      </div>
      <aside class="finance-aside">
        <section class="finance-form-card">
          <span class="eyebrow">Les comptes, en toute simplicité</span><h3>Ajouter une dépense</h3>
          <form id="expense-form" class="expense-form">
            <label>À quoi correspond la dépense?<input name="description" maxlength="120" placeholder="Épicerie, bois de chauffage…" required></label>
            <label>Catégorie<select name="category">${EXPENSE_CATEGORIES.map((category) => `<option>${esc(category)}</option>`).join('')}</select></label>
            <label>Montant (CAD)<div class="amount-input"><span>$</span><input name="amount" type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="0,00" required></div></label>
            <label>Participant qui a payé<select name="payer">${T.participants.map((person) => `<option>${esc(person)}</option>`).join('')}</select></label>
            <fieldset class="expense-split">
              <legend>Répartir entre</legend>
              <div class="expense-split-options">${T.participants.map((person) => `<label><input type="checkbox" name="split_between" value="${esc(person)}" checked><span>${esc(person)}</span></label>`).join('')}</div>
              <small class="form-hint">Décochez les personnes qui ne partagent pas cette dépense.</small>
            </fieldset>
            <button class="btn submit-expense" type="submit">Ajouter la dépense <span aria-hidden="true">↗</span></button>
          </form>
        </section>
      </aside>
    </div>`;
  }

  function renderGallery() {
    const dateFmt = new Intl.DateTimeFormat('fr-CA', { day: 'numeric', month: 'short', year: 'numeric' });
    const uploadedPhotoCard = (photo) => `
      <article class="gallery-photo">
        <img src="${esc(photo.url)}" alt="${esc(photo.caption || 'Photo du séjour')}" loading="lazy">
        <div class="gallery-photo-details">
          <span>${photo.caption ? esc(photo.caption) : '<span class="muted">Sans légende</span>'}<small>${esc(dateFmt.format(new Date(photo.created_at)))}</small></span>
          ${photo.uploaded_by === currentUser.id ? `<button class="delete-button" type="button" data-delete-photo="${esc(photo.id)}" aria-label="Supprimer cette photo">×</button>` : ''}
        </div>
      </article>`;
    return `
    <section class="block gallery-block">
      <div class="heading"><div><span class="eyebrow">Souvenirs partagés</span><h2>Galerie photo</h2></div><span class="count">${galleryPhotos.length + ARCHIVE_GALLERY_PHOTOS.length} PHOTO${galleryPhotos.length + ARCHIVE_GALLERY_PHOTOS.length === 1 ? '' : 'S'}</span></div>
      <p class="lead">Ajoutez vos photos du séjour pour les partager avec les participants connectés. Seul le compte qui a téléversé une photo peut la supprimer.</p>
      ${galleryError ? `<p class="finance-error" role="alert">${esc(galleryError)}</p>` : ''}
      <form id="gallery-upload-form" class="gallery-upload-form">
        <label>Choisir une photo<input name="photo" type="file" accept="image/jpeg,image/png,image/webp,image/gif" required${galleryUploading ? ' disabled' : ''}></label>
        <label>Légende (facultative)<input name="caption" type="text" maxlength="180" placeholder="Un bon souvenir…"${galleryUploading ? ' disabled' : ''}></label>
        <small class="form-hint">JPG, PNG, WebP ou GIF · 10 Mo maximum</small>
        <button class="btn" type="submit"${galleryUploading ? ' disabled' : ''}>${galleryUploading ? 'Téléversement…' : 'Ajouter à la galerie'}</button>
      </form>
      <h3>Archives</h3>
      <div class="gallery-grid">${ARCHIVE_GALLERY_PHOTOS.map((photo, index) => `
        <article class="gallery-photo">
          <img src="${esc(photo)}" alt="Photo d’archive ${index + 1}" loading="lazy">
          <div class="gallery-photo-details"><span>Photo d’archive<small>${esc(photo)}</small></span></div>
        </article>`).join('')}</div>
      <h3>Photos ajoutées par les participants</h3>
      ${galleryLoading ? '<p class="muted">Chargement des photos…</p>' : galleryPhotos.length
        ? `<div class="gallery-grid">${galleryPhotos.map(uploadedPhotoCard).join('')}</div>`
        : '<p class="muted">Aucune photo téléversée pour l’instant. Ajoutez-en une!</p>'}
    </section>`;
  }

  function renderDnd() {
    const d = T.dnd;
    return `
    <section class="block">
      <span class="eyebrow">${esc(d.session)}</span><h2>${esc(d.campagne)}</h2>
      <p><a class="btn" href="${esc(d.lien)}" target="_blank" rel="noopener">Rejoindre la campagne D&amp;D Beyond</a></p>
      <h3>Personnages</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>Personnage</th><th>Classe</th><th>Joueur</th></tr></thead>
        <tbody>${d.persos.map((p) => `<tr><td>${esc(p[0])}</td><td>${esc(p[1])}</td><td>${esc(p[2])}</td></tr>`).join('')}</tbody>
      </table></div>
    </section>
    <div class="grid">
      <section class="block"><span class="eyebrow">Avant la session</span><h2>Préparation</h2><ul class="bullets">${d.prep.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></section>
      <section class="block"><span class="eyebrow">Aide-mémoire</span><h2>Rappels</h2>${d.rappels.map((r) => `<div class="card-row"><b>${esc(r[0])}</b><span>${esc(r[1])}</span></div>`).join('')}</section>
    </div>
    <section class="block">
      <span class="eyebrow">Notre histoire</span><h2>Résumés des sessions</h2>
      ${d.recaps.map((r) => `<div class="card-row"><b>${esc(r[0])}</b><span><strong>${esc(r[1])}</strong><br><span class="muted">${esc(r[2])}</span></span></div>`).join('')}
    </section>`;
  }

  function renderBilan() {
    return `
    <section class="block">
      <span class="eyebrow">Leçons apprises</span><h2>Notes post-WTF 2026</h2>
      <p class="lead">${esc(T.rotation)}</p>
      <div class="grid">${T.bilan2026.map(([titre, items]) => `<div><h3>${esc(titre)}</h3><ul class="bullets">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div>`).join('')}</div>
    </section>`;
  }

  // Navigation
  const view = $('#view');
  const tabbar = $('#tabbar');
  tabbar.innerHTML = tabs.map((t, i) => `<button class="tab" role="tab" data-id="${t.id}" aria-selected="false"><small>${String(i + 1).padStart(2, '0')}</small>${esc(t.label)}</button>`).join('');

  function show(id) {
    if (!authChecked || !currentUser) return;
    const tab = tabs.find((t) => t.id === id) || tabs[0];
    view.innerHTML = tab.render();
    tabbar.querySelectorAll('.tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.id === tab.id)));
    const activeTab = Array.from(tabbar.querySelectorAll('.tab')).find((button) => button.dataset.id === tab.id);
    if (activeTab) {
      const navRect = tabbar.getBoundingClientRect();
      const tabRect = activeTab.getBoundingClientRect();
      if (tabRect.left < navRect.left || tabRect.right > navRect.right) {
        const offset = tabRect.left < navRect.left ? tabRect.left - navRect.left : tabRect.right - navRect.right;
        tabbar.scrollBy({ left: offset, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      }
    }
    if (location.hash !== '#' + tab.id) history.replaceState(null, '', '#' + tab.id);
  }
  tabbar.addEventListener('click', (e) => {
    const b = e.target.closest('.tab');
    if (b) { show(b.dataset.id); window.scrollTo({ top: tabbar.offsetTop - 4 }); }
  });
  window.addEventListener('hashchange', () => show(location.hash.slice(1)));

  view.addEventListener('change', async (e) => {
    const mealDaySelect = e.target.closest('#meal-form select[name="day_number"]');
    if (mealDaySelect) {
      const mealTypeSelect = $('#meal-form select[name="meal_type"]', view);
      const validTypes = repasTypesForDay(Number(mealDaySelect.value));
      const selectedType = validTypes.includes(mealTypeSelect.value) ? mealTypeSelect.value : validTypes[0];
      mealTypeSelect.innerHTML = validTypes.map((type) =>
        `<option${type === selectedType ? ' selected' : ''}>${esc(type)}</option>`).join('');
      return;
    }
    const cb = e.target.closest('input[data-check-item]');
    if (!cb) return;
    const itemId = cb.dataset.checkItem;
    cb.disabled = true;
    if (cb.checked) checkedItemIds.add(itemId); else checkedItemIds.delete(itemId);
    show(location.hash.slice(1));
    try {
      const { error } = await supabase.from('winterfreeze_checklist_checks').upsert({
        item_id: itemId,
        checked: cb.checked,
        updated_by: currentUser.id,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'item_id' });
      if (error) throw new Error(error.message);
    } catch (error) {
      const message = `Impossible d’enregistrer la case cochée : ${error instanceof Error ? error.message : String(error)}`;
      await refreshChecklists();
      checklistError = message;
      show(location.hash.slice(1));
    }
  });
  view.addEventListener('click', async (e) => {
    const deletePhotoButton = e.target.closest('[data-delete-photo]');
    if (deletePhotoButton) {
      deletePhotoButton.disabled = true;
      const photo = galleryPhotos.find((item) => item.id === deletePhotoButton.dataset.deletePhoto);
      if (!photo || photo.uploaded_by !== currentUser?.id) return;
      try {
        const { error } = await supabase.from('winterfreeze_gallery_photos')
          .delete().eq('id', photo.id);
        if (error) throw new Error(error.message);
        galleryPhotos = galleryPhotos.filter((item) => item.id !== photo.id);
        const { error: storageError } = await supabase.storage
          .from('winterfreeze-gallery')
          .remove([photo.photo_path]);
        if (storageError) {
          galleryError = `La photo a été retirée de la galerie, mais son fichier n’a pas pu être supprimé : ${storageError.message}`;
        } else {
          galleryError = '';
        }
        show('galerie');
      } catch (error) {
        const message = `Impossible de supprimer cette photo : ${error instanceof Error ? error.message : String(error)}`;
        await refreshGallery();
        galleryError = message;
        show('galerie');
      }
      return;
    }
    const deleteButton = e.target.closest('[data-delete-expense]');
    if (deleteButton) {
      deleteButton.disabled = true;
      const { error } = await supabase.from('winterfreeze_expenses').delete().eq('id', deleteButton.dataset.deleteExpense);
      if (error) expenseError = `Impossible de supprimer cette dépense : ${error.message}`;
      await refreshExpenses();
      return;
    }
    if (e.target.closest('[data-toggle-list-editor]')) {
      checklistEditMode = !checklistEditMode;
      editingChecklistItem = null;
      show(location.hash.slice(1));
      return;
    }
    const mealEditButton = e.target.closest('[data-edit-meal-day]');
    if (mealEditButton) {
      editingMealSlot = {
        day_number: Number(mealEditButton.dataset.editMealDay),
        meal_type: mealEditButton.dataset.editMealType,
      };
      mealDraft = null;
      mealError = '';
      show('repas');
      return;
    }
    if (e.target.closest('[data-cancel-meal-edit]')) {
      editingMealSlot = null;
      mealDraft = null;
      mealError = '';
      show('repas');
      return;
    }
    const editButton = e.target.closest('[data-edit-list-item]');
    if (editButton) {
      editingChecklistItem = editButton.dataset.editListItem;
      show(location.hash.slice(1));
      return;
    }
    if (e.target.closest('[data-cancel-list-edit]')) {
      editingChecklistItem = null;
      show(location.hash.slice(1));
      return;
    }
    const deleteItemButton = e.target.closest('[data-delete-list-item]');
    if (deleteItemButton) {
      deleteItemButton.disabled = true;
      try {
        const { error } = await supabase.from('winterfreeze_checklist_items')
          .delete().eq('id', deleteItemButton.dataset.deleteListItem);
        if (error) throw new Error(error.message);
        editingChecklistItem = null;
        await refreshChecklists();
      } catch (error) {
        checklistError = `Impossible de supprimer l’article : ${error instanceof Error ? error.message : String(error)}`;
        show(location.hash.slice(1));
      }
      return;
    }
    const chip = e.target.closest('[data-eq]');
    if (chip) { renderEquipement.active = chip.dataset.eq; show('equipement'); return; }
    if (e.target.id === 'reset-epi') {
      const ids = listItemsFor('epicerie').map((item) => item.id);
      try {
        if (ids.length) {
          const updatedAt = new Date().toISOString();
          const { error } = await supabase.from('winterfreeze_checklist_checks').upsert(
            ids.map((itemId) => ({ item_id: itemId, checked: false, updated_by: currentUser.id, updated_at: updatedAt })),
            { onConflict: 'item_id' },
          );
          if (error) throw new Error(error.message);
        }
        checklistError = '';
        await refreshChecklists();
      } catch (error) {
        checklistError = `Impossible de réinitialiser la liste d’épicerie : ${error instanceof Error ? error.message : String(error)}`;
      }
      show('epicerie');
    }
  });
  $('#site-auth').addEventListener('submit', async (e) => {
    if (e.target.id !== 'site-login') return;
    e.preventDefault();
    if (!supabase) return;
    const fields = new FormData(e.target);
    const email = String(fields.get('email') || '').trim();
    const password = String(fields.get('password') || '');
    authBusy = true;
    siteAuthError = '';
    updateSiteAccess();
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) siteAuthError = `Connexion impossible : ${error.message}`;
      else if (!data.session) siteAuthError = 'La connexion n’a pas créé de session active. Réessayez ou communiquez avec la personne qui organise le voyage.';
    } catch (error) {
      siteAuthError = `Connexion impossible : ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      authBusy = false;
    }
    if (siteAuthError) {
      updateSiteAccess();
    }
  });
  $('#site-signout').addEventListener('click', async () => {
    if (!supabase) return;
    try {
      const { error } = await supabase.auth.signOut();
      if (error) siteAuthError = `Impossible de fermer la session : ${error.message}`;
    } catch (error) {
      siteAuthError = `Impossible de fermer la session : ${error instanceof Error ? error.message : String(error)}`;
    }
    if (siteAuthError) {
      updateSiteAccess();
    }
  });
  view.addEventListener('submit', async (e) => {
    if (e.target.id === 'meal-form') {
      e.preventDefault();
      const fields = new FormData(e.target);
      const dayNumber = Number(fields.get('day_number'));
      const mealType = String(fields.get('meal_type') || '');
      const menu = String(fields.get('menu') || '').trim();
      const responsible = String(fields.get('responsible') || '').trim();
      const notes = String(fields.get('notes') || '').trim();
      if (!REPAS_DAYS.some((day) => day.number === dayNumber)
        || !repasTypesForDay(dayNumber).includes(mealType) || !menu || menu.length > 180
        || responsible.length > 100 || notes.length > 1000) {
        mealError = 'Vérifiez le jour, le type de repas et le menu.';
        show('repas');
        return;
      }
      if (!currentUser) {
        mealError = 'Connectez-vous pour modifier le plan des repas.';
        show('repas');
        return;
      }
      mealSaving = true;
      mealError = '';
      mealDraft = { day_number: dayNumber, meal_type: mealType, menu, responsible, notes };
      show('repas');
      try {
        const { error } = await supabase.from('winterfreeze_meals').upsert({
          day_number: dayNumber,
          meal_type: mealType,
          menu,
          responsible,
          notes,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'day_number,meal_type' });
        if (error) throw new Error(error.message);
        editingMealSlot = null;
        mealDraft = null;
        await refreshMeals();
      } catch (error) {
        mealError = `Impossible d’enregistrer le repas : ${error instanceof Error ? error.message : String(error)}`;
      } finally {
        mealSaving = false;
        if (location.hash === '#repas') show('repas');
      }
      return;
    }
    if (e.target.id === 'gallery-upload-form') {
      e.preventDefault();
      const form = e.target;
      const fields = new FormData(form);
      const photo = fields.get('photo');
      const caption = String(fields.get('caption') || '').trim();
      const photoExtensions = {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/webp': 'webp',
        'image/gif': 'gif',
      };
      if (!(photo instanceof File) || !photo.size || !photoExtensions[photo.type] || photo.size > 10 * 1024 * 1024) {
        galleryError = 'Choisissez une image JPG, PNG, WebP ou GIF de 10 Mo maximum.';
        show('galerie');
        return;
      }
      if (!currentUser) {
        galleryError = 'Connectez-vous pour ajouter une photo.';
        show('galerie');
        return;
      }
      galleryUploading = true;
      galleryError = '';
      show('galerie');
      const uploadingUser = currentUser;
      const photoPath = `${uploadingUser.id}/${crypto.randomUUID()}.${photoExtensions[photo.type]}`;
      let uploadedPath = '';
      try {
        const { data: uploadedPhoto, error: uploadError } = await supabase.storage
          .from('winterfreeze-gallery')
          .upload(photoPath, photo, { contentType: photo.type, cacheControl: '3600', upsert: false });
        if (uploadError) throw new Error(uploadError.message);
        uploadedPath = uploadedPhoto.path;
        const { error } = await supabase.from('winterfreeze_gallery_photos').insert({
          photo_path: uploadedPath,
          caption,
          uploaded_by: uploadingUser.id,
        });
        if (error) {
          const { error: cleanupError } = await supabase.storage
            .from('winterfreeze-gallery')
            .remove([uploadedPath]);
          throw new Error(cleanupError
            ? `${error.message}. Le fichier temporaire n’a pas pu être supprimé : ${cleanupError.message}`
            : error.message);
        }
        await refreshGallery();
      } catch (error) {
        galleryError = `Impossible d’ajouter la photo : ${error instanceof Error ? error.message : String(error)}`;
      } finally {
        galleryUploading = false;
        if (location.hash === '#galerie') show('galerie');
      }
      return;
    }
    const checklistForm = e.target.closest('[data-checklist-add], [data-checklist-update]');
    if (checklistForm) {
      e.preventDefault();
      const fields = new FormData(checklistForm);
      const listKey = String(fields.get('list_key') || '');
      const groupName = String(fields.get('group_name') || '');
      const label = String(fields.get('label') || '').trim();
      if (!label || !['depart', 'epicerie', 'equipement', 'box'].includes(listKey)) {
        checklistError = 'Entrez un article valide.';
        show(location.hash.slice(1));
        return;
      }
      const values = {
        list_key: listKey,
        group_name: groupName,
        label,
        quantity: String(fields.get('quantity') || '').trim(),
        detail: String(fields.get('detail') || '').trim(),
        status: String(fields.get('status') || '').trim(),
      };
      try {
        let result;
        if (checklistForm.matches('[data-checklist-update]')) {
          result = await supabase.from('winterfreeze_checklist_items').update({
            ...values,
            updated_at: new Date().toISOString(),
          })
            .eq('id', checklistForm.dataset.checklistUpdate);
        } else {
          const siblings = listItemsFor(listKey, groupName);
          result = await supabase.from('winterfreeze_checklist_items').insert({
            ...values,
            sort_order: siblings.reduce((max, item) => Math.max(max, item.sort_order), -1) + 1,
            created_by: currentUser.id,
          });
        }
        if (result.error) throw new Error(result.error.message);
        checklistError = '';
        editingChecklistItem = null;
        await refreshChecklists();
      } catch (error) {
        checklistError = `Impossible d’enregistrer l’article : ${error instanceof Error ? error.message : String(error)}`;
        show(location.hash.slice(1));
      }
      return;
    }
    if (e.target.id !== 'expense-form') return;
    e.preventDefault();
    const form = e.target;
    const fields = new FormData(form);
    const description = String(fields.get('description') || '').trim();
    const amount = Math.round(Number(fields.get('amount')) * 100) / 100;
    const payer = String(fields.get('payer') || '');
    const splitBetween = fields.getAll('split_between').map(String);
    if (!currentUser || !description || !Number.isFinite(amount) || amount <= 0 || !T.participants.includes(payer)
      || splitBetween.length === 0 || splitBetween.some((person) => !T.participants.includes(person))) {
      expenseError = 'Entrez une description, un montant positif, un participant valide et au moins une personne à inclure dans le partage.';
      show('finances');
      return;
    }
    expenseError = '';
    const { error } = await supabase.from('winterfreeze_expenses').insert({
      description,
      category: String(fields.get('category') || ''),
      amount,
      payer,
      split_between: splitBetween,
      created_by: currentUser.id,
    });
    if (error) {
      expenseError = `Impossible d’ajouter la dépense : ${error.message}`;
      show('finances');
    } else {
      await refreshExpenses();
    }
  });

  // Compte à rebours
  const cd = $('#countdown');
  const start = new Date(T.debut).getTime();
  const end = new Date(T.fin).getTime();
  function tick() {
    const now = Date.now();
    if (now >= end) { cd.innerHTML = '<div class="hero-msg">À l’an prochain!</div>'; return; }
    if (now >= start) { cd.innerHTML = '<div class="hero-msg">C’est parti!</div>'; return; }
    const s = Math.floor((start - now) / 1000);
    const days = Math.floor(s / 86400);
    cd.innerHTML = `<div><b>${days}</b><span>${days === 1 ? 'jour' : 'jours'}</span></div>`;
  }
  tick();
  setInterval(tick, 30000);
  void checkSiteSession();
})();
