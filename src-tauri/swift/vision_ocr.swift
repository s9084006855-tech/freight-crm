import Foundation
import Vision
import AppKit
import CoreGraphics

struct TextObs: Codable {
    let text: String
    let confidence: Float
}

struct OCRResult: Codable {
    let observations: [TextObs]
    let fullText: String
    let averageConfidence: Float
    let engine: String
    let error: String?
}

func recognizeText(imagePath: String) -> OCRResult {
    guard let image = NSImage(contentsOfFile: imagePath),
          let cgImage = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        return OCRResult(observations: [], fullText: "", averageConfidence: 0,
                         engine: "apple_vision", error: "Cannot load image: \(imagePath)")
    }

    var obs: [TextObs] = []
    let sema = DispatchSemaphore(value: 0)

    let request = VNRecognizeTextRequest { req, _ in
        defer { sema.signal() }
        guard let results = req.results as? [VNRecognizedTextObservation] else { return }
        for r in results {
            if let top = r.topCandidates(1).first {
                obs.append(TextObs(text: top.string, confidence: top.confidence))
            }
        }
    }
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.recognitionLanguages = ["en-US"]

    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
    do { try handler.perform([request]) } catch {}
    _ = sema.wait(timeout: .now() + 30)

    let full = obs.map { $0.text }.joined(separator: "\n")
    let avg = obs.isEmpty ? Float(0) : obs.map { $0.confidence }.reduce(0, +) / Float(obs.count)

    return OCRResult(observations: obs, fullText: full, averageConfidence: avg,
                     engine: "apple_vision", error: nil)
}

func renderPDFPage(pdfPath: String, pageNum: Int, outputPath: String) -> Bool {
    let url = URL(fileURLWithPath: pdfPath)
    guard let pdf = CGPDFDocument(url as CFURL),
          pageNum >= 1, pageNum <= pdf.numberOfPages,
          let page = pdf.page(at: pageNum) else { return false }

    let rect = page.getBoxRect(.mediaBox)
    let scale: CGFloat = 2.0
    let w = Int(rect.width * scale)
    let h = Int(rect.height * scale)

    guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8,
                              bytesPerRow: 0, space: CGColorSpaceCreateDeviceRGB(),
                              bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return false }

    ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
    ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
    ctx.scaleBy(x: scale, y: scale)
    ctx.drawPDFPage(page)

    guard let img = ctx.makeImage() else { return false }
    let rep = NSBitmapImageRep(cgImage: img)
    guard let data = rep.representation(using: .png, properties: [:]) else { return false }

    do {
        try data.write(to: URL(fileURLWithPath: outputPath))
        return true
    } catch { return false }
}

struct PDFTextResult: Codable {
    let pages: [OCRResult]
    let totalPages: Int
}

func ocrPDF(pdfPath: String) -> PDFTextResult {
    let url = URL(fileURLWithPath: pdfPath)
    guard let pdf = CGPDFDocument(url as CFURL) else {
        return PDFTextResult(pages: [], totalPages: 0)
    }
    let total = pdf.numberOfPages
    let tmp = NSTemporaryDirectory()
    var pages: [OCRResult] = []

    for i in 1...max(1, total) {
        let tmpPath = "\(tmp)freight_crm_\(i)_\(Int(Date().timeIntervalSince1970)).png"
        if renderPDFPage(pdfPath: pdfPath, pageNum: i, outputPath: tmpPath) {
            pages.append(recognizeText(imagePath: tmpPath))
            try? FileManager.default.removeItem(atPath: tmpPath)
        }
    }
    return PDFTextResult(pages: pages, totalPages: total)
}

// ── Entry point ─────────────────────────────────────────────────────────

let args = CommandLine.arguments
let enc = JSONEncoder()
enc.outputFormatting = .sortedKeys

func emit<T: Encodable>(_ val: T) {
    let data = (try? enc.encode(val)) ?? Data()
    print(String(data: data, encoding: .utf8) ?? "{}")
}

guard args.count >= 3 else {
    emit(OCRResult(observations: [], fullText: "", averageConfidence: 0,
                   engine: "apple_vision",
                   error: "Usage: vision_ocr <image|pdf-page|pdf-text> <path> [args...]"))
    exit(1)
}

switch args[1] {
case "image":
    emit(recognizeText(imagePath: args[2]))

case "pdf-page":
    guard args.count >= 5 else { fputs("Usage: vision_ocr pdf-page <pdf> <page> <out>\n", stderr); exit(1) }
    let ok = renderPDFPage(pdfPath: args[2], pageNum: Int(args[3]) ?? 1, outputPath: args[4])
    print(ok ? "ok" : "error")

case "pdf-text":
    emit(ocrPDF(pdfPath: args[2]))

default:
    fputs("Unknown command: \(args[1])\n", stderr)
    exit(1)
}
