// ===================== LOISIRS.JS =====================
// Page PUBLIQUE et collaborative (loisirs.html?u=<uid>) : les amis de Joas
// voient son calendrier sport/voyages et peuvent y ajouter des propositions,
// sans compte. Seul le propriétaire (dans l'app privée) peut supprimer.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, addDoc, onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const fbApp = initializeApp(firebaseConfig);
const dbFS = getFirestore(fbApp);

const params = new URLSearchParams(location.search);
const ownerUid = params.get("u");
const root = document.getElementById("loisirs-root");

function fmtDate(iso) {
  return new Date(iso + "T00:00:00").toLocaleDateString("fr-FR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
}

if (!ownerUid) {
  root.innerHTML = `<p class="err">Lien invalide — il manque l'identifiant (?u=...).</p>`;
} else {
  init();
}

const CATEGORIES = { sport: "🏃 Sport", voyage: "✈️ Voyage", autre: "🎉 Autre" };

function init() {
  const eventsCol = collection(dbFS, "loisirs", ownerUid, "events");
  onSnapshot(eventsCol, (snap) => {
    const events = [];
    snap.forEach((d) => events.push({ id: d.id, ...d.data() }));
    events.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    render(events, eventsCol);
  });
}

function render(events, eventsCol) {
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = events.filter((e) => (e.date || "") >= today);
  const past = events.filter((e) => (e.date || "") < today);

  root.innerHTML = `
    <div class="card">
      <h3>Proposer un événement</h3>
      <form id="add-form">
        <input type="text" id="ev-title" placeholder="Quoi ? (ex: Rando dans les Fagnes)" required>
        <div class="row2">
          <input type="date" id="ev-date" required>
          <select id="ev-cat">
            ${Object.entries(CATEGORIES).map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}
          </select>
        </div>
        <input type="text" id="ev-author" placeholder="Ton prénom" required>
        <button type="submit" class="btn">Ajouter</button>
      </form>
      <p id="add-status" class="hint"></p>
    </div>
    <h3>À venir</h3>
    ${upcoming.length ? upcoming.map(eventCard).join("") : '<p class="hint">Rien de prévu pour l\\'instant — sois le premier à proposer un truc !</p>'}
    ${past.length ? `<h3>Passés</h3>${past.slice(-8).reverse().map(eventCard).join("")}` : ""}
  `;

  document.getElementById("add-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const status = document.getElementById("add-status");
    status.textContent = "Ajout...";
    await addDoc(eventsCol, {
      title: document.getElementById("ev-title").value.trim(),
      date: document.getElementById("ev-date").value,
      category: document.getElementById("ev-cat").value,
      author: document.getElementById("ev-author").value.trim(),
      createdAt: new Date().toISOString(),
    });
    status.textContent = "Ajouté !";
    e.target.reset();
  });
}

function eventCard(e) {
  return `
    <div class="event-card">
      <div class="event-date">${fmtDate(e.date)}</div>
      <div class="event-title">${CATEGORIES[e.category] || "🎉"} ${e.title}</div>
      ${e.author ? `<div class="event-author">proposé par ${e.author}</div>` : ""}
    </div>`;
}
