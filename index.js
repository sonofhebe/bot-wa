const {
  makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
} = require("@whiskeysockets/baileys");

async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_info_baileys");
  const sock = makeWASocket({
    // can provide additional config here
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
    const messageText = message.message.conversation; // Content of the message

    // Custom logic to determine response based on message content
    let replyText = `Hi,
This is Wildan's temporary WhatsApp account. Wildan's main WhatsApp account (6289650973972) is now active again. This temporary account will be deleted soon, so please remove it from your contacts. This message will be forwarded to the main WhatsApp account. Thank you.`;

    // forward chat
    const forwardJid = "6289650973972@s.whatsapp.net"; // JID of the recipient contact
    const messageId = message.key.id; // ID of the message to forward
    await sock.sendMessage(forwardJid, {
      text: `Forward text
from : ${jid.split("@")[0]}

${messageText}`,
      quoted: { key: { remoteJid: jid, id: messageId } },
    });

    // if (messageText.toLowerCase().includes("hello")) {
    //   replyText = "Hi there! How can I help you?";
    // } else if (messageText.toLowerCase().includes("how are you")) {
    //   replyText = "I'm doing well, thank you! How about you?";
    // }

    // Send the reply
    await sock.sendMessage(jid, { text: replyText });
  });
}

// Run the function to connect to WhatsApp
connectToWhatsApp();
