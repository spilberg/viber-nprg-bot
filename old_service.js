const express = require("express");
const ViberBot = require("viber-bot").Bot;
const {
  Events,
  Message: { Text, Picture },
} = require("viber-bot");
const mongoose = require("mongoose");
const axios = require("axios");
const multer = require("multer");
const Tesseract = require("tesseract.js");
const sharp = require("sharp");
const fs = require("fs").promises;
const path = require("path");
require("dotenv").config();

const app = express();

// --- Multer ---
const upload = multer({
  dest: "uploads/",
  limits: { fileSize: 10 * 1024 * 1024 },
});
const uploadsDir = path.join(__dirname, "uploads");
fs.mkdir(uploadsDir, { recursive: true }).catch(console.error);

// --- MongoDB ---
mongoose.connect(
  process.env.MONGODB_URI || "mongodb://localhost:27017/viber_nova_poshta",
  {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  }
);

// --- Моделі ---
const shipmentSchema = new mongoose.Schema({
  trackingNumber: { type: String, required: true, unique: true },
  senderCity: String,
  recipientCity: String,
  status: String,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  viberUserId: String,
});
const Shipment = mongoose.model("Shipment", shipmentSchema);

const userSchema = new mongoose.Schema({
  viberUserId: { type: String, required: true, unique: true },
  name: String,
  avatar: String,
  language: String,
  country: String,
  createdAt: { type: Date, default: Date.now },
});
const User = mongoose.model("User", userSchema);

// --- Viber Bot ---
const bot = new ViberBot({
  authToken: process.env.VIBER_AUTH_TOKEN,
  name: "Nova Poshta Tracker",
  avatar: "https://example.com/avatar.jpg",
});

// --- Nova Poshta API ---
const NOVA_POSHTA_API_KEY = process.env.NOVA_POSHTA_API_KEY;
const NOVA_POSHTA_API_URL =
  process.env.NOVA_POSHTA_API_URL || "https://api.novaposhta.ua/v2.0/json/";

async function getShipmentInfo(trackingNumber) {
  try {
    const response = await axios.post(NOVA_POSHTA_API_URL, {
      apiKey: NOVA_POSHTA_API_KEY,
      modelName: "TrackingDocument",
      calledMethod: "getStatusDocuments",
      methodProperties: {
        Documents: [{ DocumentNumber: trackingNumber, Phone: "" }],
      },
    });
    return response.data.success && response.data.data.length > 0
      ? response.data.data[0]
      : null;
  } catch (err) {
    console.error("Nova Poshta API error:", err);
    return null;
  }
}

async function extractTrackingNumberFromImage(imagePath) {
  try {
    const processedImagePath = imagePath + "_processed.jpg";
    await sharp(imagePath)
      .resize(1200, null, { withoutEnlargement: true, fit: "inside" })
      .greyscale()
      .normalize()
      .sharpen()
      .jpeg({ quality: 95 })
      .toFile(processedImagePath);

    const {
      data: { text },
    } = await Tesseract.recognize(processedImagePath, "ukr+rus+eng", {
      logger: (m) => console.log("OCR:", m),
    });

    const patterns = [/\b\d{14}\b/g];
    const found = new Set();
    patterns.forEach((p) => {
      const matches = text.match(p);
      if (matches) matches.forEach((m) => found.add(m.replace(/\D/g, "")));
    });

    try {
      await fs.unlink(processedImagePath);
    } catch (e) {
      console.error(e);
    }
    return Array.from(found);
  } catch (err) {
    console.error("OCR error:", err);
    throw err;
  }
}

async function downloadImage(url, filename) {
  const response = await axios({ method: "GET", url, responseType: "stream" });
  const filepath = path.join(uploadsDir, filename);
  const writer = require("fs").createWriteStream(filepath);
  response.data.pipe(writer);
  return new Promise((resolve, reject) => {
    writer.on("finish", () => resolve(filepath));
    writer.on("error", reject);
  });
}

async function processTrackingNumber(trackingNumber, response) {
  try {
    const info = await getShipmentInfo(trackingNumber);
    if (!info)
      // return await response.sendText(
      //   "❌ Інформацію про цю відправку не знайдено."
      // );

      return await bot.sendMessage(
        response.userProfile,
        new Text("❌ Інформацію про цю відправку не знайдено.")
      );

    const shipmentData = {
      trackingNumber,
      senderCity: info.CitySender || "Не вказано",
      recipientCity: info.CityRecipient || "Не вказано",
      status: info.Status || "Невідомо",
      viberUserId: response.userProfile.id,
      updatedAt: new Date(),
    };
    await Shipment.findOneAndUpdate({ trackingNumber }, shipmentData, {
      upsert: true,
      new: true,
    });

    const msg =
      `📦 Номер: ${trackingNumber}\n` +
      `📍 Маршрут: ${info.CitySender} → ${info.CityRecipient}\n` +
      `📊 Статус: ${info.Status}\n` +
      `⚖️ Вага: ${info.DocumentWeight || "Не вказано"} кг\n` +
      `💰 Вартість: ${info.DocumentCost || "Не вказано"} грн`;

    // await response.sendText(msg);
    await bot.sendMessage(response.userProfile, new Text(msg));
  } catch (err) {
    console.error(err);
    // await response.sendText("❌ Сталася помилка при обробці ТТН.");
    await bot.sendMessage(
      response.userProfile,
      new Text("❌ Сталася помилка при обробці ТТН.")
    );
  }
}

// --- Події бота ---
bot.on(Events.SUBSCRIBED, async (resp) => {
  try {
    await User.updateOne(
      { viberUserId: resp.userProfile.id },
      {
        $setOnInsert: {
          name: resp.userProfile.name,
          avatar: resp.userProfile.avatar,
          language: resp.userProfile.language,
          country: resp.userProfile.country,
          createdAt: new Date(),
        },
      },
      { upsert: true }
    );
    await resp.sendText("Вітаю! Надішліть номер ТТН або фото чеку.");
  } catch (err) {
    console.error(err);
  }
});

bot.on(Events.MESSAGE_RECEIVED, async (message, response) => {
  try {
    if (message instanceof Text) {
      const text = message.text.trim();
      if (/^\d{14}$/.test(text))
        return await processTrackingNumber(text, response);
      if (text.toLowerCase().includes("допомога"))
        // return await response.sendText(
        //   "ℹ️ Надішліть номер накладної або фото чеку."
        // );
        return await bot.sendMessage(
          response.userProfile,
          new Text("ℹ️ Надішліть номер накладної або фото чеку.")
        );
      // return await response.sendText(
      //   "Надішліть 14-значний номер або фото чеку."
      // );
      return await bot.sendMessage(
        response.userProfile,
        new Text("Надішліть 14-значний номер або фото чеку.")
      );
    }
    if (message instanceof Picture) {
      // await response.sendText("📷 Аналізую фото...");
      await bot.sendMessage(
        response.userProfile,
        new Text("📷 Аналізую фото...")
      );
      const filename = `receipt_${Date.now()}.jpg`;
      const imagePath = await downloadImage(message.media, filename);
      const numbers = await extractTrackingNumberFromImage(imagePath);
      try {
        await fs.unlink(imagePath);
      } catch (e) {}
      if (numbers.length === 0)
        // return await response.sendText("❌ Номер не знайдено.");
        return await bot.sendMessage(
          response.userProfile,
          new Text("📷 Аналізую фото...")
        );
      if (numbers.length === 1)
        return await processTrackingNumber(numbers[0], response);
      // return await response.sendText(
      //   `Знайдено кілька номерів: ${numbers.join(", ")}`
      // );
      return await bot.sendMessage(
        response.userProfile,
        new Text(`Знайдено кілька номерів: ${numbers.join(", ")}`)
      );
    }
  } catch (err) {
    console.error(err);

    //await response.sendText("❌ Помилка при обробці повідомлення.");
    await bot.sendMessage(
      response.userProfile,
      new Text("❌ Помилка при обробці повідомлення.")
    );
  }
});

// function sendText(resp, text) {
//   return bot.sendMessage(resp.userProfile, new Text(text));
// }

// --- Middleware для Viber Webhook (правильний raw) ---
app.use(
  "/viber/webhook",
  express.raw({ type: "application/json" }),
  bot.middleware()
);

// --- Інші API ---
app.use(express.json());

app.get("/", (req, res) => res.send("Server OK"));

// --- Встановлення Webhook ---
app.get("/set_webhook", (req, res) => {
  bot
    .setWebhook(process.env.WEBHOOK_URL + "/viber/webhook")
    .then(() => res.send("Webhook встановлено"))
    .catch((err) => res.status(500).send(err));
});

// --- Запуск сервера ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

module.exports = { app, bot };
