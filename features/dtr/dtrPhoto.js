import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { supabase } from "../../config/supabase.js";

const bucket = process.env.SUPABASE_BUCKET;
const allowedFormats = new Set(["jpeg", "png", "webp"]);

// Keep the database timestamp unchanged; only rearrange its date on the photo.
function photoTimestamp(recordedAt) {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}:\d{2}:\d{2})$/.exec(recordedAt);
  if (!match) throw new Error("Invalid attendance timestamp for photo.");
  return `${match[2]}-${match[3]}-${match[1]} ${match[4]}`;
}

export async function validateDtrPhoto(file) {
  if (!file?.buffer?.length) throw Object.assign(new Error("Take a photo before recording attendance."), { status: 400 });
  try {
    const metadata = await sharp(file.buffer, { limitInputPixels: 20_000_000 }).metadata();
    if (!allowedFormats.has(metadata.format) || !metadata.width || !metadata.height)
      throw new Error("Unsupported image");
  } catch {
    throw Object.assign(new Error("The attendance photo could not be read. Retake it and try again."), { status: 400 });
  }
}

// The timestamp comes from the database session, not the browser or image metadata.
// Return only a private storage path; readers must authorize the DTR before signing it.
export async function uploadDtrPhoto(file, recordedAt, kind, userId) {
  const { data, info } = await sharp(file.buffer, { limitInputPixels: 20_000_000 })
    .rotate().resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true }).toBuffer({ resolveWithObject: true });
  const width = info.width;
  const height = info.height;
  const bandHeight = Math.min(88, Math.max(40, Math.round(width * 0.085)));
  const fontSize = Math.min(40, Math.max(10, Math.round(width * 0.025)));
  const label = `${kind === "in" ? "CLOCK IN" : "CLOCK OUT"}  |  ${photoTimestamp(recordedAt)} PHT`;
  const band = Buffer.from(`<svg width="${width}" height="${bandHeight}"><rect width="100%" height="100%" fill="#101010" fill-opacity=".85"/><text x="${Math.round(width * 0.03)}" y="${Math.round(bandHeight * 0.67)}" fill="white" font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="bold">${label}</text></svg>`);
  const stamped = await sharp(data).composite([{ input: band, gravity: "south" }]).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
  const path = `dtr/${userId}/${randomUUID()}-${kind}.jpg`;
  const { error } = await supabase.storage.from(bucket).upload(path, stamped, { contentType: "image/jpeg", upsert: false });
  if (error) throw Object.assign(new Error("Attendance photo could not be saved. Please try again."), { status: 503 });
  return path;
}
