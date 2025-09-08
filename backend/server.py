from fastapi import FastAPI, HTTPException, File, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import List, Optional
import os
import uuid
import base64
from datetime import datetime
from docx import Document
from docx.shared import Inches, Cm, Pt
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_ALIGN_VERTICAL
from docx.oxml.shared import OxmlElement, qn
import io
from PIL import Image
import tempfile
from dotenv import load_dotenv

load_dotenv()

app = FastAPI()

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class LogbookEntry(BaseModel):
    id: str
    tanggal: str
    jam: str
    judul_kegiatan: str
    rincian_kegiatan: str
    dokumen_pendukung: Optional[str] = None  # base64 image

class LogbookData(BaseModel):
    entries: List[LogbookEntry]

@app.post("/api/generate-word")
async def generate_word_document(data: LogbookData):
    try:
        # Create a new Document
        doc = Document()
        
        # Set default font to Times New Roman, size 12
        normal_style = doc.styles['Normal']
        normal_font = normal_style.font
        normal_font.name = 'Times New Roman'
        normal_font.size = Pt(12)
        
        # Create table with 4 columns
        table = doc.add_table(rows=1, cols=4)
        table.style = 'Table Grid'
        # Let Word auto-fit table to contents/page
        table.autofit = True
        
        # Do not force fixed column widths to avoid overflowing the page
        
        # Header row
        hdr_cells = table.rows[0].cells
        hdr_cells[0].text = 'NO.'
        hdr_cells[1].text = 'HARI/TGL'
        hdr_cells[2].text = 'JAM'
        hdr_cells[3].text = 'KEGIATAN PER HARI'
        
        # Make header bold and centered
        for cell in hdr_cells:
            for paragraph in cell.paragraphs:
                paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
                for run in paragraph.runs:
                    run.bold = True
                    run.font.name = 'Times New Roman'
                    run.font.size = Pt(10)
            # Vertical center header cells
            cell.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
        
        # Add data rows
        for idx, entry in enumerate(data.entries, 1):
            row_cells = table.add_row().cells
            row_cells[0].text = str(idx)
            # Format date to "DD Month YYYY" in Indonesian
            try:
                dt = datetime.strptime(entry.tanggal, '%Y-%m-%d')
                bulan = [
                    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
                    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
                ]
                formatted_date = f"{dt.day:02d} {bulan[dt.month - 1]} {dt.year}"
            except Exception:
                formatted_date = entry.tanggal
            row_cells[1].text = formatted_date
            row_cells[2].text = entry.jam
            
            # Format kegiatan cell
            kegiatan_cell = row_cells[3]
            kegiatan_paragraph = kegiatan_cell.paragraphs[0]
            
            # Add title
            judul_run = kegiatan_paragraph.add_run("Judul Kegiatan:\n")
            judul_run.bold = True
            judul_run.font.name = 'Times New Roman'
            judul_run.font.size = Pt(10)
            kegiatan_paragraph.add_run(f"• {entry.judul_kegiatan}\n\n")
            
            # Add rincian
            rincian_run = kegiatan_paragraph.add_run("Rincian Kegiatan:\n")
            rincian_run.bold = True
            rincian_run.font.name = 'Times New Roman'
            rincian_run.font.size = Pt(10)
            kegiatan_paragraph.add_run(f"• {entry.rincian_kegiatan}\n\n")
            
            # Add dokumen pendukung
            if entry.dokumen_pendukung:
                dokumen_run = kegiatan_paragraph.add_run("Dokumen Pendukung:\n\n")
                dokumen_run.bold = True
                dokumen_run.font.name = 'Times New Roman'
                dokumen_run.font.size = Pt(10)
                
                try:
                    # Decode base64 image (handle multiple possible data URL formats)
                    base64_str = entry.dokumen_pendukung
                    if 'base64,' in base64_str:
                        base64_str = base64_str.split('base64,', 1)[1]
                    elif ',' in base64_str:
                        # Fallback: take part after first comma
                        base64_str = base64_str.split(',', 1)[1]
                    # Remove whitespace/newlines
                    base64_str = base64_str.strip()
                    image_data = base64.b64decode(base64_str)
                    
                    # Create temporary file
                    with tempfile.NamedTemporaryFile(delete=False, suffix='.png') as tmp_file:
                        tmp_file.write(image_data)
                        tmp_file_path = tmp_file.name
                    
                    # Add image to document
                    kegiatan_paragraph.add_run().add_picture(tmp_file_path, width=Inches(2.5))
                    
                    # Clean up temporary file
                    os.unlink(tmp_file_path)
                    
                except Exception as e:
                    print(f"Error adding image: {e}")
                    kegiatan_paragraph.add_run("[Gambar tidak dapat ditampilkan]")
            
            # Ensure font for all paragraphs/runs in the row is Times New Roman 10 and vertical center
            for cell in row_cells:
                cell.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
                for paragraph in cell.paragraphs:
                    for run in paragraph.runs:
                        run.font.name = 'Times New Roman'
                        run.font.size = Pt(10)

            # Center align the number column
            row_cells[0].paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
            row_cells[1].paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
            row_cells[2].paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
        
        # Save document
        filename = f"logbook_{datetime.now().strftime('%Y%m%d_%H%M%S')}.docx"
        temp_dir = tempfile.gettempdir()
        filepath = os.path.join(temp_dir, filename)
        doc.save(filepath)
        
        return FileResponse(
            filepath,
            media_type='application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            filename=filename,
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error generating document: {str(e)}")

@app.get("/api/health")
async def health_check():
    return {"status": "healthy"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)