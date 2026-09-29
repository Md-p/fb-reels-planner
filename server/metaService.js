const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');

const GRAPH_API_BASE = 'https://graph.facebook.com/v21.0';

/**
 * Exchange an OAuth authorization code for a User Access Token
 */
async function exchangeCodeForToken({ appId, appSecret, redirectUri, code }) {
  try {
    const res = await axios.get(`${GRAPH_API_BASE}/oauth/access_token`, {
      params: {
        client_id: appId,
        client_secret: appSecret,
        redirect_uri: redirectUri,
        code: code
      }
    });
    return res.data.access_token;
  } catch (err) {
    const errorMsg = err.response?.data?.error?.message || err.message;
    throw new Error(`OAuth Code Exchange Failed: ${errorMsg}`);
  }
}

/**
 * Exchange a short-lived user token for a 60-day long-lived token
 */
async function exchangeForLongLivedToken(appId, appSecret, shortToken) {
  try {
    const res = await axios.get(`${GRAPH_API_BASE}/oauth/access_token`, {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: appId,
        client_secret: appSecret,
        fb_exchange_token: shortToken
      }
    });
    return {
      success: true,
      accessToken: res.data.access_token,
      expiresIn: res.data.expires_in
    };
  } catch (err) {
    const errorMsg = err.response?.data?.error?.message || err.message;
    throw new Error(`Token Exchange Failed: ${errorMsg}`);
  }
}

/**
 * Fetch all pages managed by the user with their Page Access Tokens
 */
async function fetchUserPages(userAccessToken) {
  try {
    const res = await axios.get(`${GRAPH_API_BASE}/me/accounts`, {
      params: {
        fields: 'id,name,access_token,category,picture.type(large),followers_count',
        access_token: userAccessToken,
        limit: 100
      }
    });

    const pages = (res.data.data || []).map(p => ({
      id: p.id,
      name: p.name,
      category: p.category || 'General',
      followers: p.followers_count || 0,
      avatar: p.picture?.data?.url || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=100&auto=format&fit=crop&q=60',
      accessToken: p.access_token,
      isActive: true
    }));

    return pages;
  } catch (err) {
    const errorMsg = err.response?.data?.error?.message || err.message;
    throw new Error(`Failed to fetch Facebook Pages: ${errorMsg}`);
  }
}

/**
 * Upload and publish a Facebook Reel with auto first-comment
 */
async function publishReel({ pageId, pageAccessToken, videoPath, description, firstComment, isSimulated }) {
  if (isSimulated) {
    // Realistic simulation with 1.5s delay
    await new Promise(r => setTimeout(r, 1500));
    const mockVideoId = 'fb_reel_' + Math.floor(100000000000000 + Math.random() * 900000000000000);
    let mockCommentId = null;

    if (firstComment && firstComment.trim()) {
      await new Promise(r => setTimeout(r, 500));
      mockCommentId = `${mockVideoId}_${Math.floor(100000000 + Math.random() * 900000000)}`;
    }

    return {
      success: true,
      simulated: true,
      videoId: mockVideoId,
      videoUrl: `https://www.facebook.com/reel/${mockVideoId}`,
      commentId: mockCommentId,
      firstCommentText: firstComment
    };
  }

  // Real Facebook Graph API Workflow
  try {
    if (!fs.existsSync(videoPath)) {
      throw new Error(`Video file not found at: ${videoPath}`);
    }
    const fileStats = fs.statSync(videoPath);
    const fileSize = fileStats.size;

    // STEP 1: Initialize Reel Upload Session
    const initRes = await axios.post(`${GRAPH_API_BASE}/${pageId}/video_reels`, null, {
      params: {
        upload_phase: 'start',
        access_token: pageAccessToken
      }
    });

    const videoId = initRes.data.video_id;
    const uploadUrl = initRes.data.upload_url;

    if (!videoId || !uploadUrl) {
      throw new Error('Facebook did not return video_id or upload_url in start phase');
    }

    // STEP 2: Upload Video Binary (Buffer with exact Content-Length)
    const videoBuffer = fs.readFileSync(videoPath);
    await axios.post(uploadUrl, videoBuffer, {
      headers: {
        Authorization: `OAuth ${pageAccessToken}`,
        offset: 0,
        file_size: fileSize,
        'Content-Type': 'application/octet-stream'
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity
    });

    // STEP 3: Finish Upload & Publish Reel
    const finishRes = await axios.post(`${GRAPH_API_BASE}/${pageId}/video_reels`, null, {
      params: {
        upload_phase: 'finish',
        access_token: pageAccessToken,
        video_id: videoId,
        video_state: 'PUBLISHED',
        description: description || ''
      }
    });

    let commentId = null;

    // STEP 4: Auto First Comment (with retry for video readiness)
    if (firstComment && firstComment.trim()) {
      await new Promise(r => setTimeout(r, 6000));
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          const commentRes = await axios.post(`${GRAPH_API_BASE}/${videoId}/comments`, null, {
            params: {
              message: firstComment.trim(),
              access_token: pageAccessToken
            }
          });
          commentId = commentRes.data?.id;
          if (commentId) break;
        } catch (cErr) {
          console.warn(`[Comment Attempt ${attempt}] Waiting for video propagation:`, cErr.response?.data?.error?.message || cErr.message);
          await new Promise(r => setTimeout(r, 4000));
        }
      }
    }

    return {
      success: true,
      simulated: false,
      videoId,
      videoUrl: `https://www.facebook.com/reel/${videoId}`,
      commentId,
      firstCommentText: firstComment
    };
  } catch (err) {
    const errorDetail = err.response?.data?.error || err.response?.data || {};
    const message = errorDetail.message || (typeof err.response?.data === 'string' ? err.response?.data : err.message);
    const code = errorDetail.code || 'UNKNOWN';
    throw new Error(`[FB Error ${code}] ${message}`);
  }
}

module.exports = {
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  fetchUserPages,
  publishReel
};
