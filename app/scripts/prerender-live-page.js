const fs = require("fs");
const path = require("path");

function extractConst(source, name) {
  const match = source.match(new RegExp(`const ${name} = ([\\s\\S]*?);\\n\\s*(?:const|function|async|\\/\\/)`));
  if (!match) throw new Error(`Could not find const ${name}`);
  return Function(`return (${match[1]});`)();
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
      row.push(value.trim());
      value = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") i++;
      row.push(value.trim());
      if (row.some(cell => cell !== "")) rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }

  if (value || row.length) {
    row.push(value.trim());
    if (row.some(cell => cell !== "")) rows.push(row);
  }

  const headers = rows.shift().map(header => header.trim());
  return rows.map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])));
}

function escapeHTML(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function dimensionAttrs(width, height) {
  return width && height ? ` width="${escapeHTML(width)}" height="${escapeHTML(height)}"` : "";
}

function getMediaOrientationClass(dimensions = {}) {
  const width = Number(dimensions.width);
  const height = Number(dimensions.height);

  if (!width || !height) return "";
  return height > width * 1.15 ? "portrait-media" : "landscape-media";
}

const responsiveImageWidths = [1920, 1280, 1024, 860, 540, 320];

function responsiveImagePath(imagePath, width) {
  return String(imagePath || "").replace(/\.(jpe?g|png)$/i, (_match, extension) => {
    const outputExtension = /^png$/i.test(extension) ? "png" : "jpg";
    return `-${width}w.${outputExtension}`;
  });
}

function srcsetAttrs(imagePath, sizes) {
  if (!/\.(jpe?g|png)$/i.test(String(imagePath || ""))) return "";

  const srcset = responsiveImageWidths
    .map(width => `${escapeHTML(responsiveImagePath(imagePath, width))} ${width}w`)
    .join(", ");

  return ` srcset="${srcset}" sizes="${escapeHTML(sizes)}"`;
}

function normalizeImagePath(imagePath) {
  return String(imagePath || "")
    .trim()
    .replace(/^\.\//, "")
    .replace(/^\/+/, "");
}

function buildCaptionsByPath(captionEntries = {}) {
  const captionsByPath = new Map();

  Object.values(captionEntries || {}).forEach(entry => {
    const normalizedPath = normalizeImagePath(entry && entry.path);
    if (!normalizedPath) return;
    captionsByPath.set(normalizedPath, {
      caption: String(entry.caption || "").trim(),
      credit: String(entry.credit || "").trim(),
    });
  });

  return captionsByPath;
}

async function loadFirebaseCaptions() {
  const url = "https://wc-canada-vibe-check-default-rtdb.firebaseio.com/captionForm/images.json";

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Firebase returned ${response.status}`);
    }

    return buildCaptionsByPath(await response.json());
  } catch (error) {
    console.warn(`[caption-form] Could not load Firebase captions: ${error.message}`);
    return new Map();
  }
}

function renderCaption(imagePath, captionsByPath, tagName = "figcaption", fallbackCaption = "") {
  const saved = captionsByPath.get(normalizeImagePath(imagePath)) || {};
  const caption = saved.caption || String(fallbackCaption || "").trim();
  const credit = saved.credit || "";

  if (!caption && !credit) {
    return `<${tagName} class="caption"></${tagName}>`;
  }

  return `<${tagName} class="caption">${caption ? `<span class="caption-text">${escapeHTML(caption)}</span>` : ""}${credit ? `<span class="caption-credit">${escapeHTML(credit)}</span>` : ""}</${tagName}>`;
}

function renderParagraphs(value, breakOptions = {}) {
  const paragraphs = String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n\s*\n/)
    .map(paragraph => paragraph.trim().replace(/\s*\n\s*/g, " "))
    .filter(Boolean);

  const threshold = breakOptions.threshold || 7;
  const breakAfter = Math.min(breakOptions.after || 4, Math.max(paragraphs.length - 1, 1));
  const shouldAddBreak = breakOptions.image && paragraphs.length >= threshold;

  return paragraphs
    .map((paragraph, index) => {
      let html = `<p>${escapeHTML(paragraph)}</p>`;
      if (shouldAddBreak && index + 1 === breakAfter) {
        html += renderStoryBreak(breakOptions);
      }
      return html;
    })
    .join("");
}

function renderSection(label, value, breakOptions = {}) {
  const content = renderParagraphs(value, breakOptions);
  if (!content) return "";
  return `<strong>${escapeHTML(label)}</strong>${content}`;
}

function renderStoryBreak({ image, imageAlt = "Match day in Toronto", caption = "", captionsByPath = new Map() } = {}) {
  return `
                <figure class="inline-break-figure">
                    <img src="${escapeHTML(image)}"${srcsetAttrs(image, "(max-width: 790px) calc(100vw - 40px), 750px")} alt="${escapeHTML(imageAlt)}" loading="lazy">
                    ${renderCaption(image, captionsByPath, "figcaption", caption)}
                </figure>
            `;
}

function renderEditorialMedia(imagePath, altText, className, dimensions = {}) {
  if (!imagePath) {
    return `<div class="editorial-image-placeholder" aria-label="${escapeHTML(altText)}"></div>`;
  }

  const sizes = className === "editorial-image-secondary" ?
    "(min-width: 901px) 45vw, calc(100vw - 40px)" :
    "(max-width: 940px) calc(100vw - 40px), 900px";

  return `<img class="${className}" src="${escapeHTML(imagePath)}"${srcsetAttrs(imagePath, sizes)} alt="${escapeHTML(altText)}"${dimensionAttrs(dimensions.width, dimensions.height)} loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'), { className: 'editorial-image-placeholder' }))">`;
}

function findTeamData(teamData, teamName, dataAliases) {
  const dataTeamName = dataAliases[teamName] || teamName;
  return teamData.find(row => row.team === dataTeamName) || {};
}

function getTeamImages(teamObj, imageManifest, folderName, teamIndex) {
  if (!teamObj.image1 && teamObj.image2) {
    const supportingImages = (teamObj.images || "")
      .split("|")
      .map(imagePath => imagePath.trim())
      .filter(imagePath => imagePath && imagePath !== teamObj.image2);
    return ["", teamObj.image2, ...supportingImages];
  }

  const tsvImages = (teamObj.images || "")
    .split("|")
    .map(imagePath => imagePath.trim())
    .filter(Boolean);

  if (tsvImages.length || teamObj.image1) {
    return [...new Set([teamObj.image1, teamObj.image2, ...tsvImages].filter(Boolean))];
  }

  const fileNames = imageManifest[folderName] || [];
  if (!fileNames.length) return [];

  const firstIndex = teamIndex % fileNames.length;
  const secondIndex = fileNames.length > 1 ? (teamIndex + 3) % fileNames.length : firstIndex;
  const thirdIndex = fileNames.length > 2 ? (teamIndex + 6) % fileNames.length : secondIndex;
  return [...new Set([
    `./images/${folderName}/${fileNames[firstIndex]}`,
    `./images/${folderName}/${fileNames[secondIndex]}`,
    `./images/${folderName}/${fileNames[thirdIndex]}`,
  ])];
}

function getGridThumbnailPath(imagePath) {
  if (!imagePath) return "";

  return imagePath.replace(/\.(jpe?g|png)$/i, (_match, extension) => {
    const outputExtension = /^png$/i.test(extension) ? "png" : "jpg";
    return `-320w.${outputExtension}`;
  });
}

function renderGridMedia(teamObj, teamName, folderName, teamIndex, imageManifest) {
  const fallbackImages = getTeamImages(teamObj, imageManifest, folderName, teamIndex);
  const imagePath = teamObj.image1 || (teamObj.images || "").split("|").find(Boolean) || fallbackImages.find(Boolean);
  if (imagePath) {
    return `<img src="${escapeHTML(getGridThumbnailPath(imagePath))}" alt="${escapeHTML(teamName)} fan media" loading="eager" fetchpriority="high" decoding="async">`;
  }

  return "";
}

function getGroupHeroMedia(teamsInGroup, teamData, groupLetter, fallbackGif, dataAliases, groupHeroVideoOverrides) {
  const videoPath = groupHeroVideoOverrides[groupLetter] || teamsInGroup
    .map(teamName => findTeamData(teamData, teamName, dataAliases))
    .map(teamObj => teamObj.video1 || (teamObj.videos || "").split("|").find(Boolean))
    .find(Boolean);

  if (videoPath) {
    return `<video src="${escapeHTML(videoPath)}" autoplay loop muted playsinline preload="none"></video>`;
  }

  return `<img src="${escapeHTML(fallbackGif)}" alt="Group ${escapeHTML(groupLetter)}" loading="lazy">`;
}

function buildRenderedSections(constants, teamData, captionsByPath = new Map()) {
  const { tournamentGroups, countryCodes, teamColors, gifLinks, imageManifest, dataAliases, groupHeroVideoOverrides } = constants;
  const allTeamsFlattened = Object.values(tournamentGroups).flat();
  const gridSlots = allTeamsFlattened.map((teamName, index) => {
    const teamObj = findTeamData(teamData, teamName, dataAliases);
    const folderName = teamObj.folderName || teamName.replace(/\s+/g, "");
    const mediaHtml = renderGridMedia(teamObj, teamName, folderName, index, imageManifest);
    const className = mediaHtml ? "ambassador-slot" : "ambassador-slot placeholder";
    const waveOrder = index % 8 + Math.floor(index / 8);
    return `<div class="${className}" style="--slot-wave-order:${waveOrder}">${mediaHtml}<div class="info-tab"><div class="team">${escapeHTML(teamName)}</div></div></div>`;
  }).join("\n");

  let globalGifIndex = 0;
  let navGroups = "";
  let dropdownGroups = "";
  let contentSections = "";

  Object.keys(tournamentGroups).sort().forEach(groupLetter => {
    const teamsInGroup = tournamentGroups[groupLetter];
    const groupHeroGif = gifLinks[globalGifIndex % gifLinks.length];
    globalGifIndex++;
    const groupHeroMedia = getGroupHeroMedia(teamsInGroup, teamData, groupLetter, groupHeroGif, dataAliases, groupHeroVideoOverrides);

    let flagItems = "";
    let dropdownItems = "";
    let teamBlocks = "";

    teamsInGroup.forEach((teamName, teamIndex) => {
      const cleanTeamName = teamName.replace(/\[.*?\]/, "").trim();
      const teamObj = findTeamData(teamData, cleanTeamName, dataAliases);
      const folderName = teamObj.folderName || cleanTeamName.replace(/\s+/g, "");
      const code = countryCodes[cleanTeamName] || "un";
      const anchorId = `section-${cleanTeamName.toLowerCase().replace(/\s+/g, "-")}`;
      const teamBgColor = teamColors[cleanTeamName] || "rgba(240, 240, 240, 0.5)";

      const teamImages = getTeamImages(teamObj, imageManifest, folderName, teamIndex);
      const [img1Path, img2Path] = teamImages;
      const inlineBreakImage = teamImages[2] || "";
      const image1Dimensions = { width: teamObj.image1Width, height: teamObj.image1Height };
      const image2Dimensions = { width: teamObj.image2Width, height: teamObj.image2Height };
      const mainImageHtml = img1Path ? `
                                ${renderEditorialMedia(img1Path, `${cleanTeamName} Hub 1`, "editorial-image", image1Dimensions)}
                                ${renderCaption(img1Path, captionsByPath, "span")}
                        ` : "";
      const secondaryFigureClass = [
        img1Path ? (teamIndex % 2 === 0 ? "float-right" : "float-left") : "full-width",
        getMediaOrientationClass(image2Dimensions),
      ].filter(Boolean).join(" ");
      const secondaryFigureHtml = img2Path ? `
                                    <figure class="secondary-figure ${secondaryFigureClass}">
                                        ${renderEditorialMedia(img2Path, `${cleanTeamName} Hub 2`, "editorial-image-secondary", image2Dimensions)}
                                        ${renderCaption(img2Path, captionsByPath)}
                                    </figure>
                        ` : "";
      const secondaryAfterCountry = !img1Path ? secondaryFigureHtml : "";
      const secondaryAfterWhy = img1Path ? secondaryFigureHtml : "";

      flagItems += `<a class="flag-item" href="#${anchorId}"><img class="flag-icon" src="https://flagcdn.com/w80/${code}.png" alt="${escapeHTML(cleanTeamName)}"><span class="flag-name">${escapeHTML(cleanTeamName)}</span></a>`;
      dropdownItems += `<button class="country-dropdown-item" type="button" data-target="${anchorId}" role="menuitem">${escapeHTML(cleanTeamName)}</button>`;
      teamBlocks += `
                            <div class="team-block" id="${anchorId}" style="background-color: ${teamBgColor};">
                                <div class="country-header">
                                    <img class="big-flag" src="https://flagcdn.com/w160/${code}.png" alt="${escapeHTML(cleanTeamName)}">
                                    <h2 class="country-name">${escapeHTML(cleanTeamName)}</h2>
                                </div>

                                ${mainImageHtml}

                                <div class="editorial-text">
                                    ${renderSection("The Fan", teamObj.theFan)}
                                    ${renderSection("Cheering for", teamObj.theCountry)}
                                    ${secondaryAfterCountry}
                                    ${renderSection("Why they cheer", teamObj.whyCheer, {
                                      image: inlineBreakImage,
                                      imageAlt: `${cleanTeamName} fans in Toronto`,
                                      caption: "",
                                      captionsByPath,
                                      threshold: 7,
                                      after: 4,
                                    })}
                                    ${secondaryAfterWhy}

                                    ${renderSection("How to cheer", teamObj.howToCheer)}
                                    ${renderSection("Where to gather", teamObj.wheretoGather)}
                                </div>
                            </div>
                        `;
    });

    navGroups += `<div class="nav-group-card"><h3>Group ${groupLetter}</h3><div class="group-table">${flagItems}</div></div>`;
    dropdownGroups += `<div class="country-dropdown-group"><button class="country-dropdown-group-title" type="button" data-target="group-${groupLetter}" role="menuitem">Group ${groupLetter}</button>${dropdownItems}</div>`;
    contentSections += `
                    <div class="group-container" id="group-${groupLetter}">
                        <div class="group-hero">
                            ${groupHeroMedia}
                            <div class="group-hero-overlay">
                                <h2>Group ${groupLetter}</h2>
                                <div class="group-country-list">${teamsInGroup.map(teamName => escapeHTML(teamName)).join(" • ")}</div>
                            </div>
                        </div>
                        <div class="group-teams-wrapper">
                            ${teamBlocks}
                        </div>
                    </div>`;
  });

  return { gridSlots, navGroups, dropdownGroups, contentSections };
}

function stickyScript() {
  return `<script>
        const stickyNav = document.getElementById('stickyNav');
        const backToTopBtn = document.getElementById('backToTop');
        const flagSection = document.getElementById('flagSection');
        const footer = document.getElementById('SA_footer');
        const countryDropdownToggle = document.getElementById('countryDropdownToggle');
        const countryDropdownMenu = document.getElementById('countryDropdownMenu');

        function updateHostNavbarOffset() {
            document.documentElement.classList.toggle('has-site-navbar-container', Boolean(document.querySelector('#site-navbar-container')));
        }

        function updateCountrySelectLabel() {
            if (!countryDropdownToggle) return;
            countryDropdownToggle.textContent = window.matchMedia('(max-width: 900px)').matches ? 'JUMP TO...' : 'JUMP TO A COUNTRY';
        }

        updateHostNavbarOffset();
        if (document.body) {
            new MutationObserver(updateHostNavbarOffset).observe(document.body, { childList: true, subtree: true });
        }

        updateCountrySelectLabel();
        window.addEventListener('resize', updateCountrySelectLabel);

        function hideStickyControls() {
            if (stickyNav) stickyNav.classList.remove('visible');
            if (backToTopBtn) backToTopBtn.classList.remove('visible');
            if (countryDropdownMenu) countryDropdownMenu.classList.remove('open');
            if (countryDropdownToggle) countryDropdownToggle.setAttribute('aria-expanded', 'false');
        }

        function updateStickyControls() {
            if (!flagSection) return;
            const flagRect = flagSection.getBoundingClientRect();
            const footerRect = footer ? footer.getBoundingClientRect() : null;
            const footerInView = footerRect ? footerRect.top <= window.innerHeight : false;

            if (flagRect.bottom < 0 && !footerInView) {
                if (stickyNav) stickyNav.classList.add('visible');
                if (backToTopBtn) backToTopBtn.classList.add('visible');
            } else {
                hideStickyControls();
            }
        }

        window.addEventListener('scroll', updateStickyControls);
        window.addEventListener('resize', updateStickyControls);
        updateStickyControls();

        function closeCountryDropdown() {
            if (!countryDropdownMenu || !countryDropdownToggle) return;
            countryDropdownMenu.classList.remove('open');
            countryDropdownToggle.setAttribute('aria-expanded', 'false');
        }

        if (countryDropdownToggle && countryDropdownMenu) {
            countryDropdownToggle.addEventListener('click', function() {
                const isOpen = countryDropdownMenu.classList.toggle('open');
                countryDropdownToggle.setAttribute('aria-expanded', String(isOpen));
            });

            countryDropdownMenu.addEventListener('click', function(event) {
                const item = event.target.closest('[data-target]');
                if (item) {
                    location.hash = item.dataset.target;
                    closeCountryDropdown();
                }
            });
        }

        document.addEventListener('click', function(event) {
            if (!countryDropdownMenu || !countryDropdownToggle) return;
            if (!countryDropdownMenu.contains(event.target) && !countryDropdownToggle.contains(event.target)) closeCountryDropdown();
        });

        document.addEventListener('keydown', function(event) {
            if (event.key === 'Escape') closeCountryDropdown();
        });
    </script>`;
}

function replaceBetween(html, startPattern, endPattern, replacement) {
  const start = html.search(startPattern);
  if (start === -1) throw new Error(`Could not find start pattern ${startPattern}`);
  const endMatch = html.slice(start).match(endPattern);
  if (!endMatch) throw new Error(`Could not find end pattern ${endPattern}`);
  const end = start + endMatch.index + endMatch[0].length;
  return `${html.slice(0, start)}${replacement}${html.slice(end)}`;
}

async function prerenderLivePage({
  bodyPath = path.join(__dirname, "..", "body.html"),
  htmlPath = path.join(__dirname, "..", "..", "dist", "index.html"),
  dataPath = path.join(__dirname, "..", "data", "data.tsv"),
} = {}) {
  const bodySource = fs.readFileSync(bodyPath, "utf8");
  const htmlSource = fs.readFileSync(htmlPath, "utf8");
  const teamData = parseTSV(fs.readFileSync(dataPath, "utf8"));
  const constants = {
    tournamentGroups: extractConst(bodySource, "tournamentGroups"),
    countryCodes: extractConst(bodySource, "countryCodes"),
    teamColors: extractConst(bodySource, "teamColors"),
    gifLinks: extractConst(bodySource, "gifLinks"),
    imageManifest: extractConst(bodySource, "imageManifest"),
    dataAliases: extractConst(bodySource, "dataAliases"),
    groupHeroVideoOverrides: extractConst(bodySource, "groupHeroVideoOverrides"),
  };
  const captionsByPath = await loadFirebaseCaptions();
  const rendered = buildRenderedSections(constants, teamData, captionsByPath);

  let html = htmlSource;
  html = html.replace(
    /(<main class="grid-container" id="ambassadorGrid">[\s\S]*?<div class="headline-center">[\s\S]*?<\/div>)(\s*)<\/main>/,
    `$1\n${rendered.gridSlots}$2</main>`
  );
  html = html.replace(
    /<div class="country-dropdown-menu" id="countryDropdownMenu" role="menu"><\/div>/,
    `<div class="country-dropdown-menu" id="countryDropdownMenu" role="menu">${rendered.dropdownGroups}</div>`
  );
  html = html.replace(
    /<div class="nav-groups-container" id="flagGroupsContainer"><\/div>/,
    `<div class="nav-groups-container" id="flagGroupsContainer">${rendered.navGroups}</div>`
  );
  html = html.replace(
    /<div id="contentSections"><\/div>/,
    `<div id="contentSections">${rendered.contentSections}</div>`
  );
  html = replaceBetween(html, /<script>\s*\/\/ EXPLICIT HARDCODED TOURNAMENT GROUPS A-L/, /<\/script>/, stickyScript());

  fs.writeFileSync(htmlPath, html);
}

module.exports = prerenderLivePage;

if (require.main === module) {
  prerenderLivePage().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
