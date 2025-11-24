const express = require("express")
const multer = require("multer")
const fs = require("fs")
const path = require("path")
const OpenAI = require("openai")

const app = express()
const upload = multer({ storage: multer.memoryStorage() })
const PORT = process.env.PORT || 3000

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
})

const audioDir = path.join(__dirname, "tts")
if (!fs.existsSync(audioDir)) {
  fs.mkdirSync(audioDir, { recursive: true })
}

app.use(express.static(__dirname))
app.use("/tts", express.static(audioDir))
app.use(express.json())

async function transcribeAudio(buffer) {
  const tempPath = path.join(__dirname, "temp_input.webm")
  await fs.promises.writeFile(tempPath, buffer)

  const resp = await openai.audio.transcriptions.create({
    file: fs.createReadStream(tempPath),
    model: "gpt-4o-transcribe"
  })

  await fs.promises.unlink(tempPath)
  return resp.text || ""
}

async function askChatGpt(text) {
  const completion = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      {
        role: "system",
        content: "Bạn là trợ lý Xiaozhi, trả lời tiếng Việt tự nhiên, ngắn gọn."
      },
      {
        role: "user",
        content: text
      }
    ]
  })

  return completion.choices[0].message.content || ""
}

// TTS: tạo file OGG/Opus từ text
async function callTts(text, outPath) {
  const speech = await openai.audio.speech.create({
    model: "gpt-4o-mini-tts",
    voice: "alloy",
    format: "opus",   // quan trọng: dùng Opus
    input: text
  })

  const buffer = Buffer.from(await speech.arrayBuffer())
  await fs.promises.writeFile(outPath, buffer)
}

// Ghi âm giọng nói
app.post("/api/voice", upload.single("audio"), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "Thiếu audio" })
      return
    }

    const userText = (await transcribeAudio(req.file.buffer)).trim()
    const assistantText = await askChatGpt(userText)

    const fileName = Date.now() + ".opus"
    const outPath = path.join(audioDir, fileName)
    await callTts(assistantText, outPath)

    res.json({
      user_text: userText,
      assistant_text: assistantText,
      tts_url: "/tts/" + fileName
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: e.message })
  }
})

// Nhận text (bàn phím + hint)
app.post("/api/text", async (req, res) => {
  try {
    const userText = (req.body.text || "").trim()
    const deviceId = req.body.device_id || "web"

    if (!userText) {
      res.status(400).json({ error: "Thiếu text" })
      return
    }

    const assistantText = await askChatGpt(userText)

    const fileName = Date.now() + "_" + deviceId + ".opus"
    const outPath = path.join(audioDir, fileName)
    await callTts(assistantText, outPath)

    res.json({
      user_text: userText,
      assistant_text: assistantText,
      tts_url: "/tts/" + fileName,
      device_id: deviceId
    })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: e.message })
  }
})

app.listen(PORT, () => {
  console.log("Backend running http://localhost:" + PORT)
})
