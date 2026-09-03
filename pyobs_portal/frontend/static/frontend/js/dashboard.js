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

const POLL_INTERVAL_MS = 30000;

// Module-scope timeline state so re-polls can update items in place
// instead of destroying and recreating the vis.Timeline component.
let timeline = null;
let timelineItems = null;
let timelineGroups = null;
let timelineWindow = null;
let timelineGroupCount = 0;
let lastProjectsKey = null;
let pollInFlight = false;

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

function hideTimeline() {
  const el = document.getElementById("schedule-timeline");
  if (el) el.style.display = "none";
}

/** Local noon-to-noon window at the observatory location. Falls back to UTC noon-to-noon if no location. */
function nightWindow(siteInfo) {
  const now = new Date();

  // If no site info, use fixed noon-to-noon UTC
  if (!siteInfo || siteInfo.latitude == null || siteInfo.longitude == null) {
    const start = new Date(now);
    start.setUTCHours(12, 0, 0, 0);
    if (now.getUTCHours() < 12) start.setUTCDate(start.getUTCDate() - 1);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
    return { start, end };
  }

  // Calculate local solar noon-to-noon window at observatory location
  const lat = siteInfo.latitude;
  const lon = siteInfo.longitude;

  // Get today's solar noon
  let times = SunCalc.getTimes(now, lat, lon);
  let solarNoon = times.solarNoon;

  // If we're before today's solar noon, use yesterday's solar noon as window start
  if (now < solarNoon) {
    const yesterday = new Date(now.getTime() - 24 * 3600e3);
    times = SunCalc.getTimes(yesterday, lat, lon);
    solarNoon = times.solarNoon;
  }

  // Tomorrow's solar noon as window end
  const tomorrow = new Date(now.getTime() + 24 * 3600e3);
  times = SunCalc.getTimes(tomorrow, lat, lon);
  const nextSolarNoon = times.solarNoon;

  return { start: solarNoon, end: nextSolarNoon };
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

function projectGroupContent(p) {
  return `<span title="${p.name}" style="max-width:120px;overflow:hidden;text-overflow:ellipsis;display:inline-block">${p.name}</span>`;
}

function observationItem(obs, projectIdx, taskProject, taskName) {
  const proj = taskProject[obs.task] ?? "__other__";
  const color = PROJECT_COLORS[(projectIdx[proj] ?? 0) % PROJECT_COLORS.length];
  const name = taskName[obs.task] || obs.task;
  const start = new Date(obs.start);
  const end   = new Date(obs.end);
  const isCompleted = obs.state === "completed";
  const stateClass = obs.state === "in_progress" ? "obs-running"
                   : isCompleted                 ? "obs-completed"
                   : "";
  return {
    id: `obs-${obs.id}`,
    group: proj,
    content: name,
    start,
    end,
    title: `<b>${name}</b><br>${start.toUTCString()}<br>→ ${end.toUTCString()}`,
    taskId: obs.task,
    style: isCompleted
      ? "background-color:#4a4e55;border-color:#6c757d;color:#adb5bd;"
      : `background-color:${color.bg};border-color:${color.border};color:#fff;`,
    className: ["obs-item", stateClass].filter(Boolean).join(" "),
  };
}

function renderTimeline(projects, tasks, siteInfo, observations) {
  try {
    const hasSite = siteInfo.latitude != null && siteInfo.longitude != null;

    if (!hasSite && !observations.length) {
      setTimelineStatus("No pending observations. Set SITE_LATITUDE and SITE_LONGITUDE to enable day/night display.");
      hideTimeline();
      return;
    }

    const projectIdx = {};
    projects.forEach((p, i) => (projectIdx[p.code] = i));
    const taskProject = {}, taskName = {};
    tasks.forEach((t) => { taskProject[t.id] = t.project; taskName[t.id] = t.name || t.id; });

    const { start: windowStart, end: windowEnd } = nightWindow(siteInfo);

    const activeProjectCodes = new Set(
      observations.map((obs) => taskProject[obs.task]).filter(Boolean)
    );
    const activeProjects = projects.filter((p) => activeProjectCodes.has(p.code));

    const desiredGroups = activeProjects.map((p) => ({
      id: p.code,
      content: projectGroupContent(p),
    }));

    const desiredItems = [];
    if (hasSite) {
      sunBackgrounds(siteInfo.latitude, siteInfo.longitude, windowStart, windowEnd)
        .forEach((bg) => desiredItems.push(bg));
    }
    observations.forEach((obs) =>
      desiredItems.push(observationItem(obs, projectIdx, taskProject, taskName))
    );

    if (desiredItems.some((it) => it.group === "__other__")) {
      desiredGroups.push({ id: "__other__", content: "Other" });
    }

    const height = Math.max(80, Math.min(320, desiredGroups.length * 38 + 44));

    if (!timeline) {
      // #schedule-timeline is display:none until this first render -- vis.Timeline
      // measures its container at construction time to lay out its panels, and gets
      // it wrong (extra space above the item rows) if that container has zero size.
      // Make it visible first so construction sees real dimensions.
      showTimeline();
      timelineItems = new vis.DataSet(desiredItems);
      timelineGroups = new vis.DataSet(desiredGroups);
      timeline = new vis.Timeline(
        document.getElementById("schedule-timeline"),
        timelineItems,
        timelineGroups,
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
          // Render axis labels in UTC regardless of the viewer's browser timezone,
          // matching the tooltip's toUTCString() above.
          moment: (date) => vis.moment(date).utcOffset(0),
        }
      );
      timelineWindow = { start: windowStart, end: windowEnd };
      timelineGroupCount = desiredGroups.length;
      timeline.on("click", (props) => {
        if (props.what !== "item") return;
        const id = props.item && typeof props.item === "object" ? props.item.id : props.item;
        const item = timelineItems.get(id);
        if (!item || !item.taskId) return;
        window.location.href = `/tasks/${encodeURIComponent(item.taskId)}/`;
      });
    } else {
      const desiredIds = new Set(desiredItems.map((it) => it.id));
      desiredItems.forEach((it) => timelineItems.update(it));
      timelineItems.getIds()
        .filter((id) => !desiredIds.has(id))
        .forEach((id) => timelineItems.remove(id));

      const desiredGroupIds = new Set(desiredGroups.map((g) => g.id));
      desiredGroups.forEach((g) => timelineGroups.update(g));
      timelineGroups.getIds()
        .filter((id) => !desiredGroupIds.has(id))
        .forEach((id) => timelineGroups.remove(id));

      const windowChanged =
        timelineWindow.start.getTime() !== windowStart.getTime() ||
        timelineWindow.end.getTime() !== windowEnd.getTime();
      if (windowChanged) {
        timeline.setOptions({
          start: windowStart,
          end: windowEnd,
          min: new Date(windowStart.getTime() - 24 * 3600e3),
          max: new Date(windowEnd.getTime()   + 24 * 3600e3),
        });
        timelineWindow = { start: windowStart, end: windowEnd };
      }

      if (desiredGroups.length !== timelineGroupCount) {
        timeline.setOptions({ height: `${height}px` });
        timelineGroupCount = desiredGroups.length;
      }
    }

    setTimelineStatus("", false);
    showTimeline();
  } catch (e) {
    console.error("Timeline render error:", e);
    setTimelineStatus(`Failed to render timeline: ${e.message}`, true);
  }
}

function renderProjects(projects) {
  const key = JSON.stringify(projects.map((p) => [p.code, p.name, p.priority]));
  if (key === lastProjectsKey) return;
  lastProjectsKey = key;

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
}

async function loadDashboard() {
  try {
    // Sequential fetches to avoid session-lock contention on the dev server
    const projects  = await apiList("projects/");
    const tasks     = await apiList("tasks/");
    const siteInfo  = await apiRequest("site/");
    const pending   = await apiList("observations/", { state: "pending", end_after: new Date().toISOString() });
    const running   = await apiList("observations/", { state: "in_progress" });
    const completed = await apiList("observations/", { state: "completed" });

    // Stats
    document.getElementById("stat-projects").textContent  = projects.length;
    document.getElementById("stat-tasks").textContent     = tasks.length;
    document.getElementById("stat-pending").textContent   = pending.length;
    document.getElementById("stat-completed").textContent = completed.length;

    // Projects table
    renderProjects(projects);

    // Timeline
    renderTimeline(projects, tasks, siteInfo, [...running, ...pending, ...completed]);

  } catch (e) {
    console.error("Dashboard load error:", e);
    lastProjectsKey = null;
    const tbody = document.getElementById("projects-table");
    if (tbody) tbody.innerHTML = `<tr><td colspan="3" class="text-danger">${e.message}</td></tr>`;
    setTimelineStatus(`Failed to load: ${e.message}`, true);
  }
}

async function pollDashboard() {
  if (pollInFlight) return;
  pollInFlight = true;
  try {
    await loadDashboard();
  } finally {
    pollInFlight = false;
  }
}

loadDashboard();
setInterval(pollDashboard, POLL_INTERVAL_MS);
