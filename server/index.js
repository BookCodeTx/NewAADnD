import express from "express";
import cors from "cors";
import { parseCharacter } from "./parser.js";

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

app.get("/api/character/:id", async (req, res) => {
  const { id } = req.params;

  if (!/^\d+$/.test(id)) {
    return res.status(400).json({ error: "Invalid character ID" });
  }

  const url = `https://character-service.dndbeyond.com/character/v5/character/${id}`;

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      const errorMap = {
        403: {
          error: "ดึงข้อมูลไม่ได้ — ตัวละครนี้ไม่ได้เปิด Public",
          hint: "กรุณาไปที่ D&D Beyond > Character Settings > เปิด \"Public\" แล้วลองใหม่อีกครั้ง",
          code: "NOT_PUBLIC",
        },
        404: {
          error: "ไม่พบตัวละคร",
          hint: "ตรวจสอบ Character ID หรือ URL อีกครั้ง",
          code: "NOT_FOUND",
        },
      };

      const mapped = errorMap[response.status] || {
        error: `D&D Beyond returned ${response.status}`,
        hint: "ลองใหม่อีกครั้งในภายหลัง",
        code: "UNKNOWN",
      };

      return res.status(response.status).json(mapped);
    }

    const raw = await response.json();
    const parsed = parseCharacter(raw);

    res.json({ success: true, character: parsed });
  } catch (err) {
    console.error("Proxy error:", err.message);
    res.status(500).json({ error: "Failed to fetch character data" });
  }
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, () => {
  console.log(`D&D Proxy running at http://localhost:${PORT}`);
});
