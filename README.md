# MetaPlanner Pro 🚀
### Bulk Facebook Reels & Post Scheduler with Auto First-Comment

A complete self-hosted web application for managing multiple Facebook Pages, bulk scheduling video Reels, and automatically posting first comments (affiliate links, CTAs, hashtags) the moment reels go live.

---

### Features
1. **Bulk Reels Uploader**: Upload 1 to 50 video reels at once.
2. **Bulk Facebook Page Targeter**: Select multiple pages simultaneously.
3. **Auto First-Comment Automation**: Automatically publishes your first comment with links/CTAs via Meta Graph API comments endpoint upon reel publish.
4. **Smart Drip / Interval Scheduling**: Space out reels by 10, 15, 30, or 60 minutes to protect page reach and avoid Facebook spam triggers.
5. **60-Day Long-Lived Token Exchange**: Automatically converts short-lived tokens into 60-day permanent page tokens using your App ID & App Secret.
6. **Live Execution Queue & Logs**: Real-time worker checking every 5 seconds to process scheduled jobs and log responses.
7. **Simulation / Sandbox Mode**: Safely test the entire upload, scheduling, timers, and comment workflow before publishing to real Facebook pages!

---

### Quick Start

```bash
# 1. Start the server
npm start

# 2. Open your browser at
http://localhost:3000
```
