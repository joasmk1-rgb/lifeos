// ===================== BOOKING.JS =====================
// Page PUBLIQUE de réservation (booking.html?u=<uid>), sans authentification.
// Lit les règles de dispo + indispos + créneaux déjà pris (lecture publique
// autorisée par firestore.rules), calcule les créneaux libres, et permet à
// un visiteur d'en réserver un (statut "en attente" jusqu'à validation).

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, doc, getDocs, setDoc, addDoc,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const fbApp = initializeApp(firebaseConfig);
const dbFS = getFirestore(fbApp);

const params = new URLSearchParams(location.search);
const ownerUid = params.get("u");
const root = document.getElementById("booking-root");

const DAY_NAMES = ["Dimanche","Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi"];

function toISODate(d){const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,"0"),day=String(d.getDate()).padStart(2,"0");return `${y}-${m}-${day}`;}
function minutesToLabel(t){return `${String(Math.floor(t/60)).padStart(2,"0")}:${String(t%60).padStart(2,"0")}`;}
function labelToMinutes(l){const [h,m]=l.split(":").map(Number);return h*60+m;}
function fmtDate(iso){return new Date(iso+"T00:00:00").toLocaleDateString("fr-FR",{weekday:"long",day:"2-digit",month:"long"});}

if (!ownerUid) {
  root.innerHTML = `<p class="err">Lien invalide — il manque l'identifiant du propriétaire (?u=...).</p>`;
} else {
  init();
}

async function init() {
  root.innerHTML = `<p class="hint">Chargement des créneaux...</p>`;
  const [rulesSnap, blockedSnap, takenSnap] = await Promise.all([
    getDocs(collection(dbFS, "bookingPublic", ownerUid, "availabilityRules")),
    getDocs(collection(dbFS, "bookingPublic", ownerUid, "blockedSlots")),
    getDocs(collection(dbFS, "bookingPublic", ownerUid, "slotsTaken")),
  ]);
  const rules = []; rulesSnap.forEach((d) => rules.push(d.data()));
  const blocked = []; blockedSnap.forEach((d) => blocked.push(d.data()));
  const taken = new Set(); takenSnap.forEach((d) => taken.add(d.id));

  if (!rules.length) {
    root.innerHTML = `<p class="hint">Aucune disponibilité n'a encore été configurée. Redemande un lien plus tard.</p>`;
    return;
  }

  const days = buildAvailableSlots(rules, blocked, taken, 21); // 3 semaines
  renderSlotPicker(days);
}

function buildAvailableSlots(rules, blocked, taken, daysAhead) {
  const today = new Date(); today.setHours(0,0,0,0);
  const out = [];
  for (let i = 0; i < daysAhead; i++) {
    const date = new Date(today); date.setDate(date.getDate() + i);
    const dow = date.getDay();
    const iso = toISODate(date);
    const dayRules = rules.filter((r) => (r.days || []).includes(dow));
    if (!dayRules.length) continue;

    const dayBlocks = blocked.filter((b) => b.date === iso);
    const fullDayBlocked = dayBlocks.some((b) => !b.startTime && !b.endTime);
    if (fullDayBlocked) continue;

    const slots = [];
    dayRules.forEach((rule) => {
      const slotMin = rule.slotMinutes || 30;
      let t = labelToMinutes(rule.startTime);
      const end = labelToMinutes(rule.endTime);
      while (t + slotMin <= end) {
        const label = minutesToLabel(t);
        const slotId = `${iso}_${label}`;
        const overlapsBlock = dayBlocks.some((b) => {
          if (!b.startTime) return false;
          const bs = labelToMinutes(b.startTime), be = labelToMinutes(b.endTime || b.startTime);
          return t < be && t + slotMin > bs;
        });
        if (!taken.has(slotId) && !overlapsBlock) {
          slots.push({ time: label, endTime: minutesToLabel(t + slotMin), slotId });
        }
        t += slotMin;
      }
    });
    if (slots.length) out.push({ iso, slots });
  }
  return out;
}

function renderSlotPicker(days) {
  if (!days.length) {
    root.innerHTML = `<p class="hint">Aucun créneau disponible dans les 3 prochaines semaines.</p>`;
    return;
  }
  root.innerHTML = `
    <div id="day-list">
      ${days.map((d) => `
        <div class="day-block">
          <div class="day-title">${fmtDate(d.iso)}</div>
          <div class="slot-row">
            ${d.slots.map((s) => `<button class="slot-btn" data-slot="${s.slotId}" data-date="${d.iso}" data-time="${s.time}" data-endtime="${s.endTime}">${s.time}</button>`).join("")}
          </div>
        </div>
      `).join("")}
    </div>
    <div id="booking-form-wrap" class="hidden">
      <h3>Réserver le <span id="chosen-slot-label"></span></h3>
      <form id="booking-form">
        <input type="text" id="bk-name" placeholder="Ton nom" required>
        <input type="email" id="bk-email" placeholder="Ton email" required>
        <textarea id="bk-motif" placeholder="Motif du rendez-vous (optionnel)"></textarea>
        <button type="submit" class="btn">Envoyer la demande</button>
        <button type="button" id="bk-cancel" class="btn secondary">Annuler</button>
      </form>
      <p id="bk-status" class="hint"></p>
    </div>
  `;

  let chosen = null;
  document.querySelectorAll(".slot-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      chosen = { slotId: btn.dataset.slot, date: btn.dataset.date, time: btn.dataset.time, endTime: btn.dataset.endtime };
      document.getElementById("chosen-slot-label").textContent = `${fmtDate(chosen.date)} à ${chosen.time}`;
      document.getElementById("booking-form-wrap").classList.remove("hidden");
      document.getElementById("booking-form-wrap").scrollIntoView({ behavior: "smooth" });
    });
  });

  document.getElementById("bk-cancel").addEventListener("click", () => {
    document.getElementById("booking-form-wrap").classList.add("hidden");
  });

  document.getElementById("booking-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!chosen) return;
    const status = document.getElementById("bk-status");
    status.textContent = "Envoi...";
    try {
      // 1) réserve le créneau (échoue si quelqu'un vient de le prendre)
      await setDoc(doc(dbFS, "bookingPublic", ownerUid, "slotsTaken", chosen.slotId), {
        date: chosen.date, time: chosen.time, endTime: chosen.endTime, status: "pending",
      });
      // 2) enregistre les détails de la demande (lisible seulement par le propriétaire)
      await addDoc(collection(dbFS, "bookingPublic", ownerUid, "requests"), {
        slotId: chosen.slotId, date: chosen.date, time: chosen.time, endTime: chosen.endTime,
        name: document.getElementById("bk-name").value.trim(),
        email: document.getElementById("bk-email").value.trim(),
        motif: document.getElementById("bk-motif").value.trim(),
        status: "pending", createdAt: new Date().toISOString(),
      });
      root.innerHTML = `<p class="hint">✅ Demande envoyée pour le ${fmtDate(chosen.date)} à ${chosen.time}. Tu recevras une confirmation une fois validée.</p>`;
    } catch (err) {
      status.textContent = "Ce créneau vient d'être pris par quelqu'un d'autre — choisis-en un autre.";
      init();
    }
  });
}
