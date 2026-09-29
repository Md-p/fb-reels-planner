const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const db = require('./db');
const metaService = require('./metaService');
const scheduler = require('./scheduler');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

// Set up upload storage
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const cleanName = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    cb(null, `${Date.now()}_${cleanName}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 } // 500MB max per reel
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

// ================= API ROUTES =================

// 1. Stats Overview
app.get('/api/stats', (req, res) => {
  const pages = db.getPages();
  const schedules = db.getSchedules();
  const logs = db.getLogs();

  const activePages = pages.filter(p => p.isActive).length;
  const pending = schedules.filter(s => s.status === 'SCHEDULED').length;
  const completed = schedules.filter(s => s.status === 'COMPLETED').length;
  const failed = schedules.filter(s => s.status === 'FAILED').length;

  res.json({
    activePages,
    totalScheduled: schedules.length,
    pending,
    completed,
    failed,
    recentLogsCount: logs.length
  });
});

// 2. Settings & Credentials
app.get('/api/settings', (req, res) => {
  res.json(db.getSettings());
});

app.post('/api/settings', (req, res) => {
  const updated = db.saveSettings(req.body);
  res.json({ success: true, settings: updated });
});

// OAuth 2.0: Facebook Login Entrypoint
app.get('/auth/facebook', (req, res) => {
  const settings = db.getSettings();
  const appId = req.query.appId || settings.appId;
  const appSecret = req.query.appSecret || settings.appSecret;

  if (appId || appSecret) {
    db.saveSettings({ 
      ...(appId ? { appId } : {}), 
      ...(appSecret ? { appSecret } : {}) 
    });
  }

  const effectiveAppId = appId || settings.appId;
  if (!effectiveAppId) {
    return res.redirect('/?tab=settings&error=' + encodeURIComponent('Please enter and save your Facebook App ID first.'));
  }

  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.get('host');
  const redirectUri = `${proto}://${host}/auth/facebook/callback`;
  const scopes = [
    'pages_show_list',
    'pages_read_engagement',
    'pages_manage_posts',
    'pages_manage_engagement',
    'publish_video',
    'pages_read_user_content'
  ].join(',');

  const reauthParam = req.query.reauth === 'true' ? '&auth_type=reauthenticate' : '';
  const fbAuthUrl = `https://www.facebook.com/v21.0/dialog/oauth?client_id=${effectiveAppId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}&response_type=code${reauthParam}`;
  res.redirect(fbAuthUrl);
});

// OAuth 2.0: Facebook Callback Handler
app.get('/auth/facebook/callback', async (req, res) => {
  const { code, error, error_description } = req.query;

  if (error || !code) {
    const msg = error_description || error || 'Facebook authorization was cancelled.';
    return res.redirect('/?tab=settings&error=' + encodeURIComponent(msg));
  }

  try {
    const settings = db.getSettings();
    const appId = settings.appId;
    const appSecret = settings.appSecret;

    if (!appId || !appSecret) {
      return res.redirect('/?tab=settings&error=' + encodeURIComponent('App ID and App Secret are required to complete Facebook Login.'));
    }

    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.get('host');
    const redirectUri = `${proto}://${host}/auth/facebook/callback`;

    console.log('[OAuth] Exchanging authorization code for User Access Token...');
    const shortToken = await metaService.exchangeCodeForToken({
      appId,
      appSecret,
      redirectUri,
      code
    });

    console.log('[OAuth] Exchanging for 60-day long-lived User Token...');
    let finalToken = shortToken;
    try {
      const longRes = await metaService.exchangeForLongLivedToken(appId, appSecret, shortToken);
      finalToken = longRes.accessToken;
      console.log('[OAuth] 60-day token obtained successfully!');
    } catch (e) {
      console.warn('[OAuth] 60-day exchange notice:', e.message);
    }

    console.log('[OAuth] Fetching Facebook user profile...');
    const axios = require('axios');
    let userInfo = { id: 'fb_' + Date.now(), name: 'Facebook User', avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&auto=format&fit=crop&q=60' };
    try {
      const uRes = await axios.get(`https://graph.facebook.com/v21.0/me`, {
        params: {
          fields: 'id,name,picture.type(large)',
          access_token: finalToken
        }
      });
      userInfo = {
        id: uRes.data.id,
        name: uRes.data.name,
        avatar: uRes.data.picture?.data?.url || userInfo.avatar
      };
      console.log(`[OAuth] Logged in profile: ${userInfo.name} (${userInfo.id})`);
    } catch (uErr) {
      console.warn('[OAuth] Could not fetch user profile details:', uErr.message);
    }

    console.log('[OAuth] Fetching Facebook pages from Graph API...');
    const pages = await metaService.fetchUserPages(finalToken);

    for (const page of pages) {
      db.addPage({
        ...page,
        accountId: userInfo.id,
        accountName: userInfo.name
      });
    }

    db.addAccount({
      id: userInfo.id,
      name: userInfo.name,
      avatar: userInfo.avatar,
      pagesCount: pages.length,
      connectedAt: new Date().toISOString()
    });

    db.saveSettings({
      userToken: finalToken,
      simulationMode: false
    });

    db.addLog({
      type: 'INFO',
      message: `Account Connected: "${userInfo.name}" - Synced ${pages.length} Facebook page(s).`
    });

    res.redirect(`/?tab=pages&connected=1&count=${pages.length}&userName=${encodeURIComponent(userInfo.name)}`);
  } catch (err) {
    console.error('[OAuth Callback Error]', err);
    res.redirect('/?tab=settings&error=' + encodeURIComponent(err.message));
  }
});

// Accounts API
app.get('/api/accounts', (req, res) => {
  res.json(db.getAccounts());
});

app.delete('/api/accounts/:id', (req, res) => {
  const updated = db.deleteAccount(req.params.id);
  res.json({ success: true, accounts: updated });
});

// 3. Exchange Token & Fetch Real Pages
app.post('/api/auth/connect', async (req, res) => {
  try {
    const { appId, appSecret, userToken } = req.body;
    const settings = db.getSettings();

    const effectiveAppId = appId || settings.appId;
    const effectiveAppSecret = appSecret || settings.appSecret;
    const effectiveUserToken = userToken || settings.userToken;

    if (!effectiveUserToken) {
      return res.status(400).json({ error: 'User Access Token is required.' });
    }

    let finalUserToken = effectiveUserToken;

    // If App ID & Secret provided, exchange for long-lived 60-day token
    if (effectiveAppId && effectiveAppSecret) {
      try {
        console.log('[Auth] Exchanging token for 60-day long-lived token...');
        const tokenRes = await metaService.exchangeForLongLivedToken(effectiveAppId, effectiveAppSecret, effectiveUserToken);
        finalUserToken = tokenRes.accessToken;
        console.log('[Auth] Token exchanged successfully!');
      } catch (tokenErr) {
        console.warn('[Auth] Token exchange notice:', tokenErr.message);
      }
    }

    // Fetch user pages
    console.log('[Auth] Fetching Facebook pages from Meta Graph API...');
    const pages = await metaService.fetchUserPages(finalUserToken);

    // Save pages & settings
    for (const page of pages) {
      db.addPage(page);
    }

    db.saveSettings({
      appId: effectiveAppId,
      appSecret: effectiveAppSecret,
      userToken: finalUserToken,
      simulationMode: false
    });

    db.addLog({
      type: 'INFO',
      message: `Connected to Meta! Synced ${pages.length} Facebook page(s) successfully.`
    });

    res.json({
      success: true,
      message: `Synced ${pages.length} Facebook page(s)!`,
      pages: db.getPages()
    });
  } catch (err) {
    console.error('[Auth Error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 4. Pages Management
app.get('/api/pages', (req, res) => {
  res.json(db.getPages());
});

app.post('/api/pages', (req, res) => {
  const { id, name, category, followers, avatar, accessToken } = req.body;
  if (!id || !name) {
    return res.status(400).json({ error: 'Page ID and Name are required.' });
  }
  const page = {
    id: String(id).trim(),
    name: name.trim(),
    category: category || 'General',
    followers: Number(followers) || 0,
    avatar: avatar || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=100&auto=format&fit=crop&q=60',
    accessToken: accessToken || 'DEMO_TOKEN_' + Date.now(),
    isActive: true
  };
  const updatedPages = db.addPage(page);
  res.json({ success: true, page, pages: updatedPages });
});

app.delete('/api/pages/:id', (req, res) => {
  const updated = db.deletePage(req.params.id);
  res.json({ success: true, pages: updated });
});

function computeBdSlots(count, baseDateStr) {
  const now = new Date();
  let baseDate;
  let isDefaultAuto = false;

  if (baseDateStr) {
    baseDate = new Date(baseDateStr);
    if (isNaN(baseDate.getTime())) {
      baseDate = new Date();
      isDefaultAuto = true;
    } else {
      const isToday = baseDate.toDateString() === now.toDateString();
      if (isToday) isDefaultAuto = true;
    }
  } else {
    baseDate = new Date();
    isDefaultAuto = true;
  }

  let startDayOffset = 0;
  let startSlotIndex = 0; // 0 = 8 AM, 1 = 17 PM (5 PM)

  if (isDefaultAuto) {
    const currentHour = now.getHours();
    if (currentHour >= 17) {
      startDayOffset = 1;
      startSlotIndex = 0;
    } else if (currentHour >= 8) {
      startDayOffset = 0;
      startSlotIndex = 1;
    } else {
      startDayOffset = 0;
      startSlotIndex = 0;
    }
  }

  let dayOffset = startDayOffset;
  let slotIndex = startSlotIndex;
  const slots = [];

  for (let i = 0; i < count; i++) {
    const d = new Date(baseDate);
    d.setDate(d.getDate() + dayOffset);
    const hour = (slotIndex === 0) ? 8 : 17;
    d.setHours(hour, 0, 0, 0);

    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hoursStr = String(hour).padStart(2, '0');
    const localIso = `${year}-${month}-${day}T${hoursStr}:00`;

    slots.push(new Date(localIso).toISOString());

    if (slotIndex === 0) {
      slotIndex = 1;
    } else {
      slotIndex = 0;
      dayOffset++;
    }
  }
  return slots;
}

// 5. Bulk Reels Scheduler Endpoint
app.post('/api/schedule/bulk-reels', upload.array('videos', 50), async (req, res) => {
  try {
    const files = req.files || [];
    let pageIds = [];
    if (typeof req.body.pageIds === 'string') {
      try {
        const parsed = JSON.parse(req.body.pageIds);
        pageIds = Array.isArray(parsed) ? parsed : [parsed];
      } catch (e) {
        pageIds = req.body.pageIds.split(',').map(s => s.trim().replace(/^['"\[\]]|['"\[\]]$/g, ''));
      }
    } else if (Array.isArray(req.body.pageIds)) {
      pageIds = req.body.pageIds;
    } else if (req.body.pageIds) {
      pageIds = [req.body.pageIds];
    }

    if (!Array.isArray(pageIds) || pageIds.length === 0) {
      return res.status(400).json({ error: 'Please select at least one Facebook page.' });
    }

    if (files.length === 0) {
      return res.status(400).json({ error: 'Please select at least one video reel to upload.' });
    }

    const caption = req.body.caption || '';
    const firstComment = req.body.firstComment || '';
    const scheduleMode = req.body.scheduleMode || 'now'; // 'now', 'specific', 'interval'
    const baseTimeStr = req.body.scheduledAt;
    const intervalMinutes = Number(req.body.intervalMinutes) || 15;

    let baseTime = (scheduleMode === 'now' || !baseTimeStr) 
      ? new Date() 
      : new Date(baseTimeStr);

    if (isNaN(baseTime.getTime())) baseTime = new Date();

    const allPages = db.getPages();
    const targetPages = allPages.filter(p => pageIds.includes(p.id));

    if (targetPages.length === 0) {
      return res.status(400).json({ error: 'None of the selected pages were found in the database.' });
    }

    // Parse per-video custom configs if sent by client
    let videoConfigs = [];
    if (req.body.videoConfigs) {
      try {
        videoConfigs = typeof req.body.videoConfigs === 'string'
          ? JSON.parse(req.body.videoConfigs)
          : req.body.videoConfigs;
      } catch (e) {
        console.warn('[Schedule] Could not parse videoConfigs JSON:', e.message);
      }
    }

    const createdJobs = [];
    let jobIndex = 0;
    let cachedBdSlots = null;

    // Create a job for each video and each page
    for (let f = 0; f < files.length; f++) {
      const file = files[f];
      const customConfig = videoConfigs[f] || {};

      const videoCaption = (customConfig.caption && customConfig.caption.trim()) 
        ? customConfig.caption 
        : caption;

      const videoFirstComment = (customConfig.firstComment && customConfig.firstComment.trim()) 
        ? customConfig.firstComment 
        : firstComment;

      for (let p = 0; p < targetPages.length; p++) {
        const page = targetPages[p];
        
        // Calculate scheduled time: Priority to per-video custom date!
        let scheduledAt;
        if (customConfig.scheduledAt) {
          scheduledAt = new Date(customConfig.scheduledAt).toISOString();
        } else if (scheduleMode === 'bd_daily') {
          if (!cachedBdSlots) {
            cachedBdSlots = computeBdSlots(files.length, baseTimeStr);
          }
          scheduledAt = cachedBdSlots[f] || new Date().toISOString();
        } else if (scheduleMode === 'now') {
          scheduledAt = new Date(Date.now() + (jobIndex * 5000)).toISOString();
        } else if (scheduleMode === 'interval') {
          scheduledAt = new Date(baseTime.getTime() + (jobIndex * intervalMinutes * 60 * 1000)).toISOString();
        } else {
          scheduledAt = baseTime.toISOString();
        }

        const job = {
          id: 'job_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
          pageId: page.id,
          pageName: page.name,
          pageAccessToken: page.accessToken,
          videoPath: file.path,
          videoOriginalName: file.originalname,
          videoSize: file.size,
          caption: videoCaption.replace(/\{\{page_name\}\}/gi, page.name),
          firstComment: videoFirstComment.replace(/\{\{page_name\}\}/gi, page.name),
          status: 'SCHEDULED',
          scheduledAt,
          createdAt: new Date().toISOString()
        };

        db.addSchedule(job);
        createdJobs.push(job);
        jobIndex++;
      }
    }

    db.addLog({
      type: 'INFO',
      message: `Created ${createdJobs.length} scheduled Reel job(s) across ${targetPages.length} Facebook page(s).`
    });

    // Check queue immediately if mode is 'now'
    if (scheduleMode === 'now') {
      setTimeout(() => scheduler.checkAndProcessQueue(), 500);
    }

    res.json({
      success: true,
      message: `Successfully scheduled ${createdJobs.length} Reel(s)!`,
      jobsCount: createdJobs.length,
      jobs: createdJobs
    });
  } catch (err) {
    console.error('[Bulk Schedule Error]', err);
    res.status(500).json({ error: err.message });
  }
});

// 6. Schedules List & Control
app.get('/api/schedules', (req, res) => {
  res.json(db.getSchedules());
});

app.post('/api/schedules/:id/run-now', async (req, res) => {
  try {
    const updated = await scheduler.triggerJobNow(req.params.id);
    res.json({ success: true, job: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/schedules/:id', (req, res) => {
  db.deleteSchedule(req.params.id);
  res.json({ success: true });
});

// 7. Activity Logs
app.get('/api/logs', (req, res) => {
  res.json(db.getLogs());
});

// Start background queue scheduler and web server
scheduler.startScheduler();

// HTTP Server
app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🚀 MetaPlanner Pro HTTP  running at: http://localhost:${PORT}`);
});

// HTTPS Server (Self-signed SSL for local Meta OAuth compliance; cloud platforms like Render provide automatic SSL)
if (!process.env.RENDER && !process.env.RAILWAY && process.env.NODE_ENV !== 'production') {
  try {
    const https = require('https');
    const selfsigned = require('selfsigned');
    const pems = selfsigned.generate([{ name: 'commonName', value: 'localhost' }], { days: 365 });
    const HTTPS_PORT = process.env.HTTPS_PORT || 3443;
    
    https.createServer({
      key: pems.private,
      cert: pems.cert
    }, app).listen(HTTPS_PORT, () => {
      console.log(`🔐 MetaPlanner Pro HTTPS running at: https://localhost:${HTTPS_PORT}`);
      console.log(`=======================================================`);
    });
  } catch (sslErr) {
    console.warn('[HTTPS Warning] Could not start HTTPS server:', sslErr.message);
  }
}
