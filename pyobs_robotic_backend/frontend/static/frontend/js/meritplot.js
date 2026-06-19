/**
 * meritplot.js  –  Merit / constraint plot for the task editor.
 *
 * Exports one function: initMeritPlot(getPayload, siteConfig)
 *
 *   getPayload  – zero-argument function returning the current task payload
 *                 (same object buildPayload() returns in taskeditor.js).
 *   siteConfig  – the object returned by /api/site/.
 *
 * The plot is rendered in #merit-plot-container and is refreshed whenever
 * refreshMeritPlot() is called.  taskeditor.js calls window.refreshMeritPlot()
 * after any constraint / merit change and when the target changes.
 */

"use strict";

// ---------------------------------------------------------------------------
// Colour palette (matches visplot.js dark-theme style)
// ---------------------------------------------------------------------------
const MP_PAPER_BG   = "rgba(0,0,0,0)";
const MP_PLOT_BG    = "rgba(0,0,0,0)";
const MP_GRID       = "rgba(255,255,255,0.08)";
const MP_TEXT       = "#adb5bd";
const MP_TWILIGHT   = "rgba(10,30,80,0.45)";
const MP_COMBINED   = "#4da6ff";
const MP_BLOCKED    = "rgba(220,53,69,0.18)";  // faint red band when combined==0

// Per-series colours for individual merits (cycling)
const MP_MERIT_COLORS = [
  "#66d9a0", "#f0c060", "#c084fc", "#fb923c",
  "#38bdf8", "#f472b6", "#a3e635", "#e879f9",
];

// Constraints get a distinct style: dashed, slightly muted
const MP_CONSTRAINT_COLORS = [
  "#94a3b8", "#cbd5e1", "#64748b", "#475569",
];

const MP_BASE_LAYOUT = {
  paper_bgcolor: MP_PAPER_BG,
  plot_bgcolor:  MP_PLOT_BG,
  margin: { l: 50, r: 12, t: 32, b: 50 },
  font:   { color: MP_TEXT, size: 11, family: "system-ui,sans-serif" },
  xaxis:  { gridcolor: MP_GRID, zerolinecolor: MP_GRID },
  yaxis:  { gridcolor: MP_GRID, zerolinecolor: MP_GRID },
  hoverlabel: { bgcolor: "white", bordercolor: "white", font: { color: "black" } },
};

const MP_CONFIG = { displayModeBar: false, responsive: true };

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function renderMeritPlot(el, data) {
  const times  = data.times_utc.map((t) => new Date(t));
  const t0     = new Date(data.twilight_evening_utc);
  const t1     = new Date(data.twilight_morning_utc);
  const n      = times.length;

  const traces = [];

  // Twilight shading
  traces.push({
    x: [t0, t0, t1, t1],
    y: [0, 1, 1, 0],
    fill: "toself",
    fillcolor: MP_TWILIGHT,
    line: { width: 0 },
    mode: "lines",
    hoverinfo: "skip",
    showlegend: false,
  });

  // "Blocked" regions: faint red where combined == 0
  // Build a continuous 0/1 mask and fill it
  const blockedY = data.combined.map((v) => (v === 0 ? 1 : null));
  traces.push({
    x: times,
    y: blockedY,
    fill: "tozeroy",
    fillcolor: MP_BLOCKED,
    line: { width: 0 },
    mode: "lines",
    hoverinfo: "skip",
    showlegend: false,
    connectgaps: false,
  });

  // Individual constraint traces (binary 0/1 shown as step lines)
  data.constraints.forEach((c, i) => {
    const color = MP_CONSTRAINT_COLORS[i % MP_CONSTRAINT_COLORS.length];
    const label = c.error ? `${c.name} ⚠ ${c.error}` : c.name;
    traces.push({
      x: times,
      y: c.values.map((v) => (v ? 1.0 : 0.0)),
      mode: "lines",
      line: { color, width: 1.5, dash: "dot", shape: "hv" },
      name: label,
      legendgroup: "constraints",
      legendgrouptitle: i === 0 ? { text: "Constraints" } : undefined,
      hovertemplate: `%{x|%H:%M UTC}<br>${c.name}: %{y}<extra></extra>`,
    });
  });

  // Individual merit traces
  data.merits.forEach((m, i) => {
    const color = MP_MERIT_COLORS[i % MP_MERIT_COLORS.length];
    const label = m.error ? `${m.name} ⚠ ${m.error}` : m.name;
    traces.push({
      x: times,
      y: m.values,
      mode: "lines",
      line: { color, width: 1.5, dash: "dash" },
      name: label,
      legendgroup: "merits",
      legendgrouptitle: i === 0 ? { text: "Merits" } : undefined,
      hovertemplate: `%{x|%H:%M UTC}<br>${m.name}: %{y:.4f}<extra></extra>`,
    });
  });

  // Combined product (bold, solid)
  traces.push({
    x: times,
    y: data.combined,
    mode: "lines",
    line: { color: MP_COMBINED, width: 2.5 },
    name: "Combined",
    legendgroup: "combined",
    hovertemplate: "%{x|%H:%M UTC}<br>Combined: %{y:.4f}<extra></extra>",
  });

  const layout = {
    ...MP_BASE_LAYOUT,
    title: { text: "Merit (next 24 h)", font: { color: MP_TEXT, size: 13 } },
    xaxis: {
      ...MP_BASE_LAYOUT.xaxis,
      type: "date",
      tickformat: "%b %d %H:%M",
      title: { text: "UTC", font: { size: 10 } },
    },
    yaxis: {
      ...MP_BASE_LAYOUT.yaxis,
      title: { text: "Merit / pass", font: { size: 10 }, standoff: 5 },
      range: [-0.05, 1.1],
    },
    legend: {
      orientation: "h",
      y: -0.28,
      x: 0.5,
      xanchor: "center",
      font: { size: 10 },
      groupclick: "toggleitem",
    },
    shapes: [{
      type: "line",
      x0: new Date().toISOString(), x1: new Date().toISOString(),
      y0: 0, y1: 1,
      yref: "paper",
      line: { color: "rgba(255,255,255,0.35)", width: 1, dash: "dot" },
    }],
    hovermode: "x unified",
  };

  Plotly.react(el, traces, layout, MP_CONFIG);
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * @param {function} getPayload   – returns the current task payload object
 * @param {object}   siteConfig   – { latitude, longitude, elevation, … }
 */
function initMeritPlot(getPayload, siteConfig) {
  const container = document.getElementById("merit-plot-container");
  const plotEl    = document.getElementById("merit-plot");
  const loadingEl = document.getElementById("merit-plot-loading");
  const msgEl     = document.getElementById("merit-plot-message");

  if (!container || !plotEl) return;

  if (siteConfig.latitude == null || siteConfig.longitude == null) {
    container.classList.remove("d-none");
    if (msgEl) {
      msgEl.classList.remove("d-none");
      msgEl.textContent =
        "Observatory coordinates not configured — set SITE_LATITUDE / SITE_LONGITUDE to enable merit plot.";
    }
    return;
  }

  let _debounceTimer = null;
  let _currentRequest = null;   // AbortController for in-flight fetch

  function showLoading() {
    if (loadingEl) loadingEl.classList.remove("d-none");
    if (msgEl)     msgEl.classList.add("d-none");
    plotEl.style.opacity = "0.3";
  }

  function showPlot() {
    if (loadingEl) loadingEl.classList.add("d-none");
    if (msgEl)     msgEl.classList.add("d-none");
    plotEl.style.opacity = "1";
    requestAnimationFrame(() => Plotly.relayout(plotEl, { autosize: true }));
  }

  function showError(msg) {
    if (loadingEl) loadingEl.classList.add("d-none");
    if (msgEl) {
      msgEl.classList.remove("d-none");
      msgEl.textContent = `Merit plot: ${msg}`;
    }
    plotEl.style.opacity = "0.3";
  }

  async function fetchAndRender() {
    if (_currentRequest) _currentRequest.abort();
    _currentRequest = new AbortController();

    container.classList.remove("d-none");
    showLoading();

    const payload = getPayload();

    try {
      const data = await apiRequest("merit_plot/", {
        method: "POST",
        body: payload,
        signal: _currentRequest.signal,
      });

      if (data.error) {
        showError(data.error);
        return;
      }

      renderMeritPlot(plotEl, data);
      showPlot();
    } catch (e) {
      if (e.name === "AbortError") return;   // superseded request, ignore
      showError(e.message || "Failed to load merit data.");
    }
  }

  /**
   * Exported as window.refreshMeritPlot so taskeditor.js can call it
   * whenever constraints, merits, or target change.
   * Debounced 800 ms so rapid edits don't hammer the server.
   */
  window.refreshMeritPlot = function () {
    clearTimeout(_debounceTimer);
    _debounceTimer = setTimeout(fetchAndRender, 800);
  };

  // Initial render
  window.refreshMeritPlot();
}
