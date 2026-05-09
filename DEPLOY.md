# DnD Hotbar Extension — Deployment Guide

## สารบัญ

1. [Git Push ขึ้น GitHub](#1-git-push-ขึ้น-github)
2. [Frontend Deployment (Vercel)](#2-frontend-deployment-vercel)
3. [Backend Deployment](#3-backend-deployment)
   - [Option A: Vercel Serverless (แนะนำ)](#option-a-vercel-serverless-แนะนำ)
   - [Option B: Render (Express แยกต่างหาก)](#option-b-render-express-แยกต่างหาก)
4. [Owlbear Rodeo Setup](#4-owlbear-rodeo-setup)
5. [ทดสอบระบบ](#5-ทดสอบระบบ)

---

## 1. Git Push ขึ้น GitHub

### 1.1 ตรวจสอบ .gitignore

โปรเจกต์มีไฟล์ `.gitignore` อยู่แล้ว ป้องกันไม่ให้ไฟล์ต่อไปนี้หลุดขึ้น GitHub:

```
node_modules/        # dependencies (ทั้ง root และ server/)
dist/                # build output
.env                 # secrets / environment variables
.env.local
.vercel/             # Vercel CLI cache
```

### 1.2 Initialize และ Push

เปิด Terminal ที่โฟลเดอร์โปรเจกต์ แล้วรันทีละบรรทัด:

```bash
cd C:\Users\bookg\Desktop\DnD

# Initialize git repository
git init

# เพิ่มไฟล์ทั้งหมด (ยกเว้นที่อยู่ใน .gitignore)
git add .

# ตรวจสอบว่าไม่มี node_modules หรือ .env ติดเข้ามา
git status

# ถ้าเห็น node_modules หรือ .env ในรายการ ให้รัน:
# git rm -r --cached node_modules
# git rm --cached .env

# Commit ครั้งแรก
git commit -m "Initial commit: DnD Hotbar Extension (Phase 1-8)"

# เชื่อมกับ GitHub Repository
git remote add origin https://github.com/BookCodeTx/NewAADnD.git

# เปลี่ยนชื่อ branch เป็น main (ถ้ายังเป็น master)
git branch -M main

# Push ขึ้น GitHub
git push -u origin main
```

> ถ้าถูกถามรหัสผ่าน ให้ใช้ **Personal Access Token** (ไม่ใช่รหัส GitHub)
> สร้างได้ที่: GitHub > Settings > Developer settings > Personal access tokens > Tokens (classic)

### 1.3 ตรวจสอบว่าสำเร็จ

เปิด https://github.com/BookCodeTx/NewAADnD แล้วตรวจสอบว่า:
- เห็นไฟล์ `index.html`, `main.js`, `package.json`, `vite.config.js`
- เห็นโฟลเดอร์ `server/`, `api/`, `public/`
- **ไม่เห็น** `node_modules/` หรือ `.env`

---

## 2. Frontend Deployment (Vercel)

### 2.1 สร้างบัญชี Vercel

1. ไปที่ https://vercel.com
2. กด **Sign Up** → เลือก **Continue with GitHub**
3. Authorize Vercel ให้เข้าถึง GitHub ของคุณ

### 2.2 Import โปรเจกต์

1. ที่หน้า Dashboard กด **Add New... → Project**
2. เลือก Repository **BookCodeTx/NewAADnD**
   - ถ้าไม่เห็น ให้กด "Adjust GitHub App Permissions" แล้วเพิ่ม repo
3. ตั้งค่า Build:
   - **Framework Preset**: `Vite` (Vercel จะตรวจจับอัตโนมัติ)
   - **Build Command**: `vite build` (ค่าเริ่มต้น ไม่ต้องแก้)
   - **Output Directory**: `dist` (ค่าเริ่มต้น ไม่ต้องแก้)
   - **Install Command**: `npm install` (ค่าเริ่มต้น ไม่ต้องแก้)

### 2.3 ตั้งค่า Environment Variable

ในหน้า Import Project ก่อนกด Deploy:

1. เลื่อนลงไปที่ **Environment Variables**
2. เพิ่ม:

| Key | Value | หมายเหตุ |
|-----|-------|---------|
| `VITE_PROXY_URL` | *(เว้นว่าง)* | ใช้ Serverless ที่ same origin |

> ถ้าเลือก Option B (Render) ให้ใส่ URL ของ Render backend แทน เช่น `https://dnd-proxy-xxxx.onrender.com`

### 2.4 Deploy

1. กด **Deploy**
2. รอ 1-2 นาที จนเห็น **"Congratulations!"**
3. จด URL ที่ได้ เช่น: `https://new-aa-dn-d.vercel.app`

### 2.5 Auto Deploy

ทุกครั้งที่ `git push` ไปที่ branch `main` → Vercel จะ build ใหม่อัตโนมัติ:

```bash
# ตัวอย่าง: แก้โค้ดแล้ว push
git add .
git commit -m "Update spell damage values"
git push
# → Vercel rebuild อัตโนมัติ ใน 1-2 นาที
```

---

## 3. Backend Deployment

### Option A: Vercel Serverless (แนะนำ)

**ไม่ต้องทำอะไรเพิ่ม!** โปรเจกต์มี serverless function พร้อมแล้ว:

```
api/
  character/
    [id].js    ← Vercel สร้าง API route อัตโนมัติ
```

เมื่อ Deploy ใน Step 2 แล้ว API จะพร้อมใช้ที่:

```
https://new-aa-dn-d.vercel.app/api/character/123456
```

#### ทดสอบ API

เปิด Browser แล้วเข้า:

```
https://<your-vercel-url>/api/character/12345
```

ถ้าเห็น JSON response (หรือ error 403/404) = API ทำงานปกติ

#### ข้อดีของ Option A
- ไม่ต้องจัดการ server แยก
- ไม่มีปัญหา CORS (same origin)
- Free tier ของ Vercel รองรับ 100,000 requests/เดือน
- Auto-deploy พร้อม frontend

---

### Option B: Render (Express แยกต่างหาก)

ใช้วิธีนี้ถ้าต้องการ server แยก หรือ Vercel Serverless มีปัญหา

#### 3B.1 สร้างบัญชี Render

1. ไปที่ https://render.com
2. Sign up ด้วย GitHub

#### 3B.2 สร้าง Web Service ใหม่

1. กด **New → Web Service**
2. เชื่อมกับ repo **BookCodeTx/NewAADnD**
3. ตั้งค่า:

| Setting | Value |
|---------|-------|
| **Name** | `dnd-proxy` |
| **Region** | Singapore (ใกล้สุด) |
| **Root Directory** | `server` |
| **Runtime** | Node |
| **Build Command** | `npm install` |
| **Start Command** | `node index.js` |
| **Instance Type** | Free |

4. กด **Create Web Service**
5. รอ 2-3 นาที จนเห็น **"Live"**
6. จด URL ที่ได้ เช่น: `https://dnd-proxy-xxxx.onrender.com`

#### 3B.3 ทดสอบ Backend

```bash
curl https://dnd-proxy-xxxx.onrender.com/health
# ควรได้: {"status":"ok"}
```

#### 3B.4 เชื่อม Frontend กับ Backend ตัวใหม่

กลับไปที่ **Vercel Dashboard**:

1. เลือก Project → **Settings** → **Environment Variables**
2. แก้ไข `VITE_PROXY_URL`:

```
VITE_PROXY_URL = https://dnd-proxy-xxxx.onrender.com
```

3. กด **Save**
4. ไปที่ **Deployments** → กด **⋯** ที่ deployment ล่าสุด → **Redeploy**

> **หมายเหตุ Render Free Tier**: Server จะ sleep หลังไม่มี request 15 นาที
> request แรกหลัง sleep จะช้า ~30 วินาที (cold start)

---

## 4. Owlbear Rodeo Setup

### 4.1 เตรียม manifest.json URL

ไฟล์ `manifest.json` จะอยู่ที่ `public/` ซึ่ง Vercel serve ตรง root:

```
https://<your-vercel-url>/manifest.json
```

ตัวอย่าง: `https://new-aa-dn-d.vercel.app/manifest.json`

### 4.2 ติดตั้ง Extension ใน Owlbear Rodeo

1. เปิด https://www.owlbear.rodeo แล้วเข้าห้องเกม
2. คลิกไอคอน **ปลั๊ก** (Extensions) ที่แถบด้านซ้าย
   - หรือกด **⋯ (More)** → **Extensions**
3. คลิก **+ Install Extension** (มุมขวาบน)
4. วาง URL ของ manifest.json:

```
https://new-aa-dn-d.vercel.app/manifest.json
```

5. กด **Install**
6. Extension จะปรากฏในแถบด้านซ้ายพร้อมไอคอน 🎲

### 4.3 ใช้งาน Extension

1. คลิกไอคอน Extension ที่แถบซ้าย → Hotbar popover จะเปิดขึ้น
2. วาง Token บนแผนที่แล้วคลิกเลือก
3. Link ตัวละครจาก D&D Beyond หรือวาง Monster JSON
4. ใช้ Hotbar buttons: Attack, Spell, Status, etc.

### 4.4 แชร์กับผู้เล่นคนอื่น

ผู้เล่นทุกคนในห้องเดียวกันจะเห็น Extension อัตโนมัติ
(ไม่ต้องติดตั้งซ้ำ — DM ติดตั้งครั้งเดียวก็พอ)

---

## 5. ทดสอบระบบ

### Checklist หลัง Deploy

- [ ] เปิด `https://<vercel-url>/manifest.json` ใน browser → เห็น JSON
- [ ] เปิด `https://<vercel-url>/api/character/12345` → เห็น error JSON (ไม่ 500)
- [ ] ติดตั้ง Extension ใน Owlbear Rodeo สำเร็จ
- [ ] เลือก Token → เห็น Hotbar
- [ ] Link D&D Beyond character → เห็นข้อมูลตัวละคร
- [ ] กดปุ่ม Attack → เลือกเป้าหมาย → ลูกเต๋า 3D หมุน → เห็นผล
- [ ] ได้ยินเสียง SFX (dice hit, attack hit/miss)
- [ ] เห็นตัวเลข Floating Damage บนแผนที่

### แก้ปัญหาที่พบบ่อย

| ปัญหา | สาเหตุ | วิธีแก้ |
|-------|--------|--------|
| Extension ไม่แสดงใน OBR | URL manifest ผิด | ตรวจสอบว่า URL ลงท้ายด้วย `/manifest.json` |
| "ดึงข้อมูลไม่ได้" 403 | ตัวละครไม่ได้เปิด Public | ไป D&D Beyond → Character Settings → เปิด Public |
| Proxy error 500 | API ล่ม / cold start | รอ 30 วินาทีแล้วลองใหม่ (Render free tier) |
| เสียงไม่ดัง | Browser block autoplay | คลิกที่ไหนก็ได้ในหน้า OBR 1 ครั้งก่อน |
| ลูกเต๋าไม่หมุน | dice-assets ไม่ถูก copy | ตรวจสอบ `dist/dice-assets/` มีไฟล์ |

---

## โครงสร้างไฟล์สำคัญ

```
DnD/
├── api/
│   └── character/
│       └── [id].js          ← Vercel Serverless Function
├── public/
│   ├── manifest.json        ← OBR Extension manifest
│   └── icon.svg
├── server/
│   ├── index.js             ← Express proxy (local dev / Render)
│   ├── parser.js            ← D&D Beyond JSON parser
│   └── package.json
├── index.html               ← Main popover UI
├── dice.html                ← 3D dice modal
├── floater.html             ← Floating damage modal
├── main.js                  ← Extension logic
├── dice.js                  ← Dice box controller
├── floater.js               ← Damage floater controller
├── sfx.js                   ← Web Audio sound effects
├── spells.js                ← Spell data & helpers
├── conditions.js            ← Condition data & helpers
├── vite.config.js           ← Vite build config
├── vercel.json              ← Vercel deployment config
├── package.json
├── .gitignore
└── .env.example             ← Template for env vars
```
