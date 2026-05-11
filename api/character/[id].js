import { parseCharacter } from "../../server/parser.js";

// Edge Runtime — runs on Vercel Edge Network (Cloudflare) with different IPs
// than standard serverless functions, avoiding D&D Beyond IP blocks
export const config = { runtime: "edge" };

const DNDB_URLS = [
  (id) => `https://character-service.dndbeyond.com/character/v5/character/${id}`,
  (id) => `https://character-service-scds.dndbeyond.com/v1/character/${id}`,
];

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  Origin: "https://www.dndbeyond.com",
  Referer: "https://www.dndbeyond.com/",
  "Sec-Fetch-Dest": "empty",
  "Sec-Fetch-Mode": "cors",
  "Sec-Fetch-Site": "same-site",
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default async function handler(req) {
  // Handle preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: CORS_HEADERS });
  }

  // Extract ID from URL path: /api/character/12345
  const url = new URL(req.url);
  const segments = url.pathname.split("/");
  const id = segments[segments.length - 1];

  if (!/^\d+$/.test(id)) {
    return Response.json({ error: "Invalid character ID" }, { status: 400, headers: CORS_HEADERS });
  }

  let lastError = null;

  for (const urlFn of DNDB_URLS) {
    const dndbUrl = urlFn(id);
    try {
      const response = await fetch(dndbUrl, { headers: BROWSER_HEADERS });

      if (response.ok) {
        const raw = await response.json();
        const parsed = parseCharacter(raw);
        return Response.json({ success: true, character: parsed }, { headers: CORS_HEADERS });
      }

      lastError = { status: response.status };
      console.warn(`[edge-proxy] ${dndbUrl} → ${response.status}`);
    } catch (err) {
      lastError = { status: 500, message: err.message };
      console.warn(`[edge-proxy] ${dndbUrl} threw: ${err.message}`);
    }
  }

  const status = lastError?.status || 500;
  const errorMap = {
    403: {
      error: "ดึงข้อมูลไม่ได้ — ตัวละครนี้ไม่ได้เปิด Public",
      hint: 'ไปที่ D&D Beyond → Character Settings → เปิด "Public" แล้วลองใหม่',
      code: "NOT_PUBLIC",
    },
    404: {
      error: "ไม่พบตัวละคร",
      hint: "ตรวจสอบ Character ID อีกครั้ง",
      code: "NOT_FOUND",
    },
  };

  const mapped = errorMap[status] || {
    error: `D&D Beyond error (${status})`,
    hint: "ลองใหม่อีกครั้ง",
    code: "UNKNOWN",
  };

  return Response.json(mapped, { status, headers: CORS_HEADERS });
}
