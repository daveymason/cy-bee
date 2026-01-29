use anyhow::{Context, Result};
use calamine::{Reader, open_workbook_auto};
use csv::ReaderBuilder;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

/// A document created from a CSV or Excel row, ready for embedding
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CsvDocument {
    /// Unique identifier for the document
    pub id: String,
    /// The flattened semantic content for embedding
    pub content: String,
    /// Source filename
    pub source_file: String,
    /// Original row number (1-indexed)
    pub row_number: usize,
}

/// Load all supported files (CSV, XLSX, XLS) from a directory
pub fn load_csvs_from_directory(folder_path: &str) -> Result<Vec<CsvDocument>> {
    let path = Path::new(folder_path);
    
    if !path.exists() {
        anyhow::bail!("Directory does not exist: {}", folder_path);
    }
    
    if !path.is_dir() {
        anyhow::bail!("Path is not a directory: {}", folder_path);
    }
    
    let mut all_documents = Vec::new();
    let mut doc_id = 0;
    
    // Read all files in the directory
    for entry in fs::read_dir(path).context("Failed to read directory")? {
        let entry = entry.context("Failed to read directory entry")?;
        let file_path = entry.path();
        let filename = file_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "unknown".to_string());
        
        let extension = file_path.extension()
            .map(|ext| ext.to_string_lossy().to_lowercase())
            .unwrap_or_default();
            
        let documents = match extension.as_str() {
            "csv" => parse_csv_file(&file_path, &filename, &mut doc_id)
                .with_context(|| format!("Failed to parse CSV file: {}", filename))?,
            "xlsx" | "xls" | "xlsm" | "xlsb" => parse_excel_file(&file_path, &filename, &mut doc_id)
                .with_context(|| format!("Failed to parse Excel file: {}", filename))?,
            _ => continue, // Skip unsupported files
        };
        
        all_documents.extend(documents);
    }
    
    Ok(all_documents)
}

/// Parse a single Excel file (all sheets) into documents
fn parse_excel_file(
    file_path: &Path,
    filename: &str,
    doc_id: &mut usize,
) -> Result<Vec<CsvDocument>> {
    let mut workbook = open_workbook_auto(file_path)
        .context("Failed to open Excel workbook")?;
        
    let sheet_names = workbook.sheet_names().to_owned();
    let mut documents = Vec::new();
    
    for sheet_name in sheet_names {
        if let Ok(range) = workbook.worksheet_range(&sheet_name) {
            let mut rows = range.rows();
            
            // Get headers from the first row
            let headers: Vec<String> = match rows.next() {
                Some(row) => row.iter().map(|cell| cell.to_string()).collect(),
                None => continue, // Empty sheet
            };
            
            if headers.is_empty() {
                continue;
            }
            
            // Process remaining rows
            for (row_idx, row) in rows.enumerate() {
                let row_number = row_idx + 2; // +1 for 0-index, +1 for header row skipped
                
                // Convert row to string values
                let values: Vec<String> = row.iter().map(|c| c.to_string()).collect();
                
                // Flatten row
                let content = flatten_excel_row_to_string(
                    filename,
                    &sheet_name,
                    row_number,
                    &headers,
                    &values
                );
                
                if content.trim().is_empty() {
                    continue;
                }
                
                documents.push(CsvDocument {
                    id: format!("doc_{}", *doc_id),
                    content,
                    source_file: format!("{} ({})", filename, sheet_name),
                    row_number,
                });
                
                *doc_id += 1;
            }
        }
    }
    
    Ok(documents)
}

/// Flatten an Excel row into a semantic string
fn flatten_excel_row_to_string(
    filename: &str,
    sheet_name: &str,
    row_number: usize,
    headers: &[String],
    values: &[String],
) -> String {
    let mut parts = Vec::new();
    
    for (i, header) in headers.iter().enumerate() {
        if let Some(value) = values.get(i) {
            let value = value.trim();
            if !value.is_empty() {
                parts.push(format!("{}: {}", header, value));
            }
        }
    }
    
    if parts.is_empty() {
        return String::new();
    }
    
    format!(
        "From {} [Sheet: {}], Row {}: {}",
        filename,
        sheet_name,
        row_number,
        parts.join(", ")
    )
}

/// Parse a single CSV file into documents
fn parse_csv_file(
    file_path: &Path,
    filename: &str,
    doc_id: &mut usize,
) -> Result<Vec<CsvDocument>> {
    let mut reader = ReaderBuilder::new()
        .has_headers(true)
        .flexible(true)
        // Ensure we treat the file as bytes first to handle encoding
        .from_path(file_path)
        .context("Failed to open CSV file")?;
    
    // Get headers (lossy conversion to UTF-8)
    let headers: Vec<String> = reader
        .byte_headers()
        .context("Failed to read CSV headers")?
        .iter()
        .map(|h| String::from_utf8_lossy(h).to_string())
        .collect();
    
    if headers.is_empty() {
        return Ok(Vec::new());
    }
    
    let mut documents = Vec::new();
    
    // Process each row using byte_records to avoid UTF-8 errors
    for (row_idx, result) in reader.byte_records().enumerate() {
        let record = result.context(format!("Failed to read CSV record at row {}", row_idx + 1))?;
        let row_number = row_idx + 1; // 1-indexed for human readability
        
        // Flatten the row into a semantic string
        let content = flatten_row_to_string(filename, row_number, &headers, &record);
        
        // Skip empty rows
        if content.trim().is_empty() || !has_meaningful_content(&record) {
            continue;
        }
        
        documents.push(CsvDocument {
            id: format!("doc_{}", *doc_id),
            content,
            source_file: filename.to_string(),
            row_number,
        });
        
        *doc_id += 1;
    }
    
    Ok(documents)
}

/// Flatten a CSV row into a semantic string
/// Format: "From [Filename], Row [Number]: [Column1 Header]: [Value1], [Column2 Header]: [Value2]..."
fn flatten_row_to_string(
    filename: &str,
    row_number: usize,
    headers: &[String],
    record: &csv::ByteRecord,
) -> String {
    let mut parts = Vec::new();
    
    for (i, header) in headers.iter().enumerate() {
        if let Some(value_bytes) = record.get(i) {
            // Lossy conversion to handle non-UTF8 characters
            let value = String::from_utf8_lossy(value_bytes);
            let value_trimmed = value.trim();
            if !value_trimmed.is_empty() {
                parts.push(format!("{}: {}", header, value_trimmed));
            }
        }
    }
    
    if parts.is_empty() {
        return String::new();
    }
    
    format!(
        "From {}, Row {}: {}",
        filename,
        row_number,
        parts.join(", ")
    )
}

/// Check if a record has any meaningful (non-empty) content
fn has_meaningful_content(record: &csv::ByteRecord) -> bool {
    record.iter().any(|field| !field.is_empty() && field.iter().any(|&b| !b.is_ascii_whitespace()))
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_flatten_row() {
        let headers = vec!["Name".to_string(), "Age".to_string(), "City".to_string()];
        let record = csv::ByteRecord::from(vec!["John Doe", "30", "New York"]);
        
        let result = flatten_row_to_string("test.csv", 1, &headers, &record);
        
        assert!(result.contains("From test.csv, Row 1:"));
        assert!(result.contains("Name: John Doe"));
        assert!(result.contains("Age: 30"));
        assert!(result.contains("City: New York"));
    }
}
