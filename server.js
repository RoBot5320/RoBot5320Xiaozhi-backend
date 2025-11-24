const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

const PORT = process.env.PORT || 3000;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// ---------------------------
//  Bộ nhớ hội thoại theo device_id
// ---------------------------
const conversations = {}; // { device_id: [ {role, content}, ... ] }

// Get history helper
function getHistory(deviceId) {
  if (!conversations[deviceId]) conversations[deviceId] = [];
  return conversations[deviceId];
}

// Add message helper
function addMessage(deviceId, role, content) {
  if (!conversations[deviceId]) conversations[deviceId] = [];
  conversations[deviceId].push({ role, content });

  // giữ lại tối đa 20 messages gần nhất
  if (conversations[deviceId].length > 20) {
    conversations[deviceId] = conversations[deviceId].slice(-20);
  }
}

// ---------------------------
//  Chuẩn bị thư mục TTS
// ---------------------------
const audioDir = path.join(__dirname, "tts");
if (!fs.existsSync(audioDir)) {
  fs.mkdirSync(audioDir, { recursive: true });
}

app.use(express.static(__dirname));
app.use("/tts", express.static(audioDir));
app.use(express.json());

// ---------------------------
//  Chuyển giọng nói → text
// ---------------------------
async function transcribeAudio(buffer) {
  const tempPath = path.join(__dirname, "temp_input.webm");
  await fs.promises.writeFile(tempPath, buffer);

  const resp = await openai.audio.transcriptions.create({
    file: fs.createReadStream(tempPath),
    model: "gpt-4o-transcribe"
  });

  await fs.promises.unlink(tempPath);
  return resp.text || "";
}

// ---------------------------
//  ChatGPT với bộ nhớ
// ---------------------------
async function askChatGpt(text, deviceId = "web") {
  addMessage(deviceId, "user", text);

  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      {
        role: "system",
        content: "Bạn là trợ lý Xiaozhi, trả lời tiếng Việt, ngắn gọn, thân thiện."
      },
      ...getHistory(deviceId)
    ]
  });

  const assistantText = completion.choices[0].message.content || "";
  addMessage(deviceId, "assistant", assistantText);

  return assistantText;
}

// ---------------------------
//  Fake TTS → thay bằng TTS thật sau
// ---------------------------
async function callTts(text, outPath) {
  await fs.promises.writeFile(outPath, Buffer.from("FAKE_TTS_DATA"));
}

// ---------------------------
//  API: Nhận voice từ web
// ---------------------------
app.post("/api/voice", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Thiếu audio" });

    const deviceId = req.headers["x-device-id"] || "web";

    const userText = await transcribeAudio(req.file.buffer);
    const assistantText = await askChatGpt(userText, deviceId);

    const fileName = Date.now() + ".wav";
    const outPath = path.join(audioDir, fileName);
    await callTts(assistantText, outPath);

    res.json({
      user_text: userText,
      assistant_text: assistantText,
      tts_url: "/tts/" + fileName,
      device_id: deviceId,
    });

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------
//  API: Chat bằng text
// ---------------------------
app.post("/api/text", async (req, res) => {
  try {
    const text = req.body.text;
    if (!text) return res.status(400).json({ error: "Thiếu text" });

    const deviceId = req.headers["x-device-id"] || "web";

    const assistantText = await askChatGpt(text, deviceId);

    const fileName = Date.now() + ".wav";
    const outPath = path.join(audioDir, fileName);
    await callTts(assistantText, outPath);

    res.json({
      user_text: text,
      assistant_text: assistantText,
      tts_url: "/tts/" + fileName,
      device_id: deviceId
    });

  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ---------------------------
//  API: reset history theo device
// ---------------------------
app.post("/api/reset", (req, res) => {
  const deviceId = req.headers["x-device-id"] || "web";
  conversations[deviceId] = [];
  res.json({ ok: true });
});

// ---------------------------
//  START SERVER
// ---------------------------
app.listen(PORT, () => {
  console.log("Backend running http://localhost:" + PORT);
});
