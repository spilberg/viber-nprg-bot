const express = require("express");
const ViberBot = require("viber-bot").Bot;
const BotEvents = require("viber-bot").Events;
const TextMessage = require("viber-bot").Message.Text;
const mongoose = require("mongoose");
const axios = require("axios");
require("dotenv").config();

const app = express();
app.use(express.json());

// Підключення до MongoDB
mongoose.connect(
  process.env.MONGODB_URI || "mongodb://localhost:27017/viber_nova_poshta",
  {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  }
);

// Схема для відправок
const shipmentSchema = new mongoose.Schema({
  trackingNumber: {
    type: String,
    required: true,
    unique: true,
  },
  senderCity: {
    type: String,
    required: true,
  },
  recipientCity: {
    type: String,
    required: true,
  },
  status: String,
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
  viberUserId: String,
  senderAddress: String,
  recipientAddress: String,
  weight: Number,
  cost: Number,
});

const Shipment = mongoose.model("Shipment", shipmentSchema);

// Схема для користувачів Viber
const userSchema = new mongoose.Schema({
  viberUserId: {
    type: String,
    required: true,
    unique: true,
  },
  name: String,
  avatar: String,
  language: String,
  country: String,
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

const User = mongoose.model("User", userSchema);

// Створення Viber бота
const bot = new ViberBot({
  authToken: process.env.VIBER_AUTH_TOKEN,
  name: "Nova Poshta Tracker",
  avatar: "https://example.com/avatar.jpg", // замініть на реальний URL
});

// API конфігурація Нової Пошти
const NOVA_POSHTA_API_KEY = process.env.NOVA_POSHTA_API_KEY;
const NOVA_POSHTA_API_URL = process.env.NOVA_POSHTA_API_URL;

// Функція для отримання інформації про відправку з API Нової Пошти
async function getShipmentInfo(trackingNumber) {
  try {
    const response = await axios.post(NOVA_POSHTA_API_URL, {
      apiKey: NOVA_POSHTA_API_KEY,
      modelName: "TrackingDocument",
      calledMethod: "getStatusDocuments",
      methodProperties: {
        Documents: [
          {
            DocumentNumber: trackingNumber,
            Phone: "",
          },
        ],
      },
    });

    if (response.data.success && response.data.data.length > 0) {
      return response.data.data[0];
    }
    return null;
  } catch (error) {
    console.error("Помилка при отриманні даних з API Нової Пошти:", error);
    return null;
  }
}

// Функція для отримання списку міст
async function getCities() {
  try {
    const response = await axios.post(NOVA_POSHTA_API_URL, {
      apiKey: NOVA_POSHTA_API_KEY,
      modelName: "Address",
      calledMethod: "getCities",
      methodProperties: {},
    });

    return response.data.success ? response.data.data : [];
  } catch (error) {
    console.error("Помилка при отриманні списку міст:", error);
    return [];
  }
}

// Обробка подій бота
bot.on(BotEvents.SUBSCRIBED, async (response) => {
  try {
    const user = new User({
      viberUserId: response.userProfile.id,
      name: response.userProfile.name,
      avatar: response.userProfile.avatar,
      language: response.userProfile.language,
      country: response.userProfile.country,
    });

    await user.save();
    console.log(`Новий користувач підписався: ${response.userProfile.name}`);

    bot.sendMessage(
      response.userProfile,
      new TextMessage(
        "Вітаю! 👋\n\n" +
          "Я бот для відстеження посилок Нової Пошти.\n\n" +
          "Надішліть мені номер накладної (наприклад: 20450123456789), і я покажу інформацію про вашу відправку."
      )
    );
  } catch (error) {
    if (error.code !== 11000) {
      // Ігноруємо помилку дублювання
      console.error("Помилка при збереженні користувача:", error);
    }
  }
});

bot.on(BotEvents.MESSAGE_RECEIVED, async (message, response) => {
  const trackingNumberRegex = /^\d{14}$/; // Номер накладної НП має 14 цифр

  if (message instanceof TextMessage) {
    const text = message.text.trim();

    if (trackingNumberRegex.test(text)) {
      // Це номер накладної
      try {
        bot.sendMessage(
          response.userProfile,
          new TextMessage("🔍 Шукаю інформацію про вашу відправку...")
        );

        const shipmentInfo = await getShipmentInfo(text);

        if (shipmentInfo) {
          // Збереження в базу даних
          const shipmentData = {
            trackingNumber: text,
            senderCity: shipmentInfo.CitySender || "Не вказано",
            recipientCity: shipmentInfo.CityRecipient || "Не вказано",
            status: shipmentInfo.Status || "Невідомо",
            viberUserId: response.userProfile.id,
            senderAddress: shipmentInfo.WarehouseSender || "",
            recipientAddress: shipmentInfo.WarehouseRecipient || "",
            weight: parseFloat(shipmentInfo.DocumentWeight) || 0,
            cost: parseFloat(shipmentInfo.DocumentCost) || 0,
            updatedAt: new Date(),
          };

          await Shipment.findOneAndUpdate(
            { trackingNumber: text },
            shipmentData,
            { upsert: true, new: true }
          );

          const responseMessage =
            `📦 Інформація про відправку:\n\n` +
            `📋 Номер: ${text}\n` +
            `📍 Маршрут: ${shipmentInfo.CitySender} → ${shipmentInfo.CityRecipient}\n` +
            `📊 Статус: ${shipmentInfo.Status}\n` +
            `⚖️ Вага: ${shipmentInfo.DocumentWeight || "Не вказано"} кг\n` +
            `💰 Вартість: ${shipmentInfo.DocumentCost || "Не вказано"} грн\n` +
            `📅 Дата створення: ${
              shipmentInfo.DateCreated || "Не вказано"
            }\n\n` +
            `Для відстеження іншої посилки надішліть новий номер накладної.`;

          bot.sendMessage(
            response.userProfile,
            new TextMessage(responseMessage)
          );
        } else {
          bot.sendMessage(
            response.userProfile,
            new TextMessage(
              "❌ Не вдалося знайти інформацію про цю відправку.\n\n" +
                "Перевірте правильність номера накладної та спробуйте ще раз."
            )
          );
        }
      } catch (error) {
        console.error("Помилка при обробці відправки:", error);
        bot.sendMessage(
          response.userProfile,
          new TextMessage(
            "❌ Виникла помилка при обробці запиту. Спробуйте пізніше."
          )
        );
      }
    } else if (text.toLowerCase().includes("допомога") || text === "/help") {
      bot.sendMessage(
        response.userProfile,
        new TextMessage(
          "ℹ️ Довідка:\n\n" +
            "• Надішліть номер накладної Нової Пошти (14 цифр)\n" +
            "• Приклад: 20450123456789\n" +
            "• Я покажу статус та маршрут відправки\n" +
            "• Всі запити зберігаються в базі даних\n\n" +
            "Команди:\n" +
            "• 'допомога' - показати цю довідку\n" +
            "• 'мої посилки' - показати останні відстежені посилки"
        )
      );
    } else if (text.toLowerCase().includes("мої посилки")) {
      try {
        const userShipments = await Shipment.find({
          viberUserId: response.userProfile.id,
        })
          .sort({ updatedAt: -1 })
          .limit(5);

        if (userShipments.length > 0) {
          let message = "📦 Ваші останні посилки:\n\n";
          userShipments.forEach((shipment, index) => {
            message += `${index + 1}. ${shipment.trackingNumber}\n`;
            message += `   ${shipment.senderCity} → ${shipment.recipientCity}\n`;
            message += `   Статус: ${shipment.status}\n\n`;
          });
          bot.sendMessage(response.userProfile, new TextMessage(message));
        } else {
          bot.sendMessage(
            response.userProfile,
            new TextMessage(
              "У вас поки що немає відстежених посилок.\nНадішліть номер накладної для відстеження."
            )
          );
        }
      } catch (error) {
        console.error("Помилка при отриманні посилок користувача:", error);
        bot.sendMessage(
          response.userProfile,
          new TextMessage("❌ Помилка при отриманні ваших посилок.")
        );
      }
    } else {
      bot.sendMessage(
        response.userProfile,
        new TextMessage(
          "Будь ласка, надішліть номер накладної Нової Пошти (14 цифр).\n\n" +
            "Приклад: 20450123456789\n\n" +
            "Для отримання довідки напишіть 'допомога'."
        )
      );
    }
  }
});

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

// Webhook для Viber
app.use("/viber/webhook", bot.middleware());

// Налаштування webhook
app.get("/set_webhook", (req, res) => {
  bot
    .setWebhook(process.env.WEBHOOK_URL + "/viber/webhook")
    .then(() => res.send("Webhook встановлено"))
    .catch((err) => res.status(500).send(err));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Сервер запущено на порті ${PORT}`);
  console.log(`Встановіть webhook: ${process.env.WEBHOOK_URL}/set_webhook`);
});

module.exports = { app, bot };
