const PROJECT_COLORS = [
  { bg: "#4e79a7", border: "#3a5f8a" },
  { bg: "#f28e2b", border: "#c97520" },
  { bg: "#59a14f", border: "#457d3c" },
  { bg: "#76b7b2", border: "#5a9490" },
  { bg: "#e15759", border: "#b83e40" },
  { bg: "#b07aa1", border: "#8d5f80" },
  { bg: "#edc948", border: "#c9a820" },
  { bg: "#ff9da7", border: "#d97c88" },
];

/** Noon-to-noon UTC window centred on the current night. */
function nightWindow() {
  const now = new Date();
  const start = new Date(now);
  start.setUTCHours(12, 0, 0, 0);
  if (now.getUTCHours() < 12) start.setUTCDate(start.getUTCDate() - 1);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

/** Return vis-timeline background items representing day/night bands. */
function sunBackgrounds(lat, lon, windowStart, windowEnd) {
  const ok = (t) => t instanceof Date && !isNaN(t) ? t : null;
  const evening = SunCalc.getTimes(windowStart, lat, lon);
  const morning = SunCalc.getTimes(windowEnd, lat, lon);

  const segments = [
    [windowStart,                  ok(evening.sunset),      "timeline-day"],
    [ok(evening.sunset),           ok(evening.dusk),        "timeline-civil"],
    [ok(evening.dusk),             ok(evening.nauticalDusk),"timeline-nautical"],
    [ok(evening.nauticalDusk),     ok(evening.night),       "timeline-astro"],
    [ok(evening.night),            ok(morning.nightEnd),    "timeline-night"],
    [ok(morning.nightEnd),         ok(morning.nauticalDawn),"timeline-astro"],
    [ok(morning.nauticalDawn),     ok(morning.dawn),        "timeline-nautical"],
    [ok(morning.dawn),             ok(morning.sunrise),     "timeline-civil"],
    [ok(morning.sunrise),          windowEnd,               "timeline-day"],
  ];

  const items = [];
  segments.forEach(([s, e], i) => {
    const cls = segments[i][2];
    if (!s || !e || s >= windowEnd || e <= windowStart) return;
    items.push({
      id: `sun-${i}`,
      start: s < windowStart ? windowStart : s,
      end:   e > windowEnd   ? windowEnd   : e,
      type: "background",
      className: cls,
      editable: false,
      selectable: false,
    });
  });
  return items;
}

async function loadTimeline(projects, tasks, siteInfo) {
  const container = document.getElementById("schedule-timeline");
  const msg = document.getElementById("timeline-msg");

  const [pending, running] = await Promise.all([
    apiList("observations/", { state: "pending" }),
    apiList("observations/", { state: "running" }),
  ]);
  const observations = [...running, ...pending];

  if (!observations.length && (!siteInfo.latitude || !siteInfo.longitude)) {
    container.classList.add("d-none");
    msg.textContent = "No pending observations and no site coordinates configured.";
    msg.classList.remove("d-none");
    return;
  }

  // Lookup maps
  const projectIdx = {};
  projects.forEach((p, i) => (projectIdx[p.code] = i));
  const taskProject = {};
  const taskName = {};
  tasks.forEach((t) => {
    taskProject[t.id] = t.project;
    taskName[t.id] = t.name || t.id;
  });

  const { start: windowStart, end: windowEnd } = nightWindow();

  const groups = new vis.DataSet(
    projects.map((p) => ({
      id: p.code,
      content: `<span class="text-truncate" style="max-width:120px;display:inline-block" title="${p.name}">${p.name}</span>`,
    }))
  );

  const items = new vis.DataSet();

  if (siteInfo.latitude != null && siteInfo.longitude != null) {
    sunBackgrounds(siteInfo.latitude, siteInfo.longitude, windowStart, windowEnd)
      .forEach((bg) => items.add(bg));
  }

  observations.forEach((obs) => {
    const proj = taskProject[obs.task];
    if (proj == null) return;
    const color = PROJECT_COLORS[(projectIdx[proj] ?? 0) % PROJECT_COLORS.length];
    const name = taskName[obs.task] || obs.task;
    const start = new Date(obs.start);
    const end = new Date(obs.end);
    items.add({
      id: `obs-${obs.id}`,
      group: proj,
      content: name,
      start,
      end,
      title: `<b>${name}</b><br>${start.toUTCString()}<br>→ ${end.toUTCString()}`,
      style: `background-color:${color.bg};border-color:${color.border};color:#fff;`,
      className: obs.state === "running" ? "obs-running" : "",
    });
  });

  const height = Math.max(100, Math.min(320, projects.length * 38 + 44));

  new vis.Timeline(container, items, groups, {
    start: windowStart,
    end: windowEnd,
    min: new Date(windowStart.getTime() - 24 * 3600e3),
    max: new Date(windowEnd.getTime()   + 24 * 3600e3),
    stack: false,
    showCurrentTime: true,
    moveable: true,
    zoomable: true,
    selectable: false,
    height: `${height}px`,
    margin: { item: { horizontal: 0, vertical: 2 } },
    tooltip: { followMouse: true, overflowMethod: "cap" },
  });
}

async function loadDashboard() {
  try {
    const [projects, tasks, siteInfo] = await Promise.all([
      apiList("projects/"),
      apiList("tasks/"),
      apiRequest("site/"),
    ]);

    document.getElementById("stat-projects").textContent = projects.length;
    document.getElementById("stat-tasks").textContent = tasks.length;

    const tbody = document.getElementById("projects-table");
    tbody.innerHTML = "";
    if (!projects.length) {
      tbody.innerHTML = '<tr><td colspan="3" class="text-muted">No projects.</td></tr>';
    } else {
      projects.forEach((p) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td>${p.code}</td><td>${p.name}</td><td>${p.priority}</td>`;
        tbody.appendChild(tr);
      });
    }

    await loadTimeline(projects, tasks, siteInfo);
  } catch (e) {
    document.getElementById("projects-table").innerHTML =
      `<tr><td colspan="3" class="text-danger">${e.message}</td></tr>`;
  }

  try {
    const [pending, completed] = await Promise.all([
      apiList("observations/", { state: "pending" }),
      apiList("observations/", { state: "completed" }),
    ]);
    document.getElementById("stat-pending").textContent = pending.length;
    document.getElementById("stat-completed").textContent = completed.length;
  } catch (_) {
    /* best-effort */
  }
}

loadDashboard();
