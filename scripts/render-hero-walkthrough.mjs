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
import { homedir, tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(workspace, 'scripts/media/hero-review-walkthrough.html');
const outputDirectory = path.join(workspace, 'apps/web/public/marketing');
const outputName = 'hero-review-walkthrough-v3';
const captionSource = path.join(outputDirectory, 'hero-review-walkthrough-v2.vtt');
const width = 960;
const height = 960;
const fps = 30;
const duration = 30;
const frameCount = duration * fps;
const posterTime = 8.9;
const previewTimes = [0.8, 6.5, 11.5, 16.5, 21.5, 27.5];
const tempPrefix = 'hero-review-walkthrough-';
const readyTimeout = 60_000;
const diagnosticLimit = 2 * 1024 * 1024;
const activeChildren = new Set();
let browser;
let interruption;

async function createIllustrativeQr() {
  const requireForWeb = createRequire(pathToFileURL(path.join(workspace, 'apps/web/package.json')));
  const qrcode = requireForWeb('qrcode');
  return qrcode.toDataURL('Digital Hammerr - illustrative review walkthrough', {
    width: 300,
    margin: 3,
    errorCorrectionLevel: 'M',
    color: { dark: '#111827', light: '#ffffff' },
  });
}

function parseOptions() {
  const args = new Set(process.argv.slice(2));
  const supported = new Set(['--preview', '--overwrite', '--help']);
  for (const arg of args) {
    if (!supported.has(arg)) throw new Error(`Unknown option: ${arg}. Use --help.`);
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

async function ensureOutputsAvailable(outputs, overwrite) {
  if (new Set(outputs.map((file) => path.resolve(file))).size !== outputs.length) {
    throw new Error('Deliverable paths must be distinct.');
  }
  const existing = [];
  for (const file of outputs) {
    if (await exists(file)) {
      const entry = await lstat(file);
      if (!entry.isFile() || entry.isSymbolicLink()) {
        throw new Error(
          `Deliverable target must be a regular file, not a directory or symlink: ${file}`,
        );
      }
      existing.push(file);
    }
  }
  if (!overwrite && existing.length) {
    throw new Error(
      `Refusing to overwrite existing deliverables:\n${existing.join('\n')}\nUse --overwrite explicitly for a new revision.`,
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
      const names = await readdir(binaries);
      candidates = names
        .filter(
          (name) =>
            name.startsWith('ffmpeg-') && (process.platform !== 'win32' || name.endsWith('.exe')),
        )
        .sort()
        .reverse()
        .map((name) => path.join(binaries, name));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  for (const candidate of candidates) {
    if (!(await stat(candidate).catch(() => null))?.isFile()) continue;
    const { stdout, stderr } = await runProcess(candidate, ['-hide_banner', '-encoders'], 30_000);
    const capabilities = stdout + stderr;
    if (capabilities.includes('libx264') && capabilities.includes('libvpx-vp9')) return candidate;
    if (override) throw new Error(`FFMPEG_PATH lacks libx264 or libvpx-vp9: ${candidate}`);
  }
  throw new Error(
    'No MP4/WebM-capable ffmpeg found. Set FFMPEG_PATH to an existing full ffmpeg executable; no installation is performed.',
  );
}

async function preparePage(context) {
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
  const qrSource = await createIllustrativeQr();
  await page.evaluate(
    async ({ expectedDuration, qrSource }) => {
      if (typeof window.renderAt !== 'function')
        throw new Error('Source must expose window.renderAt(seconds).');
      if (typeof window.setQrSource !== 'function')
        throw new Error('Source must expose window.setQrSource(dataUri).');
      if (window.STORY_DURATION !== expectedDuration)
        throw new Error(
          `Expected STORY_DURATION=${expectedDuration}, received ${window.STORY_DURATION}.`,
        );
      if (!window.STORY_READY || typeof window.STORY_READY.then !== 'function')
        throw new Error('Source must expose window.STORY_READY as a Promise.');
      let timeout;
      try {
        await Promise.race([
          window.STORY_READY,
          new Promise((_, reject) => {
            timeout = setTimeout(() => reject(new Error('STORY_READY timed out.')), 60_000);
          }),
        ]);
      } finally {
        clearTimeout(timeout);
      }
      await window.setQrSource(qrSource);
      await document.fonts.ready;
      const fontsFailed = [...document.fonts].filter((font) => font.status === 'error');
      if (fontsFailed.length)
        throw new Error(`Failed fonts: ${fontsFailed.map((font) => font.family).join(', ')}`);
      for (const image of document.images) {
        await image.decode();
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
    { expectedDuration: duration, qrSource },
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
  ) {
    throw new Error(
      `Storyboard must fit ${width}×${height} at DSF 1 without overflow: ${JSON.stringify(dimensions)}`,
    );
  }
  const assertHealthy = () => {
    checkInterrupted();
    if (problems.length) throw new Error(`Storyboard errors:\n${problems.join('\n')}`);
  };
  assertHealthy();
  return { page, assertHealthy };
}

async function captureFrame(page, seconds, file) {
  checkInterrupted();
  await page.evaluate(async (time) => {
    let timeout;
    try {
      await Promise.race([
        Promise.resolve(window.renderAt(time)),
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error(`renderAt(${time}) timed out.`)), 30_000);
        }),
      ]);
    } finally {
      clearTimeout(timeout);
    }
    for (const animation of document.getAnimations()) animation.pause();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }, seconds);
  await page.screenshot({ path: file, type: 'png', fullPage: false });
}

async function validateVideo(context, file) {
  const page = await context.newPage();
  try {
    await page.goto(pathToFileURL(file).href, { waitUntil: 'load', timeout: readyTimeout });
    const metadata = await page.locator('video').evaluate(async (video) => {
      if (video.error)
        throw new Error(`Encoded video cannot be decoded (code ${video.error.code}).`);
      if (video.readyState < 1) {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(
            () => reject(new Error('Encoded video metadata timed out.')),
            30_000,
          );
          video.addEventListener(
            'loadedmetadata',
            () => {
              clearTimeout(timeout);
              resolve();
            },
            { once: true },
          );
          video.addEventListener(
            'error',
            () => {
              clearTimeout(timeout);
              reject(new Error(`Encoded video cannot be decoded (code ${video.error?.code}).`));
            },
            { once: true },
          );
        });
      }
      video.pause();
      return { duration: video.duration, width: video.videoWidth, height: video.videoHeight };
    });
    if (
      !Number.isFinite(metadata.duration) ||
      Math.abs(metadata.duration - duration) > 2 / fps ||
      metadata.width !== width ||
      metadata.height !== height
    ) {
      throw new Error(`Invalid encoded video ${file}: ${JSON.stringify(metadata)}`);
    }
    return metadata;
  } finally {
    await page.close();
  }
}

async function validateFullDecode(encoder, file) {
  const { stdout } = await runProcess(encoder, [
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostdin',
    '-i',
    file,
    '-map',
    '0:v:0',
    '-an',
    '-progress',
    'pipe:1',
    '-nostats',
    '-f',
    'null',
    '-',
  ]);
  const decodedFrames = [...stdout.matchAll(/^frame=(\d+)\s*$/gm)].at(-1)?.[1];
  if (Number(decodedFrames) !== frameCount) {
    throw new Error(`Expected ${frameCount} decoded frames in ${file}, received ${decodedFrames}.`);
  }
  return { decodedFrames: Number(decodedFrames) };
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
  ) {
    throw new Error(`Refusing unsafe temporary cleanup: ${tempDirectory}`);
  }
  await rm(canonicalDirectory, { recursive: true, force: false });
}

async function main() {
  const options = parseOptions();
  if (options.help) {
    console.log(
      'Usage: node scripts/render-hero-walkthrough.mjs [--preview] [--overwrite]\n\n--preview    Capture six chapter PNGs in OS Temp; no encoding or deliverable writes.\n--overwrite  Explicitly replace the four existing v3 deliverables after validation.\nFFMPEG_PATH  Optional path to a full local ffmpeg with libx264 and libvpx-vp9.',
    );
    return;
  }
  const outputs = ['mp4', 'webm', 'png', 'vtt'].map((extension) =>
    path.join(outputDirectory, `${outputName}${extension === 'png' ? '-poster' : ''}.${extension}`),
  );
  let tempRoot;
  let tempDirectory;
  let tempEntry;
  const adjacentStaging = [];
  let exportSucceeded = false;
  process.on('SIGINT', handleSigint);
  process.on('SIGTERM', handleSigterm);
  try {
    if (!(await stat(source).catch(() => null))?.isFile())
      throw new Error(`Storyboard is not ready: ${source}`);
    if (!(await stat(captionSource).catch(() => null))?.isFile())
      throw new Error(`Captions are not ready: ${captionSource}`);
    if (!options.preview) await ensureOutputsAvailable(outputs, options.overwrite);
    const encoder = options.preview ? null : await findEncoder();
    checkInterrupted();
    tempRoot = await realpath(path.resolve(tmpdir()));
    tempDirectory = path.resolve(await mkdtemp(path.join(tempRoot, tempPrefix)));
    tempEntry = await lstat(tempDirectory);
    console.log(`Render temp: ${tempDirectory}`);
    browser = await chromium.launch({ headless: true });
    checkInterrupted();
    const context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 1,
      reducedMotion: 'no-preference',
      colorScheme: 'light',
      locale: 'en-US',
      timezoneId: 'UTC',
    });
    const { page, assertHealthy } = await preparePage(context);
    if (options.preview) {
      const previews = [];
      for (const [index, seconds] of previewTimes.entries()) {
        const file = path.join(
          tempDirectory,
          `chapter-${String(index + 1).padStart(2, '0')}-${seconds.toFixed(1)}s.png`,
        );
        await captureFrame(page, seconds, file);
        assertHealthy();
        previews.push({ seconds, path: file });
      }
      console.log(JSON.stringify({ preview: true, width, height, previews }, null, 2));
      return;
    }
    const frames = path.join(tempDirectory, 'frames');
    await mkdir(frames);
    for (let index = 0; index < frameCount; index++) {
      await captureFrame(
        page,
        index / fps,
        path.join(frames, `frame-${String(index).padStart(5, '0')}.png`),
      );
      assertHealthy();
      if ((index + 1) % 90 === 0)
        console.log(
          `Captured ${index + 1}/${frameCount} frames (${((index + 1) / fps).toFixed(1)}s).`,
        );
    }
    const staged = ['mp4', 'webm', 'png', 'vtt'].map((extension) =>
      path.join(tempDirectory, `${outputName}${extension === 'png' ? '-poster' : ''}.${extension}`),
    );
    await copyFile(
      path.join(frames, `frame-${String(Math.round(posterTime * fps)).padStart(5, '0')}.png`),
      staged[2],
      constants.COPYFILE_EXCL,
    );
    await copyFile(captionSource, staged[3], constants.COPYFILE_EXCL);
    assertHealthy();
    await page.close();
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
    console.log(`Encoding MP4 with ${encoder}`);
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
      staged[0],
    ]);
    console.log('Encoding WebM.');
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
      staged[1],
    ]);
    const metadata = [];
    for (const file of staged.slice(0, 2)) metadata.push(await validateVideo(context, file));
    const fullDecode = [];
    for (const file of staged.slice(0, 2)) fullDecode.push(await validateFullDecode(encoder, file));
    checkInterrupted();
    await ensureOutputsAvailable(outputs, options.overwrite);
    await mkdir(outputDirectory, { recursive: true });
    if (options.overwrite) {
      for (let index = 0; index < outputs.length; index++) {
        checkInterrupted();
        const adjacent = path.join(
          outputDirectory,
          `.${path.basename(outputs[index])}.${path.basename(tempDirectory)}.tmp`,
        );
        adjacentStaging.push(adjacent);
        await copyFile(staged[index], adjacent, constants.COPYFILE_EXCL);
        checkInterrupted();
      }
    }
    for (let index = 0; index < outputs.length; index++) {
      checkInterrupted();
      if (options.overwrite) await rename(adjacentStaging[index], outputs[index]);
      else await copyFile(staged[index], outputs[index], constants.COPYFILE_EXCL);
      checkInterrupted();
    }
    checkInterrupted();
    exportSucceeded = true;
    console.log(
      JSON.stringify(
        { width, height, fps, duration, frameCount, posterTime, outputs, metadata, fullDecode },
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
