const { createApp } = Vue;

createApp({
  data() {
    return {
      currentTab: 'dashboard',
      stats: {
        activePages: 0,
        pending: 0,
        completed: 0,
        failed: 0
      },
      pages: [],
      schedules: [],
      accounts: [],
      selectedAccountFilter: 'all',
      logs: [],
      settings: {
        appId: '',
        appSecret: '',
        userToken: '',
        simulationMode: true
      },
      selectedVideos: [],
      selectedPageIds: [],
      bdPreset: {
        enabled: true,
        startDate: '',
        slot1Time: '08:00',
        slot2Time: '17:00'
      },
      formData: {
        caption: '🔥 Amazing Reel! What do you think about this? Drop your thoughts below! 👇\n\n#reels #viral #trending #reelsfb',
        firstComment: '👉 Follow for more daily reels! Check out our official links here: https://yourwebsite.com',
        scheduleMode: 'bd_daily',
        scheduledAt: '',
        intervalMinutes: 15
      },
      isSubmitting: false,
      isSyncing: false,
      isConnecting: false,
      showAddPageModal: false,
      newPage: {
        name: '',
        id: '',
        category: 'Entertainment',
        followers: 5000,
        accessToken: ''
      },
      toast: {
        show: false,
        message: '',
        type: 'success'
      },
      pollingInterval: null
    };
  },
  computed: {
    currentTabTitle() {
      const titles = {
        dashboard: 'Dashboard Overview',
        reels: 'Bulk Reels Scheduler & Auto First-Comment',
        pages: 'Connected Facebook Pages',
        queue: 'Live Execution Queue',
        logs: 'Meta Graph API Activity Logs',
        settings: 'Meta Developer App & Tokens'
      };
      return titles[this.currentTab] || 'MetaPlanner Pro';
    },
    filteredPages() {
      if (this.selectedAccountFilter === 'all') return this.pages;
      return this.pages.filter(p => p.accountId === this.selectedAccountFilter);
    }
  },
  mounted() {
    // Check URL query parameters for OAuth results
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('connected')) {
      const count = urlParams.get('count');
      this.showToast(`🎉 Facebook Login successful! Synced ${count || ''} page(s).`);
      this.currentTab = 'pages';
      window.history.replaceState({}, document.title, window.location.pathname);
    } else if (urlParams.get('error')) {
      this.showToast(decodeURIComponent(urlParams.get('error')), 'error');
      this.currentTab = 'settings';
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    // Set default starting date for BD daily slots (8 AM & 5 PM)
    const now = new Date();
    const startDateObj = new Date(now);
    // If today is already past 17:00 (5 PM), next slot starts tomorrow!
    if (now.getHours() >= 17) {
      startDateObj.setDate(startDateObj.getDate() + 1);
    }
    const y = startDateObj.getFullYear();
    const m = String(startDateObj.getMonth() + 1).padStart(2, '0');
    const d = String(startDateObj.getDate()).padStart(2, '0');
    this.bdPreset.startDate = `${y}-${m}-${d}`;

    // Set fallback interval schedule time
    const nextTime = new Date(Date.now() + 10 * 60000);
    const localIso = new Date(nextTime.getTime() - (nextTime.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
    this.formData.scheduledAt = localIso;

    this.fetchAllData();

    // Start auto-poll every 4 seconds
    this.pollingInterval = setInterval(() => {
      this.fetchStats();
      this.fetchSchedules();
      this.fetchLogs();
    }, 4000);
  },
  beforeUnmount() {
    if (this.pollingInterval) clearInterval(this.pollingInterval);
  },
  methods: {
    copyText(text, successMsg = 'Copied to clipboard!') {
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text).then(() => {
          this.showToast(successMsg);
        }).catch(() => {
          this.fallbackCopy(text, successMsg);
        });
      } else {
        this.fallbackCopy(text, successMsg);
      }
    },
    fallbackCopy(text, successMsg) {
      const el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      this.showToast(successMsg);
    },
    async startFacebookLogin() {
      if (!this.settings.appId || !this.settings.appId.trim()) {
        this.showToast('Please enter your Facebook App ID first!', 'error');
        this.currentTab = 'settings';
        return;
      }
      if (!this.settings.appSecret || !this.settings.appSecret.trim()) {
        this.showToast('Please enter your Facebook App Secret first!', 'error');
        this.currentTab = 'settings';
        return;
      }

      // Save settings first
      await this.saveSettings();

      // Redirect to Facebook OAuth entrypoint
      window.location.href = `/auth/facebook?appId=${encodeURIComponent(this.settings.appId.trim())}&appSecret=${encodeURIComponent(this.settings.appSecret.trim())}`;
    },
    async connectAnotherAccount() {
      if (!this.settings.appId || !this.settings.appId.trim()) {
        this.showToast('Please save your Facebook App ID in Settings first!', 'error');
        this.currentTab = 'settings';
        return;
      }
      await this.saveSettings();
      // reauth=true forces Facebook to show account switcher!
      window.location.href = `/auth/facebook?appId=${encodeURIComponent(this.settings.appId.trim())}&appSecret=${encodeURIComponent(this.settings.appSecret.trim())}&reauth=true`;
    },
    async fetchAccounts() {
      try {
        const res = await fetch('/api/accounts');
        this.accounts = await res.json();
      } catch (e) {
        console.error('Failed to fetch accounts:', e);
      }
    },
    async removeAccount(id) {
      if (!confirm('Disconnect this Facebook profile?')) return;
      try {
        await fetch(`/api/accounts/${id}`, { method: 'DELETE' });
        this.showToast('Account profile disconnected.');
        await this.fetchAccounts();
      } catch (e) {
        this.showToast(e.message, 'error');
      }
    },
    showToast(message, type = 'success') {
      this.toast.message = message;
      this.toast.type = type;
      this.toast.show = true;
      setTimeout(() => {
        this.toast.show = false;
      }, 4000);
    },
    async fetchAllData() {
      await Promise.all([
        this.fetchStats(),
        this.fetchAccounts(),
        this.fetchPages(),
        this.fetchSchedules(),
        this.fetchLogs(),
        this.fetchSettings()
      ]);
    },
    async fetchStats() {
      try {
        const res = await fetch('/api/stats');
        this.stats = await res.json();
      } catch (e) {
        console.error('Failed to fetch stats:', e);
      }
    },
    async fetchPages() {
      try {
        const res = await fetch('/api/pages');
        this.pages = await res.json();
        if (this.selectedPageIds.length === 0 && this.pages.length > 0) {
          this.selectedPageIds = this.pages.map(p => p.id);
        }
      } catch (e) {
        console.error('Failed to fetch pages:', e);
      }
    },
    async fetchSchedules() {
      try {
        const res = await fetch('/api/schedules');
        this.schedules = await res.json();
      } catch (e) {
        console.error('Failed to fetch schedules:', e);
      }
    },
    async fetchLogs() {
      try {
        const res = await fetch('/api/logs');
        this.logs = await res.json();
      } catch (e) {
        console.error('Failed to fetch logs:', e);
      }
    },
    async fetchSettings() {
      try {
        const res = await fetch('/api/settings');
        this.settings = await res.json();
      } catch (e) {
        console.error('Failed to fetch settings:', e);
      }
    },
    async saveSettings() {
      try {
        const res = await fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.settings)
        });
        const data = await res.json();
        if (data.success) {
          this.showToast('Settings saved successfully!');
        }
      } catch (e) {
        this.showToast('Error saving settings: ' + e.message, 'error');
      }
    },
    async connectMeta() {
      if (!this.settings.userToken) {
        return this.showToast('Please enter your Facebook User Access Token.', 'error');
      }
      this.isConnecting = true;
      try {
        const res = await fetch('/api/auth/connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.settings)
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        this.showToast(data.message || 'Connected and synced pages successfully!');
        await this.fetchAllData();
        this.currentTab = 'pages';
      } catch (err) {
        this.showToast(err.message, 'error');
      } finally {
        this.isConnecting = false;
      }
    },
    async syncMetaPages() {
      if (!this.settings.userToken) {
        this.showToast('Configure your User Access Token in Settings first!', 'error');
        this.currentTab = 'settings';
        return;
      }
      this.isSyncing = true;
      try {
        const res = await fetch('/api/auth/connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.settings)
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        this.showToast(data.message || 'Pages synced successfully!');
        await this.fetchPages();
      } catch (err) {
        this.showToast(err.message, 'error');
      } finally {
        this.isSyncing = false;
      }
    },
    handleFileSelect(event) {
      const files = Array.from(event.target.files);
      this.addVideos(files);
    },
    handleFileDrop(event) {
      const files = Array.from(event.dataTransfer.files).filter(f => f.type.startsWith('video/'));
      this.addVideos(files);
    },
    getBdSlots(count, startDateStr) {
      const now = new Date();
      let baseDate;
      let isDefaultAuto = false;

      if (startDateStr) {
        const parts = startDateStr.split('-').map(Number);
        baseDate = new Date(parts[0], parts[1] - 1, parts[2]);
        const isToday = baseDate.toDateString() === now.toDateString();
        if (isToday) {
          isDefaultAuto = true;
        }
      } else {
        baseDate = new Date();
        isDefaultAuto = true;
      }

      let startDayOffset = 0;
      let startSlotIndex = 0; // 0 = 8:00 AM, 1 = 5:00 PM (17:00)

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

        const monthShort = d.toLocaleString('en-US', { month: 'short' });
        const dayNum = d.getDate();
        const slotText = slotIndex === 0 ? 'সকাল ৮:০০ AM' : 'বিকাল ৫:০০ PM';
        const dayLabel = `দিন ${dayOffset + 1}`;
        const slotBadge = `${monthShort} ${dayNum} &bull; ${slotText}`;
        const slotLabel = `${dayLabel} (${monthShort} ${dayNum}) - ${slotText}`;

        slots.push({
          scheduledAt: localIso,
          slotBadge,
          slotLabel,
          dayOffset,
          slotIndex
        });

        if (slotIndex === 0) {
          slotIndex = 1;
        } else {
          slotIndex = 0;
          dayOffset++;
        }
      }

      return slots;
    },
    applyBdSchedule(explicitStartDate, notify = true) {
      const startDate = explicitStartDate || this.bdPreset.startDate;
      const slots = this.getBdSlots(this.selectedVideos.length, startDate);
      this.selectedVideos.forEach((v, idx) => {
        if (slots[idx]) {
          v.scheduledAt = slots[idx].scheduledAt;
          v.slotBadge = slots[idx].slotBadge;
          v.slotLabel = slots[idx].slotLabel;
        }
      });
      if (notify && this.selectedVideos.length > 0) {
        this.showToast(`🇧🇩 BD Time Slots Active: প্রতিদিন ২টি রিল (সকাল ৮টা ও বিকাল ৫টা)!`);
      }
    },
    addVideos(files) {
      files.forEach(file => {
        this.selectedVideos.push({
          file: file,
          name: file.name,
          size: file.size,
          scheduledAt: '',
          slotBadge: '',
          slotLabel: '',
          customCaption: '',
          customFirstComment: '',
          showCustomDetails: false
        });
      });
      // Automatically apply BD 8am & 5pm slots to all uploaded reels by default!
      this.applyBdSchedule(this.bdPreset.startDate, true);
    },
    removeVideo(index) {
      this.selectedVideos.splice(index, 1);
      // Auto re-sequence the remaining videos so 8am & 5pm slots remain continuous!
      if (this.formData.scheduleMode === 'bd_daily') {
        this.applyBdSchedule(this.bdPreset.startDate, false);
      }
    },
    applyBatchSpread(intervalMins) {
      let startTime = this.formData.scheduledAt ? new Date(this.formData.scheduledAt) : new Date(Date.now() + 10 * 60000);
      if (isNaN(startTime.getTime())) startTime = new Date(Date.now() + 10 * 60000);

      this.selectedVideos.forEach((v, idx) => {
        const d = new Date(startTime.getTime() + (idx * intervalMins * 60000));
        v.scheduledAt = new Date(d.getTime() - (d.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
      });
      this.showToast(`Updated schedule times with ${intervalMins}-minute intervals!`);
    },
    adjustVideoTime(index, minutesToAdd) {
      const v = this.selectedVideos[index];
      if (!v) return;
      const current = v.scheduledAt ? new Date(v.scheduledAt) : new Date();
      const updated = new Date(current.getTime() + (minutesToAdd * 60000));
      v.scheduledAt = new Date(updated.getTime() - (updated.getTimezoneOffset() * 60000)).toISOString().slice(0, 16);
    },
    selectAllPages() {
      this.selectedPageIds = this.pages.map(p => p.id);
    },
    togglePageSelection(pageId) {
      const idx = this.selectedPageIds.indexOf(pageId);
      if (idx >= 0) {
        this.selectedPageIds.splice(idx, 1);
      } else {
        this.selectedPageIds.push(pageId);
      }
    },
    async submitBulkSchedule() {
      if (this.selectedVideos.length === 0) {
        return this.showToast('Please upload at least one video reel.', 'error');
      }
      if (this.selectedPageIds.length === 0) {
        return this.showToast('Please select at least one Facebook page.', 'error');
      }

      this.isSubmitting = true;
      try {
        const data = new FormData();
        this.selectedVideos.forEach(v => data.append('videos', v.file));
        data.append('pageIds', JSON.stringify(this.selectedPageIds));
        data.append('caption', this.formData.caption);
        data.append('firstComment', this.formData.firstComment);
        data.append('scheduleMode', this.formData.scheduleMode);
        data.append('scheduledAt', this.formData.scheduledAt);
        data.append('intervalMinutes', this.formData.intervalMinutes);

        // Include per-video custom configs!
        const videoConfigs = this.selectedVideos.map(v => ({
          scheduledAt: v.scheduledAt,
          caption: v.customCaption,
          firstComment: v.customFirstComment
        }));
        data.append('videoConfigs', JSON.stringify(videoConfigs));

        const res = await fetch('/api/schedule/bulk-reels', {
          method: 'POST',
          body: data
        });
        const result = await res.json();

        if (result.error) throw new Error(result.error);

        this.showToast(result.message || 'Reels successfully scheduled!');
        this.selectedVideos = [];
        await this.fetchAllData();
        this.currentTab = 'queue';
      } catch (err) {
        this.showToast(err.message, 'error');
      } finally {
        this.isSubmitting = false;
      }
    },
    async runJobNow(jobId) {
      try {
        const res = await fetch(`/api/schedules/${jobId}/run-now`, { method: 'POST' });
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        this.showToast('Job triggered for immediate publishing!');
        await this.fetchSchedules();
        await this.fetchLogs();
      } catch (e) {
        this.showToast(e.message, 'error');
      }
    },
    async deleteJob(jobId) {
      try {
        await fetch(`/api/schedules/${jobId}`, { method: 'DELETE' });
        this.showToast('Scheduled reel deleted.');
        await this.fetchSchedules();
        await this.fetchStats();
      } catch (e) {
        this.showToast(e.message, 'error');
      }
    },
    async submitAddPage() {
      if (!this.newPage.name || !this.newPage.id) {
        return this.showToast('Page name and ID are required.', 'error');
      }
      try {
        const res = await fetch('/api/pages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(this.newPage)
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        this.showToast(`Page "${this.newPage.name}" added successfully!`);
        this.showAddPageModal = false;
        this.newPage = { name: '', id: '', category: 'Entertainment', followers: 5000, accessToken: '' };
        await this.fetchPages();
      } catch (e) {
        this.showToast(e.message, 'error');
      }
    },
    async deletePage(pageId) {
      if (!confirm('Are you sure you want to remove this page from planner?')) return;
      try {
        await fetch(`/api/pages/${pageId}`, { method: 'DELETE' });
        this.showToast('Page removed.');
        await this.fetchPages();
        await this.fetchStats();
      } catch (e) {
        this.showToast(e.message, 'error');
      }
    },
    isBdSlot(isoString) {
      if (!isoString) return false;
      const d = new Date(isoString);
      const h = d.getHours();
      const m = d.getMinutes();
      return (h === 8 || h === 17) && m === 0;
    },
    getBdSlotLabel(isoString) {
      if (!isoString) return '';
      const d = new Date(isoString);
      return d.getHours() === 8 ? '🇧🇩 সকাল ৮:০০ AM' : '🇧🇩 বিকাল ৫:০০ PM';
    },
    formatDate(isoString) {
      if (!isoString) return '-';
      try {
        const d = new Date(isoString);
        const datePart = d.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric'
        });
        const timePart = d.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        });
        return `${datePart}, ${timePart}`;
      } catch (e) {
        return isoString;
      }
    },
    formatFollowers(num) {
      if (!num) return '0';
      if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
      if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
      return num;
    },
    getStatusBadgeClass(status) {
      switch (status) {
        case 'COMPLETED':
          return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
        case 'SCHEDULED':
          return 'bg-blue-500/10 text-blue-400 border-blue-500/30';
        case 'PROCESSING':
          return 'bg-amber-500/10 text-amber-400 border-amber-500/30 animate-pulse';
        case 'FAILED':
          return 'bg-red-500/10 text-red-400 border-red-500/30';
        default:
          return 'bg-slate-800 text-slate-400 border-slate-700';
      }
    },
    getLogBadgeClass(type) {
      switch (type) {
        case 'SUCCESS':
          return 'bg-emerald-500/20 text-emerald-300';
        case 'ERROR':
          return 'bg-red-500/20 text-red-300';
        case 'PROCESSING':
          return 'bg-amber-500/20 text-amber-300';
        default:
          return 'bg-blue-500/20 text-blue-300';
      }
    }
  }
}).mount('#app');
