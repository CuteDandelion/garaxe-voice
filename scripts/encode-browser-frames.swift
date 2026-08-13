import AVFoundation
import CoreImage
import Foundation
import ImageIO

let arguments = CommandLine.arguments
guard arguments.count == 4, let fps = Int32(arguments[3]), fps > 0 else {
  fatalError("usage: encode-browser-frames <frames-dir> <output.mp4> <fps>")
}

let frameDirectory = URL(fileURLWithPath: arguments[1], isDirectory: true)
let output = URL(fileURLWithPath: arguments[2], relativeTo: URL(fileURLWithPath: FileManager.default.currentDirectoryPath)).standardizedFileURL
let frames = try FileManager.default.contentsOfDirectory(at: frameDirectory, includingPropertiesForKeys: nil)
  .filter { $0.pathExtension == "png" }
  .sorted { $0.lastPathComponent < $1.lastPathComponent }
guard let first = frames.first,
      let source = CGImageSourceCreateWithURL(first as CFURL, nil),
      let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
      let width = properties[kCGImagePropertyPixelWidth] as? Int,
      let height = properties[kCGImagePropertyPixelHeight] as? Int else {
  fatalError("no readable PNG frames")
}

try? FileManager.default.removeItem(at: output)
let writer = try AVAssetWriter(outputURL: output, fileType: .mp4)
let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
  AVVideoCodecKey: AVVideoCodecType.h264,
  AVVideoWidthKey: width,
  AVVideoHeightKey: height,
  AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 2_400_000]
])
input.expectsMediaDataInRealTime = false
let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
  kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
  kCVPixelBufferWidthKey as String: width,
  kCVPixelBufferHeightKey as String: height
])
guard writer.canAdd(input) else { fatalError("video input unavailable") }
writer.add(input)
guard writer.startWriting() else { fatalError(writer.error?.localizedDescription ?? "writer failed") }
writer.startSession(atSourceTime: .zero)

let context = CIContext()
for (index, frame) in frames.enumerated() {
  while !input.isReadyForMoreMediaData { Thread.sleep(forTimeInterval: 0.005) }
  guard let pool = adaptor.pixelBufferPool else { fatalError("pixel buffer pool unavailable") }
  var buffer: CVPixelBuffer?
  guard CVPixelBufferPoolCreatePixelBuffer(nil, pool, &buffer) == kCVReturnSuccess,
        let pixelBuffer = buffer,
        let image = CIImage(contentsOf: frame) else { fatalError("failed at \(frame.lastPathComponent)") }
  context.render(image, to: pixelBuffer)
  guard adaptor.append(pixelBuffer, withPresentationTime: CMTime(value: Int64(index), timescale: fps)) else {
    fatalError(writer.error?.localizedDescription ?? "append failed")
  }
}

input.markAsFinished()
writer.finishWriting {
  if writer.status == .completed {
    print("encoded \(frames.count) frames, \(width)x\(height), \(fps) fps")
    exit(0)
  }
  fputs("encode failed: \(writer.error?.localizedDescription ?? "unknown error")\n", stderr)
  exit(1)
}
RunLoop.current.run()
