const express = require("express");
const {
  makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
} = require("@whiskeysockets/baileys");

const app = express();
let sock;

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_info_baileys");
  sock = makeWASocket({
    printQRInTerminal: true,
    auth: state,
  });

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === "close") {
      const shouldReconnect =
        lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log(
        "connection closed due to ",
        lastDisconnect.error,
        ", reconnecting ",
        shouldReconnect
      );
      // reconnect if not logged out
      if (shouldReconnect) {
        connectToWhatsApp();
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

    // replyText = `Hi,
    // This is Wildan's temporary WhatsApp account. Wildan's main WhatsApp account (6289650973972) is now active again. This temporary account will be deleted soon, so please remove it from your contacts. This message will be forwarded to the main WhatsApp account. Thank you.`;
    // forward chat
    // const forwardJid = "6289650973972@s.whatsapp.net"; // JID of the recipient contact
    // const messageId = message.key.id; // ID of the message to forward
    //     await sock.sendMessage(forwardJid, {
    //       text: `Forward text
    // from : ${jid.split("@")[0]}

    // ${messageText}`,
    //       quoted: { key: { remoteJid: jid, id: messageId } },
    //     });

    // =================================== AUTO REPLY =======================================
    if (jid.endsWith("@g.us")) {
      const messageText = message.message.conversation; // Content of the message
      // ------------- GROUP -----------
      return;
    } else {
      const messageText = message.message.extendedTextMessage.text; // Content of the message
      // ------------- PC -----------
      if (messageText.toLowerCase().includes("hello")) {
        replyText = `Hi ${message.pushName}! How can I help you?`;
        await sock.sendMessage(jid, { text: replyText });
      } else if (messageText.toLowerCase().includes("how are you")) {
        replyText = "I'm doing well, thank you! How about you?";
        await sock.sendMessage(jid, { text: replyText });
      }
    }
    // ================================= END AUTO REPLY =======================================
  });
}

// =================================== API =======================================
app.post("/send-message", async (req, res) => {
  try {
    const { phone, group, message } = req.query;
    if (!phone && !group) {
      return res.status(400).send("ID recivier are required");
    }
    if (!message) {
      return res.status(400).send("Message are required");
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
