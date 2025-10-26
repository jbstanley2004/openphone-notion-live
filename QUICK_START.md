# 🚀 Quick Start Guide

## Your Worker is LIVE!

**URL:** https://openphone-notion-sync.jstanley82.workers.dev

---

## ⚡ Next Step: Configure OpenPhone Webhook

### 1️⃣ Go to OpenPhone Settings
https://app.openphone.com/settings/api

### 2️⃣ Add Webhook URL
```
https://openphone-notion-sync.jstanley82.workers.dev/webhooks/openphone
```

### 3️⃣ Select All Events
- call.ringing
- call.completed
- call.recording.completed
- call.transcript.completed
- call.summary.completed
- message.received
- message.delivered

### 4️⃣ Save!

---

## ✅ Test It

### Option 1: Make a Real Call
Use your OpenPhone number → Data appears in Notion!

### Option 2: Watch Live Logs
```bash
npm run tail
```

### Option 3: Health Check
```bash
curl https://openphone-notion-sync.jstanley82.workers.dev/health
```

---

## 📊 Monitor

**Dashboard:** https://dash.cloudflare.com/506f4c81d1f66559b4df239fd1e39394/workers/services/view/openphone-notion-sync/production

**Logs:** `npm run tail`

---

## 🎯 Important URLs

- **Worker:** https://openphone-notion-sync.jstanley82.workers.dev
- **Webhook Endpoint:** https://openphone-notion-sync.jstanley82.workers.dev/webhooks/openphone
- **Health Check:** https://openphone-notion-sync.jstanley82.workers.dev/health

---

**Full Details:** See [DEPLOYMENT_COMPLETE.md](./DEPLOYMENT_COMPLETE.md)
