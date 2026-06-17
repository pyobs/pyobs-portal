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

function setTimelineStatus(text, isError) {
  const el = document.getElementById("timeline-status");
  if (!el) return;
  el.textContent = text;
  el.className = isError ? "small p-3 text-danger" : "text-muted small p-3";
  el.style.display = text ? "" : "none";
}

function showTimeline() {
  const el = document.getElementById("schedule-timeline");
  if (el) el.style.display = "";
}

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
  const ok = (t) => (t instanceof Date && !isNaN(t) ? t : null);
  const evening = SunCalc.getTimes(windowStart, lat, lon);
  const morning = SunCalc.getTimes(windowEnd, lat, lon);

  const segments = [
    [windowStart,               ok(evening.sunset),       "timeline-day"],
    [ok(evening.sunset),        ok(evening.dusk),         "timeline-civil"],
    [ok(evening.dusk),          ok(evening.nauticalDusk), "timeline-nautical"],
    [ok(evening.nauticalDusk),  ok(evening.night),        "timeline-astro"],
    [ok(evening.night),         ok(morning.nightEnd),     "timeline-night"],
    [ok(morning.nightEnd),      ok(morning.nauticalDawn), "timeline-astro"],
    [ok(morning.nauticalDawn),  ok(morning.dawn),         "timeline-nautical"],
    [ok(morning.dawn),          ok(morning.sunrise),      "timeline-civil"],
    [ok(morning.sunrise),       windowEnd,                "timeline-day"],
  ];

  return segments
    .filter(([s, e]) => s && e && s < windowEnd && e > windowStart)
    .map(([s, e, cls], i) => ({
      id: `sun-${i}`,
      start: s < windowStart ? windowStart : s,
      end:   e > windowEnd   ? windowEnd   : e,
      type: "background",
      className: cls,
      editable: false,
      selectable: false,
    }));
}

function renderTimeline(projects, tasks, siteInfo, observations) {
  try {
    const hasSite = siteInfo.latitude != null && siteInfo.longitude != null;

    if (!hasSite && !observations.length) {
      setTimelineStatus("No pending observations. Set SITE_LATITUDE and SITE_LONGITUDE to enable day/night display.");
      return;
    }

    const projectIdx = {};
    projects.forEach((p, i) => (projectIdx[p.code] = i));
    const taskProject = {}, taskName = {};
    tasks.forEach((t) => { taskProject[t.id] = t.project; taskName[t.id] = t.name || t.id; });

    const { start: windowStart, end: windowEnd } = nightWindow();

    const groups = new vis.DataSet(
      projects.map((p) => ({
        id: p.code,
        content: `<span title="${p.name}" style="max-width:120px;overflow:hidden;text-overflow:ellipsis;display:inline-block">${p.name}</span>`,
      }))
    );
    groups.add({ id: "__other__", content: "Other" });

    const items = new vis.DataSet();

    if (hasSite) {
      sunBackgrounds(siteInfo.latitude, siteInfo.longitude, windowStart, windowEnd)
        .forEach((bg) => items.add(bg));
    }

    observations.forEach((obs) => {
      const proj = taskProject[obs.task] ?? "__other__";
      const color = PROJECT_COLORS[(projectIdx[proj] ?? 0) % PROJECT_COLORS.length];
      const name = taskName[obs.task] || obs.task;
      const start = new Date(obs.start);
      const end   = new Date(obs.end);
      const isCompleted = obs.state === "completed";
      items.add({
        id: `obs-${obs.id}`,
        group: proj,
        content: name,
        start,
        end,
        title: `<b>${name}</b><br>${start.toUTCString()}<br>→ ${end.toUTCString()}`,
        style: isCompleted
          ? "background-color:#4a4e55;border-color:#6c757d;color:#adb5bd;"
          : `background-color:${color.bg};border-color:${color.border};color:#fff;`,
        className: obs.state === "running" ? "obs-running"
                 : isCompleted            ? "obs-completed"
                 : "",
      });
    });

    if (!items.get().some((it) => it.group === "__other__")) {
      groups.remove("__other__");
    }

    const height = Math.max(80, Math.min(320, groups.length * 38 + 44));

    setTimelineStatus("", false);
    showTimeline();

    new vis.Timeline(
      document.getElementById("schedule-timeline"),
      items,
      groups,
      {
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
      }
    );
  } catch (e) {
    console.error("Timeline render error:", e);
    setTimelineStatus(`Failed to render timeline: ${e.message}`, true);
  }
}

async function loadDashboard() {
  try {
    // Sequential fetches to avoid session-lock contention on the dev server
    const projects  = await apiList("projects/");
    const tasks     = await apiList("tasks/");
    const siteInfo  = await apiRequest("site/");
    const pending   = await apiList("observations/", { state: "pending" });
    const running   = await apiList("observations/", { state: "running" });
    const completed = await apiList("observations/", { state: "completed" });

    // Stats
    document.getElementById("stat-projects").textContent  = projects.length;
    document.getElementById("stat-tasks").textContent     = tasks.length;
    document.getElementById("stat-pending").textContent   = pending.length;
    document.getElementById("stat-completed").textContent = completed.length;

    // Projects table
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

    // Timeline
    renderTimeline(projects, tasks, siteInfo, [...running, ...pending, ...completed]);

  } catch (e) {
    console.error("Dashboard load error:", e);
    const tbody = document.getElementById("projects-table");
    if (tbody) tbody.innerHTML = `<tr><td colspan="3" class="text-danger">${e.message}</td></tr>`;
    setTimelineStatus(`Failed to load: ${e.message}`, true);
  }
}

loadDashboard();
