//! Compiles a report exported from the audit app with the real export code, to judge the PDF page by page:
//! `cargo run --example export_report -- <export.json> <out folder>` (written by `audit/export-report.mjs`).

use std::collections::HashMap;

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Input {
    source: String,
    file_stem: String,
}

#[derive(Deserialize)]
struct Captured {
    input: Input,
    images: HashMap<String, Option<String>>,
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let (json, out) = (&args[1], &args[2]);
    let captured: Captured = serde_json::from_str(&std::fs::read_to_string(json).expect("read the export")).expect("parse the export");
    let images = captured
        .images
        .into_iter()
        .map(|(id, b64)| (id.clone(), STANDARD.decode(b64.unwrap_or_else(|| panic!("no image for {id}"))).expect("base64")))
        .collect();
    let (pdf, pages) = raven_lib::export::compile_pdf(&captured.input.source, images).unwrap_or_else(|e| panic!("{e}"));
    let result = raven_lib::export::write_export(std::path::Path::new(out), &captured.input.file_stem, &pdf, pages).expect("write");
    println!("{}", serde_json::to_string_pretty(&result).unwrap());
}
