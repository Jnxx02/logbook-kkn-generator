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
from docx.shared import Inches, Cm
from docx.enum.text import WD_ALIGN_PARAGRAPH
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
        
        # Create table with 4 columns
        table = doc.add_table(rows=1, cols=4)
        table.style = 'Table Grid'
        
        # Set column widths
        for i, width in enumerate([Cm(1.5), Cm(3), Cm(3), Cm(8)]):
            for cell in table.columns[i].cells:
                cell.width = width
        
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
        
        # Add data rows
        for idx, entry in enumerate(data.entries, 1):
            row_cells = table.add_row().cells
            row_cells[0].text = str(idx)
            row_cells[1].text = entry.tanggal
            row_cells[2].text = entry.jam
            
            # Format kegiatan cell
            kegiatan_cell = row_cells[3]
            kegiatan_paragraph = kegiatan_cell.paragraphs[0]
            
            # Add title
            judul_run = kegiatan_paragraph.add_run("Judul Kegiatan:\n")
            judul_run.bold = True
            kegiatan_paragraph.add_run(f"• {entry.judul_kegiatan}\n\n")
            
            # Add rincian
            rincian_run = kegiatan_paragraph.add_run("Rincian Kegiatan:\n")
            rincian_run.bold = True
            kegiatan_paragraph.add_run(f"• {entry.rincian_kegiatan}\n\n")
            
            # Add dokumen pendukung
            if entry.dokumen_pendukung:
                dokumen_run = kegiatan_paragraph.add_run("Dokumen Pendukung:\n\n")
                dokumen_run.bold = True
                
                try:
                    # Decode base64 image
                    image_data = base64.b64decode(entry.dokumen_pendukung.split(',')[1])
                    
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
            
            # Center align the number column
            row_cells[0].paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
        
        # Save document
        filename = f"logbook_{datetime.now().strftime('%Y%m%d_%H%M%S')}.docx"
        filepath = f"/tmp/{filename}"
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