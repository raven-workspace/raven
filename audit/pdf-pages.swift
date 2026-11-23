// Draws every page of a PDF to PNG with macOS's own PDF renderer (PDFKit), so the pages judged are the PDF's, not a
// re-layout: swift audit/pdf-pages.swift <file.pdf> <out folder> → p1.png, p2.png…
import AppKit
import PDFKit

let args = CommandLine.arguments
guard args.count == 3, let doc = PDFDocument(url: URL(fileURLWithPath: args[1])) else {
  FileHandle.standardError.write("usage: pdf-pages.swift <file.pdf> <out folder>\n".data(using: .utf8)!)
  exit(1)
}
let scale: CGFloat = 1.5
for i in 0..<doc.pageCount {
  guard let page = doc.page(at: i) else { continue }
  let box = page.bounds(for: .mediaBox)
  let size = NSSize(width: box.width * scale, height: box.height * scale)
  let image = NSImage(size: size)
  image.lockFocus()
  NSColor.white.setFill()
  NSRect(origin: .zero, size: size).fill()
  let ctx = NSGraphicsContext.current!.cgContext
  ctx.scaleBy(x: scale, y: scale)
  page.draw(with: .mediaBox, to: ctx)
  image.unlockFocus()
  let rep = NSBitmapImageRep(data: image.tiffRepresentation!)!
  let png = rep.representation(using: .png, properties: [:])!
  try! png.write(to: URL(fileURLWithPath: "\(args[2])/p\(i + 1).png"))
}
print("\(doc.pageCount) pages")
