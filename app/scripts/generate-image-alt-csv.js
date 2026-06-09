// From toronto-star-blox-default-main:
// GEMINI_API_KEY=your_key npm run generate-alt
// node app/scripts/generate-image-alt-csv.js
// npx gulp rebuild

const fs = require("fs");
const https = require("https");
const path = require("path");

const root = path.resolve(__dirname, "..");
const dataPath = path.join(root, "data", "data.tsv");
const altCsvPath = path.join(root, "data", "image-alt.csv");
const publicDataDir = path.join(root, "images", "data");
const publicAltCsvPath = path.join(publicDataDir, "image-alt.csv");
const defaultGeminiModel = "gemini-2.5-flash";
const defaultMaxOutputTokens = 256;

function getArgValue(name, fallback = "") {
  const prefix = `--${name}=`;
  const match = process.argv.find(arg => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function normalizeImagePath(value) {
  return String(value || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^images\//, "");
}

function parseDelimited(text, delimiter) {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        value += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      row.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") i++;
      row.push(value);
      if (row.some(cell => cell.trim() !== "")) rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }

  if (value || row.length) {
    row.push(value);
    if (row.some(cell => cell.trim() !== "")) rows.push(row);
  }

  if (!rows.length) return [];
  const headers = rows.shift().map(header => header.trim());
  return rows.map(values => {
    const rowObj = {};
    headers.forEach((header, index) => {
      rowObj[header] = values[index] ? values[index].trim() : "";
    });
    return rowObj;
  });
}

function csvValue(value) {
  const text = String(value ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (/["\n,]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function imagePathsForRow(row) {
  return [
    row.image1,
    row.image2,
    ...String(row.images || "").split("|"),
  ]
    .map(normalizeImagePath)
    .filter(Boolean)
    .filter(pathValue => /\.(jpe?g|png|webp|gif)$/i.test(pathValue));
}

function fallbackAltText(teamName) {
  const cleanTeamName = String(teamName || "").trim() || "World Cup";
  return `${cleanTeamName} fan media in Toronto.`;
}

function isGeneratedFallbackAlt(altText) {
  return /^[A-Za-z0-9 .,&'()/-]+ fan media in Toronto\.$/.test(String(altText || "").trim());
}

function isLikelyTruncatedAlt(altText) {
  const text = String(altText || "").trim();
  if (!text) return true;
  const words = text.split(/\s+/).filter(Boolean);
  const lastWord = words[words.length - 1]?.toLowerCase().replace(/[^a-z]/g, "");
  const clippedEnding = new Set([
    "a", "an", "and", "at", "by", "for", "from", "in", "of", "on", "to", "with",
  ]);

  return words.length < 6 || (!/[.!?]$/.test(text) && clippedEnding.has(lastWord));
}

function readExistingAltText() {
  if (!fs.existsSync(altCsvPath)) return new Map();

  const rows = parseDelimited(fs.readFileSync(altCsvPath, "utf8"), ",");
  return new Map(rows
    .map(row => [normalizeImagePath(row.path), String(row.alt || "").trim()])
    .filter(([imagePath]) => imagePath));
}

function writeAltCsv(rows) {
  const csv = [
    "path,alt",
    ...rows.map(row => [csvValue(row.path), csvValue(row.alt)].join(",")),
  ].join("\n") + "\n";

  fs.writeFileSync(altCsvPath, csv);
  fs.mkdirSync(publicDataDir, { recursive: true });
  fs.writeFileSync(publicAltCsvPath, csv);
}

function mimeTypeForImage(imagePath) {
  const ext = path.extname(imagePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/jpeg";
}

function localImagePath(imagePath) {
  return path.join(root, "images", normalizeImagePath(imagePath));
}

function postJson(url, headers, body) {
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        ...headers,
      },
    }, response => {
      let data = "";
      response.setEncoding("utf8");
      response.on("data", chunk => {
        data += chunk;
      });
      response.on("end", () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`Gemini returned ${response.statusCode}: ${data.slice(0, 500)}`));
          return;
        }

        try {
          resolve(JSON.parse(data));
        } catch (error) {
          reject(new Error(`Could not parse Gemini response: ${error.message}`));
        }
      });
    });

    request.on("error", reject);
    request.write(body);
    request.end();
  });
}

function getGeminiResponseText(response) {
  const parts = response?.candidates?.[0]?.content?.parts || [];
  return parts
    .map(part => part.text || "")
    .join(" ")
    .replace(/^["']|["']$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function generateGeminiAltText({ apiKey, model, imagePath, teamName, maxOutputTokens }) {
  const filePath = localImagePath(imagePath);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing image file: ${filePath}`);
  }

  const base64Image = fs.readFileSync(filePath, { encoding: "base64" });
  const prompt = [
    "Write concise, accurate alt text for this news feature image.",
    "Mention visible people, action, setting, and soccer fan context when clear.",
    "Do not start with 'image of' or 'photo of'.",
    "Do not identify private people by name unless visible text in the image clearly provides it.",
    "Use one sentence, 10 to 25 words.",
    `Country/team context: ${teamName || "World Cup fans in Toronto"}.`,
  ].join(" ");

  const requestBody = JSON.stringify({
    contents: [{
      parts: [
        {
          inline_data: {
            mime_type: mimeTypeForImage(imagePath),
            data: base64Image,
          },
        },
        { text: prompt },
      ],
    }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens,
      thinkingConfig: {
        thinkingBudget: 0,
      },
    },
  });

  const response = await postJson(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    { "x-goog-api-key": apiKey },
    requestBody
  );
  const finishReason = response?.candidates?.[0]?.finishReason;
  const altText = getGeminiResponseText(response);
  if (!altText) throw new Error("Gemini returned an empty alt text response.");
  if (finishReason === "MAX_TOKENS" || isLikelyTruncatedAlt(altText)) {
    throw new Error(`Gemini returned truncated alt text${finishReason ? ` (${finishReason})` : ""}: ${altText}`);
  }
  return altText.replace(/\.$/, ".").trim();
}

function shouldRegenerateAlt(existingAlt, force) {
  if (force) return true;
  if (!existingAlt) return true;
  if (isLikelyTruncatedAlt(existingAlt)) return true;
  return isGeneratedFallbackAlt(existingAlt);
}

async function generateImageAltCsv(options = {}) {
  if (!fs.existsSync(dataPath)) {
    throw new Error(`Missing data file: ${dataPath}`);
  }

  const apiKey = options.apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";
  const model = options.model || process.env.GEMINI_MODEL || defaultGeminiModel;
  const force = Boolean(options.force);
  const fallbackOnly = Boolean(options.fallbackOnly);
  const strict = Boolean(options.strict);
  const limit = Number(options.limit || 0);
  const maxOutputTokens = Number(options.maxOutputTokens || defaultMaxOutputTokens) || defaultMaxOutputTokens;
  const dataRows = parseDelimited(fs.readFileSync(dataPath, "utf8"), "\t");
  const existingAltText = readExistingAltText();
  const seenPaths = new Set();
  const outputRows = [];
  let generatedCount = 0;
  let fallbackCount = 0;
  let preservedCount = 0;

  dataRows.forEach(row => {
    imagePathsForRow(row).forEach(imagePath => {
      if (seenPaths.has(imagePath)) return;
      seenPaths.add(imagePath);
      outputRows.push({
        path: imagePath,
        alt: existingAltText.get(imagePath) || fallbackAltText(row.team),
        team: row.team,
      });
    });
  });

  const candidates = outputRows.filter(row => shouldRegenerateAlt(existingAltText.get(row.path), force));
  const rowsToGenerate = limit > 0 ? candidates.slice(0, limit) : candidates;

  if (!apiKey || fallbackOnly) {
    if (strict && !apiKey) {
      throw new Error("Missing GEMINI_API_KEY. Set it in your terminal, not inside this JavaScript file.");
    }
    if (!apiKey) {
      console.warn("[alt] No GEMINI_API_KEY found. Writing fallback alt text only.");
    }
    if (fallbackOnly) {
      console.warn("[alt] --fallback-only is set. Skipping Gemini.");
    }
    fallbackCount = candidates.length;
    preservedCount = outputRows.length - candidates.length;
    writeAltCsv(outputRows.map(({ path, alt }) => ({ path, alt })));
    return { total: outputRows.length, generated: 0, fallback: fallbackCount, preserved: preservedCount, model: "" };
  }

  console.log(`[alt] Using Gemini model ${model} for ${rowsToGenerate.length} image${rowsToGenerate.length === 1 ? "" : "s"}.`);

  for (const row of rowsToGenerate) {
    try {
      row.alt = await generateGeminiAltText({
        apiKey,
        model,
        imagePath: row.path,
        teamName: row.team,
        maxOutputTokens,
      });
      generatedCount++;
      console.log(`[alt] Gemini: ${row.path}`);
    } catch (error) {
      try {
        row.alt = await generateGeminiAltText({
          apiKey,
          model,
          imagePath: row.path,
          teamName: row.team,
          maxOutputTokens: Math.max(maxOutputTokens * 2, 512),
        });
        generatedCount++;
        console.log(`[alt] Gemini retry: ${row.path}`);
      } catch (retryError) {
        row.alt = isLikelyTruncatedAlt(row.alt) ? fallbackAltText(row.team) : row.alt || fallbackAltText(row.team);
        fallbackCount++;
        console.warn(`[alt] Fallback for ${row.path}: ${retryError.message || error.message}`);
      }
    }

    writeAltCsv(outputRows.map(({ path, alt }) => ({ path, alt })));
  }

  preservedCount = outputRows.length - rowsToGenerate.length;
  writeAltCsv(outputRows.map(({ path, alt }) => ({ path, alt })));
  return { total: outputRows.length, generated: generatedCount, fallback: fallbackCount, preserved: preservedCount, model };
}

if (require.main === module) {
  generateImageAltCsv({
    model: getArgValue("model", process.env.GEMINI_MODEL || defaultGeminiModel),
    force: hasFlag("force"),
    fallbackOnly: hasFlag("fallback-only"),
    strict: hasFlag("strict"),
    limit: Number(getArgValue("limit", "0")),
    maxOutputTokens: Number(getArgValue("max-output-tokens", String(defaultMaxOutputTokens))),
  }).then(result => {
    console.log(`Wrote ${result.total} image alt text rows to ${altCsvPath}`);
    if (result.generated) console.log(`Generated ${result.generated} rows with Gemini ${result.model}.`);
    if (result.fallback) console.log(`Used fallback text for ${result.fallback} rows.`);
    if (result.preserved) console.log(`Preserved ${result.preserved} existing rows.`);
  }).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = generateImageAltCsv;
