"use strict";

// SET THESE VARIABLES

const projectPath = "wc2026SoccerCity" //example: climatechange
const hostedImageBase = "https://projects-images.thestar.com/" + projectPath + "/images/";
const macroName = "seaWc2026SoccerCity()" // example: seaClimateChangeSvalbard()

// END SET THESE VARIABLES

//https://gist.github.com/jeromecoupe/0b807b0c1050647eb340360902c3203a
//https://css-tricks.com/gulp-for-beginners/
// Load plugins
const autoprefixer = require("autoprefixer");
const {
    Blob: NodeBlob
} = require('buffer');

// Polyfill File for environments (e.g. Node 18) that don't expose it globally
if (typeof File === 'undefined') {
    const BlobBase = typeof Blob !== 'undefined' ? Blob : (NodeBlob || class Blob {
        constructor(bits = [], opts = {}) {
            this.bits = bits;
            this.type = opts.type || "";
            this.size = bits.reduce((total, bit) => total + String(bit).length, 0);
        }
    });

    global.File = class File extends BlobBase {
        constructor(bits, name, opts = {}) {
            super(bits, opts);
            this.name = name;
            this.lastModified = opts.lastModified || Date.now();
        }
        get[Symbol.toStringTag]() {
            return 'File';
        }
    };
}
const sourcemaps = require('gulp-sourcemaps');
const browsersync = require("browser-sync").create();
const cssnano = require("cssnano");
const del = require("del");
const gulp = require("gulp");
const fs = require("fs");
const {
    transform
} = require('gulp-html-transform');
const path = require('path');
const srcset = require('gulp-srcset').default;
const newer = require("gulp-newer");
const plumber = require("gulp-plumber");
const postcss = require("gulp-postcss");
const rename = require("gulp-rename");
const sass = require("gulp-sass")(require("sass"));
const fileinclude = require('gulp-file-include');
const useref = require('gulp-useref');
const terser = require('gulp-terser');
const gulpIf = require('gulp-if');
const purgecss = require('gulp-purgecss')
const imageminPngquant = require('imagemin-pngquant')
const urlPrefixer = require('gulp-url-prefixer');
const htmlmin = require('gulp-htmlmin');
const replace = require('gulp-replace');
const mergeStream = require('merge-stream');
const prerenderLivePage = require('./app/scripts/prerender-live-page');

const responsiveWidths = [2480, 1920, 1280, 1024, 860, 540, 320];

const handleError = (task) => function(err) {
    console.error(`[${task}]`, err && err.message ? err.message : err);
    if (this && typeof this.emit === 'function') {
        this.emit('end');
    }
};

const buildSrcsetString = (src, widths = responsiveWidths) => {
    const ext = path.extname(src);
    if (!ext) return '';
    const base = src.slice(0, -ext.length);
    return widths.map((width) => `${base}-${width}w${ext} ${width}w`).join(', ');
};

const applySrcsetTransform = async ($) => {
    const setSizesAttr = ($el) => {
        const dataSizes = $el.attr('data-sizes');
        if (dataSizes) {
            $el.attr('sizes', dataSizes);
        }
    };

    $('img[data-src]').each((_, el) => {
        const $el = $(el);
        const dataSrc = $el.attr('data-src');
        if (!dataSrc) return;

        const srcset = buildSrcsetString(dataSrc);
        if (srcset) {
            $el.attr('srcset', srcset);
        }

        $el.attr('src', dataSrc);
        setSizesAttr($el);
    });

    $('source[data-src]').each((_, el) => {
        const $el = $(el);
        const dataSrc = $el.attr('data-src');
        if (!dataSrc) return;

        const srcset = buildSrcsetString(dataSrc);
        if (srcset) {
            $el.attr('srcset', srcset);
        }

        setSizesAttr($el);
    });
};



const liveImagePrefix = '[% compImgPath %]';
const liveCssPrefix = 'https://projects-images.thestar.com/' + projectPath + '/images';
// const liveJsPrefix = './libraries/flex/components/torstar_special_articles/resources/scripts/' + projectPath + "/";
const liveJsPrefix = '"+compImgPath+"';


const devPrefix = 'https://qa4.thestar.com/content/dam/thestar/special_articles/toronto-zoning/'


// Remove unused css
// be careful when using this. Always check that the page is still working properly at all breakpoints and especially for classes that are added via javascript
function purge() {
    return gulp.src('dist/css/main.css')
        .pipe(purgecss({
            content: ['dist/*.html'],
            safelist: ["ls-is-cached", "lazyloaded", "lazyload", "active"] //Add tags to whitelist here
            // alternativly comment out css in the css file using /*! purgecss start ignore */ CSS YOU DON'T WANT TO PURGE HERE /*! purgecss end ignore */
        }))
        .pipe(gulp.dest('dist/css'))
    // .pipe(rename({ suffix: ".min" }))
}


//  fileInclude
function html() {
    return gulp.src('app/index.html')
        .pipe(plumber({
            errorHandler: handleError('html')
        }))
        .pipe(fileinclude({
            prefix: '@@',
            basepath: '@file'
        }))
        .pipe(transform(applySrcsetTransform))
        .pipe(gulp.dest('dist/'));
}


// BrowserSync
function browserSync(done) {
    browsersync.init({
        server: {
            baseDir: "dist/",

        },
        port: 8080,
        // proxy: 'http://127.0.0.1:8080/dist/',
        //online: false,
        reloadDelay: 1000,
        reloadDebounce: 1000,
        injectChanges: false
    });
    done();
}

// BrowserSync Reload
function browserSyncReload(done) {
    browsersync.reload();
    done();
}

// Clean assets
function clean() {
    // return del(["dist/"]);
    return del(['dist/**/*', '!dist/images']);
}

// Clean assets
function fullClean() {
    // return del(["dist/"]);
    return del(['dist/']);
}

// Global configuration for all images
var resimgconfig = {
    // Use progressive (interlace) scan for JPEG and PNG output
    progressive: true,
    // Strip all metadata
    withMetadata: false,
    errorOnEnlargement: false,
    withoutEnlargement: true, // copy original file with/without renaming
    skipOnEnlargement: false
};

// Moves everything in the image folder. optimizing if nessisary
function moveImages() {
    return gulp
        .src("app/images/**/*")
        .pipe(newer("dist/images"))
        // .pipe(
        //     imagemin([
        //         imagemin.gifsicle({ interlaced: true }),
        //         imagemin.mozjpeg({ progressive: true }),
        //         imagemin.optipng({ optimizationLevel: 5 }),
        //         imagemin.svgo({
        //             plugins: [{
        //                 removeViewBox: false,
        //                 collapseGroups: true
        //             }]
        //         })
        //     ])
        // )
        .pipe(gulp.dest("dist/images"));
}

// Moves videos without processing so they are always present in dist/images.
function moveVideos() {
    return gulp
        .src("app/images/**/*.{mov,MOV,mp4,MP4,m4v,M4V,webm,WEBM}", {
            base: "app/images",
            allowEmpty: true
        })
        .pipe(gulp.dest("dist/images"));
}

// Publishes TSV data where the article fetches it from.
function moveData() {
    return gulp
        .src("app/data/data.tsv", {
            allowEmpty: true
        })
        .pipe(gulp.dest("dist/images/data"));
}

function parseTSVText(tsvText) {
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
            if (row.some((cell) => cell.trim() !== "")) rows.push(row);
            row = [];
            value = "";
        } else {
            value += char;
        }
    }

    if (value || row.length) {
        row.push(value);
        if (row.some((cell) => cell.trim() !== "")) rows.push(row);
    }

    const headers = rows.shift().map((header) => header.trim());
    return rows.map((values) => {
        const rowObj = {};
        headers.forEach((header, index) => {
            rowObj[header] = values[index] ? values[index].trim() : "";
        });
        return rowObj;
    });
}

function toProjectAssetUrl(assetPath) {
    const value = String(assetPath || "").trim();
    if (!value) return "";
    if (/^https?:\/\//i.test(value)) return value;

    const relativePath = value
        .replace(/^\.?\//, "")
        .replace(/^images\//, "");

    return `https://projects-images.thestar.com/${projectPath}/images/${relativePath}`;
}

function uniqueList(values) {
    return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function normalizeTeamKey(value) {
    return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/&/g, "and")
        .replace(/[^a-z0-9]+/gi, "-")
        .replace(/^-|-$/g, "")
        .toLowerCase();
}

function extractBodyConst(source, name) {
    const match = source.match(new RegExp(`const ${name} = ([\\s\\S]*?);\\n\\s*(?:const|function|async|\\/\\/)`));
    if (!match) throw new Error(`Could not find const ${name}`);
    return Function(`return (${match[1]});`)();
}

function renderAllTeamsEntry(row, groupLetter) {
    const images = uniqueList([
        row.image1,
        row.image2,
        ...String(row.images || "").split("|"),
    ]).map(toProjectAssetUrl);
    const videos = uniqueList([
        row.video1,
        ...String(row.videos || "").split("|"),
    ]).map(toProjectAssetUrl);
    const mediaSections = [];

    if (images.length) {
        mediaSections.push(`Images:\n${images.map((url) => `- ${url}`).join("\n")}`);
    }

    if (videos.length) {
        mediaSections.push(`Videos:\n${videos.map((url) => `- ${url}`).join("\n")}`);
    }

    return [
        row.team || "Untitled team",
        groupLetter ? `Group: ${groupLetter}` : row.group ? `Group: ${row.group}` : "",
        ...mediaSections,
        "Text:",
        row.text || "",
    ].filter(Boolean).join("\n\n");
}

function buildAllTeamsText(done) {
    const dataPath = path.join(__dirname, "app", "data", "data.tsv");
    const bodyPath = path.join(__dirname, "app", "body.html");
    const allTeamsTextPath = path.join(__dirname, "app", "data", "countryText", "All teams.txt");
    const distRootAllTeamsTextPath = path.join(__dirname, "dist", "All teams.txt");
    const distAllTeamsTextPath = path.join(__dirname, "dist", "images", "data", "All teams.txt");

    if (!fs.existsSync(dataPath)) {
        done(new Error(`Missing data file: ${dataPath}`));
        return;
    }

    const rows = parseTSVText(fs.readFileSync(dataPath, "utf8"));
    const bodySource = fs.readFileSync(bodyPath, "utf8");
    const tournamentGroups = extractBodyConst(bodySource, "tournamentGroups");
    const rowsByTeam = new Map(rows.map((row) => [normalizeTeamKey(row.team), row]));
    const usedKeys = new Set();
    const groupSections = Object.keys(tournamentGroups).sort().map((groupLetter) => {
        const entries = tournamentGroups[groupLetter].map((teamName) => {
            const key = normalizeTeamKey(teamName);
            const row = rowsByTeam.get(key);
            if (!row) return `${teamName}\n\nGroup: ${groupLetter}\n\nText:\n`;
            usedKeys.add(key);
            return renderAllTeamsEntry(row, groupLetter);
        });

        return [`Group ${groupLetter}`, ...entries].join("\n\n========================================\n\n");
    });
    const ungroupedEntries = rows
        .filter((row) => !usedKeys.has(normalizeTeamKey(row.team)))
        .map((row) => renderAllTeamsEntry(row, row.group));
    const output = [
        ...groupSections,
        ungroupedEntries.length ? ["Ungrouped", ...ungroupedEntries].join("\n\n========================================\n\n") : "",
    ].filter(Boolean).join("\n\n----------------------------------------\n\n");

    fs.mkdirSync(path.dirname(allTeamsTextPath), { recursive: true });
    fs.mkdirSync(path.dirname(distRootAllTeamsTextPath), { recursive: true });
    fs.mkdirSync(path.dirname(distAllTeamsTextPath), { recursive: true });
    fs.writeFileSync(allTeamsTextPath, `${output}\n`);
    fs.writeFileSync(distRootAllTeamsTextPath, `${output}\n`);
    fs.writeFileSync(distAllTeamsTextPath, `${output}\n`);
    done();
}

// Resizes and optimizes jpg and png images
function resizeImages() {
    //npmjs.com/package/gulp-srcset/v/1.0.1?activeTab=readme
    // gulp.src("app/images/*.{jpg,JPG,jpeg,JPEG}")
    // if you want all images even in subfolders
    const jpgWebp = gulp.src("app/images/**/*.{jpg,JPG,jpeg,JPEG}")
        .pipe(srcset([{
            width: [2480, 1920, 1280, 1024, 860, 540, 320],
            format: ['jpg', 'webp']
        }], {
            skipOptimization: true,
            postfix: function postfix(width, mul) {
                return mul === 1 ? '' : `-${width}w`;
            },
            processing: {
                webp: {
                    quality: 90
                },
                jpg: {
                    quality: 70
                }
            }
        }))
        .pipe(gulp.dest("dist/images"));


    // gulp.src("app/images/*.{png,PNG}")
    // if you want all images even in subfolders
    const pngWebp = gulp.src("app/images/**/*.{png,PNG}")
        .pipe(srcset([{
            width: [2480, 1920, 1280, 1024, 860, 540, 320],
            format: ['png', 'webp']
        }], {
            skipOptimization: true,
            postfix: function postfix(width, mul) {
                return mul === 1 ? '' : `-${width}w`;
            },
            processing: {
                webp: {
                    quality: 80
                },
                png: {
                    quality: 20
                }
            },
            optimization: {
                png: imageminPngquant({
                    quality: [0.5, 0.8]
                })
            }
        }))
        .pipe(gulp.dest("dist/images"));

    return mergeStream(jpgWebp, pngWebp);
}

// Creates just the tiny images used by the opening grid in the live build.
function resizeGridImages() {
    const jpgThumbs = gulp.src("app/images/**/*.{jpg,JPG,jpeg,JPEG}")
        .pipe(srcset([{
            width: [320],
            format: ['jpg']
        }], {
            skipOptimization: true,
            postfix: function postfix(width) {
                return `-${width}w`;
            },
            processing: {
                jpg: {
                    quality: 60
                }
            }
        }))
        .pipe(gulp.dest("dist/images"));

    const pngThumbs = gulp.src("app/images/**/*.{png,PNG}")
        .pipe(srcset([{
            width: [320],
            format: ['png']
        }], {
            skipOptimization: true,
            postfix: function postfix(width) {
                return `-${width}w`;
            },
            processing: {
                png: {
                    quality: 20
                }
            },
            optimization: {
                png: imageminPngquant({
                    quality: [0.45, 0.65]
                })
            }
        }))
        .pipe(gulp.dest("dist/images"));

    return mergeStream(jpgThumbs, pngThumbs);
}

// Creates responsive JPG/PNG story images for the live article without WebP variants.
function resizeLiveStoryImages() {
    const widths = [1920, 1280, 1024, 860, 540, 320];

    const jpgs = gulp.src("app/images/**/*.{jpg,JPG,jpeg,JPEG}")
        .pipe(srcset([{
            width: widths,
            format: ['jpg']
        }], {
            skipOptimization: true,
            postfix: function postfix(width) {
                return `-${width}w`;
            },
            processing: {
                jpg: {
                    quality: 70
                }
            }
        }))
        .pipe(gulp.dest("dist/images"));

    const pngs = gulp.src("app/images/**/*.{png,PNG}")
        .pipe(srcset([{
            width: widths,
            format: ['png']
        }], {
            skipOptimization: true,
            postfix: function postfix(width) {
                return `-${width}w`;
            },
            processing: {
                png: {
                    quality: 20
                }
            },
            optimization: {
                png: imageminPngquant({
                    quality: [0.45, 0.65]
                })
            }
        }))
        .pipe(gulp.dest("dist/images"));

    return mergeStream(jpgs, pngs);
}



// function images(cb) {
//   [1000, 2000].forEach(function (size) {
//     gulp.src('src/images/**/*.{jpg,jpeg,png}')
//       .pipe(imageResize({ width: size }))
//       .pipe(rename(function (path) { path.basename = `${path.basename}@${size}w`; }))
//       .pipe(imagemin())
//       .pipe(gulp.dest('dist/images'))
//   });
//   cb();
// }

// CSS task
function css() {
    return gulp
        .src("app/scss/**/*.scss")
        .pipe(plumber())
        .pipe(sourcemaps.init())
        .pipe(sass({
            outputStyle: "expanded"
        }))
        .pipe(postcss([autoprefixer(), cssnano()]))
        .pipe(gulpIf(env != 'live', sourcemaps.write('.')))
        // .pipe(sourcemaps.write('.'))
        .pipe(gulp.dest("dist/css/"))
        .pipe(browsersync.stream());
}

// Direct copy js
function copyScripts() {
    return (
        gulp
        .src(["app/js/**/*"])
        .pipe(plumber())
        .pipe(gulp.dest("dist/js/"))

    );
}

function copyModulesScripts() {
    return (
        // Copies the modules folder
        gulp
        .src(["app/js/modules/**/*"])
        .pipe(plumber())
        .pipe(gulp.dest("dist/js/modules"))
    );
}

// Transpile, concatenate and minify scripts
function scripts() {
    return (
        gulp.src('app/index.html')
        .pipe(plumber({
            errorHandler: handleError('scripts')
        }))
        .pipe(fileinclude({
            prefix: '@@',
            basepath: '@file'
        }))
        .pipe(useref())
        // Minifies only if it's a JavaScript file
        .pipe(gulpIf('*.js', terser()))
        .pipe(gulp.dest('dist/'))
    );
}


// Transpile, concatenate and minify scripts
function scriptsLive() {
    return (
        gulp.src('app/index-live.html')
        .pipe(plumber({
            errorHandler: handleError('scriptsLive')
        }))
        .pipe(rename("index.html"))
        .pipe(fileinclude({
            prefix: '@@',
            basepath: '@file'
        }))
        .pipe(useref())
        // Minifies only if it's a JavaScript file
        .pipe(gulpIf('*.js', terser()))
        .pipe(gulp.dest('dist/'))
    );
}

function addSrcset() {
    return gulp.src('dist/index.html')
        .pipe(plumber({
            errorHandler: handleError('addSrcset')
        }))
        // Only remove tags (keep content) for non-live builds
        // For live builds, prefixHTMLLive will remove both tags and content
        .pipe(gulpIf(env !== 'live', replace(/\{\/?hideInBlox\}/g, "")))
        .pipe(transform(applySrcsetTransform))
        .pipe(gulp.dest('dist/'))
}

// // Transpile, concatenate and minify scripts
// function scripts() {
//   return (
//     gulp
//       .src(["app/js/**/*"])
//       .pipe(plumber())
//       .pipe(webpackstream(webpackconfig, webpack))
//       // folder only, filename is specified in webpack config
//       .pipe(gulp.dest("dist/js/"))
//       .pipe(browsersync.stream())
//   );
// }

//Add url prefix for live
function prefixHTMLLive() {
    return gulp.src('dist/index.html')
        .pipe(urlPrefixer.html({
            prefix: liveImagePrefix,
            attrs: ['href', 'src', 'data-src', 'data-srcset', 'srcset', 'content', 'data-vid-src', 'style', 'poster'],
            tags: ['link', 'a', 'img', 'embed', 'source', 'video', 'track'],
            splitOn: ','
        }))
        .pipe(replace(liveImagePrefix + "/images", liveImagePrefix))
        // Handle script tags separately - replace js path with [% compJSPath %] for non-external files
        .pipe(replace(/<script([^>]*)\ssrc="(?!https?:\/\/)js\/(.*?)"([^>]*)>/g, '<script$1 src="[% compJSPath %]/$2"$3>'))
        .pipe(replace("$$seaPath$$", projectPath))
        .pipe(replace("$$macroName$$", macroName))
        .pipe(replace(/{hideInBlox}([\s\S]*?){\/hideInBlox}/g, ""))
        .pipe(replace(/^<html[^>]*><head><\/head><body>/, ""))
        .pipe(replace(/<\/body><\/html>\s*$/, ""))

        .pipe(gulp.dest('dist/'))
}

function prefixCSSLive() {

    return gulp.src('dist/**/*.{css,less}')
        .pipe(urlPrefixer.css({
            prefix: liveCssPrefix,
        }))
        .pipe(replace(liveCssPrefix + "/images", liveCssPrefix))
        .pipe(gulp.dest('dist/'))
}

function prefixJSLive() {

    return gulp.src('dist/js/script.min.js', { allowEmpty: true })
        .pipe(urlPrefixer.js({
            prefix: liveJsPrefix,
            placeholderFuncName: 'imagePath'
        }))
        .pipe(gulp.dest('dist/js/'))
}

function prerenderLive() {
    return prerenderLivePage();
}

function copyCaptionForm() {
    return gulp.src('app/caption-form.html')
        .pipe(plumber({
            errorHandler: handleError('copyCaptionForm')
        }))
        .pipe(gulp.dest('dist/'));
}

//Add url prefix for dev
function prefixHTMLDev() {
    return gulp.src('dist/index.html')
        .pipe(urlPrefixer.html({
            prefix: devPrefix,
            attrs: ['href', 'src', 'data-src', 'data-srcset', 'srcset', 'content'],
            tags: ['script', 'link', 'a', 'img', 'embed', 'source', 'video', 'track'],
            splitOn: ','
        }))
        .pipe(gulp.dest('dist/'))

}

function prefixCSSDev() {

    return gulp.src('dist/**/*.{css,less}')
        .pipe(urlPrefixer.css({
            prefix: devPrefix,
        }))
        .pipe(gulp.dest('dist/'))

}

function prefixJSDev() {

    //not in use

    return gulp.src('dist/**/*.js')
        .pipe(urlPrefixer.js({
            prefix: devPrefix,
            placeholderFuncName: 'imagePath'
        }))
        .pipe(gulp.dest('dist/'))

}

//removes uri for local js
function localURI() {
    const js = gulp.src('dist/js/script.min.js', { allowEmpty: true })
        .pipe(urlPrefixer.js({
            prefix: liveJsPrefix,
            placeholderFuncName: 'imagePath'
        }))
        .pipe(gulp.dest('dist/js/'))

    //   gulp.src('dist/js/script.min.js')
    //     .pipe(urlPrefixer.js({
    //         prefix: '.',
    //         placeholderFuncName: 'imagePath'
    //     }))
    //     .pipe(gulp.dest('dist/js/'))

    const html = gulp.src('dist/index.html')
        .pipe(replace("{projectPath}", projectPath))
        .pipe(replace(/\.\/images\//g, hostedImageBase))
        .pipe(replace("[% paywallStart() %]", "<div id='blox-paywall'>"))
        .pipe(replace("[% subContentStart(); %]", "<div id='blox-subcontent'>"))
        .pipe(replace("[% subContentStop(); %]", "</div>"))
        .pipe(replace("[% paywallEnd(); %]", "</div>"))
        .pipe(gulp.dest('dist/'))

    return mergeStream(js, html);
}

function minifyHTML() {
    return gulp.src('dist/*.html')
        .pipe(htmlmin({
            // collapseWhitespace: true,
            // preserveLineBreaks: true,
            removeComments: true,
            caseSensitive: true,
            includeAutoGeneratedTags: false,
            // removeRedundantAttributes: true,
            // sortClassName: true,
            // collapseWhitespace: true,
            // minifyCSS: true,
            // minifyJS: true,
            // collapseInlineTagWhitespace: true
        }))
        .pipe(gulpIf(env == 'live', rename(projectPath + '.utl')))
        .pipe(gulp.dest('dist'))
};


// Watch files
function watchFiles() {
    gulp.watch("app/scss/**/*", css, localURI);
    gulp.watch("app/js/**/*", gulp.series(js, localURI, browserSyncReload));

    gulp.watch(
        [
            "app/*.html",
        ],
        gulp.series(css, js, localURI, browserSyncReload)
    );
    gulp.watch("app/images/**/*", images, localURI);
}

let env = process.env.NODE_ENV || 'dev';

function setLive(done) {
    env = "live"
    done()
}

// define complex tasks
const js = gulp.series(scripts, copyModulesScripts, addSrcset);
const jsLive = gulp.series(scriptsLive, copyModulesScripts, addSrcset);
const images = gulp.parallel(moveImages, resizeImages, moveVideos, moveData);
const dataLive = gulp.parallel(moveData, buildAllTeamsText);
const imagesLive = gulp.parallel(moveImages, resizeLiveStoryImages, resizeGridImages, moveVideos, dataLive);
const rebuild = gulp.series(fullClean, gulp.parallel(css, images, js), prerenderLive, localURI, copyCaptionForm);
const build = gulp.series(clean, gulp.parallel(css, images, js), prerenderLive, localURI, copyCaptionForm);
const quick = gulp.series(clean, gulp.parallel(css, js), prerenderLive, localURI, copyCaptionForm);
const buildDirect = gulp.series(clean, html, gulp.parallel(css, images, copyScripts));
const watch = gulp.series(quick, gulp.parallel(watchFiles, browserSync));
// const buildLive = gulp.series(clean, gulp.parallel(css, images, js), gulp.series(prefixHTMLLive,prefixCSSLive,prefixJSLive));
const compile = gulp.parallel(css, images, js);
const compileLive = gulp.parallel(css, imagesLive, jsLive);


// https://stackoverflow.com/questions/70869994/using-gulp-series-to-run-two-tasks-sequentially-isnt-working-as-expected
const addLivePrefix = gulp.series(prefixCSSLive, prefixJSLive, prefixHTMLLive);
const buildLive = gulp.series(setLive, clean, compileLive, prerenderLive, addLivePrefix, minifyHTML, copyCaptionForm);

const addDevPrefix = gulp.series(prefixCSSDev, prefixJSDev, prefixHTMLDev);
const buildDev = gulp.series(clean, compile, addDevPrefix, minifyHTML);

const prefixLive = gulp.series(prefixCSSLive, prefixJSLive, prefixHTMLLive);
// export tasks
// Remove unused css
// be careful when using this. Always check that the page is still working properly at all breakpoints and especially for classes that are added via javascript
exports.purge = purge;
// Minifiy HTML (remove comments)
exports.minifyHTML = minifyHTML;
// Compress images
exports.images = images;
// Compile Sass
exports.css = css;
// Transpile, concatenate and minify scripts
exports.js = js;
// Deletes all files from output directory except images (fullClean deletes images)
exports.clean = clean;
// Preforms clean then builds images, css and js
exports.build = build;
// Deletes everything including images then builds the project again. Slower than build
exports.rebuild = rebuild;
// Instead of proccessing and minifying js this just copys it. Usefull if you are getting js errors
exports.buildDirect = buildDirect;
// Watches for changes in the files and syncs to default browser
exports.watch = watch;
// default gulp preforms a build
exports.quick = quick;
// Final for dev build
exports.buildDev = buildDev;
// Final for live build
exports.buildLive = buildLive;
// everything in build except images
exports.default = build;

exports.prefixLive = prefixLive;
exports.buildAllTeamsText = buildAllTeamsText;
