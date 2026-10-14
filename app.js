import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

(function () {
  const T = window.TRIP;
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const STORE = 'wtf2027:checks';
  const EXPENSE_CATEGORIES = ['Dépôt', 'Activité', 'Boisson', 'Chalet', 'Collation', 'Divers', 'Gaz', 'Repas'];
  const money = (amount) => Number(amount).toLocaleString('fr-CA', { style: 'currency', currency: 'CAD' });
  const supabaseConfig = window.WTF_SUPABASE || {};
  const supabase = supabaseConfig.url && supabaseConfig.anonKey
    ? createClient(supabaseConfig.url, supabaseConfig.anonKey)
    : null;

  let checks = {};
  try { checks = JSON.parse(localStorage.getItem(STORE) || '{}'); } catch { checks = {}; }
  const saveChecks = () => { try { localStorage.setItem(STORE, JSON.stringify(checks)); } catch { /* stockage indisponible */ } };
  let expenses = [];
  let expenseError = '';
  let currentUser = null;
  let authChecked = false;
  let authBusy = false;
  let expensesLoading = false;
  let financeChannel = null;
  let financeRefreshTimer = null;
  function calculateSettlements() {
    const totalCents = expenses.reduce((sum, expense) => sum + Math.round(expense.amount * 100), 0);
    const baseShare = Math.floor(totalCents / T.participants.length);
    let extraCents = totalCents % T.participants.length;
    const balances = T.participants.map((person) => {
      const paid = expenses.reduce((sum, expense) =>
        sum + (expense.payer === person ? Math.round(expense.amount * 100) : 0), 0);
      const share = baseShare + (extraCents > 0 ? 1 : 0);
      if (extraCents > 0) extraCents -= 1;
      return { person, paid, balance: paid - share };
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
  async function checkFinanceSession() {
    if (!supabase || authChecked) return;
    const { data, error } = await supabase.auth.getSession();
    authChecked = true;
    if (error) {
      expenseError = `Impossible de vérifier la session : ${error.message}`;
    } else {
      currentUser = data.session?.user || null;
      if (currentUser) {
        await refreshExpenses();
        startFinanceSync();
      }
    }
    if (location.hash === '#finances') show('finances');
  }
  async function refreshExpenses() {
    if (!supabase || !currentUser) return;
    expensesLoading = true;
    if (location.hash === '#finances') show('finances');
    const { data, error } = await supabase
      .from('winterfreeze_expenses')
      .select('id, description, category, amount, payer, created_by, created_at')
      .order('created_at', { ascending: false });
    expensesLoading = false;
    if (error) {
      expenseError = `Impossible de charger les dépenses : ${error.message}`;
    } else {
      expenses = data || [];
      expenseError = '';
    }
    if (location.hash === '#finances') show('finances');
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
      currentUser = session?.user || null;
      authChecked = true;
      if (currentUser) {
        void refreshExpenses().then(startFinanceSync);
      } else {
        stopFinanceSync();
        expenses = [];
        expensesLoading = false;
      }
      if (location.hash === '#finances') show('finances');
    });
  }

  const checkItem = (key, html, extra = '') => `
    <label class="check">
      <input type="checkbox" data-key="${esc(key)}"${checks[key] ? ' checked' : ''}>
      ${extra}<span>${html}</span>
    </label>`;

  const progress = (keys) => {
    const done = keys.filter((k) => checks[k]).length;
    return { done, total: keys.length, pct: keys.length ? Math.round((done / keys.length) * 100) : 0 };
  };
  const progressBar = (keys, id) => {
    const p = progress(keys);
    return `<div class="heading"><span class="count" data-count="${id}">${p.done} SUR ${p.total} COMPLÉTÉS</span></div>
      <div class="progress"><i data-bar="${id}" style="width:${p.pct}%"></i></div>`;
  };

  const tabs = [
    { id: 'survol', label: 'Survol', render: renderSurvol },
    { id: 'repas', label: 'Repas', render: renderRepas },
    { id: 'epicerie', label: 'Épicerie', render: renderEpicerie },
    { id: 'equipement', label: 'Équipement', render: renderEquipement },
    { id: 'box', label: 'WTF Box', render: renderBox },
    { id: 'finances', label: 'Finances', render: renderFinances },
    { id: 'dnd', label: 'D&D', render: renderDnd },
    { id: 'bilan', label: 'Notes 2026', render: renderBilan },
  ];

  function renderSurvol() {
    const c = T.chalet;
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
      ${progressBar(T.avantDepart.map((_, i) => `depart:${i}`), 'depart')}
      ${T.avantDepart.map((a, i) => checkItem(`depart:${i}`, esc(a.t) + (a.q ? ` <span class="pill">${esc(a.q)}</span>` : ''))).join('')}
    </section>`;
  }

  function renderRepas() {
    const row = (r) => `<div class="card-row"><b>${esc(r.j)}</b><span><strong>${esc(r.t)}</strong>${r.q ? ` <span class="pill">${esc(r.q)}</span>` : ''}${r.d ? `<br><span class="muted">${esc(r.d)}</span>` : ''}</span></div>`;
    return `
    <section class="block">
      <span class="eyebrow">Autour de la table</span><h2>Plan des repas</h2>
      <h3>Déjeuners</h3>${T.repas.dejeuners.map(row).join('')}
      <h3>Soupers</h3>${T.repas.soupers.map(row).join('')}
      <h3>Collations</h3>${T.repas.collations.map(row).join('')}
      <p class="lead">Le dîner du jeudi se prend au Resto Pub O’Max vers 11 h – 11 h 30. Réserver d’avance au pub.</p>
    </section>
    <section class="block">
      <span class="eyebrow">Aide-mémoire</span><h2>Recettes</h2>
      <div class="grid">${T.recettes.map((r) => `<div><h3>${esc(r.nom)}</h3><ol class="steps">${r.etapes.map((e) => `<li>${esc(e)}</li>`).join('')}</ol></div>`).join('')}</div>
    </section>`;
  }

  function renderEpicerie() {
    const keys = [];
    const sections = T.epicerie.map((s, si) => {
      const html = s.items.map((it, i) => {
        const key = `epi:${si}:${i}`; keys.push(key);
        return checkItem(key, esc(it[1]) + (it[2] ? `<small>${esc(it[2])}</small>` : ''), `<span class="qty">${esc(it[0])}×</span>`);
      }).join('');
      return `<section class="block"><h2>${esc(s.magasin)}</h2>${html}</section>`;
    }).join('');
    return `
    <section class="block">
      <div class="heading"><div><span class="eyebrow">Magasiner</span><h2>Liste d’épicerie</h2></div></div>
      ${progressBar(keys, 'epi')}
      <button class="btn ghost" id="reset-epi" type="button">Tout décocher</button>
    </section>
    <div class="grid">${sections}</div>`;
  }

  function renderEquipement() {
    const names = Object.keys(window.EQUIP);
    const active = renderEquipement.active && names.includes(renderEquipement.active) ? renderEquipement.active : names[0];
    const items = window.EQUIP[active];
    const keys = items.map((_, i) => `eq:${active}:${i}`);
    const label = (n) => (n === 'Tous' ? 'Pour tous' : n);
    return `
    <section class="block">
      <span class="eyebrow">Apportons l’essentiel</span><h2>Équipement</h2>
      <div class="chips" role="group" aria-label="Personne">${names.map((n) => `<button type="button" class="chip" data-eq="${esc(n)}" aria-pressed="${n === active}">${esc(label(n))}</button>`).join('')}</div>
      ${progressBar(keys, 'eq')}
      ${items.map((it, i) => checkItem(keys[i], esc(it))).join('')}
    </section>`;
  }

  function renderBox() {
    const keys = window.WTFBOX.map((_, i) => `box:${i}`);
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
      ${progressBar(keys, 'box')}
      ${window.WTFBOX.map((b, i) => checkItem(keys[i], `${esc(b.item)} <span class="pill ${status(b.apres2026)}">${esc(b.apres2026 || '—')}</span>`)).join('')}
    </section>`;
  }

  function renderFinances() {
    if (!supabase) {
      return `<section class="block"><span class="eyebrow">Configuration requise</span><h2>Finances</h2>
        <p class="lead">Le partage privé des dépenses n’est pas encore configuré. Ajoutez l’URL et la clé publique du projet Supabase dans <code>supabase-config.js</code> et appliquez le schéma décrit dans README.md.</p></section>`;
    }
    if (!authChecked) {
      void checkFinanceSession();
      return '<section class="block"><p class="muted">Vérification de la session sécurisée…</p></section>';
    }
    if (!currentUser) {
      return `<div class="finance-auth-wrap"><section class="finance-form-card">
        <span class="eyebrow">Espace privé des participants</span><h2>Connexion aux finances</h2>
        <p class="lead">Connectez-vous avec le compte que l’organisateur vous a créé pour consulter et gérer les dépenses partagées.</p>
        ${expenseError ? `<p class="finance-error" role="alert">${esc(expenseError)}</p>` : ''}
        <form id="finance-login" class="expense-form">
          <label>Courriel<input name="email" type="email" autocomplete="username" required></label>
          <label>Mot de passe<input name="password" type="password" autocomplete="current-password" required></label>
          <button class="btn submit-expense" type="submit"${authBusy ? ' disabled' : ''}>${authBusy ? 'Connexion…' : 'Se connecter'} <span aria-hidden="true">↗</span></button>
        </form>
        <button class="text-button" type="button" id="reset-password">Mot de passe oublié?</button>
      </section></div>`;
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
            <div class="expense-total"><span>TOTAL DU VOYAGE</span><strong>${fmtCents(totalCents)}</strong><small>${money(share / 100)} par personne jusqu’ici</small></div>
            <div class="participant-balances">${balances.map((person) => `<div><span>${esc(person.person)}</span><small>${fmtCents(person.paid)} payé</small><strong class="${person.balance < 0 ? 'owes' : person.balance > 0 ? 'owed' : ''}">${person.balance > 0 ? '+' : ''}${fmtCents(person.balance)}</strong></div>`).join('')}</div>
          </div>
          <section class="reimbursements">
            <h3>Remboursements suggérés</h3>
            <p class="muted">${transfers.length ? 'Répartition indicative des dépenses, partagées également entre les huit participants.' : 'Les remboursements apparaîtront ici dès qu’une dépense est ajoutée.'}</p>
            ${transfers.length ? transfers.map((transfer) => `<div class="transfer-row"><span>${esc(transfer.from)} rembourse ${esc(transfer.to)}</span><strong>${fmtCents(transfer.cents)}</strong></div>`).join('') : '<div class="transfer-row"><span>Aucun remboursement à effectuer pour le moment.</span></div>'}
          </section>
          <p class="finance-private">Ces dépenses sont partagées en privé entre les huit comptes autorisés. Les dépenses ne sont jamais stockées dans ce navigateur.</p>
          ${expenseError ? `<p class="finance-error" role="alert">${esc(expenseError)}</p>` : ''}
          <div class="expense-list">
            ${expenses.length ? expenses.map((expense) => `<article class="expense-row">
              <span class="expense-icon" aria-hidden="true">↗</span>
              <span class="expense-description">${esc(expense.description)}<small>${esc(expense.category)} · ${esc(expense.payer)} · ${esc(dateFmt.format(new Date(expense.created_at)))}</small></span>
              <strong>${money(expense.amount)}</strong>
              ${expense.created_by === currentUser.id ? `<button class="delete-button" type="button" data-delete-expense="${esc(expense.id)}" aria-label="Supprimer ${esc(expense.description)}">×</button>` : ''}
            </article>`).join('') : '<p class="muted">Aucune dépense pour l’instant. Ajoutez les frais au fur et à mesure.</p>'}
          </div>
          <div class="finance-account"><span>Connecté : ${esc(currentUser.email || 'participant')}</span><button class="text-button" type="button" id="sign-out">Se déconnecter</button></div>
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
            <small class="form-hint">Partagé également entre les huit participants.</small>
            <button class="btn submit-expense" type="submit">Ajouter la dépense <span aria-hidden="true">↗</span></button>
          </form>
        </section>
      </aside>
    </div>`;
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
    const tab = tabs.find((t) => t.id === id) || tabs[0];
    view.innerHTML = tab.render();
    tabbar.querySelectorAll('.tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.id === tab.id)));
    if (location.hash !== '#' + tab.id) history.replaceState(null, '', '#' + tab.id);
  }
  tabbar.addEventListener('click', (e) => {
    const b = e.target.closest('.tab');
    if (b) { show(b.dataset.id); window.scrollTo({ top: tabbar.offsetTop - 4 }); }
  });
  window.addEventListener('hashchange', () => show(location.hash.slice(1)));

  view.addEventListener('change', (e) => {
    const cb = e.target.closest('input[data-key]');
    if (!cb) return;
    if (cb.checked) checks[cb.dataset.key] = true; else delete checks[cb.dataset.key];
    saveChecks();
    const id = cb.dataset.key.split(':')[0];
    const keys = [...view.querySelectorAll('input[data-key]')].map((i) => i.dataset.key).filter((k) => k.split(':')[0] === id);
    const p = progress(keys);
    view.querySelectorAll(`[data-bar="${id}"]`).forEach((el) => { el.style.width = p.pct + '%'; });
    view.querySelectorAll(`[data-count="${id}"]`).forEach((el) => { el.textContent = `${p.done} SUR ${p.total} COMPLÉTÉS`; });
  });
  view.addEventListener('click', async (e) => {
    const deleteButton = e.target.closest('[data-delete-expense]');
    if (deleteButton) {
      deleteButton.disabled = true;
      const { error } = await supabase.from('winterfreeze_expenses').delete().eq('id', deleteButton.dataset.deleteExpense);
      if (error) expenseError = `Impossible de supprimer cette dépense : ${error.message}`;
      await refreshExpenses();
      return;
    }
    if (e.target.id === 'sign-out') {
      const { error } = await supabase.auth.signOut();
      if (error) {
        expenseError = `Impossible de fermer la session : ${error.message}`;
        show('finances');
      }
      return;
    }
    const chip = e.target.closest('[data-eq]');
    if (chip) { renderEquipement.active = chip.dataset.eq; show('equipement'); return; }
    if (e.target.id === 'reset-epi') {
      Object.keys(checks).filter((k) => k.startsWith('epi:')).forEach((k) => delete checks[k]);
      saveChecks();
      show('epicerie');
    }
  });
  view.addEventListener('submit', async (e) => {
    if (e.target.id === 'finance-login') {
      e.preventDefault();
      if (!supabase) return;
      const fields = new FormData(e.target);
      const email = String(fields.get('email') || '').trim();
      const password = String(fields.get('password') || '');
      authBusy = true;
      expenseError = '';
      show('finances');
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      authBusy = false;
      if (error) {
        expenseError = `Connexion impossible : ${error.message}`;
        show('finances');
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
    if (!currentUser || !description || !Number.isFinite(amount) || amount <= 0 || !T.participants.includes(payer)) {
      expenseError = 'Entrez une description, un montant positif et un participant valide.';
      show('finances');
      return;
    }
    expenseError = '';
    const { error } = await supabase.from('winterfreeze_expenses').insert({
      description,
      category: String(fields.get('category') || ''),
      amount,
      payer,
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
    const parts = [[Math.floor(s / 86400), 'jours'], [Math.floor((s % 86400) / 3600), 'heures']];
    cd.innerHTML = parts.map(([n, l]) => `<div><b>${n}</b><span>${l}</span></div>`).join('');
  }
  tick();
  setInterval(tick, 30000);

  show(location.hash.slice(1));
})();
