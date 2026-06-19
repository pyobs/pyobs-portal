/**
 * visplot.js  –  Interactive observability plots for the task editor.
 *
 * Exports one function: initVisibilityPlots(siteConfig)
 * Call it once after the page loads, passing the site config object.
 *
 * The module hooks into the TargetEditor's RA/Dec fields and fetches
 * /api/observability/?ra=&dec= whenever valid coordinates are present.
 * It renders two Plotly charts:
 *   - Left  (#vis-plot-night): elevation + moon distance for the next dark night
 *   - Right (#vis-plot-year) : elevation at mid-dark-time over ~1 year
 */

"use strict";

// ---------------------------------------------------------------------------
// Layout constants (dark-theme aware)
// ---------------------------------------------------------------------------
const PLOT_BG = "rgba(0,0,0,0)";
const PAPER_BG = "rgba(0,0,0,0)";
const GRID_COLOR = "rgba(255,255,255,0.08)";
const TEXT_COLOR = "#adb5bd";
const ELEVATION_COLOR = "#4da6ff";
const MOON_COLOR = "#f0c060";
const YEAR_COLOR = "#66d9a0";
const TWILIGHT_FILL = "rgba(10,30,80,0.45)";
const HORIZON_COLOR = "rgba(255,80,80,0.5)";

const NOW_LINE = (x) => ({
  type: "line",
  x0: x, x1: x,
  y0: 0, y1: 1,
  yref: "paper",
  line: { color: "rgba(255,255,255,0.35)", width: 1, dash: "dot" },
});

const BASE_LAYOUT = {
  paper_bgcolor: PAPER_BG,
  plot_bgcolor: PLOT_BG,
  margin: { l: 44, r: 44, t: 26, b: 36 },
  font: { color: TEXT_COLOR, size: 11, family: "system-ui,sans-serif" },
  xaxis: { gridcolor: GRID_COLOR, zerolinecolor: GRID_COLOR },
  yaxis: { gridcolor: GRID_COLOR, zerolinecolor: GRID_COLOR },
  hoverlabel: { bgcolor: "white", bordercolor: "white", font: { color: "black" } },
};

// Airmass axis: ticks at fixed elevation degrees, labelled with airmass = 1/sin(el).
const AIRMASS_TICK_VALS = [20, 40, 60, 80];
const AIRMASS_TICK_TEXT = AIRMASS_TICK_VALS.map(
  (el) => (1 / Math.sin((Math.PI / 180) * el)).toFixed(2)
);
const AIRMASS_YAXIS = {
  overlaying: "y",
  side: "right",
  range: [0, 90],
  tickvals: AIRMASS_TICK_VALS,
  ticktext: AIRMASS_TICK_TEXT,
  title: { text: "Airmass", font: { size: 10 }, standoff: 5 },
  showgrid: false,
  zeroline: false,
};

const PLOTLY_CONFIG = {
  displayModeBar: false,
  responsive: true,
};

// ---------------------------------------------------------------------------
// Night plot
// ---------------------------------------------------------------------------
function renderNightPlot(el, data) {
  const times = data.times_utc.map((t) => new Date(t));

  const t0 = new Date(data.twilight_evening_utc);
  const t1 = new Date(data.twilight_morning_utc);

  // Annotate moon-target distance at ~4 evenly spaced positions where moon is above horizon
  const annotations = [];
  const step = Math.floor(times.length / 5);
  for (let i = 1; i <= 4; i++) {
    const idx = Math.min(i * step, times.length - 1);
    const moonEl = data.moon_elevation_deg[idx];
    if (moonEl < 0) continue;
    annotations.push({
      x: times[idx],
      y: moonEl,
      text: `${Math.round(data.moon_distance_deg[idx])}°`,
      showarrow: false,
      yshift: 10,
      font: { color: MOON_COLOR, size: 9 },
      bgcolor: "rgba(0,0,0,0.45)",
    });
  }

  const traces = [
    {
      x: [t0, t0, t1, t1],
      y: [0, 90, 90, 0],
      fill: "toself",
      fillcolor: TWILIGHT_FILL,
      line: { width: 0 },
      mode: "lines",
      hoverinfo: "skip",
      showlegend: false,
      name: "dark time",
    },
    {
      x: [times[0], times[times.length - 1]],
      y: [0, 0],
      mode: "lines",
      line: { color: HORIZON_COLOR, width: 1, dash: "dot" },
      hoverinfo: "skip",
      showlegend: false,
    },
    {
      x: times,
      y: data.elevation_deg,
      mode: "lines",
      line: { color: ELEVATION_COLOR, width: 2 },
      name: "Elevation",
      hovertemplate: "%{x|%H:%M UTC}<br>El: %{y:.1f}°<extra></extra>",
    },
    {
      x: times,
      y: data.moon_elevation_deg,
      mode: "lines",
      line: { color: MOON_COLOR, width: 1.5, dash: "dash" },
      name: "Moon elev.",
      hovertemplate: "%{x|%H:%M UTC}<br>Moon: %{y:.1f}°<extra></extra>",
    },
    // Invisible anchor trace — forces Plotly to render the yaxis2 airmass axis
    {
      x: [times[0], times[times.length - 1]],
      y: [0, 90],
      yaxis: "y2",
      mode: "lines",
      line: { width: 0 },
      hoverinfo: "skip",
      showlegend: false,
    },
  ];

  const layout = {
    ...BASE_LAYOUT,
    title: { text: "Tonight", font: { color: TEXT_COLOR, size: 13 } },
    xaxis: {
      ...BASE_LAYOUT.xaxis,
      type: "date",
      tickformat: "%H:%M",
      title: { text: "UTC", font: { size: 10 } },
    },
    yaxis: {
      ...BASE_LAYOUT.yaxis,
      title: { text: "Elevation (°)", font: { size: 10 }, standoff: 5 },
      range: [0, 90],
    },
    yaxis2: { ...BASE_LAYOUT.yaxis, ...AIRMASS_YAXIS },
    legend: {
      orientation: "h",
      y: -0.22,
      x: 0.5,
      xanchor: "center",
      font: { size: 10 },
    },
    annotations,
    shapes: (() => {
      const now = new Date();
      return now >= times[0] && now <= times[times.length - 1] ? [NOW_LINE(now.toISOString())] : [];
    })(),
    hovermode: "x unified",
  };

  Plotly.react(el, traces, layout, PLOTLY_CONFIG);
}

// ---------------------------------------------------------------------------
// Year plot
// ---------------------------------------------------------------------------
function renderYearPlot(el, data) {
  const dates = data.dates.map((d) => new Date(d));
  const elevs = data.elevation_deg;
  const year = dates[0].getFullYear();

  const traces = [
    // Horizon reference
    {
      x: [dates[0], dates[dates.length - 1]],
      y: [0, 0],
      mode: "lines",
      line: { color: HORIZON_COLOR, width: 1, dash: "dot" },
      hoverinfo: "skip",
      showlegend: false,
    },
    {
      x: dates,
      y: elevs,
      mode: "lines",
      line: { color: YEAR_COLOR, width: 2 },
      name: "El. at mid-night",
      connectgaps: false,
      hovertemplate: "%{x|%b %d}<br>El: %{y:.1f}°<extra></extra>",
    },
    // Invisible anchor trace — forces Plotly to render the yaxis2 airmass axis
    {
      x: [dates[0], dates[dates.length - 1]],
      y: [0, 90],
      yaxis: "y2",
      mode: "lines",
      line: { width: 0 },
      hoverinfo: "skip",
      showlegend: false,
    },
  ];

  const layout = {
    ...BASE_LAYOUT,
    title: { text: "Year-round (mid-dark)", font: { color: TEXT_COLOR, size: 13 } },
    xaxis: {
      ...BASE_LAYOUT.xaxis,
      type: "date",
      tickformat: "%b",
      dtick: "M1",
      tick0: `${year}-01-01`,
      range: [`${year}-01-01`, `${year}-12-31`],
      title: { text: "", font: { size: 10 } },
    },
    yaxis: {
      ...BASE_LAYOUT.yaxis,
      title: { text: "Elevation (°)", font: { size: 10 }, standoff: 5 },
      range: [0, 90],
    },
    yaxis2: { ...BASE_LAYOUT.yaxis, ...AIRMASS_YAXIS },
    shapes: [NOW_LINE(new Date().toISOString())],
    showlegend: false,
    hovermode: "x unified",
  };

  Plotly.react(el, traces, layout, PLOTLY_CONFIG);
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * @param {object} siteConfig  – the object returned by /api/site/
 *                               { latitude, longitude, elevation, ... }
 */
function initVisibilityPlots(siteConfig) {
  const container = document.getElementById("visibility-container");
  const loadingEl = document.getElementById("vis-loading");
  const msgEl = document.getElementById("vis-message");
  const nightEl = document.getElementById("vis-plot-night");
  const yearEl = document.getElementById("vis-plot-year");

  if (!container || !nightEl || !yearEl) return;

  // If site coords are missing show a static message and stop
  if (siteConfig.latitude == null || siteConfig.longitude == null) {
    container.classList.remove("d-none");
    msgEl.classList.remove("d-none");
    msgEl.textContent =
      "Observatory site coordinates not configured — set SITE_LATITUDE and SITE_LONGITUDE to enable visibility plots.";
    nightEl.parentElement.classList.add("d-none");
    yearEl.parentElement.classList.add("d-none");
    return;
  }

  let _fetchTimer = null;
  let _lastRa = null;
  let _lastDec = null;
  let _rendered = false;

  function showLoading() {
    container.classList.remove("d-none");
    loadingEl.classList.remove("d-none");
    nightEl.style.opacity = "0.4";
    yearEl.style.opacity = "0.4";
  }

  function showPlots() {
    loadingEl.classList.add("d-none");
    container.classList.remove("d-none");
    msgEl.classList.add("d-none");
    nightEl.style.opacity = "1";
    yearEl.style.opacity = "1";
    requestAnimationFrame(() => {
      Plotly.relayout(nightEl, { autosize: true });
      Plotly.relayout(yearEl, { autosize: true });
    });
  }

  function showError(msg) {
    container.classList.remove("d-none");
    msgEl.classList.remove("d-none");
    msgEl.textContent = `Visibility: ${msg}`;
  }

  async function fetchAndRender(ra, dec) {
    if (ra === _lastRa && dec === _lastDec && _rendered) return;
    showLoading();
    try {
      const resp = await apiRequest(
        `observability/?ra=${encodeURIComponent(ra)}&dec=${encodeURIComponent(dec)}`
      );
      if (resp.error) {
        showError(resp.error);
        return;
      }
      renderNightPlot(nightEl, resp.night);
      renderYearPlot(yearEl, resp.year);
      showPlots();
      _lastRa = ra;
      _lastDec = dec;
      _rendered = true;
    } catch (e) {
      showError(e.message || "Failed to load observability data.");
    }
  }

  /**
   * Called by TargetEditor whenever RA/Dec change.
   * raDeg and decDeg must be numeric degrees (null to hide plots).
   */
  window.updateVisibilityPlots = function (raDeg, decDeg) {
    clearTimeout(_fetchTimer);
    if (raDeg == null || decDeg == null || isNaN(raDeg) || isNaN(decDeg)) {
      // Hide while coordinates are incomplete
      container.classList.add("d-none");
      _rendered = false;
      return;
    }
    // Debounce 600ms so we don't fire on every keystroke
    _fetchTimer = setTimeout(() => fetchAndRender(raDeg, decDeg), 600);
    // Also refresh the merit plot when the target changes
    if (typeof window.refreshMeritPlot === "function") window.refreshMeritPlot();
  };
}
