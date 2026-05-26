#!/usr/bin/env node
/**
 * WaveSpeedAI — Nano Banana Pro Edit | Batch Image Generation Script (Node.js)
 * ==============================================================================
 * Uses the WaveSpeed SDK to send prompts + reference image to the
 * google/nano-banana-pro/edit endpoint and saves output images locally.
 *
 * Requirements:
 *     npm install wavespeed
 *
 * Usage:
 *     WAVESPEED_API_KEY=your_key node wavespeed_edit.js
 */
import csv from "csv-parser";
import fs from "node:fs";
import https from "node:https";
import {loadEnvFile} from "node:process";
import path from "path";
import {Client} from "wavespeed";

loadEnvFile(); // Loads from the default './.env' path

// ═══════════════════════════════════════════════════════════════════
// USER CONFIGURATION
// ═══════════════════════════════════════════════════════════════════

const API_KEY = process.env.WAVESPEED_API_KEY;
const PROMPTS_CSV = "prompts.csv";
const OUTPUT_DIR = "output";
const ASPECT_RATIO = "3:4";
const RESOLUTION = "2k";
const OUTPUT_FORMAT = "png";
const SUBMIT_DELAY = 2000; // milliseconds between submissions

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

/**
 * Load image as base64 data URI
 */
function loadImageAsDataUri(filePath) {
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
function resolveImage(source) {
  if (source.startsWith("http://") || source.startsWith("https://")) {
    return source;
  }
  return loadImageAsDataUri(source);
}

/**
 * Load prompts from CSV file
 * Expected format: "prompt text", "image_filename"
 */
function loadPromptsFromCsv(csvPath) {
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
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Download and save image from URL
 */
async function downloadImage(url, dest) {
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

// ═══════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════

async function main() {
  // Preflight checks
  if (API_KEY === "YOUR_API_KEY_HERE") {
    console.error("❌  No API key found.\n" + "    Set the WAVESPEED_API_KEY environment variable.");
    process.exit(1);
  }

  // Create output directory
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, {recursive: true});
  }

  // Load prompts from CSV
  console.log(`\n📂  Loading prompts from: ${PROMPTS_CSV}`);
  let prompts;
  try {
    prompts = await loadPromptsFromCsv(PROMPTS_CSV);
    if (prompts.length === 0) {
      throw new Error("No prompts found in CSV file.");
    }
    console.log(`✅  Loaded ${prompts.length} prompts from CSV.\n`);
  } catch (err) {
    console.error(`❌  Failed to load prompts: ${err.message}`);
    process.exit(1);
  }

  // Estimate cost
  const costPerRun = RESOLUTION === "1k" || RESOLUTION === "2k" ? 0.14 : 0.24;
  const totalCost = costPerRun * prompts.length;
  console.log(`💰  Estimated cost: ${prompts.length} × $${costPerRun.toFixed(2)} = $${totalCost.toFixed(2)}\n`);

  // Initialize WaveSpeed client
  const client = new Client(API_KEY);

  // Process each prompt
  const log = [];
  const total = prompts.length;

  for (let idx = 0; idx < total; idx++) {
    const [promptId, promptText, imageFile] = prompts[idx];
    const current = idx + 1;

    const separator = "─".repeat(60);
    console.log(separator);
    console.log(`[${current}/${total}]  Prompt #${promptId}`);
    console.log(`  📝  ${promptText}`);
    console.log(`  🖼️   Reference: ${imageFile}`);

    const entry = {
      id: promptId,
      prompt: promptText,
      image: imageFile,
      status: null,
      result: null,
    };

    try {
      // Load and resolve reference image for this prompt
      console.log("  📥  Loading reference image…");
      console.log(imageFile);
      const imageValue = resolveImage(imageFile);

      // Submit job
      console.log("  🚀  Submitting job…");
      const result = await client.run("google/nano-banana-pro/edit", {
        prompt: promptText,
        images: [imageValue],
        aspect_ratio: ASPECT_RATIO,
        resolution: RESOLUTION,
        output_format: OUTPUT_FORMAT,
        enable_sync_mode: false,
        enable_base64_output: false,
      });

      if (!result.outputs || result.outputs.length === 0) {
        throw new Error("No outputs returned from API.");
      }

      const outputUrl = result.outputs[0];
      console.log(`  🌐  Output URL: ${outputUrl}`);
      entry.output_url = outputUrl;

      // Download image
      const filename = path.join(OUTPUT_DIR, `prompt_${String(promptId).padStart(2, "0")}.${OUTPUT_FORMAT}`);
      console.log(`  💾  Downloading → ${filename}`);
      await downloadImage(outputUrl, filename);

      entry.status = "ok";
      entry.result = filename;
      console.log(`  ✅  Saved successfully.\n`);
    } catch (err) {
      entry.status = "error";
      entry.result = err.message;
      console.log(`  ❌  Error: ${err.message}\n`);
    }

    log.push(entry);

    // Brief pause before next submission
    if (idx < total - 1) {
      await sleep(SUBMIT_DELAY);
    }
  }

  // Summary
  const succeeded = log.filter((e) => e.status === "ok");
  const failed = log.filter((e) => e.status === "error");

  console.log("\n" + "═".repeat(60));
  console.log("  SUMMARY");
  console.log("═".repeat(60));
  console.log(`  ✅  Succeeded : ${succeeded.length}/${total}`);
  console.log(`  ❌  Failed    : ${failed.length}/${total}`);

  if (failed.length > 0) {
    console.log("\n  Failed prompts:");
    for (const e of failed) {
      const truncated = e.prompt.length > 55 ? e.prompt.slice(0, 55) + "…" : e.prompt;
      console.log(`    #${e.id}  "${truncated}"`);
      console.log(`         Error: ${e.result}`);
    }
  }

  // Save JSON log
  const logPath = path.join(OUTPUT_DIR, "results.json");
  fs.writeFileSync(logPath, JSON.stringify(log, null, 2), "utf-8");
  console.log(`\n  📋  Full log → ${logPath}`);
  console.log("═".repeat(60) + "\n");
}

main().catch((err) => {
  console.error(`Fatal error: ${err.message}`);
  process.exit(1);
});
