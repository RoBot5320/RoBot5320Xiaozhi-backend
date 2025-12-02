const express = require("express")
const multer = require("multer")
const cors = require("cors")
const fs = require("fs")
const path = require("path")
const OpenAI = require("openai")

const app = express()
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }
})

const PORT = process.env.PORT || 3000

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

const conversations = {}

function getHistory(deviceId) {
  if (!conversations[deviceId]) conversations[deviceId] = []
  return conversations[deviceId]
}

function addMessage(deviceId, role, content) {
  if (!conversations[deviceId]) conversations[deviceId] = []
  conversations[deviceId].push({ role, content })
  if (conversations[deviceId].length > 20) {
    conversations[deviceId] = conversations[deviceId].slice(-20)
  }
}

function checkCreatorQuestion(text) {
  if (!text) return null
  const t = text.toLowerCase()

  const keywords = [
    "nguồn gốc",
    "cha đẻ",
    "cha de",
    "ai tạo ra bạn",
    "ai tao ra ban",
    "ai tạo ra mày",
    "ai tao ra may",
    "ai làm ra bạn",
    "ai lam ra ban",
    "ai lập trình bạn",
    "ai lap trinh ban",
    "who created you",
    "who made you",
    "your creator"
  ]

  const matched = keywords.some(k => t.includes(k))
  if (!matched) return null

  return "RoBot5320 được tạo ra và phát triển bởi anh Nguyễn Trường Quốc (2k5)."
}

function pickExtFromMime(mime) {
  if (!mime) return "webm"
  const m = mime.toLowerCase()
  if (m.includes("webm")) return "webm"
  if (m.includes("ogg")) return "ogg"
  if (m.includes("mp4") || m.includes("m4a") || m.includes("mpeg")) return "mp4"
  if (m.includes("wav")) return "wav"
  if (m.includes("mp3")) return "mp3"
  return "webm"
}

async function transcribeAudio(file) {
  if (!file || !file.buffer || !file.size) {
    throw new Error("Audio trống hoặc không nhận được dữ liệu")
  }

  if (file.size < 2000) {
    throw new Error("Audio quá ngắn, hãy nói lâu hơn một chút")
  }

  const ext = pickExtFromMime(file.mimetype)
  const name = "input." + ext

  const resp = await openai.audio.transcriptions.create({
    file: { data: file.buffer, name },
    model: "gpt-4o-transcribe",
    language: "vi"
  })

  return resp.text || ""
}

async function askChatGpt(text, deviceId = "web") {
  addMessage(deviceId, "user", text)

  const special = checkCreatorQuestion(text)
  if (special) {
    addMessage(deviceId, "assistant", special)
    return special
  }

  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      {
        role: "system",
        content:
          "Bạn là trợ lý RoBot5320 – một trợ lý ảo thân thiện, thông minh và chỉ xưng hô tên RoBot5320. Trả lời tiếng Việt, tự nhiên và ngắn gọn. Nếu có ai hỏi về nguồn gốc, cha đẻ, người tạo ra hoặc người lập trình RoBot5320 thì trả lời rằng RoBot5320 được tạo ra bởi anh Nguyễn Trường Quốc (2k5)."
      },
      ...getHistory(deviceId)
    ]
  })

  const assistantText = completion.choices[0].message.content || ""
  addMessage(deviceId, "assistant", assistantText)
  return assistantText
}

async function callTts(text, outPath) {
  const speech = await openai.audio.speech.create({
    model: "gpt-4o-mini-tts",
    voice: "alloy",
    format: "opus",
    input: text
  })

  const buffer = Buffer.from(await speech.arrayBuffer())
  await fs.promises.writeFile(outPath, buffer)
}

const audioDir = path.join(__dirname, "tts")
if (!fs.existsSync(audioDir)) {
  fs.mkdirSync(audioDir, { recursive: true })
}

app.use(cors({ origin: "*"}))
app.use(express.static(__dirname))
app.use("/tts", express.static(audioDir))
app.use(express.json())

app.get("/", (req, res) => {
  res.send("RoBot5320 XiaoZhi backend OK")
})

app.post("/api/voice", upload.single("audio"), async (req, res) => {
  try {
    const file = req.file
    if (!file) {
      return res.status(400).json({ error: "Thiếu file audio" })
    }

    const deviceId = req.headers["x-device-id"] || "web"

    const userText = await transcribeAudio(file)
    const assistantText = await askChatGpt(userText, deviceId)

    const fileName = Date.now() + ".opus"
    const outPath = path.join(audioDir, fileName)
    await callTts(assistantText, outPath)

    res.json({
      user_text: userText,
      assistant_text: assistantText,
      tts_url: "/tts/" + fileName,
      device_id: deviceId
    })
  } catch (e) {
    console.error("ERROR /api/voice:", e)
    res.status(500).json({ error: e.message || "Server error" })
  }
})

app.post("/api/text", async (req, res) => {
  try {
    const text = req.body.text
    if (!text) {
      return res.status(400).json({ error: "Thiếu text" })
    }

    const deviceId = req.headers["x-device-id"] || "web"

    const assistantText = await askChatGpt(text, deviceId)

    const fileName = Date.now() + ".opus"
    const outPath = path.join(audioDir, fileName)
    await callTts(assistantText, outPath)

    res.json({
      user_text: text,
      assistant_text: assistantText,
      tts_url: "/tts/" + fileName,
      device_id: deviceId
    })
  } catch (e) {
    console.error("ERROR /api/text:", e)
    res.status(500).json({ error: e.message || "Server error" })
  }
})

app.post("/api/reset", (req, res) => {
  const deviceId = req.headers["x-device-id"] || "web"
  conversations[deviceId] = []
  res.json({ ok: true })
})

app.listen(PORT, () => {
  console.log("Backend running on port " + PORT)
})
