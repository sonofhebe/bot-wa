const express = require("express");
const {
  makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  downloadContentFromMessage,
} = require("@whiskeysockets/baileys");
const axios = require("axios");
const gtts = require("node-gtts");
const QRCode = require("qrcode");
const fs = require("fs");
const app = express();
let sock;

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_info_baileys");
  sock = makeWASocket({
    auth: state,
    browser: ["Belp Bot", "Chrome", "120.0"],
  });

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      QRCode.toString(qr, { type: "terminal", small: true }, (err, url) => {
        if (!err) console.log(url);
      });
    }
    if (connection === "close") {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !==
        DisconnectReason.loggedOut;
      if (shouldReconnect) setTimeout(connectToWhatsApp, 5000);
    } else if (connection === "open") {
      console.log("Bot WhatsApp Connected!");
    }
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("messages.upsert", async (m) => {
    const msg = m.messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const jid = msg.key.remoteJid;
    const from = msg.key.remoteJid;
    let text = "";

    // Ambil teks dari pesan (conversation atau extendedText)
    if (msg.message.conversation) text = msg.message.conversation;
    else if (msg.message.extendedTextMessage?.text)
      text = msg.message.extendedTextMessage.text;

    // Cek apakah ada gambar?
    const imageMessage = msg.message?.imageMessage;
    const caption = imageMessage?.caption || "";

    // Trigger hanya dengan kata "belp" - BAIK UNTUK TEKS MAUPUN GAMBAR
    const hasBelpInText = text.toLowerCase().includes("belp");
    const hasBelpInCaption = caption.toLowerCase().includes("belp");

    // Hanya proses jika ada kata "belp" di text atau caption
    if (hasBelpInText || hasBelpInCaption) {
      try {
        let userText = "";

        // Ambil teks dan hilangkan kata "belp"
        if (hasBelpInText) {
          userText = text.replace(/belp/gi, "").trim();
        } else if (hasBelpInCaption) {
          userText = caption.replace(/belp/gi, "").trim();
        }

        // Kalau ada gambar tapi userText kosong setelah hilangkan "belp"
        if (imageMessage && !userText) {
          userText = "jelaskan gambar ini";
        }

        // Kalau tidak ada gambar dan userText kosong
        if (!imageMessage && !userText) {
          await sock.sendMessage(jid, { text: "Yo! What can i help? 😄" });
          return;
        }

        // Download gambar kalau ada
        let imageBuffer = null;
        if (imageMessage) {
          imageBuffer = await downloadMediaMessage(msg);
        }

        await processWithNexra(jid, userText, imageBuffer, msg.pushName);
      } catch (err) {
        console.error(err);
        await sock.sendMessage(jid, {
          text: "Maaf, lagi error nih 😵 Coba lagi ya!",
        });
      }
    }
  });
}

// ================== FUNGSI UTAMA NEXRA ==================
async function processWithNexra(
  jid,
  userText,
  imageBuffer = null,
  pushName = ""
) {
  try {
    let detectedLang = "id";
    let finalText = userText;

    // Kalau bukan gambar, deteksi bahasa dulu
    if (!imageBuffer && userText.length > 0) {
      try {
        const langRes = await axios.get("https://nexra.aryahcr.cc/api/lang", {
          params: { text: userText },
          timeout: 8000,
        });
        detectedLang = langRes.data.lang || "id";
      } catch (e) {
        /* ignore */
      }
    }

    // Kalau ada gambar → analisis langsung
    if (imageBuffer) {
      await sock.sendMessage(jid, { text: "Sedang menganalisis gambar..." });

      const form = new FormData();
      const blob = new Blob([imageBuffer], { type: "image/jpeg" });

      form.append("file", blob, "image.jpg");
      form.append("prompt", userText || "Jelaskan gambar ini secara detail");

      const analyzeRes = await axios.post(
        "https://nexra.aryahcr.cc/api/image/analyze",
        form,
        {
          headers: {
            "Content-Type": "multipart/form-data",
          },
          timeout: 60000,
          maxBodyLength: Infinity,
        }
      );

      finalText = analyzeRes.data.message || "Gambar tidak bisa dianalisis.";
    }
    // Kalau teks biasa → chat biasa
    else {
      const messages = [
        {
          role: "system",
          content: `Kamu adalah Belp, asisten pintar dan ramah buatan J$ON the son of Hebe (IG: sonofhebe). 
          Jawab dengan bahasa yang sama dengan user (sekarang: ${
            detectedLang === "id" ? "Indonesia" : "English"
          }).
          Jawab singkat, helpful, dan sedikit lucu kalau bisa. Jangan terlalu panjang.`,
        },
        { role: "user", content: userText },
      ];

      const chatRes = await axios.post(
        "https://nexra.aryahcr.cc/api/chat/completions",
        {
          messages,
          model: "chatgpt",
          markdown: false,
          stream: false,
        }
      );

      finalText =
        chatRes.data.message ||
        chatRes.data.response ||
        "Maaf, aku bingung nih 😅";
    }

    // Kirim balasan teks
    await sock.sendMessage(jid, { text: finalText });

    // Kalau ada ".voice" di akhir → kirim voice note
    if (userText.toLowerCase().includes(".voice")) {
      const tts = gtts(detectedLang);
      const filePath = "./temp_voice.ogg";
      await new Promise((resolve, reject) => {
        tts.save(filePath, finalText, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      await sock.sendMessage(jid, {
        audio: fs.readFileSync(filePath),
        mimetype: "audio/ogg; codecs=opus",
        ptt: true,
      });

      fs.unlinkSync(filePath);
    }
  } catch (error) {
    console.error("Nexra Error:", error.response?.data || error.message);
    let msg = "AI lagi ngambek parah 😭 Coba lagi 1-2 menit ya.";
    if (error.response?.status === 429)
      msg = "Terlalu cepat! Sabar 1 menit ya, rate limit nih 😅";
    await sock.sendMessage(jid, { text: msg });
  }
}

// Helper: download media
async function downloadMediaMessage(message) {
  const stream = await downloadContentFromMessage(
    message.message.imageMessage || message.message.videoMessage,
    "image"
  );

  return await streamToBuffer(stream);
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

// =================================== API =======================================
const APIKey = "J$ON fineshyt";

app.post("/send-message", async (req, res) => {
  try {
    const { key, phone, group, message } = req.query;
    if (key !== APIKey) {
      return res.status(401).send("Access denied because u're ugly!");
    }
    if (!phone && !group) {
      return res.status(400).send("ID receiver are required");
    }
    if (!message) {
      return res.status(400).send("Message is required");
    }
    let jid;
    if (group) {
      jid = group + "@g.us";
    } else if (phone) {
      jid = phone + "@s.whatsapp.net";
    }

    await sock.sendMessage(jid, { text: message });
    res.status(200).send("Message sent successfully");
  } catch (error) {
    console.error("Failed to send message:", error);
    res.status(500).send("Failed to send message");
  }
});

app.post("/group-list", async (req, res) => {
  try {
    const { key } = req.query;
    if (key !== APIKey) {
      return res.status(401).send("Access denied because u're ugly!");
    }
    if (!sock) {
      return res.status(500).send("WhatsApp socket is not initialized");
    }

    const groups = await sock.groupFetchAllParticipating();
    res.status(200).json(groups);
  } catch (error) {
    console.error("Failed to get groups:", error);
    res.status(500).send("Failed to get groups");
  }
});
// =================================== API END =======================================

// Start server
const PORT = process.env.PORT || 6664;
app.listen(PORT, () => {
  console.log(`Server jalan di port ${PORT}`);
  connectToWhatsApp();
});
