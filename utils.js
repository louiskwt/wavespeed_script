import csv from "csv-parser";
import fs from "node:fs";
import https from "node:https";
import path from "path";

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

/**
 * Load image as base64 data URI
 */
export function loadImageAsDataUri(filePath) {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`;
  const image_path = path.resolve(process.cwd(), filePath);
  const buffer = fs.readFileSync(image_path);
  const encoded = buffer.toString("base64");
  return `data:image/${mime};base64,${encoded}`;
}

/**
 * Resolve image: local file → data URI, or URL → unchanged
 */
export function resolveImage(source) {
  if (source.startsWith("http://") || source.startsWith("https://")) {
    return source;
  }
  return loadImageAsDataUri(source);
}

/**
 * Load prompts from CSV file
 * Expected format: "prompt text", "image_filename"
 */
export function loadPromptsFromCsv(csvPath) {
  return new Promise((resolve, reject) => {
    const prompts = [];
    let rowId = 1;

    fs.createReadStream(csvPath)
      .pipe(csv({headers: false}))
      .on("data", (row) => {
        // row is an object with keys "0", "1", etc.
        const promptText = row["0"]?.trim();
        const imageFile = row["1"]?.trim();

        if (promptText && imageFile) {
          prompts.push([rowId, promptText, imageFile]);
          rowId++;
        }
      })
      .on("end", () => resolve(prompts))
      .on("error", reject);
  });
}

/**
 * Sleep for milliseconds
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Download and save image from URL
 */
export async function downloadImage(url, dest) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (response) => {
        const file = fs.createWriteStream(dest);
        response.pipe(file);
        file.on("finish", () => {
          file.close(resolve);
        });
        file.on("error", reject);
      })
      .on("error", reject);
  });
}
