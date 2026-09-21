// ===================== APP.JS =====================
// Cœur du Life OS : auth Firebase, Firestore (temps réel), navigation,
// et rendu de chaque module. Un seul fichier pour rester simple à suivre.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut,
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

/* ---------- ETAT LOCAL (miroir de Firestore, tenu à jour par onSnapshot) ---------- */
const state = {
  habits: [], habitLog: {}, jobs: [], skills: [], projects: [], events: [], notes: [],
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
  };
  return map[code] || "Erreur : " + code;
}

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

  const unsubLog = onSnapshot(col("habitLog"), (snap) => {
    const log = {};
    snap.forEach((d) => { log[d.id] = d.data(); });
    state.habitLog = log;
    rerenderIfCurrent();
  });
  unsubscribers.push(unsubLog);
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
    ${state.habits.map((h) => `
      <div class="row"><input type="checkbox" class="check" data-habit="${h.id}" ${doneToday[h.id] ? "checked" : ""}><span>${h.icon} ${h.name}</span></div>
    `).join("") || '<div class="empty">Aucune habitude — va dans Routine & Habitudes.</div>'}
  </div>
  <div class="section-title">Prochains événements</div>
  <div class="card">
    ${upcoming.length ? upcoming.map((e) => `
      <div class="row"><span class="pill">${fmtDate(e.date)} ${e.time || ""}</span><span>${e.title}</span>${e.category ? `<span class="pill">${e.category}</span>` : ""}</div>
    `).join("") : '<div class="empty">Rien de prévu.</div>'}
  </div>`;
};

/* ---------- HABITUDES ---------- */
pages.habitudes = () => {
  const t = todayStr();
  const doneToday = state.habitLog[t] || {};
  return `
  <h2>✅ Routine & Habitudes</h2>
  <div class="card">
    <div class="flex-between" style="margin-bottom:10px"><strong>${fmtDate(t)}</strong></div>
    ${state.habits.map((h) => `
      <div class="row">
        <input type="checkbox" class="check" data-habit="${h.id}" ${doneToday[h.id] ? "checked" : ""}>
        <span style="flex:1">${h.icon} ${h.name}</span>
        <span class="streak">🔥 ${computeStreak(h.id)}j</span>
        <button class="close-x" data-del-habit="${h.id}">✕</button>
      </div>`).join("") || '<div class="empty">Aucune habitude — ajoute la première.</div>'}
  </div>
  <div class="card">
    <div class="form-inline">
      <input type="text" id="new-habit-icon" placeholder="emoji" style="max-width:80px">
      <input type="text" id="new-habit-name" placeholder="nom de l'habitude">
      <button class="btn" id="add-habit">Ajouter</button>
    </div>
  </div>`;
};
function computeStreak(habitId) {
  let streak = 0, d = new Date();
  while (true) {
    const key = Grid.toISODate(d);
    if (state.habitLog[key] && state.habitLog[key][habitId]) { streak++; d.setDate(d.getDate() - 1); }
    else break;
  }
  return streak;
}

/* ---------- EMPLOI ---------- */
const JOB_STATUSES = [
  { v: "a-envoyer", l: "À envoyer" }, { v: "envoye", l: "Envoyé" }, { v: "relance", l: "Relancé" },
  { v: "entretien", l: "Entretien" }, { v: "refuse", l: "Refusé" }, { v: "accepte", l: "Accepté" },
];
pages.emploi = () => {
  const rows = [...state.jobs].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  return `
  <h2>💼 Recherche d'emploi</h2>
  <div class="card">
    <div class="form-inline">
      <input type="text" id="job-entreprise" placeholder="Entreprise">
      <input type="text" id="job-poste" placeholder="Poste">
      <input type="date" id="job-date" value="${todayStr()}">
      <select id="job-status">${JOB_STATUSES.map((s) => `<option value="${s.v}">${s.l}</option>`).join("")}</select>
      <button class="btn" id="add-job">Ajouter</button>
    </div>
  </div>
  <div class="card"><table><thead><tr><th>Entreprise</th><th>Poste</th><th>Date</th><th>Statut</th><th>Notes</th><th></th></tr></thead><tbody>
    ${rows.map((j) => `
      <tr>
        <td>${j.entreprise}</td><td>${j.poste}</td><td>${fmtDate(j.date)}</td>
        <td><select data-job-status="${j.id}">${JOB_STATUSES.map((s) => `<option value="${s.v}" ${s.v === j.status ? "selected" : ""}>${s.l}</option>`).join("")}</select></td>
        <td><input type="text" data-job-notes="${j.id}" value="${(j.notes || "").replace(/"/g, "&quot;")}"></td>
        <td><button class="close-x" data-del-job="${j.id}">✕</button></td>
      </tr>`).join("") || `<tr><td colspan="6" class="empty">Aucune candidature.</td></tr>`}
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
  </div>`;

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
  const addHabitBtn = document.getElementById("add-habit");
  if (addHabitBtn) addHabitBtn.addEventListener("click", async () => {
    const name = document.getElementById("new-habit-name").value.trim();
    const icon = document.getElementById("new-habit-icon").value.trim() || "⭐";
    if (!name) return;
    await addDoc(col("habits"), { name, icon });
  });

  // Emploi
  const addJobBtn = document.getElementById("add-job");
  if (addJobBtn) addJobBtn.addEventListener("click", async () => {
    const entreprise = document.getElementById("job-entreprise").value.trim();
    if (!entreprise) return;
    await addDoc(col("jobs"), {
      entreprise, poste: document.getElementById("job-poste").value.trim(),
      date: document.getElementById("job-date").value, status: document.getElementById("job-status").value, notes: "",
    });
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
}
