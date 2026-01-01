// Utility functions for image handling
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const UPLOADS_DIR = path.join(__dirname, '../../uploads/items');

// Safely delete temp files on Windows where handles can linger briefly
async function safeUnlink(filePath) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await fs.promises.unlink(filePath);
      return;
    } catch (err) {
      if (err.code === 'ENOENT') return; // already gone
      // Retry after brief pause for EBUSY/EPERM cases
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
  console.warn('Failed to cleanup temp file:', filePath);
}

// Ensure uploads directory exists
function ensureUploadsDir(itemId) {
  const itemDir = path.join(UPLOADS_DIR, itemId.toString());
  if (!fs.existsSync(itemDir)) {
    fs.mkdirSync(itemDir, { recursive: true });
  }
  return itemDir;
}

// Generate thumbnail from original image
async function generateThumbnail(originalPath, thumbnailPath) {
  await sharp(originalPath)
    .resize(200, 200, {
      fit: 'inside',
      withoutEnlargement: true
    })
    .jpeg({ quality: 80 })
    .toFile(thumbnailPath);
}

// Process uploaded image: resize if too large, generate thumbnail
async function processImage(file, itemId, displayOrder) {
  const itemDir = ensureUploadsDir(itemId);
  const ext = path.extname(file.originalname).toLowerCase();
  const baseName = `${String(displayOrder).padStart(3, '0')}`;
  
  const originalPath = path.join(itemDir, `${baseName}_original${ext}`);
  const thumbPath = path.join(itemDir, `${baseName}_thumb.jpg`);
  
  // Resize original if too large (max 1920x1920, 5MB target)
  await sharp(file.path)
    .resize(1920, 1920, {
      fit: 'inside',
      withoutEnlargement: true
    })
    .jpeg({ quality: 85 })
    .toFile(originalPath);
  
  // Generate thumbnail
  await generateThumbnail(originalPath, thumbPath);
  
  // Clean up multer temp file
  await safeUnlink(file.path);
  
  return `${baseName}_original${ext}`;
}

// Delete all images for an item
function deleteItemImages(itemId) {
  const itemDir = path.join(UPLOADS_DIR, itemId.toString());
  if (fs.existsSync(itemDir)) {
    fs.rmSync(itemDir, { recursive: true, force: true });
  }
}

// Delete specific image
async function deleteImage(itemId, filename) {
  const itemDir = path.join(UPLOADS_DIR, itemId.toString());
  const baseName = filename.replace(/_original\.(jpg|jpeg|png|webp)$/i, '');
  
  // Delete both original and thumbnail
  const originalPath = path.join(itemDir, filename);
  const thumbPath = path.join(itemDir, `${baseName}_thumb.jpg`);
  
  // Use safeUnlink to avoid EBUSY on Windows
  if (fs.existsSync(originalPath)) await safeUnlink(originalPath);
  if (fs.existsSync(thumbPath)) await safeUnlink(thumbPath);
}

module.exports = {
  ensureUploadsDir,
  processImage,
  deleteItemImages,
  deleteImage,
  UPLOADS_DIR
};
