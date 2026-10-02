const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const UPLOAD_ROOT = path.resolve(__dirname, '..', '..', 'uploads');
const EXTENSIONS_BY_MIME = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp']
]);

function getUploadDirectory(category) {
  if (!/^[a-z-]+$/.test(category)) throw new Error('Invalid file storage category.');
  return path.resolve(UPLOAD_ROOT, category);
}

class LocalStorageService {
  async saveFile({ buffer, category, mimeType }) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('Cannot store an empty file.');
    const extension = EXTENSIONS_BY_MIME.get(mimeType);
    if (!extension) throw new Error('Unsupported file type for local storage.');

    const directory = getUploadDirectory(category);
    await fs.mkdir(directory, { recursive: true });
    const filename = `${crypto.randomUUID()}${extension}`;
    const absolutePath = path.resolve(directory, filename);
    if (!absolutePath.startsWith(`${directory}${path.sep}`)) {
      throw new Error('Resolved upload path is outside the configured storage directory.');
    }

    await fs.writeFile(absolutePath, buffer, { flag: 'wx' });
    return {
      path: `/uploads/${category}/${filename}`,
      absolutePath
    };
  }

  async getFile({ category, filename }) {
    if (path.basename(filename) !== filename) throw new Error('Invalid stored filename.');
    const directory = getUploadDirectory(category);
    const absolutePath = path.resolve(directory, filename);
    if (!absolutePath.startsWith(`${directory}${path.sep}`)) {
      throw new Error('Resolved file path is outside the configured storage directory.');
    }
    return fs.readFile(absolutePath);
  }

  async deleteFile({ category, filename }) {
    if (path.basename(filename) !== filename) throw new Error('Invalid stored filename.');
    const directory = getUploadDirectory(category);
    const absolutePath = path.resolve(directory, filename);
    if (!absolutePath.startsWith(`${directory}${path.sep}`)) {
      throw new Error('Resolved file path is outside the configured storage directory.');
    }
    await fs.unlink(absolutePath);
  }
}

module.exports = new LocalStorageService();
