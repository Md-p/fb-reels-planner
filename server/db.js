const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'database.json');

const DEFAULT_DATA = {
  settings: {
    appId: '',
    appSecret: '',
    userToken: '',
    simulationMode: true // Defaults to true so user can test right away
  },
  pages: [
    {
      id: "demo_page_1",
      name: "Viral Tech & Reels (Demo)",
      category: "Tech & Gaming",
      followers: 12500,
      avatar: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=100&auto=format&fit=crop&q=60",
      accessToken: "DEMO_TOKEN_1",
      isActive: true
    },
    {
      id: "demo_page_2",
      name: "Daily Motivation Studio (Demo)",
      category: "Media & Entertainment",
      followers: 48900,
      avatar: "https://images.unsplash.com/photo-1579546929518-9e396f3cc809?w=100&auto=format&fit=crop&q=60",
      accessToken: "DEMO_TOKEN_2",
      isActive: true
    }
  ],
  schedules: [],
  logs: []
};

function initDb() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify(DEFAULT_DATA, null, 2), 'utf-8');
  }
}

function readDb() {
  initDb();
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error reading DB, resetting to defaults:', err);
    return DEFAULT_DATA;
  }
}

function writeDb(data) {
  initDb();
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

module.exports = {
  getSettings() {
    return readDb().settings || DEFAULT_DATA.settings;
  },
  saveSettings(settings) {
    const db = readDb();
    db.settings = { ...db.settings, ...settings };
    writeDb(db);
    return db.settings;
  },
  getAccounts() {
    return readDb().accounts || [];
  },
  addAccount(account) {
    const db = readDb();
    if (!db.accounts) db.accounts = [];
    const idx = db.accounts.findIndex(a => a.id === account.id);
    if (idx >= 0) {
      db.accounts[idx] = { ...db.accounts[idx], ...account };
    } else {
      db.accounts.push(account);
    }
    writeDb(db);
    return db.accounts;
  },
  deleteAccount(id) {
    const db = readDb();
    if (db.accounts) {
      db.accounts = db.accounts.filter(a => a.id !== id);
    }
    writeDb(db);
    return db.accounts || [];
  },
  getPages() {
    return readDb().pages || [];
  },
  savePages(pages) {
    const db = readDb();
    db.pages = pages;
    writeDb(db);
    return db.pages;
  },
  addPage(page) {
    const db = readDb();
    const existingIndex = db.pages.findIndex(p => p.id === page.id);
    if (existingIndex >= 0) {
      db.pages[existingIndex] = { ...db.pages[existingIndex], ...page };
    } else {
      db.pages.push(page);
    }
    writeDb(db);
    return db.pages;
  },
  deletePage(id) {
    const db = readDb();
    db.pages = db.pages.filter(p => p.id !== id);
    writeDb(db);
    return db.pages;
  },
  getSchedules() {
    return readDb().schedules || [];
  },
  addSchedule(schedule) {
    const db = readDb();
    db.schedules.unshift(schedule);
    writeDb(db);
    return schedule;
  },
  updateSchedule(id, updates) {
    const db = readDb();
    const idx = db.schedules.findIndex(s => s.id === id);
    if (idx >= 0) {
      db.schedules[idx] = { ...db.schedules[idx], ...updates };
      writeDb(db);
      return db.schedules[idx];
    }
    return null;
  },
  deleteSchedule(id) {
    const db = readDb();
    db.schedules = db.schedules.filter(s => s.id !== id);
    writeDb(db);
    return true;
  },
  getLogs() {
    return (readDb().logs || []).slice(0, 100);
  },
  addLog(entry) {
    const db = readDb();
    if (!db.logs) db.logs = [];
    db.logs.unshift({
      id: 'log_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      timestamp: new Date().toISOString(),
      ...entry
    });
    if (db.logs.length > 200) db.logs = db.logs.slice(0, 200);
    writeDb(db);
  }
};
