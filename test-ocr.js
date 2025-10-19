// test-ocr.js
// Скрипт для тестування OCR функціоналу локально

const {
  smartExtract,
  cleanupOldFiles,
  analyzeImage,
} = require("./utils/ocrHelper");
const path = require("path");
const fs = require("fs");

async function testOCR() {
  // Перевірте, чи передано шлях до зображення
  const imagePath = process.argv[2];

  if (!imagePath) {
    console.log("❌ Використання: node test-ocr.js <path-to-image>");
    console.log("📝 Приклад: node test-ocr.js ./receipts/test-receipt.jpg");
    process.exit(1);
  }

  // Перевірка існування файлу
  if (!fs.existsSync(imagePath)) {
    console.log(`❌ Файл не знайдено: ${imagePath}`);
    process.exit(1);
  }

  console.log("╔═══════════════════════════════════════════════════════════╗");
  console.log("║        🔍 ТЕСТУВАННЯ OCR РОЗПІЗНАВАННЯ                   ║");
  console.log("╚═══════════════════════════════════════════════════════════╝");
  console.log(`\n📄 Файл: ${imagePath}\n`);

  try {
    const startTime = Date.now();

    // Виконуємо розпізнавання
    const trackingNumbers = await smartExtract(imagePath);

    const endTime = Date.now();
    const duration = ((endTime - startTime) / 1000).toFixed(2);

    console.log("\n" + "=".repeat(60));
    console.log("📊 РЕЗУЛЬТАТИ:");
    console.log("=".repeat(60));

    if (trackingNumbers.length === 0) {
      console.log("❌ Номери накладних не знайдено");
      console.log("\n💡 Поради для покращення розпізнавання:");
      console.log("   1. Переконайтеся, що номер чітко видимий");
      console.log("   2. Покращіть освітлення (уникайте тіней)");
      console.log("   3. Спробуйте зробити фото ближче до номера");
      console.log("   4. Переконайтеся, що камера в фокусі");
      console.log("   5. Уникайте бліків на папері");
      console.log("   6. Тримайте камеру паралельно чеку");
      console.log("\n🔧 Технічні рекомендації:");
      console.log("   • Мінімальна висота цифр: 20 пікселів");
      console.log("   • Рекомендована роздільність: 1200+ пікселів по ширині");
      console.log("   • Формат: JPG або PNG");
    } else {
      console.log(`✅ Знайдено номерів: ${trackingNumbers.length}\n`);

      trackingNumbers.forEach((number, index) => {
        console.log(`${index + 1}. 📦 ${number}`);
        console.log(`   Формат: ${formatTrackingNumber(number)}`);
        console.log(`   Валідний: ${isValidFormat(number) ? "✅" : "⚠️ "}`);
      });

      console.log("\n✅ Готово до використання в боті!");
    }

    console.log(`\n⏱️  Час обробки: ${duration} секунд`);
    console.log("=".repeat(60) + "\n");

    // Показати додаткову інформацію
    const imageInfo = await analyzeImage(imagePath);
    console.log("📸 Інформація про зображення:");
    console.log(`   • Розмір: ${imageInfo.width}x${imageInfo.height} пікселів`);
    console.log(`   • Яскравість: ${imageInfo.brightness.toFixed(1)}/255`);
    console.log(`   • Формат: ${imageInfo.format}`);
    console.log(`   • Тип: ${imageInfo.isReceipt ? "Чек" : "Звичайне фото"}`);
    console.log("");
  } catch (error) {
    console.error("\n❌ Помилка:", error.message);
    console.error("\n📋 Повна інформація про помилку:");
    console.error(error);
    console.log("\n💡 Можливі причини:");
    console.log("   • Пошкоджений файл зображення");
    console.log("   • Недостатньо пам'яті");
    console.log("   • Tesseract не встановлений правильно");
    console.log("   • Неправильний формат файлу");
  }
}

/**
 * Форматування номера накладної для кращої читабельності
 */
function formatTrackingNumber(number) {
  return number.replace(/(\d{4})(\d{4})(\d{4})(\d{2})/, "$1 $2 $3 $4");
}

/**
 * Перевірка формату
 */
function isValidFormat(number) {
  const prefix = number.substring(0, 4);
  const prefixNum = parseInt(prefix);
  return (
    (prefixNum >= 5900 && prefixNum <= 5999) ||
    (prefixNum >= 2000 && prefixNum <= 2099)
  );
}

/**
 * Масове тестування (якщо передано папку)
 */
async function testMultipleImages(dirPath) {
  const fs = require("fs").promises;
  const path = require("path");

  console.log("╔═══════════════════════════════════════════════════════════╗");
  console.log("║      📂 МАСОВЕ ТЕСТУВАННЯ ЗОБРАЖЕНЬ                      ║");
  console.log("╚═══════════════════════════════════════════════════════════╝");
  console.log(`\n📂 Папка: ${dirPath}\n`);

  try {
    const files = await fs.readdir(dirPath);
    const imageFiles = files.filter((f) =>
      /\.(jpg|jpeg|png|bmp|tiff)$/i.test(f)
    );

    if (imageFiles.length === 0) {
      console.log("❌ Зображень не знайдено в папці");
      return;
    }

    console.log(`📸 Знайдено зображень: ${imageFiles.length}\n`);

    const results = [];
    let totalTime = 0;

    for (const [index, file] of imageFiles.entries()) {
      console.log(`\n[${index + 1}/${imageFiles.length}] 🔍 Обробка: ${file}`);
      console.log("─".repeat(60));
      const filePath = path.join(dirPath, file);

      const startTime = Date.now();
      try {
        const numbers = await smartExtract(filePath);
        const duration = (Date.now() - startTime) / 1000;
        totalTime += duration;

        results.push({
          file,
          success: numbers.length > 0,
          numbers,
          count: numbers.length,
          time: duration,
        });

        if (numbers.length > 0) {
          console.log(`   ✅ Знайдено: ${numbers.join(", ")}`);
          console.log(`   ⏱️  ${duration.toFixed(2)}с`);
        } else {
          console.log(`   ❌ Номери не знайдено`);
          console.log(`   ⏱️  ${duration.toFixed(2)}с`);
        }
      } catch (error) {
        console.log(`   ❌ Помилка: ${error.message}`);
        results.push({
          file,
          success: false,
          error: error.message,
        });
      }
    }

    // Підсумкова статистика
    console.log("\n" + "=".repeat(70));
    console.log("📊 ПІДСУМКОВА СТАТИСТИКА:");
    console.log("=".repeat(70));

    const successful = results.filter((r) => r.success).length;
    const failed = results.length - successful;
    const totalNumbers = results.reduce((sum, r) => sum + (r.count || 0), 0);
    const avgTime = totalTime / results.length;

    console.log(`\n📈 Загальні показники:`);
    console.log(`   • Всього файлів: ${results.length}`);
    console.log(
      `   • Успішно: ${successful} (${(
        (successful / results.length) *
        100
      ).toFixed(1)}%)`
    );
    console.log(
      `   • Невдало: ${failed} (${((failed / results.length) * 100).toFixed(
        1
      )}%)`
    );
    console.log(`   • Знайдено номерів: ${totalNumbers}`);
    console.log(`   • Середній час: ${avgTime.toFixed(2)}с`);
    console.log(`   • Загальний час: ${totalTime.toFixed(2)}с`);

    // Детальна таблиця
    console.log(`\n📋 Детальні результати:`);
    console.log("─".repeat(70));
    console.log(" № | Файл                           | Результат | Час   ");
    console.log("─".repeat(70));

    results.forEach((r, i) => {
      const num = (i + 1).toString().padStart(2);
      const file = r.file.substring(0, 30).padEnd(30);
      const result = r.success ? `✅ ${r.count}` : "❌ 0";
      const time = r.time ? `${r.time.toFixed(2)}с` : "N/A";
      console.log(` ${num} | ${file} | ${result.padEnd(9)} | ${time}`);
    });

    console.log("─".repeat(70));

    // Успішні розпізнавання
    const successResults = results.filter(
      (r) => r.success && r.numbers.length > 0
    );
    if (successResults.length > 0) {
      console.log(`\n✅ Успішно розпізнані номери:`);
      successResults.forEach((r) => {
        console.log(`   ${r.file}: ${r.numbers.join(", ")}`);
      });
    }

    // Невдалі розпізнавання
    const failedResults = results.filter((r) => !r.success);
    if (failedResults.length > 0) {
      console.log(`\n❌ Файли без розпізнаних номерів:`);
      failedResults.forEach((r) => {
        console.log(`   ${r.file}${r.error ? ` (${r.error})` : ""}`);
      });
    }

    console.log("\n" + "=".repeat(70) + "\n");
  } catch (error) {
    console.error("❌ Помилка при обробці папки:", error);
  }
}

// Головна функція
async function main() {
  const targetPath = process.argv[2];

  if (!targetPath) {
    console.log(
      "╔═══════════════════════════════════════════════════════════╗"
    );
    console.log("║        🔍 ТЕСТУВАННЯ OCR РОЗПІЗНАВАННЯ                   ║");
    console.log(
      "╚═══════════════════════════════════════════════════════════╝\n"
    );
    console.log("Використання:");
    console.log("  node test-ocr.js <шлях-до-файлу>");
    console.log("  node test-ocr.js <шлях-до-папки>\n");
    console.log("Приклади:");
    console.log("  node test-ocr.js ./receipt.jpg");
    console.log("  node test-ocr.js ./test-receipts/\n");
    console.log("💡 Поради:");
    console.log("  • Використовуйте чіткі фото з хорошим освітленням");
    console.log("  • Мінімальний розмір: 800x600 пікселів");
    console.log("  • Номер має бути добре видимим");
    console.log("");
    process.exit(0);
  }

  const stats = fs.statSync(targetPath);

  if (stats.isDirectory()) {
    await testMultipleImages(targetPath);
  } else {
    await testOCR();
  }

  // Очищення старих тимчасових файлів
  console.log("🧹 Очищення тимчасових файлів...");
  await cleanupOldFiles("./uploads", 1);
  console.log("✅ Готово!\n");
}

// Запуск
main().catch(console.error);
