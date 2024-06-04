const express = require("express");
const {
  makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
} = require("@whiskeysockets/baileys");
const { G4F } = require("g4f");
const g4f = new G4F();

const app = express();
let sock;

async function connectToWhatsApp() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState(
      "auth_info_baileys"
    );
    sock = makeWASocket({
      printQRInTerminal: true,
      auth: state,
    });

    sock.ev.on("connection.update", (update) => {
      const { connection, lastDisconnect } = update;
      if (connection === "close") {
        const shouldReconnect =
          lastDisconnect.error?.output?.statusCode !==
          DisconnectReason.loggedOut;
        console.log(
          "connection closed due to ",
          lastDisconnect.error,
          ", reconnecting ",
          shouldReconnect
        );
        // reconnect if not logged out
        if (shouldReconnect) {
          setTimeout(connectToWhatsApp, 5000); // retry after 5 seconds
        }
      } else if (connection === "open") {
        console.log("opened connection");
      }
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("messages.upsert", async (m) => {
      const message = m.messages[0];
      if (message.key.fromMe) return; // Ignore messages sent by your own number

      const jid = message.key.remoteJid; // JID (Jabber ID) of the sender
      let replyText = "";
      let messageText = "";

      // get message
      if (jid.endsWith("@g.us")) {
        messageText = message.message.conversation;
      } else {
        if (message.message.conversation) {
          messageText = message.message.conversation;
        } else if (
          message.message.extendedTextMessage &&
          message.message.extendedTextMessage.text
        ) {
          messageText = message.message.extendedTextMessage.text;
        }
      }

      // ------------- rule -----------
      if (messageText.toLowerCase().includes("belp")) {
        const messageToSend = messageText.replace("belp", "").trim();

        if (messageText.toLowerCase().includes("hello")) {
          replyText = `Hi ${message.pushName}! How can I help you?`;
          await sock.sendMessage(jid, { text: replyText });
          return;
        }
        if (messageText.toLowerCase().includes("how are you")) {
          replyText = "I'm doing well, thank you! How about you?";
          await sock.sendMessage(jid, { text: replyText });
          return;
        }

        fetchAI(messageToSend);
        return;
      }
      async function fetchAI(messageToSend) {
        try {
          const messages = [
            {
              role: "user",
              content:
                "Nama kamu adalah Belp, bot yang dibuat oleh Wildan, jika ada yang menanyakan biodata pembuatmu adalah Wildan the son of Hebe (instagram : sonofhebe)",
            },
            {
              role: "assistant",
              content:
                "baik, nama saya adalah Belp, dan pembuat saya adalah Wildan the son of Hebe (instagram : sonofhebe)",
            },
            {
              role: "user",
              content: messageToSend,
            },
          ];
          const options = {
            model: "gpt-4",
            debug: false,
            retry: {
              times: 3,
              condition: (text) => {
                const words = text.split(" ");
                return words.length > 10;
              },
            },
          };

          if (messageToSend.toLowerCase().includes("buat gambar")) {
            let imageText = messageToSend.replace("belp", "").trim();
            imageText = imageText.replace("Belp", "").trim();
            imageText = imageText.replace("buat gambar", "").trim();
            await sock.sendMessage(jid, {
              text:
                "Baik tunggu sebentar ya, saya akan menggambar " + imageText,
            });
            const base64Image = await g4f.imageGeneration(imageText, {
              debug: false,
              provider: g4f.providers.Prodia,
            });
            // Convert base64 string to Buffer
            const imageBuffer = Buffer.from(base64Image, "base64");
            await sock.sendMessage(jid, {
              image: imageBuffer,
              caption: "Berikut adalah gambar " + imageText,
            });
          } else {
            const response = await g4f.chatCompletion(messages, options);
            // console.log("AI response:", response);
            await sock.sendMessage(jid, {
              text: response,
            });
          }
        } catch (error) {
          console.error("Failed to fetch AI response:", error);
          await sock.sendMessage(jid, {
            text: "Sorry, I couldn't process your request at the moment🙏",
          });
        }
      }
    });
  } catch (error) {
    console.error("Failed to connect to WhatsApp:", error);
    setTimeout(connectToWhatsApp, 5000); // retry after 5 seconds
  }
}

const APIKey = "anaklanang";
// =================================== API =======================================
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

// Start the Express server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  connectToWhatsApp();
});
