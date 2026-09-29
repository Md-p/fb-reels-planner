const db = require('./db');
const metaService = require('./metaService');

let isRunning = false;

async function checkAndProcessQueue() {
  if (isRunning) return;
  isRunning = true;

  try {
    const schedules = db.getSchedules();
    const settings = db.getSettings();
    const now = new Date();

    const pending = schedules.filter(s => s.status === 'SCHEDULED' && new Date(s.scheduledAt) <= now);

    for (const job of pending) {
      console.log(`[Scheduler] Processing Job: ${job.id} for Page: ${job.pageName}`);

      db.updateSchedule(job.id, { status: 'PROCESSING', startedAt: new Date().toISOString() });
      db.addLog({
        type: 'PROCESSING',
        jobId: job.id,
        pageName: job.pageName,
        message: `Publishing Reel to Facebook page "${job.pageName}"...`
      });

      try {
        const isSimulated = settings.simulationMode || !job.pageAccessToken || job.pageAccessToken.startsWith('DEMO_');
        
        const result = await metaService.publishReel({
          pageId: job.pageId,
          pageAccessToken: job.pageAccessToken,
          videoPath: job.videoPath,
          description: job.caption,
          firstComment: job.firstComment,
          isSimulated
        });

        db.updateSchedule(job.id, {
          status: 'COMPLETED',
          completedAt: new Date().toISOString(),
          fbVideoId: result.videoId,
          fbVideoUrl: result.videoUrl,
          commentId: result.commentId,
          simulated: result.simulated
        });

        db.addLog({
          type: 'SUCCESS',
          jobId: job.id,
          pageName: job.pageName,
          message: `Reel successfully published! [Video ID: ${result.videoId}]` + 
                   (result.commentId ? ` and auto first-comment posted [ID: ${result.commentId}]` : ''),
          url: result.videoUrl
        });

        console.log(`[Scheduler] Job ${job.id} Completed Successfully!`);
      } catch (err) {
        console.error(`[Scheduler] Job ${job.id} Failed:`, err.message);
        db.updateSchedule(job.id, {
          status: 'FAILED',
          failedAt: new Date().toISOString(),
          error: err.message
        });

        db.addLog({
          type: 'ERROR',
          jobId: job.id,
          pageName: job.pageName,
          message: `Reel publishing failed: ${err.message}`
        });
      }
    }
  } catch (err) {
    console.error('[Scheduler] Error in queue runner:', err);
  } finally {
    isRunning = false;
  }
}

async function triggerJobNow(jobId) {
  const schedules = db.getSchedules();
  const job = schedules.find(s => s.id === jobId);
  if (!job) throw new Error('Job not found');

  db.updateSchedule(jobId, { scheduledAt: new Date(Date.now() - 1000).toISOString(), status: 'SCHEDULED' });
  await checkAndProcessQueue();
  return db.getSchedules().find(s => s.id === jobId);
}

function startScheduler() {
  console.log('[Scheduler] Background Worker Started (Polling every 5s)...');
  setInterval(checkAndProcessQueue, 5000);
}

module.exports = {
  startScheduler,
  triggerJobNow,
  checkAndProcessQueue
};
