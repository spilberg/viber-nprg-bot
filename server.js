require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs").promises;
const multer = require("multer");
const mongoose = require("mongoose");
const axios = require("axios");
const sharp = require("sharp");
const Tesseract = require("tesseract.js");
// require("./api/apifunction");

const {
  Bot,
  Events,
  Message: { Text, Picture },
} = require("viber-bot");

const app = express();

// --- MongoDB ---
mongoose.connect(
  process.env.MONGODB_URI || "mongodb://localhost:27017/viber_nova_poshta",
  {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  }
);

// --- Схеми ---
const shipmentSchema = new mongoose.Schema({
  trackingNumber: { type: String, required: true, unique: true },
  senderCity: String,
  recipientCity: String,
  status: String,
  weight: Number,
  cost: Number,
  viberUserId: String,
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
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
const bot = new Bot({
  authToken: process.env.VIBER_AUTH_TOKEN,
  name: "Nova Poshta Tracker", // "Nova Poshta Tracker",
  avatar: "https://example.com/avatar.jpg",
});

// --- multer ---
const uploadsDir = path.join(__dirname, "uploads");
fs.mkdir(uploadsDir, { recursive: true }).catch(console.error);
const upload = multer({
  dest: uploadsDir,
  limits: { fileSize: 10 * 1024 * 1024 },
});

// --- REST API парсер лише для /api ---
app.use("/api", express.json());

// --- REST API приклад ---
// app.get("/api/shipments", async (req, res) => {
//   const shipments = await Shipment.find().sort({ updatedAt: -1 }).limit(10);
//   res.json(shipments);
// });

// REST API для адміністрування
app.get("/api/shipments", async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const shipments = await Shipment.find()
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Shipment.countDocuments();

    res.json({
      shipments,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/shipments/:trackingNumber", async (req, res) => {
  try {
    const shipment = await Shipment.findOne({
      trackingNumber: req.params.trackingNumber,
    });
    if (!shipment) {
      return res.status(404).json({ error: "Відправка не знайдена" });
    }
    res.json(shipment);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/users", async (req, res) => {
  try {
    const users = await User.find().sort({ createdAt: -1 });
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Статистика
app.get("/api/stats", async (req, res) => {
  try {
    const totalShipments = await Shipment.countDocuments();
    const totalUsers = await User.countDocuments();
    const todayShipments = await Shipment.countDocuments({
      createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) },
    });

    res.json({
      totalShipments,
      totalUsers,
      todayShipments,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Viber webhook ---
app.use("/viber/webhook", bot.middleware());

// --- OCR ---
async function extractTrackingNumberFromImage(imagePath) {
  const processedPath = imagePath + "_processed.jpg";
  await sharp(imagePath)
    .resize(1200, null, { fit: "inside", withoutEnlargement: true })
    .greyscale()
    .normalize()
    .sharpen()
    .jpeg({ quality: 95 })
    .toFile(processedPath);

  const {
    data: { text },
  } = await Tesseract.recognize(processedPath, "ukr+rus+eng", {
    logger: (m) => console.log("OCR Progress:", m),
  });

  await fs.unlink(processedPath);

  const matches = text.match(/\b\d{14}\b/g);
  return matches ? matches : [];
}

/**
 * Завантаження фото з Viber
 * @param {*} url
 * @param {*} filename
 * @returns
 */
async function downloadImageFromViber(url, filename) {
  const filepath = path.join(uploadsDir, filename);
  // console.log("filepath", filepath);
  const response = await axios({ method: "GET", url, responseType: "stream" });
  // console.log("response", response);
  const writer = require("fs").createWriteStream(filepath);
  response.data.pipe(writer);
  return new Promise((resolve, reject) => {
    writer.on("finish", () => resolve(filepath));
    writer.on("error", reject);
  });
}

// --- API Нової Пошти ---
const NOVA_POSHTA_API_KEY = process.env.NOVA_POSHTA_API_KEY;
const NOVA_POSHTA_API_URL = process.env.NOVA_POSHTA_API_URL; // https://api.novaposhta.ua/v2.0/json/
const NOVA_POSHTA_USER_PHONE = process.env.NOVA_POSHTA_USER_PHONE; // +380675085834

async function getShipmentInfo(trackingNumber) {
  try {
    const response = await axios.post(NOVA_POSHTA_API_URL, {
      apiKey: NOVA_POSHTA_API_KEY,
      modelName: "TrackingDocument",
      calledMethod: "getStatusDocuments",
      methodProperties: {
        Documents: [
          { DocumentNumber: trackingNumber, Phone: NOVA_POSHTA_USER_PHONE },
        ],
      },
    });
    console.log("API Response:", response.data);

    if (response.data.success && response.data.data.length > 0) {
      return response.data.data[0];
    }
    return null;
  } catch (err) {
    console.error("НП API Error:", err);
    return null;
  }
}

// --- Події бота ---
bot.on(Events.SUBSCRIBED, async (response) => {
  try {
    await User.updateOne(
      { viberUserId: response.userProfile.id },
      {
        viberUserId: response.userProfile.id,
        name: response.userProfile.name,
        avatar: response.userProfile.avatar,
        language: response.userProfile.language,
        country: response.userProfile.country,
      },
      { upsert: true }
    );
    bot.sendMessage(
      response.userProfile,
      new Text("Вітаю! Надішліть номер накладної або фото чеку.")
    );
  } catch (err) {
    console.error(err);
  }
});

bot.on(Events.MESSAGE_RECEIVED, async (message, response) => {
  console.log("message", message);
  try {
    if (message instanceof Text) {
      const text = message.text.trim();
      if (/^\d{14}$/.test(text)) {
        await processTrackingNumber(text, response);
      } else {
        bot.sendMessage(
          response.userProfile,
          new Text("Надішліть номер накладної (14 цифр) або фото.")
        );
      }
    } else if (message instanceof Picture) {
      // console.log("Picture: ", PictureMessage);
      bot.sendMessage(response.userProfile, new Text("🔍 Аналізую фото..."));
      const filename = `receipt_${Date.now()}_${response.userProfile.id}.jpg`;
      // console.log("filename", filename);
      // console.log("message.url", message.url);
      const imagePath = await downloadImageFromViber(message.url, filename);
      // console.log("imagePath", imagePath);
      const numbers = await extractTrackingNumberFromImage(imagePath);
      await fs.unlink(imagePath);

      if (numbers.length === 0) {
        bot.sendMessage(
          response.userProfile,
          new Text("❌ Не вдалося розпізнати номер накладної.")
        );
      } else {
        for (const num of numbers) await processTrackingNumber(num, response);
      }
    }
  } catch (err) {
    console.error(err);
    bot.sendMessage(
      response.userProfile,
      new Text("❌ Сталася помилка при обробці повідомлення.")
    );
  }
});

// --- Обробка номера накладної ---
async function processTrackingNumber(trackingNumber, response) {
  bot.sendMessage(
    response.userProfile,
    new Text(`Отримано номер: ${trackingNumber}\n🔍 Отримую інформацію...`)
  );
  const shipmentInfo = await getShipmentInfo(trackingNumber);

  if (!shipmentInfo) {
    bot.sendMessage(
      response.userProfile,
      new Text("❌ Не вдалося знайти інформацію про відправку.")
    );
    return;
  }

  const shipmentData = {
    trackingNumber,
    senderCity: shipmentInfo.CitySender || "Н/Д",
    recipientCity: shipmentInfo.CityRecipient || "Н/Д",
    status: shipmentInfo.Status || "Невідомо",
    weight: parseFloat(shipmentInfo.DocumentWeight) || 0,
    cost: parseFloat(shipmentInfo.DocumentCost) || 0,
    viberUserId: response.userProfile.id,
    updatedAt: new Date(),
  };

  await Shipment.findOneAndUpdate({ trackingNumber }, shipmentData, {
    upsert: true,
    new: true,
  });

  const msg =
    `📦 Відправка:\nНомер: ${trackingNumber}\n` +
    `Маршрут: ${shipmentData.senderCity} → ${shipmentData.recipientCity}\n` +
    `Статус: ${shipmentData.status}\n` +
    `Вага: ${shipmentData.weight} кг\n` +
    `Вартість: ${shipmentData.cost} грн`;

  bot.sendMessage(response.userProfile, new Text(msg));
}

// --- Webhook ---
app.get("/set_webhook", (req, res) => {
  bot
    .setWebhook(process.env.WEBHOOK_URL + "/viber/webhook")
    .then(() => res.send("Webhook встановлено"))
    .catch((err) => res.status(500).send(err));
});

// --- Запуск сервера ---
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Сервер запущено на порті ${PORT}`);
  // console.log(`Встановіть webhook: ${process.env.WEBHOOK_URL}/set_webhook`);
});
