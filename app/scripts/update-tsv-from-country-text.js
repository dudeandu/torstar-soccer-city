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
  "image1Width",
  "image1Height",
  "image2Width",
  "image2Height",
  "images",
  "text",
];

const fileNameAliases = {
  "Curacao": "Curaçao",
  "Curacao-": "Curaçao",
  "Curaao": "Curaçao",
  "Czech-Republic": "Czechia",
};

const forceSecondaryImageTeams = new Set([
  "dr-congo",
  "ghana",
  "uzbekistan",
]);

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

function getImageDimensions(filePath) {
  const buffer = fs.readFileSync(filePath);

  if (buffer.length >= 24 && buffer.toString("ascii", 1, 4) === "PNG") {
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20),
    };
  }

  if (buffer.length >= 10 && buffer.toString("ascii", 0, 3) === "GIF") {
    return {
      width: buffer.readUInt16LE(6),
      height: buffer.readUInt16LE(8),
    };
  }

  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    const type = buffer.toString("ascii", 12, 16);
    if (type === "VP8X" && buffer.length >= 30) {
      return {
        width: 1 + buffer.readUIntLE(24, 3),
        height: 1 + buffer.readUIntLE(27, 3),
      };
    }
    if (type === "VP8 " && buffer.length >= 30) {
      return {
        width: buffer.readUInt16LE(26) & 0x3fff,
        height: buffer.readUInt16LE(28) & 0x3fff,
      };
    }
    if (type === "VP8L" && buffer.length >= 25) {
      const bits = buffer.readUInt32LE(21);
      return {
        width: 1 + (bits & 0x3fff),
        height: 1 + ((bits >> 14) & 0x3fff),
      };
    }
  }

  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset++;
        continue;
      }

      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      const isSofMarker = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);

      if (isSofMarker) {
        return {
          width: buffer.readUInt16BE(offset + 7),
          height: buffer.readUInt16BE(offset + 5),
        };
      }

      offset += 2 + length;
    }
  }

  return null;
}

function isHorizontalImage(browserPath) {
  try {
    const dimensions = getBrowserImageDimensions(browserPath);
    if (!dimensions) return true;
    return dimensions.width > dimensions.height;
  } catch (error) {
    console.warn(`Could not read image dimensions for ${browserPath}: ${error.message}`);
    return true;
  }
}

function getBrowserImageDimensions(browserPath) {
  if (!browserPath) return null;
  const filePath = path.join(root, browserPath.replace(/^\.\//, ""));
  return getImageDimensions(filePath);
}

function getImageSlots(row, images) {
  const forceSecondary = forceSecondaryImageTeams.has(normalizeKey(row.team)) || forceSecondaryImageTeams.has(normalizeKey(row.folderName));

  if (images.length && (forceSecondary || (images.length === 1 && !isHorizontalImage(images[0])))) {
    const image2Dimensions = getBrowserImageDimensions(images[0]) || {};
    return {
      image1: "",
      image2: images[0],
      image1Width: "",
      image1Height: "",
      image2Width: image2Dimensions.width || "",
      image2Height: image2Dimensions.height || "",
      images: images.join("|"),
    };
  }

  const image1Dimensions = getBrowserImageDimensions(images[0]) || {};
  const image2Dimensions = getBrowserImageDimensions(images[1]) || {};
  return {
    image1: images[0] || "",
    image2: images[1] || "",
    image1Width: image1Dimensions.width || "",
    image1Height: image1Dimensions.height || "",
    image2Width: image2Dimensions.width || "",
    image2Height: image2Dimensions.height || "",
    images: images.join("|"),
  };
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
  const imageSlots = getImageSlots(row, images);
  if (!textFile) {
    missing.push(row.team);
    return {
      ...row,
      video1: videos[0] || "",
      videos: videos.join("|"),
      ...imageSlots,
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
    ...imageSlots,
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
