import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const screenshotsDir = path.resolve(__dirname, '..', 'data', 'screenshots');

const MAX_HISTORY_ITEMS = 30;

let historyItems = [];

export async function initHistoryStore() {
  await clearHistoryStore();
}

export async function clearHistoryStore() {
  await fs.rm(screenshotsDir, { recursive: true, force: true });
  await fs.mkdir(screenshotsDir, { recursive: true });
  historyItems = [];
}

export function getHistoryItems() {
  return historyItems;
}

export async function saveDetectionScreenshot({ image, message, location, receivedAt }) {
  await fs.mkdir(screenshotsDir, { recursive: true });

  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const filename = `${id}.jpg`;
  const filePath = path.join(screenshotsDir, filename);
  const cleanedImage = image.replace(/^data:image\/jpeg;base64,/, '');

  await fs.writeFile(filePath, Buffer.from(cleanedImage, 'base64'));

  const item = {
    id,
    message,
    location: location?.raw || null,
    imageUrl: `/screenshots/${filename}`,
    filename,
    createdAt: receivedAt || new Date().toISOString()
  };

  historyItems.unshift(item);

  while (historyItems.length > MAX_HISTORY_ITEMS) {
    const removed = historyItems.pop();
    if (removed) {
      await fs.rm(path.join(screenshotsDir, removed.filename), { force: true });
    }
  }

  return item;
}

export async function deleteHistoryItem(id) {
  const item = historyItems.find((entry) => entry.id === id);
  if (!item) return null;

  historyItems = historyItems.filter((entry) => entry.id !== id);

  const filePath = path.join(screenshotsDir, item.filename);
  if (existsSync(filePath)) {
    await fs.rm(filePath, { force: true });
  }

  return item;
}
