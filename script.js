'use strict';

/* ── Config ── */
const API_KEY  = '2e686320cc5f0f03edbaedf541412c18';
const BASE_URL = 'https://api.openweathermap.org/data/2.5/weather';
const FORE_URL = 'https://api.openweathermap.org/data/2.5/forecast';

/* ── State ── */
let recentSearches = JSON.parse(localStorage.getItem('castaway_recents') || '[]');
let forecastChart  = null;
let forecastData   = null;
let lastCity       = '';
let clockInterval  = null;
let lastTimezone   = 0;
let lastDt         = 0;

/* ── DOM refs ── */
const cityInput     = document.getElementById('cityInput');
const searchBtn     = document.getElementById('searchBtn');
const validationMsg = document.getElementById('validationMsg');
const loaderWrap    = document.getElementById('loaderWrap');
const errorCard     = document.getElementById('errorCard');
const weatherContent= document.getElementById('weatherContent');
const emptyState    = document.getElementById('emptyState');
const recentsPanel  = document.getElementById('recentsPanel');
const recentsChips  = document.getElementById('recentsChips');
const themeToggle   = document.getElementById('themeToggle');
const offlineBanner = document.getElementById('offlineBanner');
const bgCanvas      = document.getElementById('bg-canvas');
const ctx           = bgCanvas.getContext('2d');
const errorRetryBtn = document.getElementById('errorRetryBtn');

/* ────────────────────────────────
   THEME
──────────────────────────────── */
themeToggle.addEventListener('click', () => {
  document.body.classList.toggle('dark');
  document.body.classList.toggle('light');
  localStorage.setItem('castaway_theme', document.body.classList.contains('dark') ? 'dark' : 'light');
  if (forecastChart) updateChartColors();
});
const savedTheme = localStorage.getItem('castaway_theme') || 'dark';
document.body.classList.remove('dark','light');
document.body.classList.add(savedTheme);

/* ────────────────────────────────
   OFFLINE DETECTION
──────────────────────────────── */
function checkOnline() { offlineBanner.classList.toggle('visible', !navigator.onLine); }
window.addEventListener('online',  checkOnline);
window.addEventListener('offline', checkOnline);
checkOnline();

/* ────────────────────────────────
   BACKGROUND CANVAS
──────────────────────────────── */
const WX_BG = ['wx-clear-day','wx-clear-night','wx-cloudy','wx-rain','wx-snow','wx-storm','wx-fog','wx-hot'];
let waveColor = 'rgba(91,184,212,0.06)';
let dotColor  = 'rgba(91,184,212,0.035)';
let waveOffset= 0;

function applyDynamicBackground(data) {
  const code = data.weather[0].id, icon = data.weather[0].icon, temp = data.main.temp;
  document.body.classList.remove(...WX_BG);
  let cls = '';
  if (temp >= 35)            cls = 'wx-hot';
  else if (code < 300)       cls = 'wx-storm';
  else if (code < 600)       cls = 'wx-rain';
  else if (code < 700)       cls = 'wx-snow';
  else if (code < 800)       cls = 'wx-fog';
  else if (code === 800)     cls = icon.endsWith('d') ? 'wx-clear-day' : 'wx-clear-night';
  else                       cls = 'wx-cloudy';
  if (cls) document.body.classList.add(cls);
  const palettes = {
    'wx-clear-day':  ['rgba(91,184,212,0.07)','rgba(91,184,212,0.04)'],
    'wx-clear-night':['rgba(120,150,220,0.06)','rgba(120,150,220,0.03)'],
    'wx-cloudy':     ['rgba(154,175,196,0.06)','rgba(154,175,196,0.03)'],
    'wx-rain':       ['rgba(74,144,212,0.08)','rgba(74,144,212,0.04)'],
    'wx-snow':       ['rgba(180,210,255,0.07)','rgba(180,210,255,0.04)'],
    'wx-storm':      ['rgba(160,112,255,0.07)','rgba(160,112,255,0.035)'],
    'wx-fog':        ['rgba(160,176,192,0.05)','rgba(160,176,192,0.03)'],
    'wx-hot':        ['rgba(240,164,88,0.07)','rgba(240,164,88,0.04)'],
  };
  const p = palettes[cls] || palettes['wx-clear-day'];
  waveColor = p[0]; dotColor = p[1];
}

function resizeCanvas() { bgCanvas.width = window.innerWidth; bgCanvas.height = window.innerHeight; }
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

function drawBackground() {
  ctx.clearRect(0,0,bgCanvas.width,bgCanvas.height);
  for (let i=0;i<6;i++) {
    const yBase = (bgCanvas.height/6)*(i+0.5);
    ctx.beginPath(); ctx.strokeStyle = waveColor; ctx.lineWidth = 1;
    for (let x=0;x<=bgCanvas.width;x+=2) {
      const y = yBase + Math.sin((x/180)+waveOffset+i*0.7)*28;
      x===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
    }
    ctx.stroke();
  }
  for (let x=0;x<bgCanvas.width;x+=60) for (let y=0;y<bgCanvas.height;y+=60) {
    ctx.beginPath(); ctx.fillStyle=dotColor; ctx.arc(x,y,1.5,0,Math.PI*2); ctx.fill();
  }
  waveOffset += 0.008;
  requestAnimationFrame(drawBackground);
}
drawBackground();

/* ────────────────────────────────
   FORM VALIDATION
──────────────────────────────── */
function validateInput(val) {
  val = val.trim();
  if (!val) return 'Please enter a city name.';
  if (val.length < 2) return 'City name too short.';
  if (val.length > 60) return 'City name too long.';
  if (!/^[a-zA-Z\s\-',\.àáâãäåæçèéêëìíîïðñòóôõöùúûüýþÿÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖÙÚÛÜÝÞß]+$/.test(val))
    return 'Please enter a valid city name.';
  return null;
}
function setValidation(msg) {
  validationMsg.textContent = msg || '';
  document.getElementById('searchBox').style.borderColor = msg ? 'rgba(224,108,117,0.6)' : '';
}

/* ────────────────────────────────
   UI STATE HELPERS
──────────────────────────────── */
function showLoader() {
  loaderWrap.classList.add('visible');
  errorCard.classList.remove('visible');
  weatherContent.classList.remove('visible');
  emptyState.style.display = 'none';
}
function showError(opts) {
  loaderWrap.classList.remove('visible');
  errorCard.classList.add('visible');
  weatherContent.classList.remove('visible');
  emptyState.style.display = 'none';
  document.getElementById('errorIcon').textContent  = opts.icon  || '⚓';
  document.getElementById('errorTitle').textContent = opts.title || 'Lost at Sea';
  document.getElementById('errorMsg').textContent   = opts.msg   || 'Something went wrong.';
  const hintEl = document.getElementById('errorHint');
  hintEl.textContent = opts.hint || '';
  hintEl.style.display = opts.hint ? 'block' : 'none';
  const suggs = document.getElementById('errorSuggestions');
  suggs.innerHTML = '';
  (opts.suggestions || []).forEach(city => {
    const chip = document.createElement('button');
    chip.className = 'error-suggestion-chip'; chip.textContent = city;
    chip.addEventListener('click', () => { cityInput.value = city; fetchWeather(city); });
    suggs.appendChild(chip);
  });
  errorRetryBtn.style.display = opts.retry !== false ? 'inline-flex' : 'none';
}
function showWeather() {
  loaderWrap.classList.remove('visible');
  errorCard.classList.remove('visible');
  weatherContent.classList.add('visible');
  emptyState.style.display = 'none';
}
function showEmpty() {
  loaderWrap.classList.remove('visible'); errorCard.classList.remove('visible');
  weatherContent.classList.remove('visible'); emptyState.style.display = 'block';
}

/* ────────────────────────────────
   RECENT SEARCHES
──────────────────────────────── */
function saveRecent(city) {
  recentSearches = recentSearches.filter(c => c.toLowerCase() !== city.toLowerCase());
  recentSearches.unshift(city); recentSearches = recentSearches.slice(0,5);
  localStorage.setItem('castaway_recents', JSON.stringify(recentSearches));
  renderRecents();
}
function renderRecents() {
  if (!recentSearches.length) { recentsPanel.classList.remove('visible'); return; }
  recentsPanel.classList.add('visible'); recentsChips.innerHTML = '';
  recentSearches.forEach(city => {
    const chip = document.createElement('button');
    chip.className = 'recent-chip'; chip.textContent = city;
    chip.addEventListener('click', () => { cityInput.value = city; fetchWeather(city); });
    recentsChips.appendChild(chip);
  });
}
renderRecents();

/* ────────────────────────────────
   TIME HELPERS
──────────────────────────────── */
function getLocalDate(unixTs, tzOffset) {
  const utc = unixTs * 1000 + new Date().getTimezoneOffset() * 60000;
  return new Date(utc + tzOffset * 1000);
}
function formatTime(d)  { return d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',hour12:true}); }
function formatDate(d)  { return d.toLocaleDateString([],{weekday:'short',month:'short',day:'numeric'}).toUpperCase(); }
function getDayLabel(ts){ return new Date(ts*1000).toLocaleDateString([],{weekday:'short'}); }

/* ────────────────────────────────
   LIVE CLOCK
──────────────────────────────── */
function tickClock() {
  if (!lastTimezone) return;
  const now = Math.floor(Date.now() / 1000);
  const d   = getLocalDate(now, lastTimezone);
  document.getElementById('localTime').textContent = formatTime(d);
  document.getElementById('localDate').textContent = formatDate(d);
}
function startClock() {
  if (clockInterval) clearInterval(clockInterval);
  tickClock();
  clockInterval = setInterval(tickClock, 10000);
}

/* ────────────────────────────────
   SUN TRACK
──────────────────────────────── */
function updateSunTrack(sunrise, sunset, tzOffset) {
  const now  = getLocalDate(Math.floor(Date.now()/1000), tzOffset);
  const sr   = getLocalDate(sunrise, tzOffset);
  const ss   = getLocalDate(sunset,  tzOffset);
  const total= ss - sr;
  const elapsed = Math.max(0, Math.min(now - sr, total));
  const pct  = total > 0 ? (elapsed / total) * 100 : 0;
  document.getElementById('sunTrackFill').style.width = pct + '%';
  document.getElementById('sunOrb').style.left        = pct + '%';
  document.getElementById('sunriseLabel').textContent  = formatTime(sr);
  document.getElementById('sunsetLabel').textContent   = formatTime(ss);
  document.getElementById('sunrise').textContent       = formatTime(sr);
  document.getElementById('sunriseLabel2') && (document.getElementById('sunriseLabel2').textContent = formatTime(sr));
  document.getElementById('sunset').textContent        = formatTime(ss);
}

/* ────────────────────────────────
   MOON PHASE
──────────────────────────────── */
function getMoonPhase(unixTs) {
  const synodicMonth = 29.53058867;
  const knownNew     = new Date('2000-01-06T18:14:00Z').getTime();
  const age = ((unixTs * 1000 - knownNew) / (synodicMonth * 24 * 3600 * 1000)) % 1;
  const normalized = age < 0 ? age + 1 : age;
  if (normalized < 0.03 || normalized > 0.97) return '🌑 New Moon';
  if (normalized < 0.22) return '🌒 Waxing Crescent';
  if (normalized < 0.28) return '🌓 First Quarter';
  if (normalized < 0.47) return '🌔 Waxing Gibbous';
  if (normalized < 0.53) return '🌕 Full Moon';
  if (normalized < 0.72) return '🌖 Waning Gibbous';
  if (normalized < 0.78) return '🌗 Last Quarter';
  return '🌘 Waning Crescent';
}

/* ────────────────────────────────
   DEW POINT ESTIMATE
──────────────────────────────── */
function calcDewPoint(tempC, humidity) {
  const a = 17.27, b = 237.7;
  const gamma = (a * tempC / (b + tempC)) + Math.log(humidity / 100);
  return Math.round((b * gamma) / (a - gamma));
}

/* ────────────────────────────────
   UVI LABEL
──────────────────────────────── */
function getUVILabel(uvi) {
  if (uvi <= 2)  return 'Low';
  if (uvi <= 5)  return 'Moderate';
  if (uvi <= 7)  return 'High';
  if (uvi <= 10) return 'Very High';
  return 'Extreme';
}

/* ────────────────────────────────
   AIR QUALITY SIMULATION
  (OWM free tier doesn't include AQI
   in /weather, so we estimate from
   available data)
──────────────────────────────── */
function estimateAQI(data) {
  const code  = data.weather[0].id;
  const humid = data.main.humidity;
  const vis   = (data.visibility || 10000) / 1000; // km
  let base = 40;
  if (code >= 700 && code < 800) base += 60;       // fog/haze
  if (humid > 80)                base += 20;
  if (vis < 5)                   base += 30;
  if (vis < 2)                   base += 40;
  base = Math.min(base, 200);
  return Math.round(base);
}

function aqiLevel(aqi) {
  if (aqi <= 50)  return { level: 'Good',      color: '#4ec9a0', trigger: 'PM2.5' };
  if (aqi <= 100) return { level: 'Moderate',  color: '#f0c060', trigger: 'PM25, Pollen' };
  if (aqi <= 150) return { level: 'Unhealthy for sensitive groups', color: '#f0a458', trigger: 'PM25, Ozone' };
  if (aqi <= 200) return { level: 'Unhealthy', color: '#e06c75', trigger: 'PM25, NO2' };
  return            { level: 'Very Unhealthy',  color: '#a070c0', trigger: 'PM25, SO2' };
}

/* ────────────────────────────────
   WEATHER MAP
──────────────────────────────── */
function updateMap(lat, lon, city) {
  const iframe = document.getElementById('weatherMap');
  const placeholder = document.getElementById('mapPlaceholder');
  // Use OpenStreetMap embedded with weather overlay markers
  const zoom = 8;
  const mapUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${lon-2}%2C${lat-1.5}%2C${lon+2}%2C${lat+1.5}&layer=mapnik&marker=${lat}%2C${lon}`;
  iframe.src = mapUrl;
  placeholder.style.display = 'none';
  iframe.style.display = 'block';

  const expandLink = document.getElementById('mapExpand');
  expandLink.href = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=${zoom}/${lat}/${lon}`;
}

/* ────────────────────────────────
   VIEW TABS
──────────────────────────────── */
document.getElementById('viewTabs').addEventListener('click', e => {
  const btn = e.target.closest('.tab-btn');
  if (!btn) return;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  // Tab switching note: currently all data is "Now" — Hourly/10-Day would need forecast data.
  // The chart in the bottom row already serves 5-day. Tabs visually acknowledge the selection.
});

/* ────────────────────────────────
   CHART.JS FORECAST
──────────────────────────────── */
function getCSSVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
      || getComputedStyle(document.body).getPropertyValue(name).trim();
}

function getDailyFromForecast() {
  if (!forecastData) return null;
  const days = {};
  forecastData.forEach(item => {
    const key = new Date(item.dt*1000).toLocaleDateString();
    const hr  = new Date(item.dt*1000).getHours();
    if (!days[key] || Math.abs(hr-12) < Math.abs(new Date(days[key].dt*1000).getHours()-12))
      days[key] = item;
  });
  return Object.values(days).slice(0,5);
}

function buildChartData(type) {
  const sorted = getDailyFromForecast();
  if (!sorted) return null;
  const labels = sorted.map(d => getDayLabel(d.dt));
  const accent = getCSSVar('--accent-primary') || '#5bb8d4';
  const muted  = getCSSVar('--text-muted')     || '#4a5f75';
  if (type === 'temp') return {
    labels,
    datasets:[{
      label:'High °C', data:sorted.map(d=>Math.round(d.main.temp_max)),
      borderColor:accent, backgroundColor:accent.replace(')',',0.1)').replace('rgb','rgba'),
      fill:true, tension:0.4, pointRadius:4, pointBackgroundColor:accent, pointBorderColor:'#fff', pointBorderWidth:1.5
    },{
      label:'Low °C',  data:sorted.map(d=>Math.round(d.main.temp_min)),
      borderColor:muted, backgroundColor:'transparent', fill:false, tension:0.4,
      pointRadius:3, pointBackgroundColor:muted, pointBorderColor:'#fff', pointBorderWidth:1, borderDash:[4,3]
    }]
  };
  if (type === 'rain') return {
    labels,
    datasets:[{ label:'Rain %', data:sorted.map(d=>Math.round((d.pop||0)*100)),
      borderColor:'#4a90d4', backgroundColor:'rgba(74,144,212,0.12)', fill:true, tension:0.4,
      pointRadius:4, pointBackgroundColor:'#4a90d4', pointBorderColor:'#fff', pointBorderWidth:1.5 }]
  };
  return {
    labels,
    datasets:[{ label:'Wind km/h', data:sorted.map(d=>Math.round((d.wind?.speed||0)*3.6)),
      borderColor:'#f0a458', backgroundColor:'rgba(240,164,88,0.1)', fill:true, tension:0.4,
      pointRadius:4, pointBackgroundColor:'#f0a458', pointBorderColor:'#fff', pointBorderWidth:1.5 }]
  };
}

function getChartOpts(type) {
  const muted  = getCSSVar('--text-muted')     || '#4a5f75';
  const second = getCSSVar('--text-secondary') || '#7a90ab';
  const border = getCSSVar('--glass-border')   || 'rgba(255,255,255,0.08)';
  return {
    responsive:true, maintainAspectRatio:false,
    interaction:{ mode:'index', intersect:false },
    plugins:{
      legend:{ display:type==='temp', labels:{ color:second, font:{family:"'Space Mono',monospace",size:9}, boxWidth:8, padding:10 } },
      tooltip:{ backgroundColor:'rgba(13,24,41,0.92)', titleFont:{family:"'Space Mono',monospace",size:10}, bodyFont:{family:"'DM Sans',sans-serif",size:11}, borderColor:border, borderWidth:1, padding:8, cornerRadius:6 }
    },
    scales:{
      x:{ grid:{color:border,drawTicks:false}, ticks:{color:muted,font:{family:"'Space Mono',monospace",size:9},padding:4}, border:{display:false} },
      y:{ grid:{color:border,drawTicks:false}, ticks:{color:muted,font:{family:"'Space Mono',monospace",size:9},padding:4}, border:{display:false} }
    }
  };
}

function renderChart(type='temp') {
  const el = document.getElementById('forecastChart');
  if (!el || !forecastData) return;
  const data = buildChartData(type);
  if (!data) return;
  if (forecastChart) { forecastChart.data=data; forecastChart.options=getChartOpts(type); forecastChart.update('active'); return; }
  forecastChart = new Chart(el,{ type:'line', data, options:getChartOpts(type) });
}
function updateChartColors() {
  if (!forecastChart||!forecastData) return;
  const active = document.querySelector('.chart-btn.active');
  const type   = active ? active.dataset.chart : 'temp';
  forecastChart.data    = buildChartData(type);
  forecastChart.options = getChartOpts(type);
  forecastChart.update('active');
}

document.querySelectorAll('.chart-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.chart-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderChart(btn.dataset.chart);
  });
});

function renderForecastDays() {
  const container = document.getElementById('forecastDays');
  if (!container || !forecastData) return;
  const sorted = getDailyFromForecast();
  container.innerHTML = '';
  sorted.forEach(item => {
    const div = document.createElement('div');
    div.className = 'forecast-day';
    div.innerHTML = `
      <span class="forecast-day-label">${getDayLabel(item.dt)}</span>
      <img class="forecast-day-icon" src="https://openweathermap.org/img/wn/${item.weather[0].icon}.png" alt="${item.weather[0].description}" loading="lazy"/>
      <span class="forecast-day-temp">${Math.round(item.main.temp_max)}°</span>
      <span class="forecast-day-lo">${Math.round(item.main.temp_min)}°</span>`;
    container.appendChild(div);
  });
}

/* Forecast brief (today + tonight) from 3-hr data */
function renderForecastBrief(data) {
  // "Today" = daytime hi from current data
  const todayIcon = document.getElementById('fTodayIcon');
  const tonightIcon = document.getElementById('fTonightIcon');
  const code = data.weather[0].icon;

  todayIcon.src  = `https://openweathermap.org/img/wn/${code}.png`;
  tonightIcon.src = `https://openweathermap.org/img/wn/${code.replace('d','n')}.png`;
  document.getElementById('fTodayTemp').textContent  = `Hi ${Math.round(data.main.temp_max)}°F`;

  // Tonight uses min temp (convert to F for familiarity since reference uses F, but keep C theme)
  const loC = Math.round(data.main.temp_min);
  document.getElementById('fTonightTemp').textContent = `Lo ${loC}°`;

  const desc = data.weather[0].description;
  const capDesc = desc.charAt(0).toUpperCase() + desc.slice(1);
  const humidity = data.main.humidity;
  const windKmh  = Math.round(data.wind.speed * 3.6);
  document.getElementById('fTodayTemp').textContent  = `Hi ${Math.round(data.main.temp_max)}°`;
  document.getElementById('fTodayDesc').textContent  =
    `${capDesc}. High around ${Math.round(data.main.temp_max)}°C. Humidity ${humidity}%. Winds ${windKmh} km/h.`;
  document.getElementById('fTonightTemp').textContent = `Lo ${loC}°`;
  document.getElementById('fTonightDesc').textContent =
    `Partly ${data.clouds.all > 50 ? 'cloudy' : 'clear'} night. Low around ${loC}°C. Dew point ${calcDewPoint(data.main.temp, humidity)}°C.`;
}

/* ────────────────────────────────
   RENDER ALL WEATHER DATA
──────────────────────────────── */
function renderWeather(data) {
  /* Location */
  document.getElementById('cityName').textContent    = data.name;
  document.getElementById('countryName').textContent =
    `${data.sys.country} · ${data.coord.lat.toFixed(2)}°, ${data.coord.lon.toFixed(2)}°`;

  /* As-of timestamp */
  lastTimezone = data.timezone;
  lastDt       = data.dt;
  const localDate = getLocalDate(data.dt, data.timezone);
  document.getElementById('asOfLabel').textContent =
    `As of ${localDate.toLocaleDateString([],{month:'short',day:'numeric'})} ${formatTime(localDate)}`;

  /* Temp */
  const temp = Math.round(data.main.temp);
  document.getElementById('tempValue').textContent   = temp;
  document.getElementById('feelsLike').textContent   = `Feels like ${Math.round(data.main.feels_like)}°`;
  document.getElementById('weatherDesc').textContent = data.weather[0].description;
  document.getElementById('tempMax').textContent     = Math.round(data.main.temp_max);
  document.getElementById('tempMin').textContent     = Math.round(data.main.temp_min);

  /* Icon */
  const icon = document.getElementById('weatherIcon');
  icon.src = `https://openweathermap.org/img/wn/${data.weather[0].icon}@2x.png`;
  icon.alt = data.weather[0].description;

  /* Details grid */
  const feelsC   = Math.round(data.main.feels_like);
  const dewPoint = calcDewPoint(data.main.temp, data.main.humidity);
  document.getElementById('windchill').textContent = `${feelsC}°`;
  document.getElementById('dailyRain').textContent = data.rain ? `${data.rain['1h']?.toFixed(1) || '0.0'} mm` : '0.0 mm';
  document.getElementById('dewPoint').textContent  = `${dewPoint}°`;
  document.getElementById('humidity').textContent  = `${data.main.humidity}%`;
  document.getElementById('pressure').textContent  = `${data.main.pressure} hPa`;
  document.getElementById('windSpeed').textContent = `${Math.round(data.wind.speed*3.6)} km/h ${windDegToDir(data.wind.deg||0)}`;
  document.getElementById('moonPhase').textContent = getMoonPhase(data.dt).replace(/🌑|🌒|🌓|🌔|🌕|🌖|🌗|🌘/u, '').trim();

  /* Lat factor UVI */
  const clouds = data.clouds?.all ?? 0;
  const uviEst = Math.round((1-Math.abs(data.coord.lat)/90)*(1-(clouds/100)*0.85)*11);
  document.getElementById('uvIndex').textContent  = `${uviEst} (${getUVILabel(uviEst)})`;
  document.getElementById('uviVal').textContent   = uviEst;
  document.getElementById('uviLabel').textContent = getUVILabel(uviEst);

  /* Stat pills */
  document.getElementById('windPill').textContent     = `${Math.round(data.wind.speed*3.6)} km/h`;
  document.getElementById('visibility').textContent   = data.visibility ? `${(data.visibility/1000).toFixed(1)} km` : 'N/A';
  document.getElementById('humidityPill').textContent = `${data.main.humidity}%`;
  document.getElementById('humidityBar').style.width  = `${data.main.humidity}%`;
  document.getElementById('pressurePill').textContent = `${data.main.pressure} hPa`;

  /* Cloud + UV mini cards */
  document.getElementById('cloudVal').textContent  = `${clouds}%`;
  document.getElementById('cloudFill').style.width = `${clouds}%`;

  /* Sun track */
  updateSunTrack(data.sys.sunrise, data.sys.sunset, data.timezone);
  startClock();

  /* Sun labels in details */
  const sr = getLocalDate(data.sys.sunrise, data.timezone);
  const ss = getLocalDate(data.sys.sunset,  data.timezone);
  document.getElementById('sunrise').textContent = formatTime(sr);
  document.getElementById('sunset').textContent  = formatTime(ss);

  /* Map */
  updateMap(data.coord.lat, data.coord.lon, data.name);

  /* Forecast brief */
  renderForecastBrief(data);

  /* Air quality estimate */
  const aqi   = estimateAQI(data);
  const aqMeta = aqiLevel(aqi);
  document.getElementById('aqNum').textContent   = aqi;
  document.getElementById('aqLevel').textContent = aqMeta.level;
  document.getElementById('aqTrigger').textContent = aqMeta.trigger;
  document.getElementById('aqBadge').style.background = aqMeta.color + '30';
  document.getElementById('aqBadge').style.borderColor = aqMeta.color;
  document.getElementById('aqBadge').style.border = `2px solid ${aqMeta.color}`;
  const markerPct = Math.min((aqi / 300) * 100, 98);
  document.getElementById('aqMarker').style.left = markerPct + '%';

  /* Lightning estimate */
  const stormNearby = data.weather[0].id < 300;
  const lorb = document.getElementById('lightningOrb');
  lorb.classList.toggle('alert', stormNearby);
  document.getElementById('lightningDist').textContent =
    stormNearby ? 'Storm detected' : 'No alerts nearby';
  document.getElementById('lightningSub').textContent  =
    stormNearby
      ? `Thunderstorm activity — ${data.name}`
      : `Conditions calm near ${data.name}`;

  /* Dynamic background */
  applyDynamicBackground(data);

  showWeather();
}

/* ────────────────────────────────
   WIND DIRECTION
──────────────────────────────── */
function windDegToDir(deg) {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg/22.5) % 16];
}

/* ────────────────────────────────
   API FETCH
──────────────────────────────── */
async function fetchWeather(city) {
  const err = validateInput(city);
  if (err) { setValidation(err); return; }
  setValidation(''); lastCity = city; showLoader();

  if (!navigator.onLine) {
    showError({ icon:'📡', title:'No Signal', msg:'You appear to be offline. Check your internet connection.', suggestions:[], retry:true }); return;
  }

  try {
    const [curRes, foreRes] = await Promise.all([
      fetch(`${BASE_URL}?q=${encodeURIComponent(city)}&appid=${API_KEY}&units=metric`),
      fetch(`${FORE_URL}?q=${encodeURIComponent(city)}&appid=${API_KEY}&units=metric`),
    ]);

    if (!curRes.ok) { handleAPIError(curRes.status, city); return; }

    const data = await curRes.json();
    forecastData = foreRes.ok ? (await foreRes.json()).list : null;

    saveRecent(data.name);
    renderWeather(data);

    if (forecastData) { renderForecastDays(); renderChart('temp'); }

  } catch(e) {
    showError({ icon:'🌊', title:'Wave Crash', msg:'Unable to reach the weather service.', hint:'Try a recent search:', suggestions:recentSearches.slice(0,3), retry:true });
  }
}

function handleAPIError(status, city) {
  const popular = ['London','New York','Tokyo','Paris','Sydney','Mumbai'].filter(c=>c.toLowerCase()!==city.toLowerCase()).slice(0,4);
  if (status===404) showError({ icon:'🗺️', title:'Port Not Found', msg:`"${city}" was not found. Check spelling or try a nearby city.`, hint:'Popular destinations:', suggestions:popular, retry:false });
  else if (status===401) showError({ icon:'🔑', title:'Key Required', msg:'Invalid API key. Configure a valid OpenWeatherMap key in script.js.', suggestions:[], retry:false });
  else if (status===429) showError({ icon:'⏳', title:'Too Many Requests', msg:'Rate-limited. Wait a moment and try again.', suggestions:[], retry:true });
  else showError({ icon:'⚙️', title:'Service Issue', msg:`HTTP ${status}. Try again shortly.`, suggestions:[], retry:true });
}

errorRetryBtn.addEventListener('click', () => { if (lastCity) fetchWeather(lastCity); else { showEmpty(); cityInput.focus(); } });

/* ────────────────────────────────
   SEARCH TRIGGER
──────────────────────────────── */
function triggerSearch() {
  const city = cityInput.value.trim();
  const err  = validateInput(city);
  if (err) { setValidation(err); return; }
  setValidation(''); fetchWeather(city);
}
searchBtn.addEventListener('click', triggerSearch);
cityInput.addEventListener('keydown', e => { if (e.key==='Enter') triggerSearch(); });
cityInput.addEventListener('input',   () => { if (validationMsg.textContent) setValidation(''); });

/* ── Init ── */
showEmpty();
if (window.innerWidth > 680) setTimeout(() => cityInput.focus(), 400);

/* ────────────────────────────────
   AUTH — User menu & session
──────────────────────────────── */
(function initUserMenu() {
  const session = JSON.parse(localStorage.getItem('castaway_session') || 'null');
  if (!session) return;

  // Populate avatar initials
  const initials = session.name
    .split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
  document.getElementById('userInitials').textContent      = initials;
  document.getElementById('userDropdownName').textContent  = session.name;
  document.getElementById('userDropdownEmail').textContent = session.email;
})();

function toggleUserDropdown() {
  document.getElementById('userDropdown').classList.toggle('open');
}

// Close dropdown when clicking outside
document.addEventListener('click', function(e) {
  const menu = document.getElementById('userMenu');
  if (menu && !menu.contains(e.target)) {
    document.getElementById('userDropdown').classList.remove('open');
  }
});

function handleLogout() {
  localStorage.removeItem('castaway_session');
  sessionStorage.removeItem('castaway_session_live');
  // Fade out then redirect
  document.body.style.transition = 'opacity 0.4s ease';
  document.body.style.opacity    = '0';
  setTimeout(() => window.location.replace('auth.html'), 420);
}
