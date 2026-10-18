import Foundation
import Vision
import ImageIO

// 读取课件画面中的实际文字，仅作为转写术语校对的参照。
for path in CommandLine.arguments.dropFirst() {
    autoreleasepool {
        do {
            let request = VNRecognizeTextRequest()
            request.recognitionLevel = .accurate
            request.recognitionLanguages = ["zh-Hans", "en-US"]
            request.usesLanguageCorrection = false
            let handler = VNImageRequestHandler(url: URL(fileURLWithPath: path))
            try handler.perform([request])
            let lines = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }
            let result: [String: Any] = ["image": path, "lines": lines]
            let data = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys, .withoutEscapingSlashes])
            print(String(data: data, encoding: .utf8)!)
        } catch {
            fputs("OCR failed: \(path): \(error)\n", stderr)
            exit(1)
        }
    }
}
