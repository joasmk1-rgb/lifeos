// ===================== APP.JS =====================
// Cœur du Life OS : auth Firebase, Firestore (temps réel), navigation,
// et rendu de chaque module. Un seul fichier pour rester simple à suivre.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut, sendPasswordResetEmail,
  updatePassword, reauthenticateWithCredential, EmailAuthProvider,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, collection, doc, onSnapshot, addDoc, updateDoc, deleteDoc,
  setDoc, getDoc, writeBatch,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import * as Grid from "./grid.js";
import { renderMonthsView } from "./calendar-month.js";
import { icsToLifeOSEvents } from "./ics.js";

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const dbFS = getFirestore(fbApp);

let uid = null;
const col = (name) => collection(dbFS, "users", uid, name);
const bpCol = (name) => collection(dbFS, "bookingPublic", uid, name);
const loisirsCol = () => collection(dbFS, "loisirs", uid, "events");

/* ---------- ETAT LOCAL (miroir de Firestore, tenu à jour par onSnapshot) ---------- */
const state = {
  habits: [], habitLog: {}, jobs: [], skills: [], projects: [], events: [], notes: [],
  bookingRules: [], blockedSlots: [], bookingRequests: [],
  loisirsEvents: [], actus: [], counterLog: {}, devPerso: [], mesures: [], repas: [],
  foodGoals: [], courses: [], depenses: [], budgetSettings: {},
  nutritionGoals: {}, nutritionLog: [], budgetCharges: {},
};
let unsubscribers = [];

function uid8() { return Math.random().toString(36).slice(2, 10); }
function todayStr() { return Grid.toISODate(new Date()); }
function fmtDate(d) {
  if (!d) return "";
  return new Date(d + "T00:00:00").toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/* ---------- AUTH ---------- */
const authScreen = document.getElementById("auth-screen");
const appRoot = document.getElementById("app-root");
const authForm = document.getElementById("auth-form");
const authError = document.getElementById("auth-error");
const tabLogin = document.getElementById("tab-login");
const tabSignup = document.getElementById("tab-signup");
let authMode = "login";

tabLogin.addEventListener("click", () => { authMode = "login"; tabLogin.classList.add("active"); tabSignup.classList.remove("active"); });
tabSignup.addEventListener("click", () => { authMode = "signup"; tabSignup.classList.add("active"); tabLogin.classList.remove("active"); });

authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  authError.classList.add("hidden");
  const email = document.getElementById("auth-email").value.trim();
  const password = document.getElementById("auth-password").value;
  try {
    if (authMode === "signup") {
      await createUserWithEmailAndPassword(auth, email, password);
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
  } catch (err) {
    authError.textContent = translateAuthError(err.code);
    authError.classList.remove("hidden");
  }
});

function translateAuthError(code) {
  const map = {
    "auth/email-already-in-use": "Ce compte existe déjà — utilise Connexion.",
    "auth/invalid-credential": "Email ou mot de passe incorrect.",
    "auth/weak-password": "Mot de passe trop court (6 caractères min).",
    "auth/invalid-email": "Email invalide.",
    "auth/missing-email": "Entre ton email d'abord.",
  };
  return map[code] || "Erreur : " + code;
}

const forgotBtn = document.getElementById("forgot-password-btn");
if (forgotBtn) forgotBtn.addEventListener("click", async () => {
  authError.classList.add("hidden");
  const email = document.getElementById("auth-email").value.trim();
  if (!email) { authError.textContent = "Entre ton email dans le champ ci-dessus d'abord."; authError.classList.remove("hidden"); return; }
  try {
    await sendPasswordResetEmail(auth, email);
    authError.style.color = "var(--accent2)";
    authError.textContent = "Email de réinitialisation envoyé — vérifie ta boîte mail.";
    authError.classList.remove("hidden");
  } catch (err) {
    authError.style.color = "";
    authError.textContent = translateAuthError(err.code);
    authError.classList.remove("hidden");
  }
});

onAuthStateChanged(auth, (user) => {
  unsubscribers.forEach((u) => u());
  unsubscribers = [];
  if (user) {
    uid = user.uid;
    authScreen.classList.add("hidden");
    appRoot.classList.remove("hidden");
    attachListeners();
    navigate("dashboard");
  } else {
    uid = null;
    appRoot.classList.add("hidden");
    authScreen.classList.remove("hidden");
  }
});

function attachListeners() {
  const bind = (name, targetArrayKey, sortFn) => {
    const unsub = onSnapshot(col(name), (snap) => {
      const arr = [];
      snap.forEach((d) => arr.push({ id: d.id, ...d.data() }));
      if (sortFn) arr.sort(sortFn);
      state[targetArrayKey] = arr;
      rerenderIfCurrent();
    });
    unsubscribers.push(unsub);
  };
  bind("habits", "habits");
  bind("jobs", "jobs");
  bind("skills", "skills");
  bind("projects", "projects");
  bind("events", "events");
  bind("notes", "notes", (a, b) => (b.created || "").localeCompare(a.created || ""));
  bind("actus", "actus");
  bind("devPerso", "devPerso", (a, b) => (b.created || "").localeCompare(a.created || ""));
  bind("mesures", "mesures", (a, b) => (b.date || "").localeCompare(a.date || ""));
  bind("repas", "repas");
  bind("foodGoals", "foodGoals");
  bind("courses", "courses", (a, b) => (a.addedAt || "").localeCompare(b.addedAt || ""));
  bind("depenses", "depenses", (a, b) => (b.date || "").localeCompare(a.date || ""));

  const unsubBudget = onSnapshot(doc(dbFS, "users", uid, "settings", "budget"), (d) => {
    state.budgetSettings = d.exists() ? d.data() : {};
    rerenderIfCurrent();
  });
  unsubscribers.push(unsubBudget);

  const unsubNutriGoals = onSnapshot(doc(dbFS, "users", uid, "settings", "nutrition"), (d) => {
    state.nutritionGoals = d.exists() ? d.data() : {};
    rerenderIfCurrent();
  });
  unsubscribers.push(unsubNutriGoals);
  bind("nutritionLog", "nutritionLog");

  const unsubBudgetCharges = onSnapshot(doc(dbFS, "users", uid, "settings", "budgetCharges"), (d) => {
    state.budgetCharges = d.exists() ? d.data() : {};
    rerenderIfCurrent();
  });
  unsubscribers.push(unsubBudgetCharges);

  const unsubLoisirs = onSnapshot(loisirsCol(), (snap) => {
    const arr = [];
    snap.forEach((d) => arr.push({ id: d.id, ...d.data() }));
    arr.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    state.loisirsEvents = arr;
    rerenderIfCurrent();
  });
  unsubscribers.push(unsubLoisirs);

  const bindBP = (name, targetArrayKey) => {
    const unsub = onSnapshot(bpCol(name), (snap) => {
      const arr = [];
      snap.forEach((d) => arr.push({ id: d.id, ...d.data() }));
      state[targetArrayKey] = arr;
      rerenderIfCurrent();
    });
    unsubscribers.push(unsub);
  };
  bindBP("availabilityRules", "bookingRules");
  bindBP("blockedSlots", "blockedSlots");
  bindBP("requests", "bookingRequests");

  const unsubLog = onSnapshot(col("habitLog"), (snap) => {
    const log = {};
    snap.forEach((d) => { log[d.id] = d.data(); });
    state.habitLog = log;
    rerenderIfCurrent();
  });
  unsubscribers.push(unsubLog);

  const unsubCounter = onSnapshot(col("counterLog"), (snap) => {
    const log = {};
    snap.forEach((d) => { log[d.id] = d.data(); });
    state.counterLog = log;
    rerenderIfCurrent();
  });
  unsubscribers.push(unsubCounter);
}

function rerenderIfCurrent() {
  if (currentPage) navigate(currentPage, true);
}

/* ---------- ROUTER ---------- */
const pages = {};
let currentPage = null;
document.querySelectorAll('nav button[data-page]').forEach((btn) => {
  btn.addEventListener("click", () => navigate(btn.dataset.page));
});
function navigate(page, silent) {
  currentPage = page;
  if (!silent) {
    document.querySelectorAll('nav button[data-page]').forEach((b) => b.classList.toggle("active", b.dataset.page === page));
  }
  document.getElementById("main").innerHTML = pages[page]();
  attachHandlers(page);
}

/* ---------- PRIORITÉS (matrice urgence / impact) ---------- */
function buildPriorityItems() {
  const items = [];
  const today = new Date(); today.setHours(0,0,0,0);
  const daysFrom = (d) => Math.round((d - today) / 86400000);

  // Routines périodiques en retard/dues
  state.habits.filter((h) => (h.type || "daily") === "periodic").forEach((h) => {
    const status = periodicStatus(h);
    if (status.days === null || status.days <= 3) {
      items.push({
        title: `${h.icon} ${h.name}`, source: "Routine", urgency: status.late ? 90 : 60, impact: 55,
        detail: status.label,
      });
    }
  });

  // Candidatures à relancer / entretiens
  state.jobs.forEach((j) => {
    if (j.status === "relance") items.push({ title: `Relancer ${j.entreprise}`, source: "Emploi", urgency: 75, impact: 80, detail: j.poste });
    if (j.status === "entretien") items.push({ title: `Entretien — ${j.entreprise}`, source: "Emploi", urgency: 85, impact: 90, detail: j.poste });
  });

  // Budget dépassé
  const budget = state.budgetSettings.monthlyLimit || 0;
  if (budget) {
    const monthKey = currentMonthKey();
    const sumItems = state.courses.filter((c) => c.bought && c.price != null).reduce((s,c)=>s+c.price,0);
    const sumDep = state.depenses.filter((d)=>(d.date||"").startsWith(monthKey)).reduce((s,d)=>s+d.amount,0);
    const remaining = budget - (sumItems + sumDep);
    if (remaining < 0) items.push({ title: "Budget courses dépassé", source: "Budget", urgency: 80, impact: 70, detail: `${remaining.toFixed(2)}€` });
  }

  // Demandes de réservation en attente
  state.bookingRequests.filter((r) => r.status === "pending").forEach((r) => {
    items.push({ title: `Réponse à ${r.name}`, source: "Réservation", urgency: 70, impact: 50, detail: fmtDate(r.date) });
  });

  // Événements calendrier proches
  state.events.forEach((e) => {
    const d = daysFrom(new Date(e.date + "T00:00:00"));
    if (d >= 0 && d <= 3) {
      items.push({ title: e.title, source: "Calendrier", urgency: d === 0 ? 95 : 80 - d * 15, impact: 65, detail: fmtDate(e.date) });
    }
  });

  // Actus proches (anniversaires etc.)
  actusUpcoming().forEach((a) => {
    const d = daysFrom(a._next);
    if (d <= 3) items.push({ title: `${a.person} — ${a.title}`, source: "Actus", urgency: 60 - d * 10, impact: 35, detail: `dans ${d}j` });
  });

  return items;
}

pages.priorites = () => {
  const items = buildPriorityItems();
  const q = { ui: [], i: [], u: [], n: [] };
  items.forEach((it) => {
    const urgent = it.urgency >= 55, important = it.impact >= 55;
    if (urgent && important) q.ui.push(it);
    else if (important) q.i.push(it);
    else if (urgent) q.u.push(it);
    else q.n.push(it);
  });
  const sortDesc = (arr) => arr.sort((a,b) => (b.urgency+b.impact) - (a.urgency+a.impact));
  [q.ui, q.i, q.u, q.n].forEach(sortDesc);

  const renderCards = (arr) => arr.length ? arr.map((it) => `
    <div class="priority-card">
      <div class="p-source">${it.source}</div>
      <div>${it.title}</div>
      ${it.detail ? `<div class="muted" style="font-size:11px">${it.detail}</div>` : ""}
    </div>`).join("") : '<p class="empty" style="padding:0">Rien ici.</p>';

  return `
  <h2>🎯 Priorités</h2>
  <p class="muted">Vue automatique sur tous les modules — classée par urgence (délai) et impact (importance).</p>
  <div class="priority-matrix">
    <div class="priority-quadrant q-urgent-important"><h4>🔥 Urgent & important — à faire maintenant</h4>${renderCards(q.ui)}</div>
    <div class="priority-quadrant q-important"><h4>⭐ Important, pas urgent — à planifier</h4>${renderCards(q.i)}</div>
    <div class="priority-quadrant q-urgent"><h4>⏱️ Urgent, moins important — vite fait</h4>${renderCards(q.u)}</div>
    <div class="priority-quadrant q-neither"><h4>💤 Ni urgent ni important</h4>${renderCards(q.n)}</div>
  </div>`;
};

/* ---------- DASHBOARD ---------- */
pages.dashboard = () => {
  const t = todayStr();
  const doneToday = state.habitLog[t] || {};
  const doneCount = state.habits.filter((h) => doneToday[h.id]).length;
  const upcoming = state.events.filter((e) => e.date >= t).sort((a, b) => (a.date + (a.time||"")).localeCompare(b.date + (b.time||""))).slice(0, 5);
  const activeJobs = state.jobs.filter((j) => !["refuse", "accepte"].includes(j.status)).length;

  return `
  <h2>Bonjour Joas 👋 <span class="today-badge">${fmtDate(t)}</span></h2>
  <div class="grid-cards">
    <div class="card"><div class="stat">${doneCount}/${state.habits.length}</div><div class="stat-label">habitudes aujourd'hui</div></div>
    <div class="card"><div class="stat">${activeJobs}</div><div class="stat-label">candidatures en cours</div></div>
    <div class="card"><div class="stat">${state.projects.length}</div><div class="stat-label">projets entrepreneuriaux</div></div>
    <div class="card"><div class="stat">${upcoming.length}</div><div class="stat-label">événements à venir</div></div>
  </div>
  <div class="section-title">Routine du jour</div>
  <div class="card">
    ${state.habits.filter(h=>(h.type||"daily")==="daily").map((h) => `
      <div class="row"><input type="checkbox" class="check" data-habit="${h.id}" ${doneToday[h.id] ? "checked" : ""}><span>${h.icon} ${h.name}</span></div>
    `).join("") || '<div class="empty">Aucune routine quotidienne — va dans Routine & Habitudes.</div>'}
  </div>
  <div class="section-title">Prochains événements</div>
  <div class="card">
    ${upcoming.length ? upcoming.map((e) => `
      <div class="row"><span class="pill">${fmtDate(e.date)} ${e.time || ""}</span><span>${e.title}</span>${e.category ? `<span class="pill">${e.category}</span>` : ""}</div>
    `).join("") : '<div class="empty">Rien de prévu.</div>'}
  </div>
  <div class="section-title">🔔 Actualités à venir</div>
  <div class="card">
    ${actusUpcomingDash().length ? actusUpcomingDash().map((a) => `
      <div class="row"><span class="pill">dans ${daysUntil(a._next)}j</span><span><strong>${a.person}</strong> — ${a.title}</span></div>
    `).join("") : '<div class="empty">Aucune actu — ajoute-en dans la page Actus.</div>'}
  </div>`;
};
function actusUpcomingDash() { return actusUpcoming(4); }

/* ---------- HABITUDES / ROUTINES (quotidien / périodique / compteur mensuel) ---------- */
function computeStreak(habitId) {
  let streak = 0, d = new Date();
  while (true) {
    const key = Grid.toISODate(d);
    if (state.habitLog[key] && state.habitLog[key][habitId]) { streak++; d.setDate(d.getDate() - 1); }
    else break;
  }
  return streak;
}
function currentMonthKey() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`; }
function counterValue(habitId) { return (state.counterLog[currentMonthKey()] || {})[habitId] || 0; }
function periodicStatus(h) {
  if (!h.lastDone) return { label: "jamais fait", late: true, days: null };
  const last = new Date(h.lastDone + "T00:00:00");
  const due = new Date(last); due.setDate(due.getDate() + (h.intervalDays || 30));
  const today = new Date(); today.setHours(0,0,0,0);
  const diff = Math.round((due - today) / 86400000);
  if (diff < 0) return { label: `en retard de ${-diff}j`, late: true, days: diff };
  if (diff === 0) return { label: "à faire aujourd'hui", late: true, days: diff };
  return { label: `dans ${diff}j`, late: false, days: diff };
}

function renderHabitRow(h) {
  const type = h.type || "daily";
  if (type === "daily") {
    const t = todayStr();
    const doneToday = state.habitLog[t] || {};
    return `
      <div class="row">
        <input type="checkbox" class="check" data-habit="${h.id}" ${doneToday[h.id] ? "checked" : ""}>
        <span style="flex:1">${h.icon} ${h.name}${h.alarmTime ? ` <span class="pill">⏰ ${h.alarmTime}</span>` : ""}</span>
        <span class="streak">🔥 ${computeStreak(h.id)}j</span>
        <button class="close-x" data-del-habit="${h.id}">✕</button>
      </div>`;
  }
  if (type === "counter") {
    const val = counterValue(h.id);
    const target = h.target || 1;
    return `
      <div class="row">
        <span style="flex:1">${h.icon} ${h.name}</span>
        <span class="pill">${val}/${target} ce mois</span>
        <button class="btn btn-sm" data-counter-inc="${h.id}">+1</button>
        <button class="close-x" data-del-habit="${h.id}">✕</button>
      </div>`;
  }
  // periodic
  const status = periodicStatus(h);
  return `
    <div class="row">
      <span style="flex:1">${h.icon} ${h.name}</span>
      <span class="pill" style="${status.late ? 'color:var(--danger)' : ''}">${status.label}</span>
      <button class="btn btn-sm" data-periodic-done="${h.id}">Fait aujourd'hui</button>
      <button class="close-x" data-del-habit="${h.id}">✕</button>
    </div>`;
}

pages.habitudes = () => {
  const t = todayStr();
  return `
  <h2>✅ Routine & Habitudes</h2>
  <div class="card">
    <div class="flex-between" style="margin-bottom:10px"><strong>${fmtDate(t)}</strong></div>
    ${state.habits.map(renderHabitRow).join("") || '<div class="empty">Aucune routine — ajoute la première ci-dessous.</div>'}
  </div>
  <div class="card">
    <div class="form-inline">
      <input type="text" id="new-habit-icon" placeholder="emoji" style="max-width:80px">
      <input type="text" id="new-habit-name" placeholder="nom (ex: coiffeur, boire assez, prospections)">
      <select id="new-habit-type">
        <option value="daily">Quotidien (case à cocher chaque jour)</option>
        <option value="periodic">Périodique (tous les X jours)</option>
        <option value="counter">Compteur mensuel (objectif par mois)</option>
      </select>
      <input type="number" id="new-habit-param" placeholder="intervalle (j) ou objectif" style="max-width:160px" class="hidden">
      <input type="time" id="new-habit-alarm" title="Alarme (optionnel, seulement pour Quotidien, tant que le Life OS est ouvert dans un onglet)">
      <button class="btn" id="add-habit">Ajouter</button>
    </div>
    <p class="muted" style="margin-top:8px">⏰ L'alarme sonne uniquement si le Life OS est ouvert dans un onglet — pas une vraie alarme téléphone.</p>
  </div>`;
};

/* ---------- EMPLOI ---------- */
const JOB_STATUSES = [
  { v: "a-envoyer", l: "À envoyer" }, { v: "envoye", l: "Envoyé" }, { v: "relance", l: "Relancé" },
  { v: "entretien", l: "Entretien" }, { v: "refuse", l: "Refusé" }, { v: "accepte", l: "Accepté" },
];
function jobWeeksBarChart(jobs, weeksBack) {
  const today = new Date();
  const weekCounts = [];
  for (let i = weeksBack - 1; i >= 0; i--) {
    const weekStart = new Date(today); weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1 - i * 7);
    weekStart.setHours(0,0,0,0);
    const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate() + 7);
    const startISO = Grid.toISODate(weekStart), endISO = Grid.toISODate(weekEnd);
    const count = jobs.filter((j) => j.date >= startISO && j.date < endISO).length;
    weekCounts.push({ label: `${weekStart.getDate()}/${weekStart.getMonth()+1}`, count });
  }
  const max = Math.max(1, ...weekCounts.map((w) => w.count));
  return `
    <div style="display:flex;align-items:flex-end;gap:6px;height:90px;margin-top:8px">
      ${weekCounts.map((w) => `
        <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;justify-content:flex-end;height:100%">
          <span style="font-size:11px;color:var(--muted)">${w.count || ""}</span>
          <div style="width:100%;background:var(--accent);border-radius:4px 4px 0 0;height:${(w.count / max) * 60}px;min-height:${w.count?4:0}px"></div>
          <span style="font-size:10px;color:var(--muted)">${w.label}</span>
        </div>`).join("")}
    </div>`;
}

function jobPilotagePanel() {
  const jobs = state.jobs;
  const today = todayStr();
  const weekAgo = Grid.toISODate(Grid.addDays(new Date(), -7));
  const monthAgo = Grid.toISODate(Grid.addDays(new Date(), -30));
  const sentThisWeek = jobs.filter((j) => j.date >= weekAgo).length;
  const sentThisMonth = jobs.filter((j) => j.date >= monthAgo).length;
  const total = jobs.length;
  const entretiens = jobs.filter((j) => ["entretien","accepte"].includes(j.status)).length;
  const acceptes = jobs.filter((j) => j.status === "accepte").length;
  const tauxEntretien = total ? Math.round((entretiens / total) * 100) : 0;
  const tauxAcceptation = entretiens ? Math.round((acceptes / entretiens) * 100) : 0;
  const scored = jobs.filter((j) => j.quality);
  const avgQuality = scored.length ? (scored.reduce((s,j)=>s+j.quality,0) / scored.length).toFixed(1) : "—";

  return `
  <div class="grid-cards" style="margin-bottom:16px">
    <div class="card"><div class="stat">${sentThisWeek}</div><div class="stat-label">candidatures cette semaine</div></div>
    <div class="card"><div class="stat">${sentThisMonth}</div><div class="stat-label">ce mois-ci</div></div>
    <div class="card"><div class="stat">${tauxEntretien}%</div><div class="stat-label">taux de conversion en entretien (${entretiens}/${total})</div></div>
    <div class="card"><div class="stat">${tauxAcceptation}%</div><div class="stat-label">entretien → accepté (${acceptes}/${entretiens})</div></div>
    <div class="card"><div class="stat">${avgQuality}${scored.length ? "/5" : ""}</div><div class="stat-label">qualité moyenne des candidatures</div></div>
  </div>
  <div class="card">
    <div class="section-title" style="margin-top:0">Candidatures par semaine (8 dernières semaines)</div>
    ${jobWeeksBarChart(jobs, 8)}
  </div>`;
}

let jobTypeFilter = "";
pages.emploi = () => {
  const allTypes = [...new Set(state.jobs.map((j) => j.jobType).filter(Boolean))];
  const rows = state.jobs
    .filter((j) => !jobTypeFilter || j.jobType === jobTypeFilter)
    .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  return `
  <h2>💼 Recherche d'emploi</h2>
  ${jobPilotagePanel()}
  <div class="card">
    <div class="form-inline">
      <input type="text" id="job-entreprise" placeholder="Entreprise">
      <input type="text" id="job-poste" placeholder="Poste">
      <input type="text" id="job-type" placeholder="Type de poste (ex: Supply Chain, Consulting)" list="job-type-suggestions">
      <datalist id="job-type-suggestions">${allTypes.map((t) => `<option value="${t}">`).join("")}</datalist>
      <input type="date" id="job-date" value="${todayStr()}">
      <select id="job-status">${JOB_STATUSES.map((s) => `<option value="${s.v}">${s.l}</option>`).join("")}</select>
      <select id="job-quality">
        <option value="">Qualité ?</option>
        <option value="1">⭐ 1</option><option value="2">⭐ 2</option><option value="3">⭐ 3</option><option value="4">⭐ 4</option><option value="5">⭐ 5</option>
      </select>
      <button class="btn" id="add-job">Ajouter</button>
    </div>
  </div>
  ${allTypes.length ? `
  <div class="form-inline" style="max-width:320px">
    <select id="job-type-filter">
      <option value="">Tous les types</option>
      ${allTypes.map((t) => `<option value="${t}" ${t === jobTypeFilter ? "selected" : ""}>${t}</option>`).join("")}
    </select>
  </div>` : ""}
  <div class="card"><table><thead><tr><th>Entreprise</th><th>Poste</th><th>Type</th><th>Date</th><th>Statut</th><th>Qualité</th><th>Notes</th><th></th></tr></thead><tbody>
    ${rows.map((j) => `
      <tr>
        <td>${j.entreprise}</td><td>${j.poste}</td><td>${j.jobType ? `<span class="pill">${j.jobType}</span>` : ""}</td><td>${fmtDate(j.date)}</td>
        <td><select data-job-status="${j.id}">${JOB_STATUSES.map((s) => `<option value="${s.v}" ${s.v === j.status ? "selected" : ""}>${s.l}</option>`).join("")}</select></td>
        <td><select data-job-quality="${j.id}">
          <option value="">—</option>
          ${[1,2,3,4,5].map((n)=>`<option value="${n}" ${j.quality===n?"selected":""}>⭐ ${n}</option>`).join("")}
        </select></td>
        <td><input type="text" data-job-notes="${j.id}" value="${(j.notes || "").replace(/"/g, "&quot;")}"></td>
        <td><button class="close-x" data-del-job="${j.id}">✕</button></td>
      </tr>`).join("") || `<tr><td colspan="8" class="empty">Aucune candidature.</td></tr>`}
  </tbody></table></div>`;
};

/* ---------- SKILLS ---------- */
pages.skills = () => {
  const rows = [...state.skills].sort((a, b) => (b.progress || 0) - (a.progress || 0));
  return `
  <h2>📈 Montée en compétences</h2>
  <div class="card">
    <div class="form-inline">
      <input type="text" id="skill-name" placeholder="Ex: Excel avancé">
      <input type="text" id="skill-resource" placeholder="Ressource / lien">
      <button class="btn" id="add-skill">Ajouter</button>
    </div>
  </div>
  <div class="card">
    ${rows.map((s) => `
      <div class="row" style="align-items:flex-start">
        <div style="flex:1">
          <div class="flex-between"><strong>${s.name}</strong><button class="close-x" data-del-skill="${s.id}">✕</button></div>
          ${s.resource ? `<div class="muted">${s.resource}</div>` : ""}
          <div style="margin-top:6px;display:flex;align-items:center;gap:8px">
            <input type="range" min="0" max="100" value="${s.progress || 0}" data-skill-progress="${s.id}" style="flex:1">
            <span class="pill">${s.progress || 0}%</span>
          </div>
        </div>
      </div>`).join("") || '<div class="empty">Aucune compétence.</div>'}
  </div>`;
};

/* ---------- PROJETS ---------- */
pages.projets = () => `
  <h2>🚀 Projets entrepreneuriaux</h2>
  <div class="card">
    <div class="form-inline">
      <input type="text" id="proj-name" placeholder="Nom du projet">
      <select id="proj-status">
        <option value="idee">Idée</option><option value="exploration">En exploration</option>
        <option value="lance">Lancé</option><option value="pause">En pause</option><option value="abandonne">Abandonné</option>
      </select>
      <button class="btn" id="add-proj">Ajouter</button>
    </div>
  </div>
  <div class="card">
    ${state.projects.map((p) => `
      <div class="row" style="align-items:flex-start;flex-direction:column;gap:8px">
        <div class="flex-between" style="width:100%">
          <strong>${p.name}</strong>
          <div style="display:flex;gap:6px;align-items:center">
            <select data-proj-status="${p.id}">
              ${["idee","exploration","lance","pause","abandonne"].map(v=>`<option value="${v}" ${p.status===v?"selected":""}>${v}</option>`).join("")}
            </select>
            <button class="close-x" data-del-proj="${p.id}">✕</button>
          </div>
        </div>
        <textarea data-proj-notes="${p.id}" placeholder="évolution, notes...">${p.notes || ""}</textarea>
      </div>`).join("") || '<div class="empty">Aucun projet.</div>'}
  </div>`;

/* ---------- NOTES ---------- */
pages.notes = () => `
  <h2>📝 Notes rapides</h2>
  <div class="card">
    <div class="form-inline" style="align-items:flex-start">
      <textarea id="note-content" placeholder="Écris une idée..." style="flex:2"></textarea>
      <button class="btn" id="add-note" style="flex:0 0 auto">Ajouter</button>
    </div>
  </div>
  <div class="card">
    ${state.notes.map((n) => `
      <div class="row" style="align-items:flex-start">
        <div style="flex:1"><div class="muted">${n.created ? new Date(n.created).toLocaleString("fr-FR") : ""}</div><div>${(n.content||"").replace(/</g,"&lt;")}</div></div>
        <button class="close-x" data-del-note="${n.id}">✕</button>
      </div>`).join("") || '<div class="empty">Aucune note.</div>'}
  </div>`;

/* ---------- REGLAGES ---------- */
pages.reglages = () => `
  <h2>⚙️ Réglages</h2>
  <div class="card">
    <p class="muted">Connecté en tant que <strong>${auth.currentUser ? auth.currentUser.email : ""}</strong>. Tes données sont stockées sur Firestore (cloud), accessibles depuis n'importe quel appareil connecté à ce compte.</p>
    <button class="btn danger" id="logout-btn">Se déconnecter</button>
  </div>
  <div class="card">
    <div class="section-title" style="margin-top:0">Changer mon mot de passe</div>
    <div class="form-inline" style="flex-direction:column">
      <input type="password" id="current-password" placeholder="Mot de passe actuel">
      <input type="password" id="new-password" placeholder="Nouveau mot de passe (6 caractères min)">
      <button class="btn" id="change-password-btn">Valider</button>
    </div>
    <p id="change-password-status" class="hint"></p>
  </div>`;

/* ---------- ALARMES (tant que l'onglet est ouvert) ---------- */
if ("Notification" in window) Notification.requestPermission();
const alarmedToday = new Set();
setInterval(() => {
  if (!uid) return;
  const now = new Date();
  const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const t = todayStr();
  state.habits.forEach((h) => {
    if ((h.type || "daily") !== "daily" || !h.alarmTime) return;
    const key = h.id + "_" + t;
    if (h.alarmTime === hhmm && !alarmedToday.has(key)) {
      alarmedToday.add(key);
      try {
        const audio = new Audio("data:audio/wav;base64,UklGRl9vT19XQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoAAAAAAAAAAAAAAA==");
        audio.play().catch(() => {});
      } catch (e) {}
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification("⏰ Life OS", { body: `${h.icon} ${h.name}` });
      }
    }
  });
}, 20000);

/* ---------- REPAS (avec tags + objectifs alimentaires hebdo) ---------- */
const MEAL_SLOTS = { petitdej: "🥐 Petit-déj", dejeuner: "🍽️ Déjeuner", diner: "🍲 Dîner", collation: "🍎 Collation" };
const FOOD_TAGS = { viande: "🥩 Viande", poisson: "🐟 Poisson", legume: "🥦 Légume", feculent: "🍞 Féculent", laitier: "🧀 Laitier", autre: "🍳 Autre" };
let repasDate = todayStr();

function mealSlotData(dayDoc, slotKey) {
  const v = dayDoc ? dayDoc[slotKey] : null;
  if (!v) return { text: "", tags: [] };
  if (typeof v === "string") return { text: v, tags: [] }; // ancien format
  return { text: v.text || "", tags: v.tags || [] };
}

function weekRange(dateISO) {
  const d = new Date(dateISO + "T00:00:00");
  const monday = new Date(d); monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const sunday = new Date(monday); sunday.setDate(monday.getDate() + 6);
  return { start: Grid.toISODate(monday), end: Grid.toISODate(sunday) };
}

function tagCountsThisWeek() {
  const { start, end } = weekRange(repasDate);
  const counts = {};
  Object.keys(FOOD_TAGS).forEach((t) => counts[t] = 0);
  state.repas.filter((r) => r.id >= start && r.id <= end).forEach((day) => {
    Object.keys(MEAL_SLOTS).forEach((slot) => {
      const data = mealSlotData(day, slot);
      data.tags.forEach((t) => { if (counts[t] !== undefined) counts[t]++; });
    });
  });
  return counts;
}

pages.repas = () => {
  const dayMeals = state.repas.find((r) => r.id === repasDate);
  const counts = tagCountsThisWeek();
  const goals = state.foodGoals || [];
  return `
  <h2>🍽️ Repas</h2>
  <div class="card">
    <div class="section-title" style="margin-top:0">Objectifs alimentaires (par semaine)</div>
    <div class="grid-cards">
      ${Object.entries(FOOD_TAGS).map(([k, l]) => {
        const goal = goals.find((g) => g.id === k);
        const target = goal ? goal.target : null;
        return `
        <div class="card" style="background:var(--bg)">
          <div class="flex-between"><span>${l}</span><input type="number" min="0" style="width:60px" data-goal="${k}" value="${target ?? ""}" placeholder="obj."></div>
          <div class="stat" style="font-size:20px;margin-top:6px">${counts[k]}${target ? `/${target}` : ""}</div>
        </div>`;
      }).join("")}
    </div>
    <p class="muted" style="margin-top:8px">Semaine du ${fmtDate(weekRange(repasDate).start)} au ${fmtDate(weekRange(repasDate).end)} — calculé à partir des étiquettes que tu coches sur tes repas ci-dessous.</p>
  </div>

  <div class="view-nav" style="margin-bottom:14px">
    <button id="repas-prev">◀</button>
    <span class="pill">${fmtDate(repasDate)}</span>
    <button id="repas-next">▶</button>
    <button id="repas-today" class="btn-sm">Aujourd'hui</button>
  </div>
  <div class="card">
    ${Object.entries(MEAL_SLOTS).map(([k, l]) => {
      const data = mealSlotData(dayMeals, k);
      return `
      <div class="row" style="align-items:flex-start;flex-direction:column;gap:6px">
        <span style="font-weight:600">${l}</span>
        <textarea data-meal="${k}" placeholder="Qu'est-ce que tu prévois ?" style="min-height:44px">${data.text}</textarea>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          ${Object.entries(FOOD_TAGS).map(([tk, tl]) => `
            <label style="font-size:12px;display:flex;align-items:center;gap:4px">
              <input type="checkbox" class="meal-tag" data-meal-slot="${k}" data-tag="${tk}" ${data.tags.includes(tk) ? "checked" : ""}> ${tl}
            </label>`).join("")}
        </div>
      </div>`;
    }).join("")}
  </div>`;
};

/* ---------- NUTRITION (calories & macros, type diététicien) ---------- */
let nutritionDate = todayStr();
function macroBar(label, value, target, unit, color) {
  const pct = target ? Math.min(100, Math.round((value / target) * 100)) : 0;
  return `
    <div style="margin-bottom:10px">
      <div class="flex-between" style="font-size:13px"><span>${label}</span><span class="muted">${value}${unit}${target ? ` / ${target}${unit}` : ""}</span></div>
      <div style="background:var(--bg);border-radius:6px;height:8px;overflow:hidden;margin-top:3px">
        <div style="width:${pct}%;background:${color};height:100%"></div>
      </div>
    </div>`;
}

pages.nutrition = () => {
  const dayEntries = state.nutritionLog.filter((e) => e.date === nutritionDate);
  const totals = dayEntries.reduce((acc, e) => ({
    kcal: acc.kcal + (e.kcal || 0), protein: acc.protein + (e.protein || 0),
    carbs: acc.carbs + (e.carbs || 0), fat: acc.fat + (e.fat || 0),
  }), { kcal: 0, protein: 0, carbs: 0, fat: 0 });
  const goals = state.nutritionGoals;

  return `
  <h2>🥗 Nutrition</h2>
  <div class="card">
    <div class="section-title" style="margin-top:0">Objectifs journaliers</div>
    <div class="form-inline">
      <input type="number" id="goal-kcal" placeholder="kcal" value="${goals.kcal || ""}">
      <input type="number" id="goal-protein" placeholder="protéines (g)" value="${goals.protein || ""}">
      <input type="number" id="goal-carbs" placeholder="glucides (g)" value="${goals.carbs || ""}">
      <input type="number" id="goal-fat" placeholder="lipides (g)" value="${goals.fat || ""}">
      <button class="btn" id="save-nutrition-goals">Enregistrer</button>
    </div>
  </div>

  <div class="view-nav" style="margin-bottom:14px">
    <button id="nutri-prev">◀</button>
    <span class="pill">${fmtDate(nutritionDate)}</span>
    <button id="nutri-next">▶</button>
    <button id="nutri-today" class="btn-sm">Aujourd'hui</button>
  </div>

  <div class="card">
    <div class="section-title" style="margin-top:0">Bilan du jour</div>
    ${macroBar("Calories", totals.kcal, goals.kcal, " kcal", "var(--accent)")}
    ${macroBar("Protéines", totals.protein, goals.protein, "g", "var(--accent2)")}
    ${macroBar("Glucides", totals.carbs, goals.carbs, "g", "var(--warn)")}
    ${macroBar("Lipides", totals.fat, goals.fat, "g", "var(--danger)")}
  </div>

  <div class="card">
    <div class="section-title" style="margin-top:0">Ajouter un aliment / repas</div>
    <div class="form-inline">
      <input type="text" id="nutri-desc" placeholder="Description (ex: poulet-riz)">
      <input type="number" id="nutri-kcal" placeholder="kcal">
      <input type="number" id="nutri-protein" placeholder="protéines (g)">
      <input type="number" id="nutri-carbs" placeholder="glucides (g)">
      <input type="number" id="nutri-fat" placeholder="lipides (g)">
      <button class="btn" id="add-nutri">Ajouter</button>
    </div>
  </div>
  <div class="card">
    ${dayEntries.length ? dayEntries.map((e) => `
      <div class="row">
        <span style="flex:1">${e.description}</span>
        <span class="pill">${e.kcal || 0} kcal</span>
        <span class="muted" style="font-size:12px">P${e.protein||0} G${e.carbs||0} L${e.fat||0}</span>
        <button class="close-x" data-del-nutri="${e.id}">✕</button>
      </div>`).join("") : '<div class="empty">Rien loggé aujourd\\'hui.</div>'}
  </div>`;
};

/* ---------- BUDGET MENSUEL (catégories type CPAS) ---------- */
const CHARGE_CATEGORIES = [
  { id: "loyer", label: "Loyer / prêt hypothécaire", section: "primaire", freq: "mensuel" },
  { id: "chargeslocatives", label: "Charges locatives (charges communes)", section: "primaire", freq: "mensuel" },
  { id: "electricite", label: "Électricité", section: "primaire", freq: "mensuel" },
  { id: "chauffage", label: "Chauffage", section: "primaire", freq: "mensuel" },
  { id: "gaz", label: "Gaz", section: "primaire", freq: "mensuel" },
  { id: "eau", label: "Eau", section: "primaire", freq: "mensuel" },
  { id: "nourriture", label: "Nourriture", section: "primaire", freq: "mensuel" },
  { id: "fraismedicaux", label: "Frais médicaux et pharmaceutiques", section: "primaire", freq: "mensuel" },
  { id: "mutuelle", label: "Cotisations mutuelle", section: "primaire", freq: "trimestriel" },
  { id: "pensionalimentaire", label: "Pension alimentaire payée", section: "primaire", freq: "mensuel" },
  { id: "taxeimmondices", label: "Taxe immondices", section: "primaire", freq: "annuel" },
  { id: "taxeegouts", label: "Taxe égouts", section: "primaire", freq: "annuel" },
  { id: "impots", label: "Impôts des personnes physiques", section: "primaire", freq: "annuel" },
  { id: "assuranceincendie", label: "Assurance incendie", section: "primaire", freq: "annuel" },
  { id: "precompte", label: "Précompte immobilier", section: "primaire", freq: "annuel" },
  { id: "internet", label: "Internet - TV - Téléphone", section: "secondaire", freq: "mensuel" },
  { id: "vetements", label: "Vêtements / chaussures", section: "secondaire", freq: "mensuel" },
  { id: "entretienmenage", label: "Entretien du ménage et sac poubelle", section: "secondaire", freq: "mensuel" },
  { id: "materielscolaire", label: "Matériel scolaire", section: "secondaire", freq: "annuel" },
  { id: "abonnementscolaire", label: "Abonnement scolaire (repas/garderie)", section: "secondaire", freq: "mensuel" },
  { id: "hygiene", label: "Hygiène", section: "secondaire", freq: "mensuel" },
  { id: "coiffeur", label: "Coiffeur", section: "secondaire", freq: "mensuel" },
  { id: "transport", label: "Frais de transport en commun", section: "secondaire", freq: "mensuel" },
  { id: "assurancefamiliale", label: "Assurance familiale", section: "secondaire", freq: "mensuel" },
  { id: "extratv", label: "Extra TV / streaming / abonnements app", section: "choixdevie", freq: "mensuel" },
  { id: "sport", label: "Sport", section: "choixdevie", freq: "mensuel" },
  { id: "animaux", label: "Animaux", section: "choixdevie", freq: "mensuel" },
  { id: "magazines", label: "Magazines / revues / journaux", section: "choixdevie", freq: "mensuel" },
  { id: "entretienvehicule", label: "Frais d'entretien du véhicule", section: "choixdevie", freq: "annuel" },
  { id: "assurancevehicule", label: "Assurance véhicule", section: "choixdevie", freq: "annuel" },
  { id: "garage", label: "Location de garage", section: "choixdevie", freq: "mensuel" },
  { id: "taxecirculation", label: "Taxe circulation", section: "choixdevie", freq: "annuel" },
  { id: "carburant", label: "Carburant", section: "choixdevie", freq: "mensuel" },
  { id: "bien2", label: "Frais liés à un 2ème bien immobilier", section: "choixdevie", freq: "mensuel" },
  { id: "assurancehospi", label: "Assurance hospitalisation", section: "choixdevie", freq: "annuel" },
  { id: "assurancedeces", label: "Assurance décès", section: "choixdevie", freq: "mensuel" },
  { id: "epargne", label: "Épargne", section: "choixdevie", freq: "mensuel" },
  { id: "argentpoche", label: "Argent de poche", section: "choixdevie", freq: "mensuel" },
  { id: "creditconso", label: "Crédit à la consommation / carte de crédit / prêt", section: "choixdevie", freq: "mensuel" },
  { id: "cotisationssyndicales", label: "Cotisations syndicales", section: "choixdevie", freq: "mensuel" },
  { id: "dons", label: "Dons (famille, église...)", section: "choixdevie", freq: "mensuel" },
  { id: "tabac", label: "Tabac", section: "choixdevie", freq: "mensuel" },
  { id: "loisirs_budget", label: "Loisirs (vacances, stages, camps...)", section: "choixdevie", freq: "mensuel" },
  { id: "assuetudes", label: "Assuétudes (jeux, alcool...)", section: "choixdevie", freq: "mensuel" },
  { id: "autrescv", label: "Autres (à préciser)", section: "choixdevie", freq: "mensuel" },
];
const CHARGE_SECTIONS = { primaire: "Dépenses primaires", secondaire: "Dépenses secondaires", choixdevie: "Dépenses liées au choix de vie" };
const FREQ_DIVISOR = { mensuel: 1, trimestriel: 3, annuel: 12 };

function monthlyEquivalent(amount, freq) { return (amount || 0) / (FREQ_DIVISOR[freq] || 1); }

pages.budgetmensuel = () => {
  const values = state.budgetCharges || {};
  const allMonthly = CHARGE_CATEGORIES.reduce((s, c) => s + monthlyEquivalent((values[c.id] || {}).amount, (values[c.id] || {}).freq || c.freq), 0);

  const renderSection = (sectionKey) => {
    const cats = CHARGE_CATEGORIES.filter((c) => c.section === sectionKey);
    const sectionTotal = cats.reduce((s, c) => s + monthlyEquivalent((values[c.id] || {}).amount, (values[c.id] || {}).freq || c.freq), 0);
    return `
    <div class="card">
      <div class="section-title" style="margin-top:0">${CHARGE_SECTIONS[sectionKey]}</div>
      <table><thead><tr><th>Intitulé</th><th>Montant</th><th>Fréquence</th><th>Mensuel</th><th>%</th></tr></thead><tbody>
        ${cats.map((c) => {
          const v = values[c.id] || {};
          const monthly = monthlyEquivalent(v.amount, v.freq || c.freq);
          const pct = allMonthly ? Math.round((monthly / allMonthly) * 100) : 0;
          return `
          <tr>
            <td>${c.label}</td>
            <td><input type="number" step="0.01" data-charge-amount="${c.id}" value="${v.amount ?? ""}" style="width:90px"></td>
            <td><select data-charge-freq="${c.id}">
              <option value="mensuel" ${(v.freq||c.freq)==='mensuel'?'selected':''}>Mensuel</option>
              <option value="trimestriel" ${(v.freq||c.freq)==='trimestriel'?'selected':''}>Trimestriel</option>
              <option value="annuel" ${(v.freq||c.freq)==='annuel'?'selected':''}>Annuel</option>
            </select></td>
            <td>${monthly.toFixed(2)}€</td>
            <td>${pct}%</td>
          </tr>`;
        }).join("")}
        <tr><td><strong>Total ${CHARGE_SECTIONS[sectionKey].toLowerCase()}</strong></td><td></td><td></td><td><strong>${sectionTotal.toFixed(2)}€</strong></td><td></td></tr>
      </tbody></table>
    </div>`;
  };

  return `
  <h2>📋 Budget mensuel — charges fixes</h2>
  <p class="muted">Basé sur le modèle CPAS que tu m'as donné — remplis seulement ce qui te concerne, laisse à 0 le reste.</p>
  <div class="card"><div class="stat">${allMonthly.toFixed(2)}€ / mois</div><div class="stat-label">total toutes charges fixes confondues</div></div>
  ${renderSection("primaire")}
  ${renderSection("secondaire")}
  ${renderSection("choixdevie")}`;
};

/* ---------- COURSES & BUDGET ---------- */
function csvDownload(filename, rows) {
  const csv = rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

pages.courses = () => {
  const monthKey = currentMonthKey();
  const budget = state.budgetSettings.monthlyLimit || 0;
  const itemsWithPrice = state.courses.filter((c) => c.bought && c.price != null);
  const sumItems = itemsWithPrice.reduce((s, c) => s + c.price, 0);
  const depensesThisMonth = state.depenses.filter((d) => (d.date || "").startsWith(monthKey));
  const sumDepenses = depensesThisMonth.reduce((s, d) => s + d.amount, 0);
  const totalSpent = sumItems + sumDepenses;
  const remaining = budget - totalSpent;

  return `
  <h2>🛒 Courses & Budget</h2>
  <div class="card">
    <div class="section-title" style="margin-top:0">Budget mensuel courses</div>
    <div class="form-inline">
      <input type="number" id="budget-limit" value="${budget || ""}" placeholder="Budget mensuel (€)">
      <button class="btn" id="save-budget">Enregistrer</button>
    </div>
  </div>
  <div class="grid-cards" style="margin-bottom:16px">
    <div class="card"><div class="stat">${totalSpent.toFixed(2)}€</div><div class="stat-label">dépensé ce mois</div></div>
    <div class="card"><div class="stat" style="color:${remaining < 0 ? 'var(--danger)' : 'var(--accent2)'}">${remaining.toFixed(2)}€</div><div class="stat-label">restant sur le budget</div></div>
  </div>

  <div class="section-title">Liste de courses</div>
  <div class="card">
    <div class="form-inline">
      <input type="text" id="course-name" placeholder="Article">
      <input type="number" step="0.01" id="course-price" placeholder="Prix fixe (optionnel, en €)">
      <button class="btn" id="add-course">Ajouter</button>
      <button class="btn secondary" id="export-courses">Exporter CSV</button>
    </div>
  </div>
  <div class="card">
    ${state.courses.length ? state.courses.map((c) => `
      <div class="row">
        <input type="checkbox" class="check" data-course-bought="${c.id}" ${c.bought ? "checked" : ""}>
        <span style="flex:1${c.bought ? ";text-decoration:line-through;color:var(--muted)" : ""}">${c.name}</span>
        ${c.price != null ? `<span class="pill">${c.price.toFixed(2)}€</span>` : '<span class="pill muted">prix libre</span>'}
        <button class="close-x" data-del-course="${c.id}">✕</button>
      </div>`).join("") : '<div class="empty">Liste vide.</div>'}
  </div>

  <div class="section-title">Dépenses libres (tickets globaux, sans détail par article)</div>
  <div class="card">
    <div class="form-inline">
      <input type="date" id="dep-date" value="${todayStr()}">
      <input type="number" step="0.01" id="dep-amount" placeholder="Montant (€)">
      <input type="text" id="dep-label" placeholder="Label (ex: courses Colruyt)">
      <button class="btn" id="add-depense">Ajouter</button>
      <button class="btn secondary" id="export-depenses">Exporter CSV</button>
    </div>
  </div>
  <div class="card">
    ${depensesThisMonth.length ? depensesThisMonth.map((d) => `
      <div class="row">
        <span class="pill">${fmtDate(d.date)}</span>
        <span style="flex:1">${d.label || ""}</span>
        <span class="pill">${d.amount.toFixed(2)}€</span>
        <button class="close-x" data-del-depense="${d.id}">✕</button>
      </div>`).join("") : '<div class="empty">Aucune dépense ce mois.</div>'}
  </div>`;
};

/* ---------- SPORT & SANTE ---------- */
const MESURE_TYPES = {
  poids: { label: "⚖️ Poids", unit: "kg" },
  sommeil: { label: "😴 Sommeil", unit: "h" },
  pas: { label: "🚶 Pas", unit: "pas" },
  seance: { label: "🏋️ Séance de sport", unit: "min" },
  autre: { label: "📊 Autre", unit: "" },
};
let mesureFilter = "poids";

function mesureTrendChart(entries) {
  if (entries.length < 2) return '<p class="empty">Pas encore assez de données pour une tendance.</p>';
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date)).slice(-30);
  const values = sorted.map((e) => e.value);
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;
  return `
    <div style="display:flex;align-items:flex-end;gap:3px;height:100px;margin-top:8px">
      ${sorted.map((e) => `
        <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%" title="${fmtDate(e.date)}: ${e.value}${e.unit||''}">
          <div style="width:100%;background:var(--accent2);border-radius:3px 3px 0 0;height:${((e.value - min) / range) * 70 + 6}px"></div>
        </div>`).join("")}
    </div>
    <div class="flex-between muted" style="font-size:11px;margin-top:4px"><span>${fmtDate(sorted[0].date)}</span><span>min ${min} / max ${max}</span><span>${fmtDate(sorted[sorted.length-1].date)}</span></div>`;
}

pages.sport = () => {
  const filtered = state.mesures.filter((m) => m.type === mesureFilter).sort((a,b)=>b.date.localeCompare(a.date));
  const info = MESURE_TYPES[mesureFilter];
  return `
  <h2>🏋️ Sport & Santé</h2>
  <div class="card">
    <div class="section-title" style="margin-top:0">Ajouter une mesure</div>
    <div class="form-inline">
      <select id="mesure-type">${Object.entries(MESURE_TYPES).map(([k,v]) => `<option value="${k}">${v.label}</option>`).join("")}</select>
      <input type="date" id="mesure-date" value="${todayStr()}">
      <input type="number" step="0.1" id="mesure-value" placeholder="Valeur">
      <input type="text" id="mesure-label" placeholder="Détail (ex: type de séance) — optionnel">
      <button class="btn" id="add-mesure">Ajouter</button>
    </div>
  </div>
  <div class="view-selector">
    ${Object.entries(MESURE_TYPES).map(([k,v]) => `<button data-mesure-view="${k}" class="${k===mesureFilter?"active":""}">${v.label}</button>`).join("")}
  </div>
  <div class="card">
    <div class="section-title" style="margin-top:0">Tendance — ${info.label}</div>
    ${mesureTrendChart(filtered.map(m=>({...m, unit: info.unit})))}
  </div>
  <div class="card">
    ${filtered.length ? filtered.slice(0,20).map((m) => `
      <div class="row">
        <span class="pill">${fmtDate(m.date)}</span>
        <span style="flex:1">${m.value}${info.unit} ${m.label ? `— ${m.label}` : ""}</span>
        <button class="close-x" data-del-mesure="${m.id}">✕</button>
      </div>`).join("") : '<div class="empty">Rien enregistré pour ce type.</div>'}
  </div>`;
};

/* ---------- DEVELOPPEMENT PERSONNEL ---------- */
const DEVPERSO_TYPES = { livre: "📖 Livre", video: "🎬 Vidéo", podcast: "🎧 Podcast", activite: "🏋️ Activité", reflexion: "💭 Réflexion" };
const DEVPERSO_STATUSES = { a_faire: "À faire/voir", en_cours: "En cours", termine: "Terminé" };
let devPersoFilter = "";

pages.devperso = () => {
  const items = state.devPerso.filter((d) => !devPersoFilter || d.type === devPersoFilter);
  const scored = state.devPerso.filter((d) => d.rating);
  const avgRating = scored.length ? (scored.reduce((s, d) => s + d.rating, 0) / scored.length).toFixed(1) : "—";
  return `
  <h2>🌱 Développement personnel</h2>
  <div class="grid-cards" style="margin-bottom:16px">
    <div class="card"><div class="stat">${state.devPerso.length}</div><div class="stat-label">entrées enregistrées</div></div>
    <div class="card"><div class="stat">${state.devPerso.filter((d) => d.status === "termine").length}</div><div class="stat-label">terminées</div></div>
    <div class="card"><div class="stat">${avgRating}${scored.length ? "/5" : ""}</div><div class="stat-label">note moyenne</div></div>
  </div>
  <div class="card">
    <div class="form-inline">
      <select id="dp-type">${Object.entries(DEVPERSO_TYPES).map(([k,l]) => `<option value="${k}">${l}</option>`).join("")}</select>
      <input type="text" id="dp-title" placeholder="Titre (ex: Atomic Habits, méditation guidée...)">
      <select id="dp-status">${Object.entries(DEVPERSO_STATUSES).map(([k,l]) => `<option value="${k}">${l}</option>`).join("")}</select>
      <button class="btn" id="add-dp">Ajouter</button>
    </div>
    <textarea id="dp-notes" placeholder="Notes, réflexion, ce que tu en retiens... (optionnel)"></textarea>
  </div>
  <div class="form-inline" style="max-width:260px">
    <select id="dp-filter">
      <option value="">Tous les types</option>
      ${Object.entries(DEVPERSO_TYPES).map(([k,l]) => `<option value="${k}" ${k===devPersoFilter?"selected":""}>${l}</option>`).join("")}
    </select>
  </div>
  <div class="card">
    ${items.length ? items.map((d) => `
      <div class="row" style="align-items:flex-start;flex-direction:column;gap:6px">
        <div class="flex-between" style="width:100%">
          <strong>${DEVPERSO_TYPES[d.type] || ""} ${d.title}</strong>
          <div style="display:flex;gap:6px;align-items:center">
            <select data-dp-status="${d.id}">${Object.entries(DEVPERSO_STATUSES).map(([k,l])=>`<option value="${k}" ${k===d.status?"selected":""}>${l}</option>`).join("")}</select>
            <select data-dp-rating="${d.id}">
              <option value="">Note ?</option>
              ${[1,2,3,4,5].map((n)=>`<option value="${n}" ${d.rating===n?"selected":""}>⭐ ${n}</option>`).join("")}
            </select>
            <button class="close-x" data-del-dp="${d.id}">✕</button>
          </div>
        </div>
        ${d.notes ? `<div class="muted">${d.notes.replace(/</g,"&lt;")}</div>` : ""}
      </div>`).join("") : '<div class="empty">Rien pour l\\'instant.</div>'}
  </div>`;
};

/* ---------- ACTUS (événements qui concernent d'autres personnes) ---------- */
function nextOccurrence(dateISO, recurringYearly) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let d = new Date(dateISO + "T00:00:00");
  if (recurringYearly) {
    d.setFullYear(today.getFullYear());
    if (d < today) d.setFullYear(today.getFullYear() + 1);
  }
  return d;
}
function daysUntil(date) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((date - today) / 86400000);
}
function actusUpcoming(limit) {
  return state.actus
    .map((a) => ({ ...a, _next: nextOccurrence(a.date, a.recurringYearly) }))
    .filter((a) => a.recurringYearly || a._next >= new Date(new Date().toDateString()))
    .sort((a, b) => a._next - b._next)
    .slice(0, limit || 100);
}

pages.actus = () => `
  <h2>🔔 Actus</h2>
  <p class="muted">Événements qui concernent d'autres personnes — anniversaire, déménagement, voyage... juste pour être au courant, ça n'apparaît pas dans ton calendrier perso.</p>
  <div class="card">
    <div class="form-inline">
      <input type="text" id="actu-person" placeholder="Qui ?">
      <input type="text" id="actu-title" placeholder="Quoi ? (ex: anniversaire, déménagement)">
      <input type="date" id="actu-date" value="${todayStr()}">
      <label style="flex:0 0 auto;display:flex;align-items:center;gap:6px"><input type="checkbox" id="actu-recurring"> se répète chaque année</label>
      <button class="btn" id="add-actu">Ajouter</button>
    </div>
  </div>
  <div class="card">
    ${actusUpcoming().map((a) => `
      <div class="row">
        <span class="pill">dans ${daysUntil(a._next)}j — ${fmtDate(Grid.toISODate(a._next))}</span>
        <span style="flex:1"><strong>${a.person}</strong> — ${a.title}${a.recurringYearly ? " 🔁" : ""}</span>
        <button class="close-x" data-del-actu="${a.id}">✕</button>
      </div>`).join("") || '<div class="empty">Aucune actu enregistrée.</div>'}
  </div>`;

/* ---------- LOISIRS (sport/voyages, partagé avec les amis) ---------- */
const LOISIR_CATS = { sport: "🏃 Sport", voyage: "✈️ Voyage", autre: "🎉 Autre" };
pages.loisirs = () => {
  const link = `${location.origin}${location.pathname.replace(/index\.html$/, "")}loisirs.html?u=${uid}`;
  const today = todayStr();
  const upcoming = state.loisirsEvents.filter((e) => e.date >= today);
  const past = state.loisirsEvents.filter((e) => e.date < today);
  return `
  <h2>🎉 Loisirs — sport & voyages</h2>
  <div class="card">
    <div class="section-title" style="margin-top:0">Lien à partager avec tes amis</div>
    <div class="form-inline">
      <input type="text" id="loisirs-link" value="${link}" readonly>
      <button class="btn secondary" id="copy-loisirs-link">Copier</button>
    </div>
    <p class="muted">Tes amis peuvent voir et proposer des événements via ce lien, sans compte. Seul toi peux en supprimer.</p>
  </div>
  <div class="card">
    <div class="form-inline">
      <input type="text" id="loisir-title" placeholder="Quoi ?">
      <input type="date" id="loisir-date" value="${today}">
      <select id="loisir-cat">${Object.entries(LOISIR_CATS).map(([k,l])=>`<option value="${k}">${l}</option>`).join("")}</select>
      <button class="btn" id="add-loisir">Ajouter</button>
    </div>
  </div>
  <div class="section-title">À venir</div>
  <div class="card">
    ${upcoming.length ? upcoming.map((e) => `
      <div class="row">
        <span class="pill">${fmtDate(e.date)}</span>
        <span style="flex:1">${LOISIR_CATS[e.category] || "🎉"} ${e.title}${e.author ? ` — <span class="muted">proposé par ${e.author}</span>` : ""}</span>
        <button class="close-x" data-del-loisir="${e.id}">✕</button>
      </div>`).join("") : '<div class="empty">Rien de prévu.</div>'}
  </div>
  ${past.length ? `<div class="section-title">Passés</div><div class="card">${past.slice(-8).reverse().map((e) => `
    <div class="row"><span class="pill">${fmtDate(e.date)}</span><span style="flex:1">${LOISIR_CATS[e.category] || "🎉"} ${e.title}</span><button class="close-x" data-del-loisir="${e.id}">✕</button></div>
  `).join("")}</div>` : ""}`;
};

/* ---------- RESERVATION (lien public + dispos + demandes) ---------- */
const DAY_LABELS = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];

pages.reservation = () => {
  const link = `${location.origin}${location.pathname.replace(/index\.html$/, "")}booking.html?u=${uid}`;
  const pending = state.bookingRequests.filter((r) => r.status === "pending").sort((a,b)=> (a.date+a.time).localeCompare(b.date+b.time));
  const other = state.bookingRequests.filter((r) => r.status !== "pending").sort((a,b)=> (b.date+b.time).localeCompare(a.date+a.time));

  return `
  <h2>🔗 Réservation en ligne</h2>
  <div class="card">
    <div class="section-title" style="margin-top:0">Ton lien à partager</div>
    <div class="form-inline">
      <input type="text" id="booking-link" value="${link}" readonly>
      <button class="btn secondary" id="copy-link">Copier</button>
    </div>
    <p class="muted">Ouvre-le toi-même dans un nouvel onglet pour vérifier avant de l'envoyer.</p>
  </div>

  <div class="section-title">Demandes en attente ${pending.length ? `<span class="pill">${pending.length}</span>` : ""}</div>
  <div class="card">
    ${pending.length ? pending.map((r) => `
      <div class="row">
        <span class="pill">${fmtDate(r.date)} ${r.time}</span>
        <span style="flex:1"><strong>${r.name}</strong> — ${r.email}${r.motif ? ` — <span class="muted">${r.motif}</span>` : ""}</span>
        <button class="btn btn-sm" data-accept-req="${r.id}">✅ Accepter</button>
        <button class="btn btn-sm danger" data-decline-req="${r.id}">✕ Refuser</button>
      </div>`).join("") : '<div class="empty">Aucune demande en attente.</div>'}
  </div>

  ${other.length ? `
  <div class="section-title">Historique</div>
  <div class="card">
    ${other.map((r) => `
      <div class="row">
        <span class="pill">${fmtDate(r.date)} ${r.time}</span>
        <span style="flex:1">${r.name} — ${r.email}</span>
        <span class="pill">${r.status === "confirmed" ? "✅ confirmé" : "✕ refusé"}</span>
      </div>`).join("")}
  </div>` : ""}

  <div class="section-title">Règles de disponibilité récurrentes</div>
  <div class="card">
    ${state.bookingRules.map((r) => `
      <div class="row">
        <span style="flex:1">${(r.days||[]).map(d=>DAY_LABELS[d]).join(", ")} — ${r.startTime} à ${r.endTime} (créneaux de ${r.slotMinutes} min)</span>
        <button class="close-x" data-del-rule="${r.id}">✕</button>
      </div>`).join("") || '<div class="empty">Aucune règle — ajoute-en une ci-dessous.</div>'}
  </div>
  <div class="card">
    <div class="form-inline" style="flex-wrap:wrap">
      ${DAY_LABELS.map((l, i) => `<label style="flex:0 0 auto"><input type="checkbox" class="rule-day" value="${i}"> ${l}</label>`).join(" ")}
    </div>
    <div class="form-inline">
      <input type="time" id="rule-start" value="09:00">
      <input type="time" id="rule-end" value="17:00">
      <select id="rule-slotmin">
        <option value="15">créneaux 15 min</option>
        <option value="30" selected>créneaux 30 min</option>
        <option value="60">créneaux 60 min</option>
      </select>
      <button class="btn" id="add-rule">Ajouter la règle</button>
    </div>
  </div>

  <div class="section-title">Indisponibilités ponctuelles</div>
  <div class="card">
    ${state.blockedSlots.map((b) => `
      <div class="row">
        <span class="pill">${fmtDate(b.date)}${b.startTime ? ` ${b.startTime}-${b.endTime||b.startTime}` : " (journée)"}</span>
        <span style="flex:1">${b.reason || ""}</span>
        <button class="close-x" data-del-block="${b.id}">✕</button>
      </div>`).join("") || '<div class="empty">Aucune indisponibilité ponctuelle.</div>'}
  </div>
  <div class="card">
    <div class="form-inline">
      <input type="date" id="block-date" value="${todayStr()}">
      <input type="time" id="block-start" placeholder="début (vide = tte la journée)">
      <input type="time" id="block-end" placeholder="fin">
      <input type="text" id="block-reason" placeholder="raison (ex: barbecue)">
      <button class="btn" id="add-block">Bloquer</button>
    </div>
  </div>`;
};

/* ---------- CALENDRIER (vue flexible) ---------- */
const calState = { unit: "week", startDate: new Date() };
calState.startDate.setHours(0,0,0,0);

const VIEW_OPTIONS = [
  { key: "day", label: "Jour", days: 1 },
  { key: "3days", label: "3 jours", days: 3 },
  { key: "week", label: "Semaine", days: 7 },
  { key: "2weeks", label: "2 semaines", days: 14 },
  { key: "month", label: "Mois", months: 1 },
  { key: "3months", label: "3 mois", months: 3 },
  { key: "year", label: "Année", months: 12 },
];

function currentViewOption() {
  return VIEW_OPTIONS.find((v) => v.key === calState.unit) || VIEW_OPTIONS[2];
}
function periodLabel() {
  const opt = currentViewOption();
  if (opt.months) {
    if (opt.months === 1) return `${Grid.MONTHS_FULL[calState.startDate.getMonth()]} ${calState.startDate.getFullYear()}`;
    const end = new Date(calState.startDate.getFullYear(), calState.startDate.getMonth() + opt.months - 1, 1);
    return `${Grid.MONTHS_FULL[calState.startDate.getMonth()]} ${calState.startDate.getFullYear()} → ${Grid.MONTHS_FULL[end.getMonth()]} ${end.getFullYear()}`;
  }
  const dates = Grid.buildDateList(calState.startDate, opt.days);
  return `${fmtDate(Grid.toISODate(dates[0]))} → ${fmtDate(Grid.toISODate(dates[dates.length - 1]))}`;
}
function shiftPeriod(dir) {
  const opt = currentViewOption();
  if (opt.months) {
    calState.startDate = new Date(calState.startDate.getFullYear(), calState.startDate.getMonth() + dir * opt.months, 1);
  } else {
    calState.startDate = Grid.addDays(calState.startDate, dir * opt.days);
  }
}

pages.calendrier = () => `
  <h2>📅 Calendrier</h2>
  <div class="card">
    <div class="form-inline">
      <input type="text" id="ev-title" placeholder="Titre">
      <input type="date" id="ev-date" value="${todayStr()}">
      <input type="time" id="ev-time">
      <input type="time" id="ev-endtime">
      <input type="text" id="ev-cat" placeholder="Catégorie">
      <button class="btn" id="add-event">Ajouter</button>
    </div>
    <div class="form-inline">
      <label class="btn secondary" style="cursor:pointer;text-align:center">
        📥 Importer un .ics
        <input type="file" id="ics-input" accept=".ics,text/calendar" class="hidden">
      </label>
      <span id="ics-status" class="muted"></span>
    </div>
  </div>
  <div class="flex-between" style="margin-bottom:10px">
    <div class="view-selector">
      ${VIEW_OPTIONS.map((v) => `<button data-view="${v.key}" class="${v.key === calState.unit ? "active" : ""}">${v.label}</button>`).join("")}
    </div>
    <div class="view-nav">
      <button id="cal-prev">◀</button>
      <span class="pill">${periodLabel()}</span>
      <button id="cal-next">▶</button>
      <button id="cal-today" class="btn-sm">Aujourd'hui</button>
    </div>
  </div>
  <div id="calendar-render"></div>
  `;

function renderCalendarBody() {
  const container = document.getElementById("calendar-render");
  if (!container) return;
  const opt = currentViewOption();
  if (opt.months) {
    renderMonthsView(container, calState.startDate, opt.months, state.events, jumpToDay);
  } else {
    container.innerHTML = '<div class="grid-scroll"><div id="hour-grid" class="grid"></div></div>';
    const dates = Grid.buildDateList(calState.startDate, opt.days);
    const times = Grid.buildTimeSlots();
    const gridEl = document.getElementById("hour-grid");
    gridEl.style.gridTemplateColumns = Grid.gridTemplateColumns(dates.length);
    gridEl.style.gridTemplateRows = Grid.gridTemplateRows(times.length);
    Grid.renderGridHeaders(gridEl, dates, state.events, jumpToDay);
    Grid.renderHourRows(gridEl, dates, times, state.events);
  }
}
function jumpToDay(dateISO) {
  calState.unit = "day";
  calState.startDate = new Date(dateISO + "T00:00:00");
  navigate("calendrier");
}

/* ---------- EVENT HANDLERS ---------- */
function attachHandlers(page) {
  // Habitudes
  document.querySelectorAll("[data-habit]").forEach((el) => {
    el.addEventListener("change", async () => {
      const t = todayStr();
      const ref = doc(dbFS, "users", uid, "habitLog", t);
      const current = state.habitLog[t] || {};
      current[el.dataset.habit] = el.checked;
      await setDoc(ref, current, { merge: true });
    });
  });
  document.querySelectorAll("[data-del-habit]").forEach((el) => {
    el.addEventListener("click", () => deleteDoc(doc(dbFS, "users", uid, "habits", el.dataset.delHabit)));
  });
  const typeSelect = document.getElementById("new-habit-type");
  const paramInput = document.getElementById("new-habit-param");
  if (typeSelect) {
    const syncParam = () => {
      if (typeSelect.value === "daily") { paramInput.classList.add("hidden"); }
      else { paramInput.classList.remove("hidden"); paramInput.placeholder = typeSelect.value === "counter" ? "objectif par mois (ex: 20)" : "tous les combien de jours (ex: 42)"; }
    };
    typeSelect.addEventListener("change", syncParam);
    syncParam();
  }
  const addHabitBtn = document.getElementById("add-habit");
  if (addHabitBtn) addHabitBtn.addEventListener("click", async () => {
    const name = document.getElementById("new-habit-name").value.trim();
    const icon = document.getElementById("new-habit-icon").value.trim() || "⭐";
    const type = typeSelect ? typeSelect.value : "daily";
    if (!name) return;
    const data = { name, icon, type };
    const paramVal = parseInt(paramInput.value) || 0;
    if (type === "counter") data.target = paramVal || 1;
    if (type === "periodic") { data.intervalDays = paramVal || 30; data.lastDone = null; }
    if (type === "daily") {
      const alarmVal = document.getElementById("new-habit-alarm").value;
      if (alarmVal) data.alarmTime = alarmVal;
    }
    await addDoc(col("habits"), data);
  });
  document.querySelectorAll("[data-counter-inc]").forEach((el) => {
    el.addEventListener("click", async () => {
      const ref = doc(dbFS, "users", uid, "counterLog", currentMonthKey());
      const current = state.counterLog[currentMonthKey()] || {};
      current[el.dataset.counterInc] = (current[el.dataset.counterInc] || 0) + 1;
      await setDoc(ref, current, { merge: true });
    });
  });
  document.querySelectorAll("[data-periodic-done]").forEach((el) => {
    el.addEventListener("click", () => updateDoc(doc(dbFS, "users", uid, "habits", el.dataset.periodicDone), { lastDone: todayStr() }));
  });

  // Emploi
  const addJobBtn = document.getElementById("add-job");
  if (addJobBtn) addJobBtn.addEventListener("click", async () => {
    const entreprise = document.getElementById("job-entreprise").value.trim();
    if (!entreprise) return;
    const qualityVal = document.getElementById("job-quality").value;
    await addDoc(col("jobs"), {
      entreprise, poste: document.getElementById("job-poste").value.trim(),
      jobType: document.getElementById("job-type").value.trim(),
      date: document.getElementById("job-date").value, status: document.getElementById("job-status").value, notes: "",
      quality: qualityVal ? parseInt(qualityVal) : null,
    });
  });
  const jobTypeFilterEl = document.getElementById("job-type-filter");
  if (jobTypeFilterEl) jobTypeFilterEl.addEventListener("change", () => { jobTypeFilter = jobTypeFilterEl.value; navigate("emploi"); });
  document.querySelectorAll("[data-job-quality]").forEach((el) => {
    el.addEventListener("change", () => updateDoc(doc(dbFS, "users", uid, "jobs", el.dataset.jobQuality), { quality: el.value ? parseInt(el.value) : null }));
  });
  document.querySelectorAll("[data-job-status]").forEach((el) => {
    el.addEventListener("change", () => updateDoc(doc(dbFS, "users", uid, "jobs", el.dataset.jobStatus), { status: el.value }));
  });
  document.querySelectorAll("[data-job-notes]").forEach((el) => {
    el.addEventListener("change", () => updateDoc(doc(dbFS, "users", uid, "jobs", el.dataset.jobNotes), { notes: el.value }));
  });
  document.querySelectorAll("[data-del-job]").forEach((el) => {
    el.addEventListener("click", () => deleteDoc(doc(dbFS, "users", uid, "jobs", el.dataset.delJob)));
  });

  // Skills
  const addSkillBtn = document.getElementById("add-skill");
  if (addSkillBtn) addSkillBtn.addEventListener("click", async () => {
    const name = document.getElementById("skill-name").value.trim();
    if (!name) return;
    await addDoc(col("skills"), { name, resource: document.getElementById("skill-resource").value.trim(), progress: 0 });
  });
  document.querySelectorAll("[data-skill-progress]").forEach((el) => {
    el.addEventListener("change", () => updateDoc(doc(dbFS, "users", uid, "skills", el.dataset.skillProgress), { progress: parseInt(el.value) }));
  });
  document.querySelectorAll("[data-del-skill]").forEach((el) => {
    el.addEventListener("click", () => deleteDoc(doc(dbFS, "users", uid, "skills", el.dataset.delSkill)));
  });

  // Projets
  const addProjBtn = document.getElementById("add-proj");
  if (addProjBtn) addProjBtn.addEventListener("click", async () => {
    const name = document.getElementById("proj-name").value.trim();
    if (!name) return;
    await addDoc(col("projects"), { name, status: document.getElementById("proj-status").value, notes: "" });
  });
  document.querySelectorAll("[data-proj-status]").forEach((el) => {
    el.addEventListener("change", () => updateDoc(doc(dbFS, "users", uid, "projects", el.dataset.projStatus), { status: el.value }));
  });
  document.querySelectorAll("[data-proj-notes]").forEach((el) => {
    el.addEventListener("change", () => updateDoc(doc(dbFS, "users", uid, "projects", el.dataset.projNotes), { notes: el.value }));
  });
  document.querySelectorAll("[data-del-proj]").forEach((el) => {
    el.addEventListener("click", () => deleteDoc(doc(dbFS, "users", uid, "projects", el.dataset.delProj)));
  });

  // Notes
  const addNoteBtn = document.getElementById("add-note");
  if (addNoteBtn) addNoteBtn.addEventListener("click", async () => {
    const content = document.getElementById("note-content").value.trim();
    if (!content) return;
    await addDoc(col("notes"), { content, created: new Date().toISOString() });
  });
  document.querySelectorAll("[data-del-note]").forEach((el) => {
    el.addEventListener("click", () => deleteDoc(doc(dbFS, "users", uid, "notes", el.dataset.delNote)));
  });

  // Réglages
  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) logoutBtn.addEventListener("click", () => signOut(auth));
  const changePwBtn = document.getElementById("change-password-btn");
  if (changePwBtn) changePwBtn.addEventListener("click", async () => {
    const status = document.getElementById("change-password-status");
    const current = document.getElementById("current-password").value;
    const next = document.getElementById("new-password").value;
    if (!current || next.length < 6) { status.textContent = "Remplis le mot de passe actuel + un nouveau d'au moins 6 caractères."; return; }
    try {
      const cred = EmailAuthProvider.credential(auth.currentUser.email, current);
      await reauthenticateWithCredential(auth.currentUser, cred);
      await updatePassword(auth.currentUser, next);
      status.textContent = "Mot de passe changé avec succès.";
      document.getElementById("current-password").value = "";
      document.getElementById("new-password").value = "";
    } catch (err) {
      status.textContent = translateAuthError(err.code);
    }
  });

  // Calendrier
  const addEventBtn = document.getElementById("add-event");
  if (addEventBtn) addEventBtn.addEventListener("click", async () => {
    const title = document.getElementById("ev-title").value.trim();
    const evDate = document.getElementById("ev-date").value;
    if (!title || !evDate) return;
    await addDoc(col("events"), {
      title, date: evDate, allDay: false,
      time: document.getElementById("ev-time").value || null,
      endTime: document.getElementById("ev-endtime").value || null,
      category: document.getElementById("ev-cat").value.trim(),
    });
  });
  document.querySelectorAll("[data-view]").forEach((el) => {
    el.addEventListener("click", () => { calState.unit = el.dataset.view; navigate("calendrier"); });
  });
  const prevBtn = document.getElementById("cal-prev");
  if (prevBtn) prevBtn.addEventListener("click", () => { shiftPeriod(-1); navigate("calendrier"); });
  const nextBtn = document.getElementById("cal-next");
  if (nextBtn) nextBtn.addEventListener("click", () => { shiftPeriod(1); navigate("calendrier"); });
  const todayBtn = document.getElementById("cal-today");
  if (todayBtn) todayBtn.addEventListener("click", () => { calState.startDate = new Date(); calState.startDate.setHours(0,0,0,0); navigate("calendrier"); });
  const icsInput = document.getElementById("ics-input");
  if (icsInput) icsInput.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    const newEvents = icsToLifeOSEvents(text);
    const status = document.getElementById("ics-status");
    status.textContent = `Import en cours (${newEvents.length} événements)...`;
    const batch = writeBatch(dbFS);
    newEvents.forEach((ev) => batch.set(doc(col("events")), ev));
    await batch.commit();
    status.textContent = `${newEvents.length} événements importés.`;
  });

  if (page === "calendrier") renderCalendarBody();

  // Réservation
  const copyLinkBtn = document.getElementById("copy-link");
  if (copyLinkBtn) copyLinkBtn.addEventListener("click", () => {
    const input = document.getElementById("booking-link");
    input.select();
    navigator.clipboard?.writeText(input.value);
    copyLinkBtn.textContent = "Copié !";
    setTimeout(() => { copyLinkBtn.textContent = "Copier"; }, 1500);
  });

  const addRuleBtn = document.getElementById("add-rule");
  if (addRuleBtn) addRuleBtn.addEventListener("click", async () => {
    const days = [...document.querySelectorAll(".rule-day:checked")].map((el) => parseInt(el.value));
    if (!days.length) return;
    await addDoc(bpCol("availabilityRules"), {
      days, startTime: document.getElementById("rule-start").value,
      endTime: document.getElementById("rule-end").value,
      slotMinutes: parseInt(document.getElementById("rule-slotmin").value),
    });
  });
  document.querySelectorAll("[data-del-rule]").forEach((el) => {
    el.addEventListener("click", () => deleteDoc(doc(dbFS, "bookingPublic", uid, "availabilityRules", el.dataset.delRule)));
  });

  const addBlockBtn = document.getElementById("add-block");
  if (addBlockBtn) addBlockBtn.addEventListener("click", async () => {
    const date = document.getElementById("block-date").value;
    if (!date) return;
    const startTime = document.getElementById("block-start").value || null;
    const endTime = document.getElementById("block-end").value || null;
    const reason = document.getElementById("block-reason").value.trim();
    await addDoc(bpCol("blockedSlots"), { date, startTime, endTime, reason });
    // Reflète aussi l'indispo dans le calendrier privé, pour la voir d'un coup d'œil.
    await addDoc(col("events"), {
      title: `🚫 ${reason || "Indisponible"}`, date,
      allDay: !startTime, time: startTime, endTime,
      category: "indispo",
    });
  });
  document.querySelectorAll("[data-del-block]").forEach((el) => {
    el.addEventListener("click", () => deleteDoc(doc(dbFS, "bookingPublic", uid, "blockedSlots", el.dataset.delBlock)));
  });

  document.querySelectorAll("[data-accept-req]").forEach((el) => {
    el.addEventListener("click", async () => {
      const r = state.bookingRequests.find((x) => x.id === el.dataset.acceptReq);
      if (!r) return;
      await updateDoc(doc(dbFS, "bookingPublic", uid, "requests", r.id), { status: "confirmed" });
      await updateDoc(doc(dbFS, "bookingPublic", uid, "slotsTaken", r.slotId), { status: "confirmed" });
      await addDoc(col("events"), {
        title: `📅 RDV: ${r.name}`, date: r.date, allDay: false,
        time: r.time, endTime: r.endTime,
        category: r.motif || "réservation",
      });
    });
  });
  // Repas
  function currentSlotData(slotKey) {
    const dayDoc = state.repas.find((r) => r.id === repasDate);
    return mealSlotData(dayDoc, slotKey);
  }
  document.querySelectorAll("[data-meal]").forEach((el) => {
    el.addEventListener("change", async () => {
      const cur = currentSlotData(el.dataset.meal);
      await setDoc(doc(dbFS, "users", uid, "repas", repasDate), { [el.dataset.meal]: { text: el.value, tags: cur.tags } }, { merge: true });
    });
  });
  document.querySelectorAll(".meal-tag").forEach((el) => {
    el.addEventListener("change", async () => {
      const slot = el.dataset.mealSlot;
      const cur = currentSlotData(slot);
      let tags = cur.tags.slice();
      if (el.checked) { if (!tags.includes(el.dataset.tag)) tags.push(el.dataset.tag); }
      else { tags = tags.filter((t) => t !== el.dataset.tag); }
      await setDoc(doc(dbFS, "users", uid, "repas", repasDate), { [slot]: { text: cur.text, tags } }, { merge: true });
    });
  });
  document.querySelectorAll("[data-goal]").forEach((el) => {
    el.addEventListener("change", async () => {
      const val = parseInt(el.value);
      await setDoc(doc(dbFS, "users", uid, "foodGoals", el.dataset.goal), { target: isNaN(val) ? null : val }, { merge: true });
    });
  });
  const repasPrev = document.getElementById("repas-prev");
  if (repasPrev) repasPrev.addEventListener("click", () => { repasDate = Grid.toISODate(Grid.addDays(new Date(repasDate + "T00:00:00"), -1)); navigate("repas"); });
  const repasNext = document.getElementById("repas-next");
  if (repasNext) repasNext.addEventListener("click", () => { repasDate = Grid.toISODate(Grid.addDays(new Date(repasDate + "T00:00:00"), 1)); navigate("repas"); });
  const repasToday = document.getElementById("repas-today");
  if (repasToday) repasToday.addEventListener("click", () => { repasDate = todayStr(); navigate("repas"); });

  // Nutrition
  const saveNutriGoalsBtn = document.getElementById("save-nutrition-goals");
  if (saveNutriGoalsBtn) saveNutriGoalsBtn.addEventListener("click", async () => {
    await setDoc(doc(dbFS, "users", uid, "settings", "nutrition"), {
      kcal: parseInt(document.getElementById("goal-kcal").value) || null,
      protein: parseInt(document.getElementById("goal-protein").value) || null,
      carbs: parseInt(document.getElementById("goal-carbs").value) || null,
      fat: parseInt(document.getElementById("goal-fat").value) || null,
    }, { merge: true });
  });
  const addNutriBtn = document.getElementById("add-nutri");
  if (addNutriBtn) addNutriBtn.addEventListener("click", async () => {
    const description = document.getElementById("nutri-desc").value.trim();
    if (!description) return;
    await addDoc(col("nutritionLog"), {
      date: nutritionDate, description,
      kcal: parseInt(document.getElementById("nutri-kcal").value) || 0,
      protein: parseInt(document.getElementById("nutri-protein").value) || 0,
      carbs: parseInt(document.getElementById("nutri-carbs").value) || 0,
      fat: parseInt(document.getElementById("nutri-fat").value) || 0,
    });
  });
  document.querySelectorAll("[data-del-nutri]").forEach((el) => {
    el.addEventListener("click", () => deleteDoc(doc(dbFS, "users", uid, "nutritionLog", el.dataset.delNutri)));
  });
  const nutriPrev = document.getElementById("nutri-prev");
  if (nutriPrev) nutriPrev.addEventListener("click", () => { nutritionDate = Grid.toISODate(Grid.addDays(new Date(nutritionDate + "T00:00:00"), -1)); navigate("nutrition"); });
  const nutriNext = document.getElementById("nutri-next");
  if (nutriNext) nutriNext.addEventListener("click", () => { nutritionDate = Grid.toISODate(Grid.addDays(new Date(nutritionDate + "T00:00:00"), 1)); navigate("nutrition"); });
  const nutriToday = document.getElementById("nutri-today");
  if (nutriToday) nutriToday.addEventListener("click", () => { nutritionDate = todayStr(); navigate("nutrition"); });

  // Budget mensuel (charges fixes)
  document.querySelectorAll("[data-charge-amount]").forEach((el) => {
    el.addEventListener("change", async () => {
      const id = el.dataset.chargeAmount;
      const cur = state.budgetCharges[id] || {};
      await setDoc(doc(dbFS, "users", uid, "settings", "budgetCharges"), { [id]: { ...cur, amount: parseFloat(el.value) || 0 } }, { merge: true });
    });
  });
  document.querySelectorAll("[data-charge-freq]").forEach((el) => {
    el.addEventListener("change", async () => {
      const id = el.dataset.chargeFreq;
      const cur = state.budgetCharges[id] || {};
      await setDoc(doc(dbFS, "users", uid, "settings", "budgetCharges"), { [id]: { ...cur, freq: el.value } }, { merge: true });
    });
  });

  // Courses & Budget
  const saveBudgetBtn = document.getElementById("save-budget");
  if (saveBudgetBtn) saveBudgetBtn.addEventListener("click", async () => {
    const val = parseFloat(document.getElementById("budget-limit").value) || 0;
    await setDoc(doc(dbFS, "users", uid, "settings", "budget"), { monthlyLimit: val }, { merge: true });
  });
  const addCourseBtn = document.getElementById("add-course");
  if (addCourseBtn) addCourseBtn.addEventListener("click", async () => {
    const name = document.getElementById("course-name").value.trim();
    if (!name) return;
    const priceVal = document.getElementById("course-price").value;
    await addDoc(col("courses"), { name, price: priceVal ? parseFloat(priceVal) : null, bought: false, addedAt: new Date().toISOString() });
  });
  document.querySelectorAll("[data-course-bought]").forEach((el) => {
    el.addEventListener("change", () => updateDoc(doc(dbFS, "users", uid, "courses", el.dataset.courseBought), { bought: el.checked }));
  });
  document.querySelectorAll("[data-del-course]").forEach((el) => {
    el.addEventListener("click", () => deleteDoc(doc(dbFS, "users", uid, "courses", el.dataset.delCourse)));
  });
  const exportCoursesBtn = document.getElementById("export-courses");
  if (exportCoursesBtn) exportCoursesBtn.addEventListener("click", () => {
    csvDownload("liste-courses.csv", [["Article","Prix","Acheté"], ...state.courses.map((c) => [c.name, c.price ?? "", c.bought ? "oui" : "non"])]);
  });
  const addDepenseBtn = document.getElementById("add-depense");
  if (addDepenseBtn) addDepenseBtn.addEventListener("click", async () => {
    const amount = parseFloat(document.getElementById("dep-amount").value);
    const date = document.getElementById("dep-date").value;
    if (isNaN(amount) || !date) return;
    await addDoc(col("depenses"), { date, amount, label: document.getElementById("dep-label").value.trim() });
  });
  document.querySelectorAll("[data-del-depense]").forEach((el) => {
    el.addEventListener("click", () => deleteDoc(doc(dbFS, "users", uid, "depenses", el.dataset.delDepense)));
  });
  const exportDepensesBtn = document.getElementById("export-depenses");
  if (exportDepensesBtn) exportDepensesBtn.addEventListener("click", () => {
    csvDownload("depenses-courses.csv", [["Date","Montant","Label"], ...state.depenses.map((d) => [d.date, d.amount, d.label || ""])]);
  });

  // Sport & Santé
  const addMesureBtn = document.getElementById("add-mesure");
  if (addMesureBtn) addMesureBtn.addEventListener("click", async () => {
    const value = parseFloat(document.getElementById("mesure-value").value);
    const date = document.getElementById("mesure-date").value;
    const type = document.getElementById("mesure-type").value;
    if (isNaN(value) || !date) return;
    await addDoc(col("mesures"), { type, date, value, label: document.getElementById("mesure-label").value.trim() });
  });
  document.querySelectorAll("[data-mesure-view]").forEach((el) => {
    el.addEventListener("click", () => { mesureFilter = el.dataset.mesureView; navigate("sport"); });
  });
  document.querySelectorAll("[data-del-mesure]").forEach((el) => {
    el.addEventListener("click", () => deleteDoc(doc(dbFS, "users", uid, "mesures", el.dataset.delMesure)));
  });

  // Développement perso
  const addDpBtn = document.getElementById("add-dp");
  if (addDpBtn) addDpBtn.addEventListener("click", async () => {
    const title = document.getElementById("dp-title").value.trim();
    if (!title) return;
    await addDoc(col("devPerso"), {
      title, type: document.getElementById("dp-type").value, status: document.getElementById("dp-status").value,
      notes: document.getElementById("dp-notes").value.trim(), rating: null, created: new Date().toISOString(),
    });
  });
  const dpFilterEl = document.getElementById("dp-filter");
  if (dpFilterEl) dpFilterEl.addEventListener("change", () => { devPersoFilter = dpFilterEl.value; navigate("devperso"); });
  document.querySelectorAll("[data-dp-status]").forEach((el) => {
    el.addEventListener("change", () => updateDoc(doc(dbFS, "users", uid, "devPerso", el.dataset.dpStatus), { status: el.value }));
  });
  document.querySelectorAll("[data-dp-rating]").forEach((el) => {
    el.addEventListener("change", () => updateDoc(doc(dbFS, "users", uid, "devPerso", el.dataset.dpRating), { rating: el.value ? parseInt(el.value) : null }));
  });
  document.querySelectorAll("[data-del-dp]").forEach((el) => {
    el.addEventListener("click", () => deleteDoc(doc(dbFS, "users", uid, "devPerso", el.dataset.delDp)));
  });

  // Actus
  const addActuBtn = document.getElementById("add-actu");
  if (addActuBtn) addActuBtn.addEventListener("click", async () => {
    const person = document.getElementById("actu-person").value.trim();
    const title = document.getElementById("actu-title").value.trim();
    const date = document.getElementById("actu-date").value;
    if (!person || !title || !date) return;
    await addDoc(col("actus"), { person, title, date, recurringYearly: document.getElementById("actu-recurring").checked });
  });
  document.querySelectorAll("[data-del-actu]").forEach((el) => {
    el.addEventListener("click", () => deleteDoc(doc(dbFS, "users", uid, "actus", el.dataset.delActu)));
  });

  // Loisirs
  const copyLoisirsBtn = document.getElementById("copy-loisirs-link");
  if (copyLoisirsBtn) copyLoisirsBtn.addEventListener("click", () => {
    const input = document.getElementById("loisirs-link");
    input.select();
    navigator.clipboard?.writeText(input.value);
    copyLoisirsBtn.textContent = "Copié !";
    setTimeout(() => { copyLoisirsBtn.textContent = "Copier"; }, 1500);
  });
  const addLoisirBtn = document.getElementById("add-loisir");
  if (addLoisirBtn) addLoisirBtn.addEventListener("click", async () => {
    const title = document.getElementById("loisir-title").value.trim();
    const date = document.getElementById("loisir-date").value;
    if (!title || !date) return;
    await addDoc(loisirsCol(), { title, date, category: document.getElementById("loisir-cat").value, author: "Joas" });
  });
  document.querySelectorAll("[data-del-loisir]").forEach((el) => {
    el.addEventListener("click", () => deleteDoc(doc(dbFS, "loisirs", uid, "events", el.dataset.delLoisir)));
  });

  document.querySelectorAll("[data-decline-req]").forEach((el) => {
    el.addEventListener("click", async () => {
      const r = state.bookingRequests.find((x) => x.id === el.dataset.declineReq);
      if (!r) return;
      await updateDoc(doc(dbFS, "bookingPublic", uid, "requests", r.id), { status: "declined" });
      await deleteDoc(doc(dbFS, "bookingPublic", uid, "slotsTaken", r.slotId)).catch(() => {});
    });
  });
}
