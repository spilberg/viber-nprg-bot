// utils/ocrHelper.js
// Допоміжні функції для роботи з OCR

const sharp = require("sharp");
const Tesseract = require("tesseract.js");
const fs = require("fs").promises;

/**
 * Різні режими обробки зображення для покращення OCR
 */
const ImageProcessingModes = {
  STANDARD: "standard",
  HIGH_CONTRAST: "high_contrast",
  DARK_TEXT: "dark_text",
  LIGHT_TEXT: "light_text",
  RECEIPT: "receipt", // Спеціально для чеків
  BARCODE_AREA: "barcode_area", // Область біля штрих-коду
};

/**
 * Агресивна обробка спеціально для чеків Нової Пошти
 */
async function processReceiptImage(imagePath) {
  const processedPath = `${imagePath}_receipt_processed.jpg`;

  try {
    // Отримуємо метадані
    const metadata = await sharp(imagePath).metadata();
    const { width, height } = metadata;

    // Збільшуємо розмір для кращого розпізнавання
    const targetWidth = Math.max(width, 2000);

    await sharp(imagePath)
      .resize(targetWidth, null, {
        kernel: "lanczos3",
        fit: "inside",
      })
      // Конвертуємо в чорно-біле
      .grayscale()
      // Нормалізація (покращує контраст)
      .normalize()
      // Збільшення різкості
      .sharpen({
        sigma: 2,
        m1: 1.5,
        m2: 0.5,
      })
      // Збільшення контрасту
      .linear(1.3, -(128 * 0.3))
      // Бінаризація (чорно-біле без відтінків сірого)
      .threshold(140)
      // Висока якість
      .jpeg({
        quality: 100,
        chromaSubsampling: "4:4:4",
      })
      .toFile(processedPath);

    return processedPath;
  } catch (error) {
    console.error("Помилка обробки зображення чеку:", error);
    throw error;
  }
}

/**
 * Обробка зображення з різними налаштуваннями
 */
async function processImageWithMode(
  imagePath,
  mode = ImageProcessingModes.STANDARD
) {
  const processedPath = `${imagePath}_${mode}.jpg`;

  let processor = sharp(imagePath).resize(2000, null, {
    withoutEnlargement: false,
    fit: "inside",
    kernel: "lanczos3",
  });

  switch (mode) {
    case ImageProcessingModes.RECEIPT:
      processor = processor
        .grayscale()
        .normalize()
        .sharpen({ sigma: 2 })
        .linear(1.3, -(128 * 0.3))
        .threshold(140);
      break;

    case ImageProcessingModes.HIGH_CONTRAST:
      processor = processor
        .greyscale()
        .normalize()
        .linear(1.5, -(128 * 0.5))
        .sharpen({ sigma: 2 });
      break;

    case ImageProcessingModes.DARK_TEXT:
      processor = processor.greyscale().normalize().threshold(128);
      break;

    case ImageProcessingModes.LIGHT_TEXT:
      processor = processor.greyscale().negate().normalize().threshold(128);
      break;

    case ImageProcessingModes.BARCODE_AREA:
      // Обробка області навколо штрих-коду
      processor = processor
        .grayscale()
        .normalize()
        .sharpen({ sigma: 3 })
        .linear(1.4, -(128 * 0.4))
        .threshold(130);
      break;

    default: // STANDARD
      processor = processor.greyscale().normalize().sharpen();
  }

  await processor.jpeg({ quality: 95 }).toFile(processedPath);
  return processedPath;
}

/**
 * Покращене розпізнавання з множинними спробами
 */
async function recognizeNumbers(imagePath, language = "ukr+rus+eng") {
  try {
    const {
      data: { text, confidence },
    } = await Tesseract.recognize(imagePath, language, {
      logger: () => {},
      tessedit_char_whitelist: "0123456789 ",
      tessedit_pageseg_mode: Tesseract.PSM.AUTO,
    });

    console.log(`OCR впевненість: ${confidence}%`);
    console.log(`Розпізнаний текст:\n${text.substring(0, 500)}`);

    return extractTrackingNumbers(text);
  } catch (error) {
    console.error("Помилка OCR:", error);
    return [];
  }
}

/**
 * Спроба розпізнавання з різними режимами обробки
 */
async function extractWithMultipleModes(imagePath) {
  console.log("🔍 Спроба розпізнавання з різними режимами...\n");

  const modes = [
    ImageProcessingModes.RECEIPT,
    ImageProcessingModes.BARCODE_AREA,
    ImageProcessingModes.HIGH_CONTRAST,
    ImageProcessingModes.DARK_TEXT,
    ImageProcessingModes.STANDARD,
  ];

  const allFoundNumbers = new Set();

  for (const mode of modes) {
    try {
      console.log(`Режим: ${mode}`);
      const processedPath = await processImageWithMode(imagePath, mode);

      // Спроба з різними мовами
      const languages = ["eng", "ukr+eng", "ukr+rus+eng"];

      for (const lang of languages) {
        const numbers = await recognizeNumbers(processedPath, lang);

        if (numbers.length > 0) {
          console.log(
            `✅ Знайдено ${numbers.length} номер(ів) в режимі ${mode} (${lang})`
          );
          numbers.forEach((num) => allFoundNumbers.add(num));

          // Якщо знайшли - можна зупинитися
          await fs.unlink(processedPath).catch(() => {});
          return Array.from(allFoundNumbers);
        }
      }

      // Видаляємо тимчасовий файл
      await fs.unlink(processedPath).catch(() => {});
    } catch (error) {
      console.error(`Помилка в режимі ${mode}:`, error.message);
    }
  }

  return Array.from(allFoundNumbers);
}

/**
 * Витягування номерів накладних з тексту
 */
function extractTrackingNumbers(text) {
  // Очищаємо текст від зайвих символів
  const cleanText = text
    .replace(/[^\d\s\n]/g, " ") // Залишаємо тільки цифри та пробіли
    .replace(/\s+/g, " "); // Множинні пробіли в один

  console.log(`Очищений текст: ${cleanText.substring(0, 200)}`);

  const patterns = [
    /\b(\d{14})\b/g, // 14 цифр підряд
    /\b(\d{4}\s?\d{4}\s?\d{4}\s?\d{2})\b/g, // З пробілами
    /(\d{5}\s?\d{4}\s?\d{4}\s?\d{1})/g, // Інший формат
  ];

  const foundNumbers = new Set();

  patterns.forEach((pattern) => {
    const matches = cleanText.match(pattern);
    if (matches) {
      matches.forEach((match) => {
        const cleanNumber = match.replace(/\D/g, "");
        if (cleanNumber.length === 14 && isValidTrackingNumber(cleanNumber)) {
          console.log(`✅ Знайдено валідний номер: ${cleanNumber}`);
          foundNumbers.add(cleanNumber);
        }
      });
    }
  });

  // Додатковий пошук - послідовності 14 цифр де завгодно
  const allDigits = text.replace(/\D/g, "");
  for (let i = 0; i <= allDigits.length - 14; i++) {
    const candidate = allDigits.substring(i, i + 14);
    if (isValidTrackingNumber(candidate)) {
      console.log(`✅ Знайдено валідний номер (послідовність): ${candidate}`);
      foundNumbers.add(candidate);
    }
  }

  return Array.from(foundNumbers);
}

/**
 * Базова валідація номера накладної
 */
function isValidTrackingNumber(number) {
  // Номер має бути 14 цифр
  if (!/^\d{14}$/.test(number)) {
    return false;
  }

  // Перевірка що не всі цифри однакові
  if (/^(\d)\1{13}$/.test(number)) {
    return false;
  }

  // Перші 4 цифри зазвичай рік (префікс НП або рік)
  const prefix = number.substring(0, 4);
  const prefixNum = parseInt(prefix);

  // НП використовує префікси 5900-5999 або роки 2000-2099
  if (
    (prefixNum >= 5900 && prefixNum <= 5999) ||
    (prefixNum >= 2000 && prefixNum <= 2099)
  ) {
    return true;
  }

  return false;
}

/**
 * Покращення зображення перед OCR (автоматичний вибір кращих параметрів)
 */
async function analyzeImage(imagePath) {
  const metadata = await sharp(imagePath).metadata();
  const stats = await sharp(imagePath).stats();

  // Визначення яскравості зображення
  const channels = stats.channels;
  const avgBrightness =
    channels.reduce((sum, ch) => sum + ch.mean, 0) / channels.length;

  return {
    width: metadata.width,
    height: metadata.height,
    brightness: avgBrightness,
    isDark: avgBrightness < 100,
    isLight: avgBrightness > 200,
    isReceipt: metadata.width < 800, // Чеки зазвичай вузькі
    format: metadata.format,
  };
}

/**
 * Автоматичний вибір найкращого режиму обробки
 */
async function suggestProcessingMode(imagePath) {
  const imageInfo = await analyzeImage(imagePath);

  console.log("📊 Аналіз зображення:", imageInfo);

  if (imageInfo.isReceipt) {
    return ImageProcessingModes.RECEIPT;
  } else if (imageInfo.isDark) {
    return ImageProcessingModes.LIGHT_TEXT;
  } else if (imageInfo.isLight) {
    return ImageProcessingModes.DARK_TEXT;
  } else {
    return ImageProcessingModes.HIGH_CONTRAST;
  }
}

/**
 * Головна функція для розпізнавання з автоматичним вибором режиму
 */
async function smartExtract(imagePath) {
  try {
    console.log("🚀 Початок розпізнавання...");
    console.log(`📄 Файл: ${imagePath}\n`);

    // Аналіз зображення
    const imageInfo = await analyzeImage(imagePath);
    console.log(`📊 Розмір: ${imageInfo.width}x${imageInfo.height}`);
    console.log(`💡 Яскравість: ${imageInfo.brightness.toFixed(1)}\n`);

    // Спроба з усіма режимами
    const numbers = await extractWithMultipleModes(imagePath);

    if (numbers.length === 0) {
      console.log(
        "\n⚠️  Номери не знайдено. Спроба з послабленими правилами..."
      );

      // Останній шанс - без валідації
      const processedPath = await processReceiptImage(imagePath);
      const {
        data: { text },
      } = await Tesseract.recognize(processedPath, "eng+ukr");
      await fs.unlink(processedPath).catch(() => {});

      console.log("📝 Весь розпізнаний текст:");
      console.log(text);
      console.log("\n");

      // Шукаємо будь-які 14-значні числа
      const allDigits = text.replace(/\D/g, "");
      console.log(`🔢 Всі цифри: ${allDigits.substring(0, 100)}...`);

      for (let i = 0; i <= allDigits.length - 14; i++) {
        const candidate = allDigits.substring(i, i + 14);
        console.log(`Перевірка: ${candidate}`);
        numbers.push(candidate);
      }
    }

    return [...new Set(numbers)]; // Унікальні значення
  } catch (error) {
    console.error("Помилка smart extract:", error);
    throw error;
  }
}

/**
 * Очищення папки з тимчасовими файлами
 */
async function cleanupOldFiles(uploadsDir, maxAgeHours = 24) {
  try {
    const files = await fs.readdir(uploadsDir);
    const now = Date.now();
    const maxAge = maxAgeHours * 60 * 60 * 1000;

    for (const file of files) {
      const filePath = `${uploadsDir}/${file}`;
      const stats = await fs.stat(filePath);

      if (now - stats.mtimeMs > maxAge) {
        await fs.unlink(filePath);
        console.log(`Видалено старий файл: ${file}`);
      }
    }
  } catch (error) {
    console.error("Помилка очищення:", error);
  }
}

module.exports = {
  ImageProcessingModes,
  processImageWithMode,
  processReceiptImage,
  extractWithMultipleModes,
  recognizeNumbers,
  extractTrackingNumbers,
  isValidTrackingNumber,
  analyzeImage,
  suggestProcessingMode,
  smartExtract,
  cleanupOldFiles,
};

/**
 * Обробка зображення з різними налаштуваннями
 * @param {string} imagePath - шлях до оригінального зображення
 * @param {string} mode - режим обробки
 * @returns {string} - шлях до обробленого зображення
 */
async function processImageWithMode(
  imagePath,
  mode = ImageProcessingModes.STANDARD
) {
  const processedPath = `${imagePath}_${mode}.jpg`;

  let processor = sharp(imagePath).resize(1600, null, {
    withoutEnlargement: true,
    fit: "inside",
  });

  switch (mode) {
    case ImageProcessingModes.HIGH_CONTRAST:
      processor = processor
        .greyscale()
        .normalize()
        .linear(1.5, -(128 * 0.5)) // Збільшення контрасту
        .sharpen({ sigma: 2 });
      break;

    case ImageProcessingModes.DARK_TEXT:
      processor = processor.greyscale().normalize().threshold(128); // Бінаризація
      break;

    case ImageProcessingModes.LIGHT_TEXT:
      processor = processor
        .greyscale()
        .negate() // Інверсія кольорів
        .normalize()
        .threshold(128);
      break;

    default: // STANDARD
      processor = processor.greyscale().normalize().sharpen();
  }

  await processor.jpeg({ quality: 95 }).toFile(processedPath);
  return processedPath;
}

/**
 * Спроба розпізнавання з різними режимами обробки
 * @param {string} imagePath - шлях до зображення
 * @returns {Array} - знайдені номери накладних
 */
async function extractWithMultipleModes(imagePath) {
  const modes = Object.values(ImageProcessingModes);
  const allFoundNumbers = new Set();

  for (const mode of modes) {
    try {
      const processedPath = await processImageWithMode(imagePath, mode);
      const numbers = await recognizeNumbers(processedPath);

      numbers.forEach((num) => allFoundNumbers.add(num));

      // Видаляємо тимчасовий файл
      await fs.unlink(processedPath).catch(() => {});

      // Якщо знайшли хоча б один номер, можна зупинитися
      if (allFoundNumbers.size > 0) {
        console.log(`Успішно розпізнано з режимом: ${mode}`);
        break;
      }
    } catch (error) {
      console.error(`Помилка в режимі ${mode}:`, error.message);
    }
  }

  return Array.from(allFoundNumbers);
}

/**
 * Базове розпізнавання номерів
 * @param {string} imagePath - шлях до зображення
 * @returns {Array} - знайдені номери
 */
async function recognizeNumbers(imagePath) {
  const {
    data: { text },
  } = await Tesseract.recognize(imagePath, "ukr+rus+eng", {
    logger: () => {}, // Вимкнути логи
  });

  return extractTrackingNumbers(text);
}

/**
 * Витягування номерів накладних з тексту
 * @param {string} text - розпізнаний текст
 * @returns {Array} - масив знайдених номерів
 */
function extractTrackingNumbers(text) {
  const patterns = [
    /\b\d{14}\b/g,
    /\b\d{4}\s?\d{4}\s?\d{4}\s?\d{2}\b/g,
    /№?\s?(\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{2})/g,
    /накладна[^\d]*(\d{14})/gi,
    /ТТН[^\d]*(\d{14})/gi,
    /відправлення[^\d]*(\d{14})/gi,
    /номер[^\d]*(\d{14})/gi,
    /\bEN[^\d]*(\d{14})/gi, // Англійська абревіатура
  ];

  const foundNumbers = new Set();

  patterns.forEach((pattern) => {
    const matches = text.match(pattern);
    if (matches) {
      matches.forEach((match) => {
        const cleanNumber = match.replace(/\D/g, "");
        if (cleanNumber.length === 14 && isValidTrackingNumber(cleanNumber)) {
          foundNumbers.add(cleanNumber);
        }
      });
    }
  });

  return Array.from(foundNumbers);
}

/**
 * Базова валідація номера накладної
 * @param {string} number - номер для перевірки
 * @returns {boolean}
 */
function isValidTrackingNumber(number) {
  // Номер має бути 14 цифр
  if (!/^\d{14}$/.test(number)) {
    return false;
  }

  // Перевірка що не всі цифри однакові
  if (/^(\d)\1{13}$/.test(number)) {
    return false;
  }

  // Перші 4 цифри зазвичай рік (20XX або 21XX)
  const year = number.substring(0, 4);
  const yearNum = parseInt(year);
  if (yearNum < 2000 || yearNum > 2099) {
    return false;
  }

  return true;
}

/**
 * Покращення зображення перед OCR (автоматичний вибір кращих параметрів)
 * @param {string} imagePath - шлях до зображення
 * @returns {Object} - статистика зображення для вибору режиму
 */
async function analyzeImage(imagePath) {
  const metadata = await sharp(imagePath).metadata();
  const stats = await sharp(imagePath).stats();

  // Визначення яскравості зображення
  const channels = stats.channels;
  const avgBrightness =
    channels.reduce((sum, ch) => sum + ch.mean, 0) / channels.length;

  return {
    width: metadata.width,
    height: metadata.height,
    brightness: avgBrightness,
    isDark: avgBrightness < 127,
    isLight: avgBrightness > 200,
    format: metadata.format,
  };
}

/**
 * Автоматичний вибір найкращого режиму обробки
 * @param {string} imagePath - шлях до зображення
 * @returns {string} - рекомендований режим
 */
async function suggestProcessingMode(imagePath) {
  const imageInfo = await analyzeImage(imagePath);

  if (imageInfo.isDark) {
    return ImageProcessingModes.LIGHT_TEXT;
  } else if (imageInfo.isLight) {
    return ImageProcessingModes.DARK_TEXT;
  } else {
    return ImageProcessingModes.HIGH_CONTRAST;
  }
}

/**
 * Головна функція для розпізнавання з автоматичним вибором режиму
 * @param {string} imagePath - шлях до зображення
 * @returns {Array} - знайдені номери накладних
 */
async function smartExtract(imagePath) {
  try {
    // Спочатку аналізуємо зображення
    const recommendedMode = await suggestProcessingMode(imagePath);
    console.log(`Рекомендований режим: ${recommendedMode}`);

    // Пробуємо з рекомендованим режимом
    const processedPath = await processImageWithMode(
      imagePath,
      recommendedMode
    );
    let numbers = await recognizeNumbers(processedPath);
    await fs.unlink(processedPath).catch(() => {});

    // Якщо не знайшли, пробуємо всі інші режими
    if (numbers.length === 0) {
      console.log("Пробуємо всі режими...");
      numbers = await extractWithMultipleModes(imagePath);
    }

    return numbers;
  } catch (error) {
    console.error("Помилка smart extract:", error);
    throw error;
  }
}

/**
 * Очищення папки з тимчасовими файлами
 * @param {string} uploadsDir - шлях до папки
 * @param {number} maxAgeHours - максимальний вік файлів в годинах
 */
async function cleanupOldFiles(uploadsDir, maxAgeHours = 24) {
  try {
    const files = await fs.readdir(uploadsDir);
    const now = Date.now();
    const maxAge = maxAgeHours * 60 * 60 * 1000;

    for (const file of files) {
      const filePath = `${uploadsDir}/${file}`;
      const stats = await fs.stat(filePath);

      if (now - stats.mtimeMs > maxAge) {
        await fs.unlink(filePath);
        console.log(`Видалено старий файл: ${file}`);
      }
    }
  } catch (error) {
    console.error("Помилка очищення:", error);
  }
}

module.exports = {
  ImageProcessingModes,
  processImageWithMode,
  extractWithMultipleModes,
  recognizeNumbers,
  extractTrackingNumbers,
  isValidTrackingNumber,
  analyzeImage,
  suggestProcessingMode,
  smartExtract,
  cleanupOldFiles,
};
