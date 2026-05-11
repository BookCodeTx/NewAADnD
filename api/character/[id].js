import { parseCharacter } from "../../server/parser.js";

const DNDB_URLS = [
  // Primary: public character JSON endpoint (works without auth)
  (id) => `https://character-service-scds.dndbeyond.com/v1/character/${id}`,
  // Fallback: legacy v5 endpoint
  (id) => `https://character-service.dndbeyond.com/character/v5/character/${id}`,
];

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  Origin: "https://www.dndbeyond.com",
  Referer: "https://www.dndbeyond.com/",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-site",
  "Sec-Ch-Ua": '"Chromium";v="131", "Not_A Brand";v="24"',
  "Sec-Ch-Ua-Mobile": "?0",
  "Sec-Ch-Ua-Platform": '"Windows"',
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const { id } = req.query;

  if (!/^\d+$/.test(id)) {
    return res.status(400).json({ error: "Invalid character ID" });
  }

  let lastError = null;

  // Try each endpoint in order
  for (const urlFn of DNDB_URLS) {
    const url = urlFn(id);
    try {
      const response = await fetch(url, { headers: BROWSER_HEADERS });

      if (response.ok) {
        const raw = await response.json();
        const parsed = parseCharacter(raw);
        return res.json({ success: true, character: parsed });
      }

      lastError = { status: response.status, url };
      console.warn(`[proxy] ${url} returned ${response.status}, trying next...`);
    } catch (err) {
      lastError = { status: 500, message: err.message, url };
      console.warn(`[proxy] ${url} threw: ${err.message}, trying next...`);
    }
  }

  // All endpoints failed
  const status = lastError?.status || 500;
  const errorMap = {
    403: {
      error: "ดึงข้อมูลไม่ได้ — ตัวละครนี้ไม่ได้เปิด Public",
      hint: 'กรุณาไปที่ D&D Beyond → Character Settings → เปิด "Public" แล้วลองใหม่',
      code: "NOT_PUBLIC",
    },
    404: {
      error: "ไม่พบตัวละคร",
      hint: "ตรวจสอบ Character ID หรือ URL อีกครั้ง",
      code: "NOT_FOUND",
    },
  };

  const mapped = errorMap[status] || {
    error: `D&D Beyond ไม่ตอบกลับ (${status})`,
    hint: "ลองใหม่อีกครั้ง หรือตรวจสอบว่าตัวละครเป็น Public",
    code: "UNKNOWN",
  };

  return res.status(status).json(mapped);
}
