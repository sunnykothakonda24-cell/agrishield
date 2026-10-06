const { PassThrough } = require('stream');
const cloudinary = require('cloudinary').v2;
const { ERROR_CODES, AgriShieldError } = require('../utils/errors');
const { imageMatchesMime } = require('../middleware/validation');

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function safeFolderSegment(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
}

class CloudinaryImageService {
  constructor({ client = cloudinary, env = process.env, fetchImpl = global.fetch } = {}) {
    this.client = client;
    this.env = env;
    this.fetchImpl = fetchImpl;
    this.lastReachable = null;
  }

  isConfigured() {
    return Boolean(
      this.env.CLOUDINARY_CLOUD_NAME &&
      this.env.CLOUDINARY_API_KEY &&
      this.env.CLOUDINARY_API_SECRET
    );
  }

  status() {
    return {
      provider: 'cloudinary',
      configured: this.isConfigured(),
      reachable: this.lastReachable
    };
  }

  configure() {
    if (!this.isConfigured()) {
      throw new AgriShieldError(
        ERROR_CODES.CLOUDINARY_NOT_CONFIGURED,
        'Cloudinary image storage is not configured on the backend.',
        503
      );
    }
    this.client.config({
      cloud_name: this.env.CLOUDINARY_CLOUD_NAME,
      api_key: this.env.CLOUDINARY_API_KEY,
      api_secret: this.env.CLOUDINARY_API_SECRET,
      secure: true
    });
  }

  async uploadBuffer({ buffer, mimeType, ownerUid, farmId, conversationId, messageId }) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > MAX_IMAGE_BYTES) {
      throw new AgriShieldError(ERROR_CODES.INVALID_INPUT, 'A valid crop image is required.', 400);
    }
    if (!ownerUid || !farmId || !conversationId || !messageId) {
      throw new AgriShieldError(ERROR_CODES.INVALID_INPUT, 'Image ownership details are required.', 400);
    }
    this.configure();
    const folder = [
      this.env.CLOUDINARY_AI_FOLDER || 'agrishield/ai-images',
      safeFolderSegment(ownerUid),
      safeFolderSegment(farmId),
      safeFolderSegment(conversationId)
    ].join('/');
    const publicId = safeFolderSegment(messageId);

    try {
      const uploaded = await new Promise((resolve, reject) => {
        const uploadStream = this.client.uploader.upload_stream({
          folder,
          public_id: publicId,
          resource_type: 'image',
          type: 'authenticated',
          overwrite: true,
          unique_filename: false,
          use_filename: false
        }, (error, result) => error ? reject(error) : resolve(result));
        const bufferStream = new PassThrough();
        bufferStream.end(buffer);
        bufferStream.pipe(uploadStream);
      });
      this.lastReachable = true;
      return {
        provider: 'cloudinary',
        assetId: uploaded.asset_id,
        publicId: uploaded.public_id,
        version: uploaded.version,
        resourceType: uploaded.resource_type || 'image',
        type: uploaded.type || 'authenticated',
        format: uploaded.format,
        bytes: uploaded.bytes,
        width: uploaded.width,
        height: uploaded.height,
        uploadedAt: uploaded.created_at || new Date().toISOString(),
        ownerUid: String(ownerUid),
        farmId: String(farmId),
        conversationId: String(conversationId)
      };
    } catch (error) {
      this.lastReachable = false;
      console.error('[AgriShield Cloudinary] Image upload failed:', error.http_code || error.name || 'upload_error');
      throw new AgriShieldError(
        ERROR_CODES.IMAGE_UPLOAD_FAILED,
        'The crop image could not be stored. Please try again.',
        502
      );
    }
  }

  getSignedDeliveryUrl(attachment, { ownerUid, farmId, conversationId }) {
    this.configure();
    this.assertAttachmentScope(attachment, { ownerUid, farmId, conversationId });
    return this.client.url(attachment.publicId, {
      secure: true,
      resource_type: 'image',
      type: 'authenticated',
      version: attachment.version,
      format: attachment.format,
      sign_url: true
    });
  }

  async getImageBuffer(attachment, { ownerUid, farmId, conversationId }) {
    if (typeof this.fetchImpl !== 'function') {
      throw new AgriShieldError(ERROR_CODES.IMAGE_RETRIEVAL_FAILED, 'The stored crop image could not be retrieved.', 502);
    }
    const url = this.getSignedDeliveryUrl(attachment, { ownerUid, farmId, conversationId });
    try {
      const response = await this.fetchImpl(url, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`Cloudinary delivery returned HTTP ${response.status}.`);
      const contentType = (response.headers.get('content-type') || '').split(';')[0].toLowerCase();
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) {
        throw new Error('Cloudinary returned an unsupported image type.');
      }
      let bytes;
      if (response.body?.getReader) {
        const reader = response.body.getReader();
        const chunks = [];
        let totalBytes = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          totalBytes += value.byteLength;
          if (totalBytes > MAX_IMAGE_BYTES) {
            await reader.cancel();
            throw new Error('The stored image exceeds the size limit.');
          }
          chunks.push(Buffer.from(value));
        }
        bytes = Buffer.concat(chunks, totalBytes);
      } else {
        bytes = Buffer.from(await response.arrayBuffer());
      }
      if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) {
        throw new Error('The stored image size is invalid.');
      }
      if (!imageMatchesMime(bytes, contentType)) {
        throw new Error('The stored image bytes do not match their MIME type.');
      }
      this.lastReachable = true;
      return { buffer: bytes, mimeType: contentType };
    } catch (error) {
      this.lastReachable = false;
      console.error('[AgriShield Cloudinary] Stored image retrieval failed:', error.name || 'delivery_error');
      throw new AgriShieldError(
        ERROR_CODES.IMAGE_RETRIEVAL_FAILED,
        'The saved crop image could not be retrieved. Please select it again.',
        502
      );
    }
  }

  async deleteAsset(attachment) {
    if (!attachment?.publicId || !this.isConfigured()) return false;
    this.configure();
    try {
      await this.client.uploader.destroy(attachment.publicId, {
        resource_type: 'image',
        type: 'authenticated',
        invalidate: true
      });
      return true;
    } catch (error) {
      console.error('[AgriShield Cloudinary] Unreferenced image cleanup failed:', error.http_code || error.name || 'cleanup_error');
      throw error;
    }
  }

  async deleteUserAssets(ownerUid) {
    if (!ownerUid || !this.isConfigured()) return { deleted: false, reason: 'not_configured' };
    this.configure();
    const prefix = [
      this.env.CLOUDINARY_AI_FOLDER || 'agrishield/ai-images',
      safeFolderSegment(ownerUid)
    ].join('/');
    try {
      let nextCursor;
      let deletedCount = 0;
      const seenCursors = new Set();
      do {
        const result = await this.client.api.delete_resources_by_prefix(prefix, {
          resource_type: 'image',
          type: 'authenticated',
          invalidate: true,
          max_results: 500,
          ...(nextCursor ? { next_cursor: nextCursor } : {})
        });
        deletedCount += result.deleted ? Object.keys(result.deleted).length : 0;
        nextCursor = result.next_cursor || null;
        if (nextCursor && seenCursors.has(nextCursor)) {
          throw new Error('Cloudinary returned a repeated cursor during account cleanup.');
        }
        if (nextCursor) seenCursors.add(nextCursor);
      } while (nextCursor);
      return { deleted: true, deletedCount };
    } catch (error) {
      console.error('[AgriShield Cloudinary] User image cleanup failed:', error.http_code || error.name || 'cleanup_error');
      throw error;
    }
  }

  assertAttachmentScope(attachment, { ownerUid, farmId, conversationId }) {
    const expectedPrefix = [
      this.env.CLOUDINARY_AI_FOLDER || 'agrishield/ai-images',
      safeFolderSegment(ownerUid),
      safeFolderSegment(farmId),
      safeFolderSegment(conversationId)
    ].join('/') + '/';
    if (!attachment || attachment.provider !== 'cloudinary' ||
        attachment.ownerUid !== String(ownerUid) ||
        attachment.farmId !== String(farmId) ||
        attachment.conversationId !== String(conversationId) ||
        typeof attachment.publicId !== 'string' ||
        !attachment.publicId.startsWith(expectedPrefix) ||
        attachment.type !== 'authenticated' ||
        !attachment.assetId ||
        !attachment.version) {
      throw new AgriShieldError(ERROR_CODES.FARM_ACCESS_DENIED, 'This image is not available in this farm conversation.', 403);
    }
  }
}

module.exports = new CloudinaryImageService();
module.exports.CloudinaryImageService = CloudinaryImageService;
module.exports.safeFolderSegment = safeFolderSegment;
