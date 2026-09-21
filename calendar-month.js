// ===================== CALENDAR-MONTH.JS =====================
// Vues "mini-calendrier" pour Mois / 3 mois / Année — pas d'heures, juste
// des cases jour numérotées avec un point si des événements ce jour-là.
// Complète grid.js (qui gère lui la grille horaire jour/semaine).

import { toISODate, WEEKDAYS_SHORT, MONTHS_FULL, allDayEventsForDate } from "./grid.js";

function eventsOnDate(events, dateISO) {
  return (events || []).filter((e) => {
    const end = e.endDate || e.date;
    return dateISO >= e.date && dateISO <= end;
  });
}

// Construit un mini-calendrier pour un mois donné (year, month 0-11).
export function buildMiniMonth(year, month, events, onDayClick) {
  const wrap = document.createElement("div");
  wrap.className = "mini-month";

  const title = document.createElement("div");
  title.className = "mini-month-title";
  title.textContent = `${MONTHS_FULL[month]} ${year}`;
  wrap.appendChild(title);

  const weekdaysRow = document.createElement("div");
  weekdaysRow.className = "mini-month-weekdays";
  // Semaine commence le lundi
  const order = [1, 2, 3, 4, 5, 6, 0];
  order.forEach((d) => {
    const el = document.createElement("span");
    el.textContent = WEEKDAYS_SHORT[d];
    weekdaysRow.appendChild(el);
  });
  wrap.appendChild(weekdaysRow);

  const daysGrid = document.createElement("div");
  daysGrid.className = "mini-month-days";

  const firstOfMonth = new Date(year, month, 1);
  const startOffset = (firstOfMonth.getDay() + 6) % 7; // 0 = lundi
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayISO = toISODate(new Date());

  for (let i = 0; i < startOffset; i++) {
    const filler = document.createElement("div");
    filler.className = "mini-day filler";
    daysGrid.appendChild(filler);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day);
    const dateISO = toISODate(date);
    const dayEvents = eventsOnDate(events, dateISO);
    const cell = document.createElement("div");
    cell.className = "mini-day" + (dateISO === todayISO ? " today" : "") + (dayEvents.length ? " has-events" : "");
    cell.innerHTML = `<span class="mini-day-num">${day}</span>` + (dayEvents.length ? `<span class="mini-day-dot" title="${dayEvents.map(e=>e.title).join(', ').replace(/"/g,'&quot;')}"></span>` : "");
    if (onDayClick) {
      cell.style.cursor = "pointer";
      cell.addEventListener("click", () => onDayClick(dateISO));
    }
    daysGrid.appendChild(cell);
  }

  wrap.appendChild(daysGrid);
  return wrap;
}

// months: nombre de mois à afficher (1, 3 ou 12), à partir de startDate.
export function renderMonthsView(container, startDate, monthsCount, events, onDayClick) {
  container.innerHTML = "";
  container.className = "months-view" + (monthsCount > 1 ? " multi" : "");
  for (let i = 0; i < monthsCount; i++) {
    const d = new Date(startDate.getFullYear(), startDate.getMonth() + i, 1);
    container.appendChild(buildMiniMonth(d.getFullYear(), d.getMonth(), events, onDayClick));
  }
}
