#!/usr/bin/env node
// check-setup.js
// Скрипт для перевірки чи все готове до запуску

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const colors = {
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  reset: "\x1b[0m",
};

function log(message, color = colors.reset) {
  console.log(color + message + colors.reset);
}

function success(message) {
  log("✅ " + message, colors.green);
}

function error(message) {
  log("❌ " + message, colors.red);
}

function warning(message) {
  log("⚠️  " + message, colors.yellow);
}

function info(message) {
  log("ℹ️  " + message, colors.blue);
}

function checkCommand(command, name) {
  try {
    const version = execSync(command, { encoding: "utf-8" }).trim();
    success(`${name} встановлений: ${version}`);
    return true;
  } catch (e) {
    error(`${name} НЕ встановлений`);
    return false;
  }
}

function checkFile(filepath, name) {
  if (fs.existsSync(filepath)) {
    success(`${name} знайдено`);
    return true;
  } else {
    error(`${name} НЕ знайдено: ${filepath}`);
    return false;
  }
}

function checkEnvVariable(name) {
  const envPath = path.join(process.cwd(), ".env");
  if (!fs.existsSync(envPath)) {
    return false;
  }

  const envContent = fs.readFileSync(envPath, "utf-8");
  const regex = new RegExp(`^${name}=(.+)$`, "m");
  const match = envContent.match(regex);

  if (match && match[1].trim()) {
    success(`${name} налаштовано`);
    return true;
  } else {
    error(`${name} НЕ налаштовано або порожнє`);
    return false;
  }
}

function checkPort(port) {
  try {
    const command =
      process.platform === "win32"
        ? `netstat -ano | findstr :${port}`
        : `lsof -i :${port}`;

    const result = execSync(command, { encoding: "utf-8" });
    if (result.trim()) {
      warning(`Порт ${port} вже використовується`);
      return false;
    }
  } catch (e) {
    success(`Порт ${port} вільний`);
    return true;
  }
}

function checkMongoDB() {
  try {
    // Спроба підключитися до MongoDB
    const mongoose = require("mongoose");
    mongoose.connect("mongodb://localhost:27017/test", {
      serverSelectionTimeoutMS: 3000,
    });

    return new Promise((resolve) => {
      mongoose.connection.on("connected", () => {
        success("MongoDB запущений і доступний");
        mongoose.connection.close();
        resolve(true);
      });

      mongoose.connection.on("error", () => {
        error("MongoDB НЕ доступний (перевірте чи запущений сервіс)");
        resolve(false);
      });

      // Таймаут
      setTimeout(() => {
        error("MongoDB НЕ відповідає (таймаут)");
        mongoose.connection.close();
        resolve(false);
      }, 3000);
    });
  } catch (e) {
    error("Не вдалося перевірити MongoDB: " + e.message);
    return Promise.resolve(false);
  }
}

async function checkNodeModules() {
  const modulesPath = path.join(process.cwd(), "node_modules");
  if (!fs.existsSync(modulesPath)) {
    error("node_modules не знайдено (запустіть: npm install)");
    return false;
  }

  // Перевірка ключових пакетів
  const packages = [
    "express",
    "viber-bot",
    "mongoose",
    "tesseract.js",
    "sharp",
  ];
  let allInstalled = true;

  for (const pkg of packages) {
    const pkgPath = path.join(modulesPath, pkg);
    if (fs.existsSync(pkgPath)) {
      success(`Пакет ${pkg} встановлений`);
    } else {
      error(`Пакет ${pkg} НЕ встановлений`);
      allInstalled = false;
    }
  }

  return allInstalled;
}

function printSummary(checks) {
  const passed = checks.filter((c) => c.passed).length;
  const total = checks.length;
  const percentage = ((passed / total) * 100).toFixed(0);

  console.log("\n" + "=".repeat(60));
  log("📊 ПІДСУМОК ПЕРЕВІРКИ", colors.blue);
  console.log("=".repeat(60));

  if (passed === total) {
    success(`Всі перевірки пройдено: ${passed}/${total} (100%)`);
    log("\n🎉 Система готова до запуску!", colors.green);
    console.log("\nНаступні кроки:");
    info("1. Запустіть сервер: npm start");
    info("2. Запустіть ngrok: ngrok http 3000");
    info("3. Оновіть WEBHOOK_URL в .env");
    info("4. Перезапустіть сервер");
    info("5. Встановіть webhook: відкрийте /set_webhook");
  } else {
    warning(`Пройдено перевірок: ${passed}/${total} (${percentage}%)`);
    log("\n⚠️  Деякі компоненти відсутні або не налаштовані", colors.yellow);
    console.log("\nВиправте помилки перед запуском:");

    checks
      .filter((c) => !c.passed)
      .forEach((c) => {
        error(`• ${c.name}`);
        if (c.fix) {
          info(`  Рішення: ${c.fix}`);
        }
      });
  }

  console.log("=".repeat(60) + "\n");
}

async function main() {
  console.log("╔═══════════════════════════════════════════════════════════╗");
  console.log("║     🔍 ПЕРЕВІРКА СИСТЕМНИХ ВИМОГ ТА НАЛАШТУВАНЬ         ║");
  console.log(
    "╚═══════════════════════════════════════════════════════════╝\n"
  );

  const checks = [];

  // 1. Перевірка Node.js
  log("1️⃣  Перевірка Node.js...", colors.blue);
  checks.push({
    name: "Node.js",
    passed: checkCommand("node --version", "Node.js"),
    fix: "Встановіть з https://nodejs.org/",
  });

  // 2. Перевірка npm
  log("\n2️⃣  Перевірка npm...", colors.blue);
  checks.push({
    name: "npm",
    passed: checkCommand("npm --version", "npm"),
    fix: "Переустановіть Node.js",
  });

  // 3. Перевірка MongoDB
  log("\n3️⃣  Перевірка MongoDB...", colors.blue);
  const mongoInstalled = checkCommand(
    "mongo --version || mongod --version",
    "MongoDB"
  );
  checks.push({
    name: "MongoDB встановлений",
    passed: mongoInstalled,
    fix: "Встановіть MongoDB з https://www.mongodb.com/try/download/community",
  });

  if (mongoInstalled) {
    const mongoRunning = await checkMongoDB();
    checks.push({
      name: "MongoDB запущений",
      passed: mongoRunning,
      fix: "Запустіть: sudo systemctl start mongodb (Linux) або через Services (Windows)",
    });
  }

  // 4. Перевірка файлів проекту
  log("\n4️⃣  Перевірка файлів проекту...", colors.blue);
  checks.push({
    name: "package.json",
    passed: checkFile("package.json", "package.json"),
    fix: "Створіть package.json з залежностями",
  });

  checks.push({
    name: "server.js",
    passed: checkFile("server.js", "server.js"),
    fix: "Створіть server.js з кодом бота",
  });

  checks.push({
    name: ".env",
    passed: checkFile(".env", ".env файл"),
    fix: "Створіть .env файл з конфігурацією",
  });

  // 5. Перевірка змінних середовища
  log("\n5️⃣  Перевірка змінних середовища (.env)...", colors.blue);
  if (fs.existsSync(".env")) {
    checks.push({
      name: "VIBER_AUTH_TOKEN",
      passed: checkEnvVariable("VIBER_AUTH_TOKEN"),
      fix: "Отримайте токен на https://partners.viber.com/",
    });

    checks.push({
      name: "NOVA_POSHTA_API_KEY",
      passed: checkEnvVariable("NOVA_POSHTA_API_KEY"),
      fix: "Отримайте ключ на https://devcenter.novaposhta.ua/",
    });

    checks.push({
      name: "WEBHOOK_URL",
      passed: checkEnvVariable("WEBHOOK_URL"),
      fix: "Встановіть після запуску ngrok (https://xxxxx.ngrok.io)",
    });
  }

  // 6. Перевірка node_modules
  log("\n6️⃣  Перевірка залежностей...", colors.blue);
  const modulesInstalled = await checkNodeModules();
  checks.push({
    name: "Залежності npm",
    passed: modulesInstalled,
    fix: "Запустіть: npm install",
  });

  // 7. Перевірка порту
  log("\n7️⃣  Перевірка доступності порту 3000...", colors.blue);
  checks.push({
    name: "Порт 3000",
    passed: checkPort(3000),
    fix: "Зупиніть програму на порту 3000 або змініть PORT в .env",
  });

  // 8. Перевірка ngrok (опціонально)
  log("\n8️⃣  Перевірка ngrok (опціонально)...", colors.blue);
  const ngrokInstalled = checkCommand("ngrok version", "ngrok");
  checks.push({
    name: "ngrok",
    passed: ngrokInstalled,
    fix: "Встановіть з https://ngrok.com/download",
  });

  // 9. Перевірка папки uploads
  log("\n9️⃣  Перевірка папки для завантажень...", colors.blue);
  const uploadsDir = path.join(process.cwd(), "uploads");
  if (!fs.existsSync(uploadsDir)) {
    try {
      fs.mkdirSync(uploadsDir, { recursive: true });
      success("Папка uploads створена");
      checks.push({ name: "Папка uploads", passed: true });
    } catch (e) {
      error("Не вдалося створити папку uploads");
      checks.push({
        name: "Папка uploads",
        passed: false,
        fix: "Створіть папку uploads вручну",
      });
    }
  } else {
    success("Папка uploads існує");
    checks.push({ name: "Папка uploads", passed: true });
  }

  // Підсумок
  printSummary(checks);
}

// Запуск
main().catch(console.error);
