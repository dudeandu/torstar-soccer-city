// From toronto-star-blox-default-main:
// node app/scripts/update-tsv-from-country-text.js
// npx gulp rebuild
//
// From toronto-star-blox-default-main/app:
// node scripts/update-tsv-from-country-text.js

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const tsvPath = path.join(root, "data", "data.tsv");
const countryTextDir = path.join(root, "data", "countryText");
// Media is intentionally gathered only from images/. Do not scan videos raw/.
const imagesDir = path.join(root, "images");
const publicDataDir = path.join(imagesDir, "data");
const publicTsvPath = path.join(publicDataDir, "data.tsv");

const columns = [
  "team",
  "folderName",
  "group",
  "theFan",
  "theCountry",
  "whyCheer",
  "howToCheer",
  "wheretoGather",
  "video1",
  "videos",
  "image1",
  "image2",
  "images",
  "text",
];

const fileNameAliases = {
  "Curacao": "Curaçao",
  "Curacao-": "Curaçao",
  "Curaao": "Curaçao",
  "Czech-Republic": "Czechia",
};

function normalizeKey(value) {
  return String(value)
    .normalize("NFD")
    .replace(/Cura\uFFFDao/gi, "Curacao")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\uFFFD/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function parseTSV(tsvText) {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;

  for (let i = 0; i < tsvText.length; i++) {
    const char = tsvText[i];
    const nextChar = tsvText[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        value += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "\t" && !inQuotes) {
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

  const headers = rows.shift().map(header => header.trim());
  return rows.map(values => {
    const rowObj = {};
    headers.forEach((header, index) => {
      rowObj[header] = values[index] ? values[index].trim() : "";
    });
    return rowObj;
  });
}

function tsvValue(value) {
  const text = String(value ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (/["\t\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function writeTSV(rows) {
  const lines = [columns.join("\t")];
  rows.forEach(row => {
    lines.push(columns.map(column => tsvValue(row[column])).join("\t"));
  });
  const tsv = `${lines.join("\n")}\n`;
  fs.writeFileSync(tsvPath, tsv);
  fs.mkdirSync(publicDataDir, { recursive: true });
  fs.writeFileSync(publicTsvPath, tsv);
}

function headingFor(line) {
  const trimmed = line.trim();
  if (/^the\s+fans?:/i.test(trimmed)) return "theFan";
  if (/^(the\s+country|cheering\s+for):/i.test(trimmed)) return "theCountry";
  if (/^why\b.*(?:cheers?|cheering):/i.test(trimmed)) return "whyCheer";
  if (/^how\s+(?:to|you\s+can)\s+cheer:/i.test(trimmed)) return "howToCheer";
  if (/^where\b.*(?:gather|watch|cheer):/i.test(trimmed)) return "wheretoGather";
  return "";
}

function stripHeading(line) {
  return line.replace(/^[^:]+:\s*/, "").trim();
}

function parseCountryText(rawText) {
  const text = rawText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  const sections = {
    theFan: "",
    theCountry: "",
    whyCheer: "",
    howToCheer: "",
    wheretoGather: "",
    text,
  };

  let currentSection = "";
  const chunks = [];

  function flush() {
    if (currentSection) {
      const sectionText = chunks.join("\n").trim();
      if (sectionText) {
        sections[currentSection] = [sections[currentSection], sectionText].filter(Boolean).join("\n\n");
      }
    }
    chunks.length = 0;
  }

  text.split("\n").forEach(line => {
    const section = headingFor(line);
    if (section) {
      flush();
      currentSection = section;
      const firstLine = stripHeading(line);
      if (firstLine) chunks.push(firstLine);
      return;
    }

    if (currentSection) chunks.push(line);
  });

  flush();
  return sections;
}

function getCountryTextFiles() {
  const byKey = new Map();
  fs.readdirSync(countryTextDir)
    .filter(fileName => fileName.endsWith(".txt"))
    .forEach(fileName => {
      const baseName = path.basename(fileName, ".txt");
      byKey.set(normalizeKey(baseName), path.join(countryTextDir, fileName));

      const alias = fileNameAliases[baseName];
      if (alias) {
        byKey.set(normalizeKey(alias), path.join(countryTextDir, fileName));
      }
    });
  return byKey;
}

function findTextFile(row, textFilesByKey) {
  const candidates = [
    row.folderName,
    row.team,
    row.team.replace(/\s+/g, "-"),
  ];

  for (const candidate of candidates) {
    const match = textFilesByKey.get(normalizeKey(candidate));
    if (match) return match;
  }

  return "";
}

function isImageFile(fileName) {
  return /\.(jpe?g|png|webp|gif)$/i.test(fileName);
}

function isVideoFile(fileName) {
  return /\.(mov|mp4|m4v|webm)$/i.test(fileName);
}

function naturalSort(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function mediaSort(a, b) {
  const aInVideoFolder = a.split(path.sep).includes("video");
  const bInVideoFolder = b.split(path.sep).includes("video");
  if (aInVideoFolder !== bInVideoFolder) return aInVideoFolder ? -1 : 1;
  return naturalSort(a, b);
}

function getFilesRecursive(dir) {
  const resolvedDir = path.resolve(dir);
  const resolvedImagesDir = path.resolve(imagesDir);
  if (resolvedDir !== resolvedImagesDir && !resolvedDir.startsWith(`${resolvedImagesDir}${path.sep}`)) {
    throw new Error(`Refusing to scan media outside images/: ${dir}`);
  }

  return fs.readdirSync(dir, { withFileTypes: true })
    .flatMap(entry => {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) return getFilesRecursive(entryPath);
      if (entry.isFile()) return [entryPath];
      return [];
    });
}

function toBrowserPath(filePath) {
  return `./${path.relative(root, filePath).split(path.sep).join("/")}`;
}

function getImageFolders() {
  const byKey = new Map();
  fs.readdirSync(imagesDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .forEach(entry => {
      byKey.set(normalizeKey(entry.name), path.join(imagesDir, entry.name));
    });
  return byKey;
}

function findImageFolder(row, imageFoldersByKey) {
  const candidates = [
    row.folderName,
    row.team,
    row.team.replace(/\s+/g, "-"),
  ];

  for (const candidate of candidates) {
    const match = imageFoldersByKey.get(normalizeKey(candidate));
    if (match) return match;
  }

  return "";
}

function getCountryImages(row, imageFoldersByKey) {
  const imageFolder = findImageFolder(row, imageFoldersByKey);
  if (!imageFolder) return [];

  return getFilesRecursive(imageFolder)
    .filter(filePath => isImageFile(path.basename(filePath)))
    .sort(naturalSort)
    .map(toBrowserPath);
}

function getCountryVideos(row, imageFoldersByKey) {
  const imageFolder = findImageFolder(row, imageFoldersByKey);
  if (!imageFolder) return [];

  return getFilesRecursive(imageFolder)
    .filter(filePath => isVideoFile(path.basename(filePath)))
    .sort(mediaSort)
    .map(toBrowserPath);
}

const rows = parseTSV(fs.readFileSync(tsvPath, "utf8"));
const textFilesByKey = getCountryTextFiles();
const imageFoldersByKey = getImageFolders();
const missing = [];

const updatedRows = rows.map(row => {
  const textFile = findTextFile(row, textFilesByKey);
  const images = getCountryImages(row, imageFoldersByKey);
  const videos = getCountryVideos(row, imageFoldersByKey);
  if (!textFile) {
    missing.push(row.team);
    return {
      ...row,
      video1: videos[0] || "",
      videos: videos.join("|"),
      image1: images[0] || "",
      image2: images[1] || "",
      images: images.join("|"),
    };
  }

  const parsed = parseCountryText(fs.readFileSync(textFile, "utf8"));
  return {
    ...row,
    theFan: parsed.theFan,
    theCountry: parsed.theCountry,
    whyCheer: parsed.whyCheer,
    howToCheer: parsed.howToCheer,
    wheretoGather: parsed.wheretoGather,
    video1: videos[0] || "",
    videos: videos.join("|"),
    image1: images[0] || "",
    image2: images[1] || "",
    images: images.join("|"),
    text: parsed.text,
  };
});

writeTSV(updatedRows);

console.log(`Updated ${updatedRows.length - missing.length} TSV rows from countryText files.`);
if (missing.length) {
  console.log(`Missing text files for: ${missing.join(", ")}`);
}

["theFan", "theCountry", "whyCheer", "howToCheer", "text"].forEach(column => {
  const blankRows = updatedRows.filter(row => !String(row[column] || "").trim()).map(row => row.team);
  if (blankRows.length) {
    console.log(`Blank ${column}: ${blankRows.join(", ")}`);
  }
});
