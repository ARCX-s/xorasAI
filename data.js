const API = 'https://xoras-proxy.vercel.app';
const AI_API_ENDPOINT = '/api/ai';

const KIND_MAP = {
  'л.':  'лек',
  'пр.': 'пр',
  'лаб.':'лаб',
  'к.р.':'крп',
  'КРП': 'крп',
};

const TIME_TO_PARA = {
  '08': 1, '10': 2, '11': 3,
  '13': 4, '14': 5, '16': 6, '17': 7,
};

let D = {
  groups: [],
  schedule: {},
  days: ['Понедельник','Вторник','Среда','Четверг','Пятница','Суббота']
};

const scheduleCache = {};

function getParaNum(time) {
  if (!time) return 0;
  const h = time.slice(0, 2);
  return TIME_TO_PARA[h] || 0;
}

function getKindType(abbr) {
  if (!abbr) return 'лек';
  const clean = abbr.trim().toLowerCase();
  for (const [key, val] of Object.entries(KIND_MAP)) {
    if (clean === key.toLowerCase()) return val;
  }
  if (clean.includes('лаб')) return 'лаб';
  if (clean.includes('пр'))  return 'пр';
  if (clean.includes('крп') || clean.includes('к.р')) return 'крп';
  return 'лек';
}

function getCurrentWeekRange() {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const mon = new Date(now);
  mon.setDate(now.getDate() + diff);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  return { start: formatDate(mon), end: formatDate(sun) };
}

function formatDate(d) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(2);
  return `${dd}.${mm}.${yy}`;
}

function formatDateFull(d) {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

function getSemesterRange() {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  const start = new Date(now);
  start.setDate(now.getDate() + diff);
  const end = new Date(start);
  end.setDate(start.getDate() + 13);
  return { start: formatDateFull(start), end: formatDateFull(end) };
}

// ── Загрузка групп ────────────────────────────────

async function searchGroups(query) {
  try {
    const r = await fetch(`${API}/groups?q=${encodeURIComponent(query)}`);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    return (data.results || []).map(g => ({
      id: g.id || g.text,
      text: g.text || g.id,
    }));
  } catch (e) {
    console.error('Ошибка поиска групп:', e.message);
    return [];
  }
}

async function searchLecturers(query) {
  try {
    const r = await fetch(`${API}/lecturers?q=${encodeURIComponent(query)}`);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    return (data.results || []).map(l => ({
      id: l.id || l.text,
      text: l.text || l.id,
    }));
  } catch (e) {
    console.error('Ошибка поиска преподавателей:', e.message);
    return [];
  }
}

// ── Кэш ──────────────────────────────────────────

const CACHE_TTL = 24 * 60 * 60 * 1000;

function lsCacheGet(key) {
  try {
    const raw = localStorage.getItem('xoras_cache_' + key);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL) { localStorage.removeItem('xoras_cache_' + key); return null; }
    return data;
  } catch(e) { return null; }
}

function lsCacheSet(key, data) {
  try {
    localStorage.setItem('xoras_cache_' + key, JSON.stringify({ ts: Date.now(), data }));
  } catch(e) {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('xoras_cache_')) localStorage.removeItem(k);
    }
  }
}

// ── Загрузка расписания ───────────────────────────

async function loadWeekSchedule(groupName, startDate, endDate, downloadFile = false) {
  const cacheKey = `${groupName}_${startDate}_${endDate}`;

  if (scheduleCache[cacheKey]) {
    if (downloadFile) {
      exportScheduleToFile(scheduleCache[cacheKey], groupName, startDate, endDate);
    }
    return scheduleCache[cacheKey];
  }

  const cached = lsCacheGet(cacheKey);
  if (cached) {
    scheduleCache[cacheKey] = cached;
    if (downloadFile) {
      exportScheduleToFile(cached, groupName, startDate, endDate);
    }
    console.log('📦 Расписание из кэша:', groupName);
    return cached;
  }

  const dbCached = await dbGet(cacheKey);
  if (dbCached) {
    scheduleCache[cacheKey] = dbCached;
    lsCacheSet(cacheKey, dbCached);
    if (downloadFile) {
      exportScheduleToFile(dbCached, groupName, startDate, endDate);
    }
    console.log('📦 Расписание из IndexedDB:', groupName);
    return dbCached;
  }

  try {
    const r = await fetch(`${API}/schedule`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group: groupName, start_date: startDate, end_date: endDate })
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    const lessons = Array.isArray(data.lessons) ? data.lessons : [];
    scheduleCache[cacheKey] = lessons;
    lsCacheSet(cacheKey, lessons);
    await dbSet(cacheKey, lessons);
    console.log('✅ Расписание загружено и закэшировано:', groupName);
    
    if (downloadFile) {
      exportScheduleToFile(lessons, groupName, startDate, endDate);
    }
    
    return lessons;
  } catch (e) {
    console.error('Ошибка загрузки расписания:', e.message);
    return [];
  }
}

// ── Преобразование уроков ─────────────────────────

function capitalize(s) {
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function lessonsToSlots(lessons) {
  // Группируем по конкретной дате
  const byDate = {};
  for (const l of lessons) {
    const date = l.lesson_date || '';
    if (!date) continue;
    if (!byDate[date]) byDate[date] = {
      date,
      dayName: capitalize(l.day_name || ''),
      weekType: l.type_week || '',
      paras: {}
    };

    const para = getParaNum(l.lesson_time);
    if (!para) continue;

    if (!byDate[date].paras[para]) {
      byDate[date].paras[para] = {
        para,
        time: l.lesson_time ? l.lesson_time.replace(' - ', '–') : '',
        date,
        weekType: l.type_week || '',
        lessons: []
      };
    }

    byDate[date].paras[para].lessons.push({
      subject: l.discipline || '',
      teacher: l.lecturer || '',
      room: l.aud_name || '',
      type: getKindType(l.kind_abbr),
      groups: l.group_name || '',
      link: l.link || null,
    });
  }

  // Сортируем даты по возрастанию
  const sortedDates = Object.keys(byDate).sort((a, b) => {
    const [da, ma, ya] = a.split('.').map(Number);
    const [db, mb, yb] = b.split('.').map(Number);
    return new Date(2000+ya, ma-1, da) - new Date(2000+yb, mb-1, db);
  });

  // Берём первое вхождение каждого дня недели
  const result = {};
  for (const date of sortedDates) {
    const entry = byDate[date];
    const dayName = entry.dayName;
    if (!dayName || result[dayName]) continue;
    result[dayName] = Object.values(entry.paras).sort((a, b) => a.para - b.para);
  }

  return result;
}

// ── Файловый экспорт/импорт расписания ─────────────

const DB_NAME = 'XorasSchedules';
const DB_VERSION = 1;
const STORE_NAME = 'schedules';

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });
}

async function dbGet(key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result?.data || null);
    req.onerror = () => reject(req.error);
  });
}

async function dbSet(key, data) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put({ id: key, data, savedAt: Date.now() });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function getScheduleFileName(groupName, startDate, endDate) {
  const safeName = groupName.replace(/[^a-zA-Zа-яА-Я0-9]/g, '_');
  return `raspisanie_${safeName}_${startDate}_${endDate}.json`;
}

async function exportScheduleToFile(lessons, groupName, startDate, endDate) {
  const fileName = getScheduleFileName(groupName, startDate, endDate);
  const exportData = {
    exportedAt: new Date().toISOString(),
    groupName,
    startDate,
    endDate,
    lessons
  };

  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  console.log('📥 Файл сохранён:', fileName);
  return fileName;
}

async function importScheduleFromFile() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) {
        resolve(null);
        return;
      }
      
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        
        if (data.groupName && data.lessons) {
          const cacheKey = `${data.groupName}_${data.startDate}_${data.endDate}`;
          await dbSet(cacheKey, data.lessons);
          lsCacheSet(cacheKey, data.lessons);
          console.log('📂 Расписание загружено из файла:', data.groupName);
          resolve({ groupName: data.groupName, lessons: data.lessons });
        } else {
          reject(new Error('Неверный формат файла'));
        }
      } catch (err) {
        reject(err);
      }
    };
    
    input.onerror = () => reject(new Error('Ошибка выбора файла'));
    input.click();
  });
}

// ── AI Chat via Backend Proxy ──────────────────────

async function askAI(messages) {
  try {
    const r = await fetch(AI_API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages })
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error?.message || 'HTTP ' + r.status);
    }
    const data = await r.json();
    return data.content || '';
  } catch (e) {
    console.error('Ошибка AI:', e.message);
    throw e;
  }
}

// ── Инициализация ─────────────────────────────────

async function initSchedule(groupName) {
  const { start, end } = getSemesterRange();
  const lessons = await loadWeekSchedule(groupName, start, end);
  if (!lessons.length) return null;
  const slots = lessonsToSlots(lessons);
  const typeWeek = lessons[0]?.type_week || '';
  return { slots, typeWeek, groupName };
}

window.MGSU = {
  searchGroups,
  searchLecturers,
  loadWeekSchedule,
  lessonsToSlots,
  initSchedule,
  getSemesterRange,
  formatDate,
  formatDateFull,
  getCurrentWeekRange,
  askAI,
  exportScheduleToFile,
  importScheduleFromFile,
  dbGet,
};

console.log('✅ data.js загружен, API:', API);
