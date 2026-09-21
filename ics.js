// ===================== ICS.JS =====================
// Parseur .ics minimal (repris du projet "agenda du conseil"), adapté ici
// pour produire directement des événements du Life OS (title/date/time/
// endTime/allDay) au lieu de créneaux "pas dispo".

const DAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

function unfoldLines(text) {
  const rawLines = text.split(/\r\n|\n|\r/);
  const lines = [];
  for (const line of rawLines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }
  return lines;
}

function parseLineProp(line) {
  const colonIdx = line.indexOf(":");
  if (colonIdx === -1) return null;
  const left = line.slice(0, colonIdx);
  const value = line.slice(colonIdx + 1);
  const [name, ...paramParts] = left.split(";");
  const params = {};
  paramParts.forEach((p) => {
    const [k, v] = p.split("=");
    if (k) params[k] = v;
  });
  return { name: name.toUpperCase(), params, value };
}

function parseICSDate(value) {
  if (!value) return null;
  const isDateOnly = /^\d{8}$/.test(value);
  if (isDateOnly) {
    const y = Number(value.slice(0, 4));
    const m = Number(value.slice(4, 6));
    const d = Number(value.slice(6, 8));
    return { allDay: true, date: new Date(y, m - 1, d) };
  }
  const utc = value.endsWith("Z");
  const clean = value.replace("Z", "");
  const y = Number(clean.slice(0, 4));
  const mo = Number(clean.slice(4, 6));
  const d = Number(clean.slice(6, 8));
  const h = Number(clean.slice(9, 11) || 0);
  const mi = Number(clean.slice(11, 13) || 0);
  const s = Number(clean.slice(13, 15) || 0);
  const date = utc ? new Date(Date.UTC(y, mo - 1, d, h, mi, s)) : new Date(y, mo - 1, d, h, mi, s);
  return { allDay: false, date };
}

function parseRRule(value) {
  const out = {};
  value.split(";").forEach((part) => {
    const [k, v] = part.split("=");
    if (k) out[k] = v;
  });
  return out;
}

export function parseICS(text) {
  const lines = unfoldLines(text);
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { cur = { exdates: [] }; continue; }
    if (line === "END:VEVENT") { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const prop = parseLineProp(line);
    if (!prop) continue;
    switch (prop.name) {
      case "SUMMARY": cur.summary = prop.value; break;
      case "DTSTART": cur.dtstart = parseICSDate(prop.value); break;
      case "DTEND": cur.dtend = parseICSDate(prop.value); break;
      case "RRULE": cur.rrule = parseRRule(prop.value); break;
      case "EXDATE":
        prop.value.split(",").forEach((v) => {
          const parsed = parseICSDate(v);
          if (parsed) cur.exdates.push(parsed);
        });
        break;
      default: break;
    }
  }
  return events;
}

function toISODateLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function timeLabel(d) {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// Convertit un fichier .ics en une liste d'événements Life OS, en développant
// les récurrences hebdomadaires simples sur `weeksAhead` semaines à partir
// d'aujourd'hui (largement suffisant pour un horaire de cours). Les
// événements ponctuels sont repris tels quels, sans limite de date.
export function icsToLifeOSEvents(icsText, weeksAhead = 26) {
  const events = parseICS(icsText);
  const out = [];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const horizon = new Date(today); horizon.setDate(horizon.getDate() + weeksAhead * 7);

  events.forEach((ev) => {
    if (!ev.dtstart) return;
    const title = ev.summary || "Événement importé";

    if (ev.dtstart.allDay) {
      out.push({
        title,
        allDay: true,
        date: toISODateLocal(ev.dtstart.date),
        endDate: ev.dtend ? toISODateLocal(new Date(ev.dtend.date.getTime() - 86400000)) : toISODateLocal(ev.dtstart.date),
        category: "importé",
      });
      return;
    }

    const startTime = timeLabel(ev.dtstart.date);
    const endTime = ev.dtend ? timeLabel(ev.dtend.date) : null;
    const exISOs = new Set((ev.exdates || []).map((e) => toISODateLocal(e.date)));

    if (ev.rrule && ev.rrule.FREQ === "WEEKLY") {
      const allowedDays = ev.rrule.BYDAY ? ev.rrule.BYDAY.split(",") : [DAY_CODES[ev.dtstart.date.getDay()]];
      const until = ev.rrule.UNTIL ? parseICSDate(ev.rrule.UNTIL).date : horizon;
      let cursor = new Date(ev.dtstart.date); cursor.setHours(0, 0, 0, 0);
      let guard = 0;
      while (cursor <= until && cursor <= horizon && guard < 400) {
        const iso = toISODateLocal(cursor);
        if (allowedDays.includes(DAY_CODES[cursor.getDay()]) && !exISOs.has(iso) && cursor >= today) {
          out.push({ title, allDay: false, date: iso, time: startTime, endTime, category: "importé" });
        }
        cursor.setDate(cursor.getDate() + 1);
        guard++;
      }
    } else {
      const iso = toISODateLocal(ev.dtstart.date);
      if (!exISOs.has(iso)) {
        out.push({ title, allDay: false, date: iso, time: startTime, endTime, category: "importé" });
      }
    }
  });

  return out;
}
