// ===================== GRID.JS =====================
// Moteur de grille horaire — repris et adapté du projet "agenda du conseil"
// (fonctions génériques uniquement, tout ce qui était spécifique membres/
// admin a été retiré). Sert aux vues Jour / 3 jours / Semaine / 2 semaines.

export const WEEKDAYS_FULL = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
export const WEEKDAYS_SHORT = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];
export const MONTHS_FULL = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];

export const GRID_CONFIG = {
  dayStartHour: 7,
  dayEndHour: 22,
  slotMinutes: 30,
};

export const LAYOUT = {
  timeColWidth: 60,
  dayColWidth: 130,
  monthRowHeight: 20,
  dayRowHeight: 36,
  eventsRowHeight: 20,
  hourRowHeight: 24,
};

const HOUR_ROW_OFFSET = 4;

export function toISODate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function minutesToLabel(totalMinutes) {
  const h = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
  const m = String(totalMinutes % 60).padStart(2, "0");
  return `${h}:${m}`;
}

function timeToMinutes(label) {
  const [h, m] = label.split(":").map(Number);
  return h * 60 + m;
}

export function buildTimeSlots() {
  const slots = [];
  for (let t = GRID_CONFIG.dayStartHour * 60; t < GRID_CONFIG.dayEndHour * 60; t += GRID_CONFIG.slotMinutes) {
    slots.push(minutesToLabel(t));
  }
  return slots;
}

// startDate: Date ; count: nombre de jours consécutifs à afficher (pas de
// filtrage week-end pour un usage perso — contrairement au conseil).
export function buildDateList(startDate, count) {
  const dates = [];
  let cursor = new Date(startDate);
  cursor.setHours(0, 0, 0, 0);
  for (let i = 0; i < count; i++) {
    dates.push(addDays(cursor, i));
  }
  return dates;
}

export function slotKey(dateISO, timeLabel) {
  return `${dateISO}|${timeLabel}`;
}

export function gridTemplateColumns(dateCount) {
  return `${LAYOUT.timeColWidth}px repeat(${dateCount}, minmax(90px, 1fr))`;
}

export function gridTemplateRows(timeCount) {
  return `${LAYOUT.monthRowHeight}px ${LAYOUT.dayRowHeight}px ${LAYOUT.eventsRowHeight}px repeat(${timeCount}, ${LAYOUT.hourRowHeight}px)`;
}

// ---------------------- Événements ----------------------
// event: { id, title, allDay, date, endDate?, time?, endTime?, category? }

export function allDayEventsForDate(events, dateISO) {
  return (events || []).filter((e) => {
    if (!e.allDay) return false;
    const end = e.endDate || e.date;
    return dateISO >= e.date && dateISO <= end;
  });
}

export function timedEventsAt(events, dateISO, timeLabel) {
  const minutes = timeToMinutes(timeLabel);
  const slotEnd = minutes + GRID_CONFIG.slotMinutes;
  return (events || []).filter((e) => {
    if (e.allDay || e.date !== dateISO) return false;
    const start = timeToMinutes(e.time || "00:00");
    const end = timeToMinutes(e.endTime || e.time || "23:59");
    return start < slotEnd && end > minutes;
  });
}

export function buildMonthGroups(dates) {
  const groups = [];
  dates.forEach((date, i) => {
    const label = `${MONTHS_FULL[date.getMonth()]} ${date.getFullYear()}`;
    const last = groups[groups.length - 1];
    if (last && last.label === label) {
      last.span += 1;
    } else {
      groups.push({ label, startIndex: i, span: 1 });
    }
  });
  return groups;
}

function buildDayHeaderCell(date) {
  const dow = date.getDay();
  const isWeekend = dow === 0 || dow === 6;
  const isToday = toISODate(date) === toISODate(new Date());
  const el = document.createElement("div");
  el.className = "cell day-header" + (isWeekend ? " weekend" : "") + (isToday ? " today" : "");
  el.dataset.dateIso = toISODate(date);
  el.innerHTML = `<span class="weekday">${WEEKDAYS_SHORT[dow]}</span><span class="day-number">${date.getDate()}</span>`;
  return el;
}

export function renderGridHeaders(container, dates, events, onDayClick) {
  const corner = document.createElement("div");
  corner.className = "cell corner";
  corner.style.gridRow = "1 / 4";
  corner.style.gridColumn = "1";
  container.appendChild(corner);

  buildMonthGroups(dates).forEach((group) => {
    const el = document.createElement("div");
    el.className = "cell month-band";
    el.textContent = group.label;
    el.style.gridRow = "1";
    el.style.gridColumn = `${group.startIndex + 2} / span ${group.span}`;
    container.appendChild(el);
  });

  dates.forEach((date, i) => {
    const el = buildDayHeaderCell(date);
    el.style.gridRow = "2";
    el.style.gridColumn = String(i + 2);
    if (onDayClick) {
      el.style.cursor = "pointer";
      el.addEventListener("click", () => onDayClick(toISODate(date)));
    }
    container.appendChild(el);
  });

  dates.forEach((date, i) => {
    const dateISO = toISODate(date);
    const dayEvents = allDayEventsForDate(events, dateISO);
    const el = document.createElement("div");
    el.className = "cell events-band" + (dayEvents.length ? " has-events" : "");
    el.style.gridRow = "3";
    el.style.gridColumn = String(i + 2);
    el.dataset.dateIso = dateISO;
    if (dayEvents.length) {
      el.textContent = dayEvents.map((e) => e.title).join(" · ");
      el.title = dayEvents.map((e) => e.title).join("\n");
    }
    container.appendChild(el);
  });
}

export function renderHourRows(container, dates, times, events, cellFactory) {
  times.forEach((timeLabel, r) => {
    const isHourMark = timeLabel.endsWith(":00");
    const labelEl = document.createElement("div");
    labelEl.className = "cell time-label" + (isHourMark ? " hour-mark" : "");
    labelEl.textContent = isHourMark ? timeLabel : "";
    labelEl.style.gridRow = String(r + HOUR_ROW_OFFSET);
    labelEl.style.gridColumn = "1";
    container.appendChild(labelEl);

    dates.forEach((date, i) => {
      const dateISO = toISODate(date);
      const cellEvents = timedEventsAt(events, dateISO, timeLabel);
      const cell = document.createElement("div");
      cell.className = "cell slot" + (isHourMark ? " hour-mark" : "") + (cellEvents.length ? " has-event" : "");
      cell.style.gridRow = String(r + HOUR_ROW_OFFSET);
      cell.style.gridColumn = String(i + 2);
      if (cellEvents.length) {
        cell.title = cellEvents.map((e) => `${e.time || ""} ${e.title}`).join("\n");
      }
      if (cellFactory) cellFactory(cell, { date, dateISO, timeLabel, events: cellEvents });
      container.appendChild(cell);
    });
  });
}
