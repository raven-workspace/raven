//! The exam report export (docs/adr/0002): the report's Typst source, written by the app
//! (`src/engines/report/typst.ts`), compiled in-process to a PDF with the house fonts built into the app, then the
//! unpassworded `.7z` OffSec takes and the archive's MD5 to compare at upload.offsec.com. No network: the only files
//! the source can read are the screenshots it names (`img/<attachment id>`), served from the vault.

use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use md5::{Digest, Md5};
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use typst::diag::{FileError, FileResult, Severity};
use typst::foundations::{Bytes, Datetime, Duration};
use typst_layout::PagedDocument;
use typst::syntax::{FileId, RootedPath, Source, VirtualPath, VirtualRoot};
use typst::text::{Font, FontBook};
use typst::utils::LazyHash;
use typst::{Library, LibraryExt, World};

use crate::error::{AppError, AppResult};

/// OffSec's upload limit for the archive.
pub const UPLOAD_LIMIT_BYTES: u64 = 200 * 1024 * 1024;

/// The house fonts (src-tauri/fonts/README.md).
const FONTS: &[&[u8]] = &[
    include_bytes!("../fonts/InstrumentSans-Regular.ttf"),
    include_bytes!("../fonts/InstrumentSans-RegularItalic.ttf"),
    include_bytes!("../fonts/InstrumentSans-Medium.ttf"),
    include_bytes!("../fonts/InstrumentSans-SemiBold.ttf"),
    include_bytes!("../fonts/InstrumentSans-SemiBoldItalic.ttf"),
    include_bytes!("../fonts/InstrumentSans-Bold.ttf"),
    include_bytes!("../fonts/InstrumentSans-BoldItalic.ttf"),
    include_bytes!("../fonts/JetBrainsMono-Regular.ttf"),
    include_bytes!("../fonts/JetBrainsMono-Bold.ttf"),
    include_bytes!("../fonts/JetBrainsMono-Italic.ttf"),
];

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportInput {
    /// The whole report as Typst (`reportTypst`).
    pub source: String,
    /// The screenshots it prints, each read as `img/<id>`.
    pub attachment_ids: Vec<String>,
    /// The folder the owner picked.
    pub folder: String,
    /// `OSCP-<OSID>-Exam-Report`: the PDF and the archive take it with their extensions.
    pub file_stem: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub pdf_path: String,
    pub pdf_bytes: u64,
    pub archive_path: String,
    pub archive_bytes: u64,
    /// The archive's MD5, lower-case hex: what upload.offsec.com shows.
    pub md5: String,
    pub pages: usize,
    /// Over OffSec's 200 MB limit.
    pub too_large: bool,
}

/// The screenshots a report prints, as stored: by attachment id. An id the vault doesn't hold is an error, never a
/// silent gap in the report.
pub fn load_images(conn: &Connection, ids: &[String]) -> AppResult<HashMap<String, Vec<u8>>> {
    let mut out = HashMap::new();
    for id in ids {
        let bytes: Option<Vec<u8>> = conn.query_row("SELECT bytes FROM attachments WHERE id = ?1", [id], |r| r.get(0)).optional()?;
        let bytes = bytes.ok_or_else(|| AppError::validation("attachment", format!("a screenshot on the report is missing from the vault ({id})")))?;
        out.insert(id.clone(), bytes);
    }
    Ok(out)
}

/// The compile's whole world: one source, the bundled fonts, the screenshots. Nothing else can be read.
struct ReportWorld {
    library: LazyHash<Library>,
    book: LazyHash<FontBook>,
    fonts: Vec<Font>,
    main: Source,
    images: HashMap<String, Bytes>,
}

impl ReportWorld {
    fn new(source: &str, images: HashMap<String, Vec<u8>>) -> Self {
        let fonts: Vec<Font> = FONTS.iter().flat_map(|data| Font::iter(Bytes::new(*data))).collect();
        let main_id = RootedPath::new(VirtualRoot::Project, VirtualPath::new("main.typ").expect("a valid path")).intern();
        Self {
            library: LazyHash::new(Library::default()),
            book: LazyHash::new(FontBook::from_fonts(&fonts)),
            fonts,
            main: Source::new(main_id, source.to_string()),
            images: images.into_iter().map(|(id, bytes)| (id, Bytes::new(bytes))).collect(),
        }
    }

    /// The attachment a path names: `img/<id>`.
    fn image_of(&self, id: FileId) -> Option<&Bytes> {
        let path = id.get().vpath().get_without_slash();
        path.strip_prefix("img/").and_then(|id| self.images.get(id))
    }
}

impl World for ReportWorld {
    fn library(&self) -> &LazyHash<Library> {
        &self.library
    }
    fn book(&self) -> &LazyHash<FontBook> {
        &self.book
    }
    fn main(&self) -> FileId {
        self.main.id()
    }
    fn source(&self, id: FileId) -> FileResult<Source> {
        if id == self.main.id() {
            Ok(self.main.clone())
        } else {
            Err(FileError::NotSource)
        }
    }
    fn file(&self, id: FileId) -> FileResult<Bytes> {
        if id == self.main.id() {
            return Ok(Bytes::from_string(self.main.text().to_string()));
        }
        self.image_of(id).cloned().ok_or_else(|| FileError::NotFound(PathBuf::from(id.get().vpath().get_without_slash())))
    }
    fn font(&self, index: usize) -> Option<Font> {
        self.fonts.get(index).cloned()
    }
    fn today(&self, _offset: Option<Duration>) -> Option<Datetime> {
        None
    }
}

/// The report's PDF and its page count. A compile error names the first problem in words, never a partial PDF.
pub fn compile_pdf(source: &str, images: HashMap<String, Vec<u8>>) -> AppResult<(Vec<u8>, usize)> {
    let world = ReportWorld::new(source, images);
    let warned = typst::compile::<PagedDocument>(&world);
    let doc = warned.output.map_err(|errors| {
        let first = errors.iter().find(|e| e.severity == Severity::Error).map(|e| e.message.to_string()).unwrap_or_default();
        AppError::validation("export", format!("the report could not be laid out: {first}"))
    })?;
    let pages = doc.pages().len();
    let pdf = typst_pdf::pdf(&doc, &typst_pdf::PdfOptions::default()).map_err(|errors| {
        let first = errors.first().map(|e| e.message.to_string()).unwrap_or_default();
        AppError::validation("export", format!("the PDF could not be written: {first}"))
    })?;
    Ok((pdf, pages))
}

/// `OSCP-OS-12345-Exam-Report`: letters, digits and hyphens only, so it can never name another folder.
fn checked_stem(stem: &str) -> AppResult<&str> {
    let ok = !stem.is_empty() && stem.len() <= 120 && stem.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    if ok {
        Ok(stem)
    } else {
        Err(AppError::validation("fileStem", "the file name may hold only letters, digits and hyphens"))
    }
}

fn md5_hex(path: &Path) -> AppResult<String> {
    let mut file = fs::File::open(path)?;
    let mut hasher = Md5::new();
    let mut buf = vec![0u8; 1 << 16];
    loop {
        let n = file.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hasher.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

/// Writes `<stem>.pdf` and `<stem>.7z` (holding just the PDF, no password) into `folder`, replacing earlier exports
/// of the same name, and returns their paths, sizes and the archive's MD5.
pub fn write_export(folder: &Path, stem: &str, pdf: &[u8], pages: usize) -> AppResult<ExportResult> {
    let stem = checked_stem(stem)?;
    if !folder.is_dir() {
        return Err(AppError::validation("folder", "the export folder doesn't exist any more: pick it again"));
    }
    let pdf_path = folder.join(format!("{stem}.pdf"));
    let archive_path = folder.join(format!("{stem}.7z"));
    fs::write(&pdf_path, pdf)?;
    if archive_path.exists() {
        fs::remove_file(&archive_path)?;
    }
    sevenz_rust2::compress_to_path(&pdf_path, &archive_path).map_err(|e| AppError::Io(format!("couldn't write the .7z: {e}")))?;
    let archive_bytes = fs::metadata(&archive_path)?.len();
    Ok(ExportResult {
        pdf_path: pdf_path.to_string_lossy().into_owned(),
        pdf_bytes: fs::metadata(&pdf_path)?.len(),
        archive_path: archive_path.to_string_lossy().into_owned(),
        archive_bytes,
        md5: md5_hex(&archive_path)?,
        pages,
        too_large: archive_bytes > UPLOAD_LIMIT_BYTES,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A 1×1 PNG.
    const PNG: &[u8] = &[
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01,
        0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0b, 0x49, 0x44, 0x41,
        0x54, 0x78, 0x9c, 0x63, 0xf8, 0x0f, 0x04, 0x00, 0x09, 0xfb, 0x03, 0xfd, 0xfb, 0x5e, 0x6b, 0x2b, 0x00, 0x00, 0x00, 0x00,
        0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ];

    #[test]
    fn compiles_text_code_and_a_screenshot_with_the_house_fonts() {
        let source = r#"
#set text(font: "Instrument Sans")
#show raw: set text(font: "JetBrains Mono")
= Heading
Some text and #raw("code -> as typed").
#figure(image("img/a1"), caption: [A screenshot])
"#;
        let (pdf, pages) = compile_pdf(source, HashMap::from([("a1".to_string(), PNG.to_vec())])).unwrap();
        assert!(pdf.starts_with(b"%PDF-"));
        assert_eq!(pages, 1);
        // The fonts are embedded (subset) under their own names.
        let text = String::from_utf8_lossy(&pdf);
        assert!(text.contains("InstrumentSans"), "Instrument Sans embedded");
        assert!(text.contains("JetBrainsMono"), "JetBrains Mono embedded");
    }

    #[test]
    fn a_missing_screenshot_or_any_other_file_is_an_error_not_a_gap() {
        let err = compile_pdf(r#"#image("img/nope")"#, HashMap::new()).unwrap_err();
        assert!(err.to_string().contains("could not be laid out"), "{err}");
        let err = compile_pdf(r#"#read("/etc/passwd")"#, HashMap::new()).unwrap_err();
        assert!(err.to_string().contains("could not be laid out"), "{err}");
    }

    #[test]
    fn writes_the_pdf_and_an_unpassworded_7z_holding_it_with_its_md5() {
        let dir = tempfile::tempdir().unwrap();
        let (pdf, pages) = compile_pdf("Hello", HashMap::new()).unwrap();
        let out = write_export(dir.path(), "OSCP-OS-48213-Exam-Report", &pdf, pages).unwrap();
        assert!(out.pdf_path.ends_with("OSCP-OS-48213-Exam-Report.pdf"));
        assert!(out.archive_path.ends_with("OSCP-OS-48213-Exam-Report.7z"));
        assert_eq!(out.pdf_bytes, pdf.len() as u64);
        assert_eq!(out.md5.len(), 32);
        assert_eq!(out.md5, md5_hex(Path::new(&out.archive_path)).unwrap());
        assert!(!out.too_large);
        // The archive opens with no password and holds exactly the PDF.
        let unpacked = tempfile::tempdir().unwrap();
        sevenz_rust2::decompress_file(&out.archive_path, unpacked.path()).unwrap();
        let files: Vec<_> = fs::read_dir(unpacked.path()).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(files, vec![std::ffi::OsString::from("OSCP-OS-48213-Exam-Report.pdf")]);
        assert_eq!(fs::read(unpacked.path().join("OSCP-OS-48213-Exam-Report.pdf")).unwrap(), pdf);
        // A second export replaces the first: still one PDF and one archive, the archive's MD5 its own.
        let again = write_export(dir.path(), "OSCP-OS-48213-Exam-Report", &pdf, pages).unwrap();
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 2);
        assert_eq!(again.md5, md5_hex(Path::new(&again.archive_path)).unwrap());
    }

    #[test]
    fn reads_the_screenshots_from_the_vault_and_refuses_a_missing_one() {
        use crate::engagements::{self, EngagementInput};
        use crate::log::{self, LogContent, LogEntryInput, NewAttachment};
        use crate::paths::DataPaths;
        use crate::vault::Vault;
        use base64::{engine::general_purpose::STANDARD, Engine};

        let dir = tempfile::tempdir().unwrap();
        let mut v = Vault::new(DataPaths::for_root(dir.path().to_path_buf()));
        v.create_for_test("correct horse battery").unwrap();
        let c = v.conn().unwrap();
        let e = engagements::create(c, EngagementInput {
            name: "exam".into(), kind: "exam-sim".into(), client: None, sub_label: None, scope_cidrs: vec![], domain: None,
            starts_at: None, ends_at: None, timebox_start: None, timebox_minutes: None,
        }).unwrap().id;
        let entry = log::create(c, &e, LogEntryInput {
            title: "proof.txt".into(), title_edited: false, ran_on: None, host_ids: vec![], observations: None, returned_nothing: false,
            private: false,
            content: LogContent::Screenshot { attachment_id: String::new(), caption: "proof.txt".into(), file_name: "p.png".into() },
            payload_id: None, payload_values: None, at: None,
            attachment: Some(NewAttachment { mime: "image/png".into(), data_base64: STANDARD.encode(PNG) }),
        }).unwrap();
        let LogContent::Screenshot { attachment_id, .. } = entry.content else { panic!("a screenshot") };
        let images = load_images(c, std::slice::from_ref(&attachment_id)).unwrap();
        assert_eq!(images[&attachment_id], PNG);
        let source = format!("#image(\"img/{attachment_id}\")");
        assert!(compile_pdf(&source, images).is_ok());
        let err = load_images(c, &["gone".to_string()]).unwrap_err();
        assert!(err.to_string().contains("missing from the vault"), "{err}");
    }

    #[test]
    fn refuses_a_file_name_that_could_leave_the_folder() {
        let dir = tempfile::tempdir().unwrap();
        for stem in ["../evil", "a/b", "", "name.pdf"] {
            assert!(write_export(dir.path(), stem, b"%PDF-", 1).is_err(), "{stem}");
        }
        assert!(write_export(&dir.path().join("gone"), "OSCP-OS-1-Exam-Report", b"%PDF-", 1).is_err());
    }
}
