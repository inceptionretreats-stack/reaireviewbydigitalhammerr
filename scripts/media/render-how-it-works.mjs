// Browser globals are used only inside Playwright page.evaluate callbacks.
/* global window, document, requestAnimationFrame */
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rename,
  rm,
  stat,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = path.join(workspace, 'scripts/media/how-it-works-clips.html');
const outputDirectory = path.join(workspace, 'apps/web/public/marketing/how-it-works');
const requireForWeb = createRequire(pathToFileURL(path.join(workspace, 'apps/web/package.json')));
const clipIds = ['scan', 'draft', 'publish'];
const width = 480;
const height = 900;
const duration = 9;
const fps = 30;
const frameCount = duration * fps;
const posterTimes = { scan: 4.8, draft: 2.8, publish: 8.5 };
const tempPrefix = 'how-it-works-clips-';
const readyTimeout = 60_000;
const diagnosticLimit = 2 * 1024 * 1024;
const activeChildren = new Set();
let browser;
let interruption;

function parseOptions() {
  const args = new Set(process.argv.slice(2));
  for (const arg of args) {
    if (!['--preview', '--overwrite', '--help'].includes(arg)) {
      throw new Error(`Unknown option: ${arg}. Use --help.`);
    }
  }
  return {
    preview: args.has('--preview'),
    overwrite: args.has('--overwrite'),
    help: args.has('--help'),
  };
}

function checkInterrupted() {
  if (interruption) throw new Error(`Render interrupted by ${interruption}.`);
}

function handleSignal(signal) {
  interruption ??= signal;
  for (const child of activeChildren) child.kill('SIGTERM');
  if (browser) void browser.close().catch(() => {});
}

const handleSigint = () => handleSignal('SIGINT');
const handleSigterm = () => handleSignal('SIGTERM');

async function exists(file) {
  try {
    await lstat(file);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

async function ensureOutputParentSafe() {
  let current = workspace;
  for (const segment of path.relative(workspace, outputDirectory).split(path.sep)) {
    current = path.join(current, segment);
    if (!(await exists(current))) continue;
    const entry = await lstat(current);
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw new Error(`Output parent must be a regular directory, not a symlink: ${current}`);
    }
  }
}

async function ensureOutputsAvailable(outputs, overwrite) {
  await ensureOutputParentSafe();
  if (new Set(outputs.map((file) => path.resolve(file))).size !== outputs.length) {
    throw new Error('Deliverable paths must be distinct.');
  }
  const existing = [];
  for (const file of outputs) {
    if (!(await exists(file))) continue;
    const entry = await lstat(file);
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new Error(`Deliverable target must be a regular file, not a symlink: ${file}`);
    }
    existing.push(file);
  }
  if (!overwrite && existing.length) {
    throw new Error(
      `Refusing to overwrite existing deliverables:\n${existing.join('\n')}\nUse --overwrite explicitly.`,
    );
  }
}

function runProcess(executable, args, timeout = 15 * 60_000) {
  checkInterrupted();
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    activeChildren.add(child);
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const append = (current, chunk) => (current + chunk.toString()).slice(-diagnosticLimit);
    child.stdout.on('data', (chunk) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr = append(stderr, chunk);
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeout);
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      activeChildren.delete(child);
      if (error) reject(error);
      else resolve(result);
    };
    child.once('error', (error) =>
      finish(new Error(`Cannot launch ${executable}: ${error.message}`)),
    );
    child.once('close', (code, signal) => {
      if (timedOut || interruption || code !== 0) {
        const reason = timedOut
          ? 'timed out'
          : interruption
            ? `interrupted by ${interruption}`
            : `exited ${code ?? signal}`;
        finish(new Error(`${path.basename(executable)} ${reason}.\n${(stderr || stdout).trim()}`));
      } else {
        finish(null, { stdout, stderr });
      }
    });
  });
}

async function findEncoder() {
  const override = process.env.FFMPEG_PATH?.trim();
  const binaries = path.resolve(
    homedir(),
    '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/Lib/site-packages/imageio_ffmpeg/binaries',
  );
  let candidates = [];
  if (override) {
    candidates = [path.resolve(override)];
  } else {
    try {
      candidates = (await readdir(binaries))
        .filter(
          (name) =>
            name.startsWith('ffmpeg-') && (process.platform !== 'win32' || name.endsWith('.exe')),
        )
        .sort(
          (a, b) => Number(b.includes('v7.1')) - Number(a.includes('v7.1')) || b.localeCompare(a),
        )
        .map((name) => path.join(binaries, name));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const failures = [];
  for (const candidate of candidates) {
    checkInterrupted();
    if (!(await stat(candidate).catch(() => null))?.isFile()) continue;
    try {
      const { stdout, stderr } = await runProcess(candidate, ['-hide_banner', '-encoders'], 30_000);
      if ((stdout + stderr).includes('libx264') && (stdout + stderr).includes('libvpx-vp9'))
        return candidate;
      throw new Error(`Encoder lacks libx264 or libvpx-vp9: ${candidate}`);
    } catch (error) {
      checkInterrupted();
      if (override) throw error;
      failures.push(error.message);
    }
  }
  throw new Error(
    `No MP4/WebM-capable ffmpeg found. Set FFMPEG_PATH to a full existing executable; no installation is performed.${failures.length ? `\n${failures.join('\n')}` : ''}`,
  );
}

async function createIllustrativeQr() {
  return requireForWeb('qrcode').toDataURL('Digital Hammerr - illustrative review walkthrough', {
    width: 300,
    margin: 3,
    errorCorrectionLevel: 'M',
    color: { dark: '#111827', light: '#ffffff' },
  });
}

async function preparePage(context, id, qrSource) {
  checkInterrupted();
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });
  page.on('requestfailed', (request) =>
    problems.push(`asset request: ${request.url()} (${request.failure()?.errorText})`),
  );
  await page.goto(pathToFileURL(source).href, { waitUntil: 'load', timeout: readyTimeout });
  await page.evaluate(
    async ({ id, qrSource, width, height, duration }) => {
      const bounded = async (promise, label) => {
        let timer;
        try {
          return await Promise.race([
            promise,
            new Promise((_, reject) => {
              timer = setTimeout(() => reject(new Error(`${label} timed out.`)), 60_000);
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
      };
      for (const hook of ['selectClip', 'setQrSource', 'renderAt']) {
        if (typeof window[hook] !== 'function')
          throw new Error(`Source must expose window.${hook}().`);
      }
      const selection = window.selectClip(id);
      if (!selection || typeof selection.then !== 'function')
        throw new Error('selectClip(id) must return a Promise.');
      await bounded(selection, `selectClip(${id})`);
      if (!window.STORY_READY || typeof window.STORY_READY.then !== 'function')
        throw new Error('STORY_READY must be a Promise.');
      await bounded(window.STORY_READY, 'STORY_READY');
      if (window.STORY_DURATION !== duration)
        throw new Error(`Expected STORY_DURATION=${duration}, received ${window.STORY_DURATION}.`);
      if (window.STORY_SIZE?.width !== width || window.STORY_SIZE?.height !== height)
        throw new Error(`Expected STORY_SIZE=${width}x${height}.`);
      await bounded(Promise.resolve(window.setQrSource(qrSource)), 'setQrSource');
      await bounded(document.fonts.ready, 'Font readiness');
      const failedFonts = [...document.fonts].filter((font) => font.status === 'error');
      if (failedFonts.length)
        throw new Error(`Failed fonts: ${failedFonts.map((font) => font.family).join(', ')}`);
      for (const image of document.images) {
        await bounded(image.decode(), 'Image decode');
        if (!image.naturalWidth || !image.naturalHeight)
          throw new Error(`Image failed to decode: ${image.currentSrc || image.src}`);
      }
      if (
        !document.body?.textContent.trim() &&
        !document.images.length &&
        !document.querySelector('canvas, svg')
      )
        throw new Error('Storyboard appears blank.');
      for (const animation of document.getAnimations()) animation.pause();
    },
    { id, qrSource, width, height, duration },
  );
  await page.addStyleTag({
    content: '* { transition: none !important; caret-color: transparent !important; }',
  });
  const dimensions = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
    scale: window.devicePixelRatio,
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
  }));
  if (
    dimensions.width !== width ||
    dimensions.height !== height ||
    dimensions.scale !== 1 ||
    dimensions.scrollWidth > width ||
    dimensions.scrollHeight > height
  )
    throw new Error(
      `Storyboard must fit ${width}x${height} at DSF 1 without overflow: ${JSON.stringify(dimensions)}`,
    );
  const assertHealthy = () => {
    checkInterrupted();
    if (problems.length) throw new Error(`Storyboard errors for ${id}:\n${problems.join('\n')}`);
  };
  assertHealthy();
  return { page, assertHealthy };
}

async function captureFrame(page, seconds, file) {
  checkInterrupted();
  await page.evaluate(async (time) => {
    let timer;
    try {
      await Promise.race([
        (async () => {
          await window.renderAt(time);
          for (const animation of document.getAnimations()) animation.pause();
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          );
        })(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`renderAt(${time}) timed out.`)), 30_000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }, seconds);
  checkInterrupted();
  await page.screenshot({ path: file, type: 'png', fullPage: false });
  checkInterrupted();
}

async function validateVideo(context, encoder, file) {
  checkInterrupted();
  const page = await context.newPage();
  let metadata;
  try {
    await page.goto(pathToFileURL(file).href, { waitUntil: 'load', timeout: readyTimeout });
    metadata = await page.locator('video').evaluate(async (video) => {
      if (video.error)
        throw new Error(`Encoded video cannot be decoded (code ${video.error.code}).`);
      if (video.readyState < 1) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error('Encoded video metadata timed out.')),
            30_000,
          );
          video.addEventListener(
            'loadedmetadata',
            () => {
              clearTimeout(timer);
              resolve();
            },
            { once: true },
          );
          video.addEventListener(
            'error',
            () => {
              clearTimeout(timer);
              reject(new Error(`Encoded video cannot be decoded (code ${video.error?.code}).`));
            },
            { once: true },
          );
        });
      }
      video.pause();
      return { duration: video.duration, width: video.videoWidth, height: video.videoHeight };
    });
  } finally {
    await page.close().catch(() => {});
  }
  if (
    !Number.isFinite(metadata.duration) ||
    Math.abs(metadata.duration - duration) > 0.001 ||
    metadata.width !== width ||
    metadata.height !== height
  )
    throw new Error(`Invalid encoded metadata ${file}: ${JSON.stringify(metadata)}`);
  const { stdout } = await runProcess(encoder, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostdin',
    '-nostats',
    '-xerror',
    '-i',
    file,
    '-map',
    '0:v:0',
    '-an',
    '-progress',
    'pipe:1',
    '-fps_mode',
    'passthrough',
    '-f',
    'null',
    '-',
  ]);
  const decodedFrames = [...stdout.matchAll(/^frame=(\d+)\s*$/gm)]
    .map((match) => Number(match[1]))
    .at(-1);
  if (decodedFrames !== frameCount || !/^progress=end\s*$/m.test(stdout))
    throw new Error(
      `Full decode must complete exactly ${frameCount} frames: ${file} (${decodedFrames ?? 'no frame count'}).`,
    );
  return { ...metadata, decodedFrames };
}

async function removeRenderTemp(tempRoot, tempDirectory, originalEntry) {
  const canonicalRoot = await realpath(tempRoot);
  const canonicalDirectory = await realpath(tempDirectory);
  const relative = path.relative(canonicalRoot, canonicalDirectory);
  const entry = await lstat(tempDirectory);
  if (
    entry.dev !== originalEntry.dev ||
    entry.ino !== originalEntry.ino ||
    entry.isSymbolicLink() ||
    !entry.isDirectory() ||
    canonicalDirectory !== path.resolve(tempDirectory) ||
    !relative ||
    path.isAbsolute(relative) ||
    relative.startsWith('..') ||
    relative.includes(path.sep) ||
    !path.basename(canonicalDirectory).startsWith(tempPrefix)
  )
    throw new Error(`Refusing unsafe temporary cleanup: ${tempDirectory}`);
  checkInterrupted();
  await rm(canonicalDirectory, { recursive: true, force: false, maxRetries: 5, retryDelay: 250 });
}

async function main() {
  const options = parseOptions();
  if (options.help) {
    console.log(
      'Usage: node scripts/media/render-how-it-works.mjs [--preview] [--overwrite]\n\n--preview    Capture three settled PNGs in OS Temp; no encoding or repo writes.\n--overwrite  Explicitly replace existing v5 deliverables after all validation.\nFFMPEG_PATH  Optional full path to a local ffmpeg with libx264 and libvpx-vp9.',
    );
    return;
  }
  const names = clipIds.flatMap((id) => [`${id}-v5.mp4`, `${id}-v5.webm`, `${id}-v5-poster.webp`]);
  const outputs = names.map((name) => path.join(outputDirectory, name));
  const adjacentStaging = [];
  const published = [];
  let tempRoot;
  let tempDirectory;
  let tempEntry;
  let exportSucceeded = false;
  process.on('SIGINT', handleSigint);
  process.on('SIGTERM', handleSigterm);
  try {
    if (!(await stat(source).catch(() => null))?.isFile())
      throw new Error(`Storyboard is not ready: ${source}`);
    if (!options.preview) await ensureOutputsAvailable(outputs, options.overwrite);
    const encoder = options.preview ? null : await findEncoder();
    checkInterrupted();
    tempRoot = await realpath(path.resolve(tmpdir()));
    tempDirectory = path.resolve(await mkdtemp(path.join(tempRoot, tempPrefix)));
    tempEntry = await lstat(tempDirectory);
    console.log(`Render temp: ${tempDirectory}`);
    const qrSource = await createIllustrativeQr();
    const sharp = options.preview ? null : requireForWeb('sharp');
    // libvips' file cache otherwise keeps staged posters open through Windows cleanup.
    if (sharp) sharp.cache({ files: 0 });
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    checkInterrupted();
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 1,
      reducedMotion: 'no-preference',
      colorScheme: 'light',
      locale: 'en-US',
      timezoneId: 'UTC',
    });
    const staged = names.map((name) => path.join(tempDirectory, name));
    const previews = [];
    const validation = [];
    for (const [clipIndex, id] of clipIds.entries()) {
      console.log(`Clip ${clipIndex + 1}/${clipIds.length}: ${id}`);
      const posterTime = posterTimes[id];
      const posterFrame = Math.round(posterTime * fps);
      const { page, assertHealthy } = await preparePage(context, id, qrSource);
      try {
        if (options.preview) {
          const file = path.join(tempDirectory, `${id}-${posterTime}s.png`);
          await captureFrame(page, posterTime, file);
          assertHealthy();
          previews.push({ id, seconds: posterTime, path: file });
          console.log(`Preview ${id}: ${file}`);
          continue;
        }
        const frames = path.join(tempDirectory, `frames-${id}`);
        await mkdir(frames);
        for (let index = 0; index < frameCount; index++) {
          await captureFrame(
            page,
            index / fps,
            path.join(frames, `frame-${String(index).padStart(5, '0')}.png`),
          );
          assertHealthy();
          if ((index + 1) % 90 === 0)
            console.log(`${id}: captured ${index + 1}/${frameCount} frames.`);
        }
        const [mp4, webm, poster] = staged.slice(clipIndex * 3, clipIndex * 3 + 3);
        checkInterrupted();
        await sharp(path.join(frames, `frame-${String(posterFrame).padStart(5, '0')}.png`))
          .webp({ quality: 90 })
          .toFile(poster);
        checkInterrupted();
        const posterMetadata = await sharp(poster).metadata();
        if (
          posterMetadata.width !== width ||
          posterMetadata.height !== height ||
          posterMetadata.format !== 'webp'
        )
          throw new Error(`Invalid WebP poster: ${poster}`);
        const input = [
          '-hide_banner',
          '-loglevel',
          'error',
          '-nostdin',
          '-n',
          '-framerate',
          String(fps),
          '-start_number',
          '0',
          '-i',
          path.join(frames, 'frame-%05d.png'),
          '-frames:v',
          String(frameCount),
          '-an',
        ];
        console.log(`${id}: encoding MP4/WebM with ${encoder}`);
        await runProcess(encoder, [
          ...input,
          '-c:v',
          'libx264',
          '-preset',
          'medium',
          '-crf',
          '20',
          '-pix_fmt',
          'yuv420p',
          '-movflags',
          '+faststart',
          mp4,
        ]);
        await runProcess(encoder, [
          ...input,
          '-c:v',
          'libvpx-vp9',
          '-crf',
          '30',
          '-b:v',
          '0',
          '-deadline',
          'good',
          '-cpu-used',
          '4',
          '-row-mt',
          '1',
          '-pix_fmt',
          'yuv420p',
          webm,
        ]);
        const mp4Metadata = await validateVideo(context, encoder, mp4);
        const webmMetadata = await validateVideo(context, encoder, webm);
        validation.push({
          id,
          mp4: mp4Metadata,
          webm: webmMetadata,
          poster: {
            width: posterMetadata.width,
            height: posterMetadata.height,
            format: posterMetadata.format,
          },
        });
        console.log(
          `${id}: both videos validated at ${width}x${height}, ${duration}s, ${frameCount} decoded frames.`,
        );
      } finally {
        await page.close().catch(() => {});
      }
    }
    if (options.preview) {
      console.log(JSON.stringify({ preview: true, width, height, previews }, null, 2));
      return;
    }
    if (validation.length !== clipIds.length)
      throw new Error('Every clip must validate before publication.');
    checkInterrupted();
    await ensureOutputsAvailable(outputs, options.overwrite);
    checkInterrupted();
    await mkdir(outputDirectory, { recursive: true });
    await ensureOutputParentSafe();
    if (options.overwrite) {
      for (let index = 0; index < outputs.length; index++) {
        checkInterrupted();
        const adjacent = path.join(
          outputDirectory,
          `.${path.basename(outputs[index])}.${path.basename(tempDirectory)}.tmp`,
        );
        await copyFile(staged[index], adjacent, constants.COPYFILE_EXCL);
        adjacentStaging.push(adjacent);
        checkInterrupted();
      }
    }
    for (let index = 0; index < outputs.length; index++) {
      checkInterrupted();
      await ensureOutputParentSafe();
      if (options.overwrite) {
        await ensureOutputsAvailable([outputs[index]], true);
        await rename(adjacentStaging[index], outputs[index]);
      } else {
        await copyFile(staged[index], outputs[index], constants.COPYFILE_EXCL);
      }
      published.push(outputs[index]);
      checkInterrupted();
    }
    checkInterrupted();
    exportSucceeded = true;
    console.log(
      JSON.stringify(
        { width, height, fps, duration, frameCount, posterTimes, outputs, validation },
        null,
        2,
      ),
    );
  } finally {
    try {
      if (browser) {
        await browser
          .close()
          .catch((error) => console.warn(`Browser close warning: ${error.message}`));
        browser = undefined;
      }
      if (exportSucceeded && !interruption) {
        await removeRenderTemp(tempRoot, tempDirectory, tempEntry);
        console.log(`Removed successful render temp: ${tempDirectory}`);
      } else if (tempDirectory) {
        console.log(`Temporary files retained for QA/debugging: ${tempDirectory}`);
        for (const file of adjacentStaging) {
          if (await exists(file)) console.log(`Unpublished overwrite staging retained: ${file}`);
        }
        if (published.length)
          console.warn(
            `Partial publication retained (${published.length}/${outputs.length}):\n${published.join('\n')}`,
          );
      }
      checkInterrupted();
    } finally {
      process.removeListener('SIGINT', handleSigint);
      process.removeListener('SIGTERM', handleSigterm);
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = interruption === 'SIGINT' ? 130 : interruption === 'SIGTERM' ? 143 : 1;
});
