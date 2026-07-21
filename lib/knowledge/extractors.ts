// lib/knowledge/extractors.ts
// Local, token-light text extraction for the learnings corpus. Documents are
// parsed entirely by code (pdf-parse / mammoth / exceljs / adm-zip). Images use
// Tesseract OCR (no tokens); only when OCR can't read an image do we fall back
// to a single OpenAI vision call. The raw files are NEVER sent to the LLM.

import fs from "fs/promises";
import path from "path";
import OpenAI from "openai";
import ExcelJS from "exceljs";
import mammoth from "mammoth";
import AdmZip from "adm-zip";
import { createWorker, type Worker } from "tesseract.js";
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { logger } from "../logger";
import type { KnowledgeConfig } from "@/lib/types";

export interface ExtractResult {
  text: string;
  ocrUsed: boolean;
  visionUsed: boolean;
  scanned: boolean;
  type: string;
}

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif"]);

export function fileType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (IMAGE_EXT.has(ext)) return "image";
  return ext.replace(/^\./, "") || "unknown";
}

// ---- Tesseract worker (shared, lazy) --------------------------------------
let workerPromise: Promise<Worker> | null = null;

async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker("eng");
  }
  return workerPromise;
}

export async function terminateOcr(): Promise<void> {
  if (workerPromise) {
    const w = await workerPromise;
    await w.terminate();
    workerPromise = null;
  }
}

// ---- Vision fallback (only token use, only for unreadable images) ----------
function mimeFor(ext: string): string {
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/jpeg";
}

async function visionExtract(
  filePath: string,
  cfg: KnowledgeConfig,
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) {
    return "";
  }
  const buf = await fs.readFile(filePath);
  const dataUrl = `data:${mimeFor(path.extname(filePath).toLowerCase())};base64,${buf.toString("base64")}`;
  const client = new OpenAI({ apiKey });
  const completion = await client.chat.completions.create({
    model: cfg.visionModel,
    max_tokens: 700,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "This is a page from a QA/automation engineer's study notes. Transcribe the meaningful text and describe any diagram/code concisely as plain text for a knowledge base. No preamble.",
          },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
  });
  return (completion.choices[0]?.message?.content ?? "").trim();
}

// ---- Per-type extractors ---------------------------------------------------
async function extractTxt(filePath: string): Promise<string> {
  return (await fs.readFile(filePath, "utf8")).trim();
}

async function extractDocx(filePath: string): Promise<string> {
  const result = await mammoth.extractRawText({ path: filePath });
  return result.value.trim();
}

async function extractXlsx(filePath: string): Promise<string> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const parts: string[] = [];
  wb.eachSheet((sheet) => {
    parts.push(`# ${sheet.name}`);
    sheet.eachRow((row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: false }, (cell) => {
        const v = cell.value;
        if (v !== null && v !== undefined) {
          cells.push(typeof v === "object" ? JSON.stringify(v) : String(v));
        }
      });
      if (cells.length > 0) parts.push(cells.join(" | "));
    });
  });
  return parts.join("\n").trim();
}

function extractPptx(filePath: string): string {
  const zip = new AdmZip(filePath);
  const parts: string[] = [];
  for (const entry of zip.getEntries()) {
    if (/ppt\/slides\/slide\d+\.xml$/.test(entry.entryName)) {
      const xml = entry.getData().toString("utf8");
      const matches = xml.match(/<a:t>([^<]*)<\/a:t>/g) ?? [];
      for (const m of matches) {
        parts.push(m.replace(/<\/?a:t>/g, ""));
      }
    }
  }
  return parts.join(" ").trim();
}

async function ocrImage(filePath: string): Promise<string> {
  const worker = await getWorker();
  const { data } = await worker.recognize(filePath);
  return (data.text ?? "").trim();
}

// Rasterize the first N pages of a scanned PDF and OCR them. Best-effort:
// any failure (pdfjs/canvas issues) degrades to scanned=true, empty text.
async function ocrScannedPdf(
  filePath: string,
  cfg: KnowledgeConfig,
): Promise<string> {
  interface Viewport { width: number; height: number; }
  interface Page {
    getViewport(o: { scale: number }): Viewport;
    render(o: { canvasContext: unknown; viewport: Viewport }): { promise: Promise<void> };
  }
  interface Doc { numPages: number; getPage(n: number): Promise<Page>; }
  interface Lib {
    getDocument(o: { data: Uint8Array; disableWorker?: boolean; isEvalSupported?: boolean }): { promise: Promise<Doc> };
    GlobalWorkerOptions: { workerSrc: string };
  }
  const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as Lib;
  // In Node, pdfjs runs a main-thread "fake worker" but still needs workerSrc to
  // point at the worker module — and on Windows it must be a file:// URL.
  const { pathToFileURL } = await import("url");
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
    path.join(process.cwd(), "node_modules", "pdfjs-dist", "legacy", "build", "pdf.worker.mjs"),
  ).href;
  const canvasMod = await import("@napi-rs/canvas");
  const raw = await fs.readFile(filePath);
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(raw),
    disableWorker: true,
    isEvalSupported: false,
  }).promise;

  const pages = Math.min(cfg.maxOcrPages, doc.numPages);
  const worker = await getWorker();
  const texts: string[] = [];
  for (let i = 1; i <= pages; i += 1) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = canvasMod.createCanvas(
      Math.ceil(viewport.width),
      Math.ceil(viewport.height),
    );
    const ctx = canvas.getContext("2d");
    await page.render({ canvasContext: ctx as unknown, viewport }).promise;
    const png = canvas.toBuffer("image/png");
    const { data } = await worker.recognize(png);
    texts.push((data.text ?? "").trim());
  }
  return texts.join("\n\n").trim();
}

// PDFs that yield very little text per page are almost certainly scans.
function looksScanned(text: string, pages: number): boolean {
  const perPage = pages > 0 ? text.replace(/\s/g, "").length / pages : text.length;
  return perPage < 40;
}

export async function extractFile(
  filePath: string,
  cfg: KnowledgeConfig,
): Promise<ExtractResult> {
  const type = fileType(filePath);
  const base = { ocrUsed: false, visionUsed: false, scanned: false, type };

  try {
    switch (type) {
      case "txt":
      case "md":
        return { ...base, text: await extractTxt(filePath) };
      case "docx":
        return { ...base, text: await extractDocx(filePath) };
      case "xlsx":
        return { ...base, text: await extractXlsx(filePath) };
      case "pptx":
        return { ...base, text: extractPptx(filePath) };
      case "doc":
        // Legacy binary Word — not supported without native tooling.
        return { ...base, text: "" };
      case "pdf": {
        const buf = await fs.readFile(filePath);
        const parsed = await pdfParse(buf);
        const text = (parsed.text ?? "").trim();
        if (!looksScanned(text, parsed.numpages)) {
          return { ...base, text };
        }
        // Scanned PDF.
        if (cfg.ocrScannedPdfs) {
          try {
            const ocrText = await ocrScannedPdf(filePath, cfg);
            if (ocrText.replace(/\s/g, "").length >= 25) {
              return { ...base, text: ocrText, ocrUsed: true };
            }
          } catch (err) {
            logger.warn(`[knowledge] scanned-PDF OCR failed for ${path.basename(filePath)}: ${String(err)}`);
          }
        }
        return { ...base, text, scanned: true };
      }
      case "image": {
        let text = "";
        let ocrUsed = false;
        let visionUsed = false;
        if (cfg.ocrImages) {
          try {
            text = await ocrImage(filePath);
            ocrUsed = true;
          } catch (err) {
            logger.warn(`[knowledge] OCR failed for ${path.basename(filePath)}: ${String(err)}`);
          }
        }
        if (text.replace(/\s/g, "").length < 25 && cfg.visionFallback) {
          try {
            const v = await visionExtract(filePath, cfg);
            if (v.length > 0) {
              text = v;
              visionUsed = true;
            }
          } catch (err) {
            logger.warn(`[knowledge] vision fallback failed for ${path.basename(filePath)}: ${String(err)}`);
          }
        }
        return { ...base, text, ocrUsed, visionUsed };
      }
      default:
        return { ...base, text: "" };
    }
  } catch (err) {
    logger.warn(`[knowledge] extract failed for ${path.basename(filePath)}: ${String(err)}`);
    return { ...base, text: "" };
  }
}

// ---- Buffer (in-memory) extraction ----------------------------------------
// Mirrors extractFile but works entirely from an in-memory Buffer so the
// deployed app can extract browser-uploaded files without the server FS.

async function extractXlsxBuffer(bytes: Buffer): Promise<string> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as Parameters<typeof wb.xlsx.load>[0]);
  const parts: string[] = [];
  wb.eachSheet((sheet) => {
    parts.push(`# ${sheet.name}`);
    sheet.eachRow((row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: false }, (cell) => {
        const v = cell.value;
        if (v !== null && v !== undefined) {
          cells.push(typeof v === "object" ? JSON.stringify(v) : String(v));
        }
      });
      if (cells.length > 0) parts.push(cells.join(" | "));
    });
  });
  return parts.join("\n").trim();
}

function extractPptxBuffer(bytes: Buffer): string {
  const zip = new AdmZip(bytes);
  const parts: string[] = [];
  for (const entry of zip.getEntries()) {
    if (/ppt\/slides\/slide\d+\.xml$/.test(entry.entryName)) {
      const xml = entry.getData().toString("utf8");
      const matches = xml.match(/<a:t>([^<]*)<\/a:t>/g) ?? [];
      for (const m of matches) {
        parts.push(m.replace(/<\/?a:t>/g, ""));
      }
    }
  }
  return parts.join(" ").trim();
}

async function ocrImageBuffer(bytes: Buffer): Promise<string> {
  const worker = await getWorker();
  const { data } = await worker.recognize(bytes);
  return (data.text ?? "").trim();
}

async function visionExtractBuffer(
  name: string,
  bytes: Buffer,
  cfg: KnowledgeConfig,
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) {
    return "";
  }
  const dataUrl = `data:${mimeFor(path.extname(name).toLowerCase())};base64,${bytes.toString("base64")}`;
  const client = new OpenAI({ apiKey });
  const completion = await client.chat.completions.create({
    model: cfg.visionModel,
    max_tokens: 700,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "This is a page from a QA/automation engineer's study notes. Transcribe the meaningful text and describe any diagram/code concisely as plain text for a knowledge base. No preamble.",
          },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
  });
  return (completion.choices[0]?.message?.content ?? "").trim();
}

// Rasterize + OCR a scanned PDF from an in-memory Buffer. Best-effort:
// any failure degrades to scanned=true, empty text.
async function ocrScannedPdfBuffer(
  bytes: Buffer,
  cfg: KnowledgeConfig,
): Promise<string> {
  interface Viewport { width: number; height: number; }
  interface Page {
    getViewport(o: { scale: number }): Viewport;
    render(o: { canvasContext: unknown; viewport: Viewport }): { promise: Promise<void> };
  }
  interface Doc { numPages: number; getPage(n: number): Promise<Page>; }
  interface Lib {
    getDocument(o: { data: Uint8Array; disableWorker?: boolean; isEvalSupported?: boolean }): { promise: Promise<Doc> };
    GlobalWorkerOptions: { workerSrc: string };
  }
  const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as Lib;
  const { pathToFileURL } = await import("url");
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(
    path.join(process.cwd(), "node_modules", "pdfjs-dist", "legacy", "build", "pdf.worker.mjs"),
  ).href;
  const canvasMod = await import("@napi-rs/canvas");
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(bytes),
    disableWorker: true,
    isEvalSupported: false,
  }).promise;

  const pages = Math.min(cfg.maxOcrPages, doc.numPages);
  const worker = await getWorker();
  const texts: string[] = [];
  for (let i = 1; i <= pages; i += 1) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = canvasMod.createCanvas(
      Math.ceil(viewport.width),
      Math.ceil(viewport.height),
    );
    const ctx = canvas.getContext("2d");
    await page.render({ canvasContext: ctx as unknown, viewport }).promise;
    const png = canvas.toBuffer("image/png");
    const { data } = await worker.recognize(png);
    texts.push((data.text ?? "").trim());
  }
  return texts.join("\n\n").trim();
}

export async function extractBuffer(
  name: string,
  bytes: Buffer,
  cfg: KnowledgeConfig,
): Promise<ExtractResult> {
  const type = fileType(name);
  const base = { ocrUsed: false, visionUsed: false, scanned: false, type };

  try {
    switch (type) {
      case "txt":
      case "md":
        return { ...base, text: bytes.toString("utf8").trim() };
      case "docx": {
        const result = await mammoth.extractRawText({ buffer: bytes });
        return { ...base, text: result.value.trim() };
      }
      case "xlsx":
        return { ...base, text: await extractXlsxBuffer(bytes) };
      case "pptx":
        return { ...base, text: extractPptxBuffer(bytes) };
      case "doc":
        // Legacy binary Word — not supported without native tooling.
        return { ...base, text: "" };
      case "pdf": {
        const parsed = await pdfParse(bytes);
        const text = (parsed.text ?? "").trim();
        if (!looksScanned(text, parsed.numpages)) {
          return { ...base, text };
        }
        if (cfg.ocrScannedPdfs) {
          try {
            const ocrText = await ocrScannedPdfBuffer(bytes, cfg);
            if (ocrText.replace(/\s/g, "").length >= 25) {
              return { ...base, text: ocrText, ocrUsed: true };
            }
          } catch (err) {
            logger.warn(`[knowledge] scanned-PDF OCR failed for ${path.basename(name)}: ${String(err)}`);
          }
        }
        return { ...base, text, scanned: true };
      }
      case "image": {
        let text = "";
        let ocrUsed = false;
        let visionUsed = false;
        if (cfg.ocrImages) {
          try {
            text = await ocrImageBuffer(bytes);
            ocrUsed = true;
          } catch (err) {
            logger.warn(`[knowledge] OCR failed for ${path.basename(name)}: ${String(err)}`);
          }
        }
        if (text.replace(/\s/g, "").length < 25 && cfg.visionFallback) {
          try {
            const v = await visionExtractBuffer(name, bytes, cfg);
            if (v.length > 0) {
              text = v;
              visionUsed = true;
            }
          } catch (err) {
            logger.warn(`[knowledge] vision fallback failed for ${path.basename(name)}: ${String(err)}`);
          }
        }
        return { ...base, text, ocrUsed, visionUsed };
      }
      default:
        return { ...base, text: "" };
    }
  } catch (err) {
    logger.warn(`[knowledge] buffer extract failed for ${path.basename(name)}: ${String(err)}`);
    return { ...base, text: "" };
  }
}
