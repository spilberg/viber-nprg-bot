#!/usr/bin/env node
// diagnose-ocr.js
// Повна діагностика OCR системи

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

function log(msg, color = colors.reset) {
  console.log(color + msg + colors.reset);
}

console.log("╔═══════════════════════════════════════════════════════════╗");
console.log("║           🔍 ДІАГНОСТИКА OCR СИСТЕМИ                     ║");
console.log("╚═══════════════════════════════════════════════════════════╝\n");

let issues = [];
let warnings = [];

// 1. Перевірка Tesseract
log("1️⃣  Перевірка Tesseract...", colors.blue);
try {
  const version = execSync("tesseract --version", { encoding: "utf-8" });
  log("✅ Tesseract встановлений", colors.green);
  console.log("   Версія:", version.split("\n")[0]);
} catch (e) {
  log("❌ Tesseract НЕ встановлений!", colors.red);
  issues.push("Tesseract не встановлений");
  console.log("\n   📥 Встановлення:");
  console.log("   Ubuntu: sudo apt install tesseract-ocr");
  console.log("   macOS: brew install tesseract");
  console.log("   Windows: https://github.com/UB-Mannheim/tesseract/wiki\n");
}

// 2. Перевірка мовних пакетів
log("\n2️⃣  Перевірка мовних пакетів...", colors.blue);
try {
  const langs = execSync("tesseract --list-langs", { encoding: "utf-8" });
  const langList = langs
    .split("\n")
    .slice(1)
    .filter((l) => l.trim());

  const required = ["eng", "ukr", "rus"];
  const missing = required.filter((lang) => !langList.includes(lang));

  if (missing.length === 0) {
    log("✅ Всі необхідні мови встановлені", colors.green);
    console.log("   Доступні:", langList.join(", "));
  } else {
    log(`⚠️  Відсутні мови: ${missing.join(", ")}`, colors.yellow);
    warnings.push(`Відсутні мовні пакети: ${missing.join(", ")}`);
    console.log("\n   📥 Встановлення:");
    console.log(
      "   Ubuntu: sudo apt install tesseract-ocr-ukr tesseract-ocr-rus"
    );
    console.log("   macOS: brew install tesseract-lang");
    console.log(
      "   Windows: завантажте .traineddata з https://github.com/tesseract-ocr/tessdata\n"
    );
  }
} catch (e) {
  log("❌ Не вдалося перевірити мови", colors.red);
  issues.push("Проблема з мовними пакетами Tesseract");
}

// 3. Перевірка Node.js пакетів
log("\n3️⃣  Перевірка Node.js залежностей...", colors.blue);

const packages = ["tesseract.js", "sharp", "viber-bot", "mongoose", "express"];

packages.forEach((pkg) => {
  try {
    require.resolve(pkg);
    log(`✅ ${pkg} встановлений`, colors.green);
  } catch (e) {
    log(`❌ ${pkg} НЕ встановлений`, colors.red);
    issues.push(`Пакет ${pkg} не встановлений`);
  }
});

// 4. Тест Sharp обробки
log("\n4️⃣  Тестування Sharp (обробка зображень)...", colors.blue);
try {
  const sharp = require("sharp");

  // Створюємо тестове зображення
  const testImage = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
    "base64"
  );

  sharp(testImage)
    .greyscale()
    .toBuffer()
    .then(() => {
      log("✅ Sharp працює коректно", colors.green);
    })
    .catch((err) => {
      log("❌ Помилка Sharp: " + err.message, colors.red);
      issues.push("Sharp не працює");
    });
} catch (e) {
  log("❌ Sharp не встановлений або не працює", colors.red);
  issues.push("Проблема з Sharp");
}

// 5. Тест Tesseract.js
log("\n5️⃣  Тестування Tesseract.js...", colors.blue);
try {
  const Tesseract = require("tesseract.js");
  log("✅ Tesseract.js імпортується", colors.green);

  // Простий тест розпізнавання
  log(
    "   🔄 Запуск тесту розпізнавання (може зайняти 10-15 секунд)...",
    colors.yellow
  );

  Tesseract.recognize(
    "https://tesseract.projectnaptha.com/img/eng_bw.png",
    "eng",
    {
      logger: () => {}, // Вимкнути логи
    }
  )
    .then(({ data: { text, confidence } }) => {
      if (confidence > 50) {
        log(
          `✅ Тест розпізнавання пройшов успішно (${confidence.toFixed(1)}%)`,
          colors.green
        );
        console.log(`   Розпізнаний текст: "${text.substring(0, 50)}..."`);
      } else {
        log(
          `⚠️  Низька впевненість розпізнавання (${confidence.toFixed(1)}%)`,
          colors.yellow
        );
        warnings.push("Низька якість OCR розпізнавання");
      }
    })
    .catch((err) => {
      log("❌ Помилка тесту: " + err.message, colors.red);
      issues.push("Tesseract.js не працює");
    });
} catch (e) {
  log("❌ Помилка Tesseract.js: " + e.message, colors.red);
  issues.push("Tesseract.js має проблеми");
}

// 6. Перевірка структури проекту
log("\n6️⃣  Перевірка структури проекту...", colors.blue);
const requiredFiles = [
  "server.js",
  "package.json",
  ".env",
  "utils/ocrHelper.js",
];

const requiredDirs = ["uploads", "utils"];

requiredFiles.forEach((file) => {
  if (fs.existsSync(file)) {
    log(`✅ ${file} існує`, colors.green);
  } else {
    log(`⚠️  ${file} не знайдено`, colors.yellow);
    warnings.push(`Відсутній файл: ${file}`);
  }
});

requiredDirs.forEach((dir) => {
  if (fs.existsSync(dir)) {
    log(`✅ Папка ${dir}/ існує`, colors.green);
  } else {
    log(
      `⚠️  Папка ${dir}/ не знайдена (буде створена автоматично)`,
      colors.yellow
    );
    try {
      fs.mkdirSync(dir, { recursive: true });
      log(`   ✅ Папку ${dir}/ створено`, colors.green);
    } catch (e) {
      warnings.push(`Не вдалося створити папку: ${dir}`);
    }
  }
});

// 7. Перевірка .env
log("\n7️⃣  Перевірка .env конфігурації...", colors.blue);
if (fs.existsSync(".env")) {
  const envContent = fs.readFileSync(".env", "utf-8");

  const requiredVars = [
    "VIBER_AUTH_TOKEN",
    "NOVA_POSHTA_API_KEY",
    "WEBHOOK_URL",
    "MONGODB_URI",
  ];

  requiredVars.forEach((varName) => {
    const regex = new RegExp(`^${varName}=(.+)$`, "m");
    const match = envContent.match(regex);

    if (match && match[1].trim()) {
      log(`✅ ${varName} налаштовано`, colors.green);
    } else {
      log(`⚠️  ${varName} порожнє або відсутнє`, colors.yellow);
      warnings.push(`Потрібно налаштувати: ${varName}`);
    }
  });
} else {
  log("❌ .env файл не знайдено", colors.red);
  issues.push(".env файл відсутній");
}

// 8. Тест прямого виклику tesseract (якщо є тестове зображення)
log("\n8️⃣  Тест прямого виклику Tesseract...", colors.blue);
const testImagePath = process.argv[2];

if (testImagePath && fs.existsSync(testImagePath)) {
  log(`   Тестування файлу: ${testImagePath}`, colors.blue);
  try {
    const output = execSync(
      `tesseract "${testImagePath}" stdout -l eng+ukr --psm 6`,
      {
        encoding: "utf-8",
      }
    );

    if (output.trim()) {
      log("✅ Tesseract розпізнав текст:", colors.green);
      console.log("   " + output.substring(0, 200).replace(/\n/g, "\n   "));

      // Пошук 14-значних номерів
      const numbers = output.match(/\d{14}/g);
      if (numbers) {
        log(`\n   🎯 Знайдено номер(и): ${numbers.join(", ")}`, colors.green);
      }
    } else {
      log("⚠️  Tesseract не розпізнав текст", colors.yellow);
      warnings.push("Tesseract не може розпізнати тестове зображення");
    }
  } catch (e) {
    log("❌ Помилка виклику Tesseract: " + e.message, colors.red);
  }
} else {
  log("ℹ️  Тестове зображення не надано", colors.blue);
  console.log("   Використання: node diagnose-ocr.js path/to/test-image.jpg");
}

// Підсумок
setTimeout(() => {
  console.log("\n" + "=".repeat(70));
  log("📊 ПІДСУМОК ДІАГНОСТИКИ", colors.blue);
  console.log("=".repeat(70));

  if (issues.length === 0 && warnings.length === 0) {
    log("\n🎉 ВСЕ ЧУДОВО! Система готова до роботи!", colors.green);
    console.log("\nНаступні кроки:");
    console.log("  1. Заповніть токени в .env");
    console.log("  2. Запустіть тест: node test-ocr.js your-receipt.jpg");
    console.log("  3. Запустіть бот: npm start\n");
  } else {
    if (issues.length > 0) {
      log(`\n❌ КРИТИЧНІ ПРОБЛЕМИ (${issues.length}):`, colors.red);
      issues.forEach((issue, i) => {
        console.log(`   ${i + 1}. ${issue}`);
      });
    }

    if (warnings.length > 0) {
      log(`\n⚠️  ПОПЕРЕДЖЕННЯ (${warnings.length}):`, colors.yellow);
      warnings.forEach((warning, i) => {
        console.log(`   ${i + 1}. ${warning}`);
      });
    }

    console.log("\n📋 РЕКОМЕНДАЦІЇ:");

    if (issues.includes("Tesseract не встановлений")) {
      console.log("\n   🔧 Встановіть Tesseract:");
      console.log(
        "      Ubuntu: sudo apt install tesseract-ocr tesseract-ocr-ukr"
      );
      console.log("      macOS: brew install tesseract tesseract-lang");
      console.log(
        "      Windows: https://github.com/UB-Mannheim/tesseract/wiki"
      );
    }

    if (issues.some((i) => i.includes("Пакет"))) {
      console.log("\n   📦 Встановіть відсутні пакети:");
      console.log("      npm install");
    }

    if (warnings.some((w) => w.includes("VIBER_AUTH_TOKEN"))) {
      console.log("\n   🔑 Отримайте токени:");
      console.log("      Viber: https://partners.viber.com/");
      console.log("      Nova Poshta: https://devcenter.novaposhta.ua/");
    }

    console.log("\n   ℹ️  Після виправлення запустіть діагностику знову");
  }

  console.log("\n" + "=".repeat(70) + "\n");

  // Додаткова інформація
  console.log("💡 Корисні команди:");
  console.log("   • Перевірка Tesseract: tesseract --version");
  console.log("   • Список мов: tesseract --list-langs");
  console.log("   • Тест OCR: tesseract image.jpg stdout -l ukr+eng");
  console.log("   • Тест нашої системи: node test-ocr.js image.jpg");
  console.log("");
}, 3000); // Даємо час на асинхронні тести
