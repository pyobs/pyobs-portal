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

const BASE_LAYOUT = {
  paper_bgcolor: PAPER_BG,
  plot_bgcolor: PLOT_BG,
  margin: { l: 50, r: 50, t: 36, b: 44 },
  font: { color: TEXT_COLOR, size: 11, family: "system-ui,sans-serif" },
  xaxis: { gridcolor: GRID_COLOR, zerolinecolor: GRID_COLOR },
  yaxis: { gridcolor: GRID_COLOR, zerolinecolor: GRID_COLOR },
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

  // Twilight band: shade the full range as dark time
  const t0 = new Date(data.twilight_evening_utc);
  const t1 = new Date(data.twilight_morning_utc);

  const traces = [
    // Dark-time background via a filled area at full height
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
    // Horizon line
    {
      x: [times[0], times[times.length - 1]],
      y: [0, 0],
      mode: "lines",
      line: { color: HORIZON_COLOR, width: 1, dash: "dot" },
      hoverinfo: "skip",
      showlegend: false,
    },
    // Elevation
    {
      x: times,
      y: data.elevation_deg,
      mode: "lines",
      line: { color: ELEVATION_COLOR, width: 2 },
      name: "Elevation",
      yaxis: "y",
      hovertemplate: "%{x|%H:%M UTC}<br>El: %{y:.1f}°<extra></extra>",
    },
    // Moon distance (right y-axis)
    {
      x: times,
      y: data.moon_distance_deg,
      mode: "lines",
      line: { color: MOON_COLOR, width: 1.5, dash: "dash" },
      name: "Moon dist.",
      yaxis: "y2",
      hovertemplate: "%{x|%H:%M UTC}<br>Moon: %{y:.1f}°<extra></extra>",
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
    yaxis2: {
      ...BASE_LAYOUT.yaxis,
      title: { text: "Moon dist. (°)", font: { size: 10 }, standoff: 5 },
      range: [0, 180],
      overlaying: "y",
      side: "right",
      showgrid: false,
    },
    legend: {
      orientation: "h",
      y: -0.18,
      x: 0.5,
      xanchor: "center",
      font: { size: 10 },
    },
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
  ];

  const layout = {
    ...BASE_LAYOUT,
    title: { text: "Year-round (mid-dark)", font: { color: TEXT_COLOR, size: 13 } },
    xaxis: {
      ...BASE_LAYOUT.xaxis,
      type: "date",
      tickformat: "%b",
      dtick: "M1",
      title: { text: "", font: { size: 10 } },
    },
    yaxis: {
      ...BASE_LAYOUT.yaxis,
      title: { text: "Elevation (°)", font: { size: 10 }, standoff: 5 },
      range: [0, 90],
    },
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
    nightEl.style.opacity = "0.4";
    yearEl.style.opacity = "0.4";
  }

  function showPlots() {
    container.classList.remove("d-none");
    msgEl.classList.add("d-none");
    nightEl.style.opacity = "1";
    yearEl.style.opacity = "1";
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
  };
}
