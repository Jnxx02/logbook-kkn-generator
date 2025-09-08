from fastapi import FastAPI, HTTPException, Depends
from fastapi.responses import FileResponse
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel, EmailStr
from typing import List, Optional
from datetime import datetime, date, time, timedelta
from docx import Document
from docx.shared import Inches, Pt
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_ALIGN_VERTICAL
import base64
import tempfile
import os
from jose import jwt
import requests
import uuid
from passlib.context import CryptContext
from sqlalchemy import create_engine, Column, Integer, String, Date, Time, Boolean, ForeignKey
from sqlalchemy.orm import sessionmaker, declarative_base, relationship, Session

app = FastAPI()


# =====================================
# Database & Auth Setup (Supabase Postgres)
# =====================================

DATABASE_URL = os.getenv("DATABASE_URL", "")
JWT_SECRET = os.getenv("JWT_SECRET", "change-this-secret")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("JWT_EXPIRE_MINUTES", "60"))
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
SUPABASE_STORAGE_BUCKET = os.getenv("SUPABASE_STORAGE_BUCKET", "logbook-images")

if not DATABASE_URL:
    # In serverless, we still allow non-DB mode for backward compatibility
    engine = None
    SessionLocal = None
else:
    engine = create_engine(
        DATABASE_URL,
        pool_pre_ping=True,
        connect_args={}
    )
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")


def get_db():
    if SessionLocal is None:
        raise HTTPException(status_code=500, detail="Database not configured")
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    is_admin = Column(Boolean, default=False, nullable=False)
    created_at = Column(String, default=lambda: datetime.utcnow().isoformat(), nullable=False)
    entries = relationship("LogbookEntryORM", back_populates="user", cascade="all, delete-orphan")


class LogbookEntryORM(Base):
    __tablename__ = "logbook_entries"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    tanggal = Column(Date, nullable=False)
    jam_mulai = Column(Time, nullable=False)
    jam_selesai = Column(Time, nullable=True)
    judul_kegiatan = Column(String, nullable=False)
    rincian_kegiatan = Column(String, nullable=False)
    dokumen_pendukung = Column(String, nullable=True)
    user = relationship("User", back_populates="entries")


if engine is not None:
    Base.metadata.create_all(bind=engine)


# Schemas
class Token(BaseModel):
    access_token: str
    token_type: str


class UserCreate(BaseModel):
    email: EmailStr
    password: str
    is_admin: Optional[bool] = False


class UserOut(BaseModel):
    id: int
    email: EmailStr
    is_admin: bool

    class Config:
        from_attributes = True


class LogbookEntryIn(BaseModel):
    tanggal: date
    jam_mulai: str
    jam_selesai: Optional[str] = None
    judul_kegiatan: str
    rincian_kegiatan: str
    dokumen_pendukung: Optional[str] = None


class LogbookEntryOut(BaseModel):
    id: int
    tanggal: date
    jam_mulai: str
    jam_selesai: Optional[str]
    judul_kegiatan: str
    rincian_kegiatan: str
    dokumen_pendukung: Optional[str]

    class Config:
        from_attributes = True


class GenerateEntry(BaseModel):
    id: str
    tanggal: str
    jam: str
    judul_kegiatan: str
    rincian_kegiatan: str
    dokumen_pendukung: Optional[str] = None


class GenerateBody(BaseModel):
    entries: List[GenerateEntry]


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def hash_password(plain: str) -> str:
    return pwd_context.hash(plain)


def create_access_token(user_id: int) -> str:
    payload = {"sub": str(user_id), "exp": datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)}
    return jwt.encode(payload, JWT_SECRET, algorithm=ALGORITHM)


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[ALGORITHM])
        uid = int(payload.get("sub"))
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")
    user = db.query(User).filter(User.id == uid).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


# ==============================
# Supabase Storage Helpers
# ==============================

def _is_base64_data_url(value: Optional[str]) -> bool:
    if not value:
        return False
    # data:image/png;base64,....
    return value.startswith("data:") and "base64," in value


def upload_base64_image_to_storage(base64_data_url: str, user_id: int) -> Optional[str]:
    if not SUPABASE_URL or not SUPABASE_SERVICE_ROLE_KEY:
        return None
    try:
        raw = base64_data_url
        if 'base64,' in raw:
            raw = raw.split('base64,', 1)[1]
        elif ',' in raw:
            raw = raw.split(',', 1)[1]
        raw = raw.strip()
        image_bytes = base64.b64decode(raw)
        # detect simple type from data URL header if available
        ext = 'png'
        if base64_data_url.startswith('data:image/jpeg') or base64_data_url.startswith('data:image/jpg'):
            ext = 'jpg'
        elif base64_data_url.startswith('data:image/webp'):
            ext = 'webp'
        elif base64_data_url.startswith('data:image/gif'):
            ext = 'gif'
        filename = f"user-{user_id}/{uuid.uuid4().hex}.{ext}"
        url = f"{SUPABASE_URL}/storage/v1/object/{SUPABASE_STORAGE_BUCKET}/{filename}"
        headers = {
            'Authorization': f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
            'Content-Type': f"image/{ext}",
        }
        resp = requests.post(url, headers=headers, data=image_bytes, timeout=30)
        # 200/201 both are OK for object put
        if resp.status_code not in (200, 201):
            return None
        # Public URL (bucket should be public). If private, you can create signed URLs instead.
        public_url = f"{SUPABASE_URL}/storage/v1/object/public/{SUPABASE_STORAGE_BUCKET}/{filename}"
        return public_url
    except Exception:
        return None


def download_image_bytes(image_ref: str) -> Optional[bytes]:
    try:
        if image_ref.startswith('http://') or image_ref.startswith('https://'):
            r = requests.get(image_ref, timeout=30)
            if r.status_code == 200:
                return r.content
            return None
        # fallback: treat as storage path bucket/key
        if SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY:
            url = f"{SUPABASE_URL}/storage/v1/object/{image_ref}"
            headers = {'Authorization': f"Bearer {SUPABASE_SERVICE_ROLE_KEY}"}
            r = requests.get(url, headers=headers, timeout=30)
            if r.status_code == 200:
                return r.content
        return None
    except Exception:
        return None

@app.get("/")
@app.get("/api/generate-word")
async def generate_word_document_root():
    return {"status": "generate-word"}


# Auth endpoints
@app.post("/auth/register", response_model=UserOut)
async def register_user(user_in: UserCreate, db: Session = Depends(get_db)):
    existing = db.query(User).filter(User.email == user_in.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    user = User(email=user_in.email, password_hash=hash_password(user_in.password), is_admin=bool(user_in.is_admin or False))
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


@app.post("/auth/login", response_model=Token)
async def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == form.username).first()
    if not user or not verify_password(form.password, user.password_hash):
        raise HTTPException(status_code=400, detail="Incorrect email or password")
    token = create_access_token(user.id)
    return {"access_token": token, "token_type": "bearer"}


# CRUD endpoints
@app.get("/logbook", response_model=List[LogbookEntryOut])
async def list_logbook(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    entries = (
        db.query(LogbookEntryORM)
        .filter(LogbookEntryORM.user_id == current_user.id)
        .order_by(LogbookEntryORM.tanggal.asc(), LogbookEntryORM.jam_mulai.asc())
        .all()
    )
    out = []
    for e in entries:
        out.append(LogbookEntryOut(
            id=e.id,
            tanggal=e.tanggal,
            jam_mulai=e.jam_mulai.strftime('%H:%M'),
            jam_selesai=e.jam_selesai.strftime('%H:%M') if e.jam_selesai else None,
            judul_kegiatan=e.judul_kegiatan,
            rincian_kegiatan=e.rincian_kegiatan,
            dokumen_pendukung=e.dokumen_pendukung,
        ))
    return out


@app.post("/logbook", response_model=LogbookEntryOut)
async def create_logbook(entry: LogbookEntryIn, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    def parse_time(v: Optional[str]) -> Optional[time]:
        if not v:
            return None
        hh, mm = v.split(':')
        return time(hour=int(hh), minute=int(mm))

    image_url = None
    if _is_base64_data_url(entry.dokumen_pendukung):
        image_url = upload_base64_image_to_storage(entry.dokumen_pendukung, current_user.id)

    orm = LogbookEntryORM(
        user_id=current_user.id,
        tanggal=entry.tanggal,
        jam_mulai=parse_time(entry.jam_mulai),
        jam_selesai=parse_time(entry.jam_selesai),
        judul_kegiatan=entry.judul_kegiatan,
        rincian_kegiatan=entry.rincian_kegiatan,
        dokumen_pendukung=image_url or entry.dokumen_pendukung,
    )
    db.add(orm)
    db.commit()
    db.refresh(orm)
    return LogbookEntryOut(
        id=orm.id,
        tanggal=orm.tanggal,
        jam_mulai=orm.jam_mulai.strftime('%H:%M'),
        jam_selesai=orm.jam_selesai.strftime('%H:%M') if orm.jam_selesai else None,
        judul_kegiatan=orm.judul_kegiatan,
        rincian_kegiatan=orm.rincian_kegiatan,
        dokumen_pendukung=orm.dokumen_pendukung,
    )


@app.put("/logbook/{entry_id}", response_model=LogbookEntryOut)
async def update_logbook(entry_id: int, entry: LogbookEntryIn, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    orm = db.query(LogbookEntryORM).filter(LogbookEntryORM.id == entry_id, LogbookEntryORM.user_id == current_user.id).first()
    if not orm:
        raise HTTPException(status_code=404, detail="Entry not found")

    def parse_time(v: Optional[str]) -> Optional[time]:
        if not v:
            return None
        hh, mm = v.split(':')
        return time(hour=int(hh), minute=int(mm))

    orm.tanggal = entry.tanggal
    orm.jam_mulai = parse_time(entry.jam_mulai)
    orm.jam_selesai = parse_time(entry.jam_selesai)
    orm.judul_kegiatan = entry.judul_kegiatan
    orm.rincian_kegiatan = entry.rincian_kegiatan
    # If base64 provided, upload and replace with URL
    if _is_base64_data_url(entry.dokumen_pendukung):
        uploaded = upload_base64_image_to_storage(entry.dokumen_pendukung, current_user.id)
        if uploaded:
            orm.dokumen_pendukung = uploaded
    else:
        orm.dokumen_pendukung = entry.dokumen_pendukung
    db.commit()
    db.refresh(orm)
    return LogbookEntryOut(
        id=orm.id,
        tanggal=orm.tanggal,
        jam_mulai=orm.jam_mulai.strftime('%H:%M'),
        jam_selesai=orm.jam_selesai.strftime('%H:%M') if orm.jam_selesai else None,
        judul_kegiatan=orm.judul_kegiatan,
        rincian_kegiatan=orm.rincian_kegiatan,
        dokumen_pendukung=orm.dokumen_pendukung,
    )


@app.delete("/logbook/{entry_id}")
async def delete_logbook(entry_id: int, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    orm = db.query(LogbookEntryORM).filter(LogbookEntryORM.id == entry_id, LogbookEntryORM.user_id == current_user.id).first()
    if not orm:
        raise HTTPException(status_code=404, detail="Entry not found")
    db.delete(orm)
    db.commit()
    return {"status": "deleted"}


@app.post("/api/generate-word")
async def generate_word_document(data: Optional[GenerateBody] = None, token: Optional[str] = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    try:
        doc = Document()

        normal_style = doc.styles['Normal']
        normal_font = normal_style.font
        normal_font.name = 'Times New Roman'
        normal_font.size = Pt(10)

        table = doc.add_table(rows=1, cols=4)
        table.style = 'Table Grid'
        table.autofit = True

        hdr_cells = table.rows[0].cells
        headers = ['NO.', 'HARI/TGL', 'JAM', 'KEGIATAN PER HARI']
        for i, h in enumerate(headers):
            hdr_cells[i].text = h
        for cell in hdr_cells:
            for paragraph in cell.paragraphs:
                paragraph.alignment = WD_ALIGN_PARAGRAPH.CENTER
                for run in paragraph.runs:
                    run.bold = True
                    run.font.name = 'Times New Roman'
                    run.font.size = Pt(10)
            cell.vertical_alignment = WD_ALIGN_VERTICAL.CENTER

        bulan = [
            'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
            'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
        ]

        entries_for_doc: List[GenerateEntry] = []
        user = None
        if token and SessionLocal is not None:
            try:
                payload = jwt.decode(token, JWT_SECRET, algorithms=[ALGORITHM])
                uid = int(payload.get('sub'))
                user = db.query(User).filter(User.id == uid).first()
            except Exception:
                user = None
        if user is not None:
            db_entries = (
                db.query(LogbookEntryORM)
                .filter(LogbookEntryORM.user_id == user.id)
                .order_by(LogbookEntryORM.tanggal.asc(), LogbookEntryORM.jam_mulai.asc())
                .all()
            )
            for e in db_entries:
                jam_str = e.jam_mulai.strftime('%H:%M')
                if e.jam_selesai:
                    jam_str += f" - {e.jam_selesai.strftime('%H:%M')}"
                entries_for_doc.append(GenerateEntry(
                    id=str(e.id),
                    tanggal=e.tanggal.strftime('%Y-%m-%d'),
                    jam=jam_str,
                    judul_kegiatan=e.judul_kegiatan,
                    rincian_kegiatan=e.rincian_kegiatan,
                    dokumen_pendukung=e.dokumen_pendukung,
                ))
        elif data and data.entries:
            def sort_key(en: GenerateEntry):
                try:
                    d = datetime.strptime(en.tanggal, '%Y-%m-%d')
                except Exception:
                    d = datetime.max
                try:
                    start = (en.jam or '').split(' - ')[0].strip()
                    t = datetime.strptime(start, '%H:%M').time()
                except Exception:
                    t = time.max
                return (d, t)
            entries_for_doc = sorted(list(data.entries), key=sort_key)
        else:
            entries_for_doc = []

        for idx, entry in enumerate(entries_for_doc, 1):
            row_cells = table.add_row().cells
            row_cells[0].text = str(idx)

            try:
                dt = datetime.strptime(entry.tanggal, '%Y-%m-%d')
                formatted_date = f"{dt.day:02d} {bulan[dt.month - 1]} {dt.year}"
            except Exception:
                formatted_date = entry.tanggal
            row_cells[1].text = formatted_date
            row_cells[2].text = entry.jam

            kegiatan_cell = row_cells[3]
            kegiatan_paragraph = kegiatan_cell.paragraphs[0]
            judul_run = kegiatan_paragraph.add_run("Judul Kegiatan:\n")
            judul_run.bold = True
            judul_run.font.name = 'Times New Roman'
            judul_run.font.size = Pt(10)
            kegiatan_paragraph.add_run(f"• {entry.judul_kegiatan}\n\n")

            rincian_run = kegiatan_paragraph.add_run("Rincian Kegiatan:\n")
            rincian_run.bold = True
            rincian_run.font.name = 'Times New Roman'
            rincian_run.font.size = Pt(10)
            kegiatan_paragraph.add_run(f"• {entry.rincian_kegiatan}\n\n")

            if entry.dokumen_pendukung:
                dokumen_run = kegiatan_paragraph.add_run("Dokumen Pendukung:\n\n")
                dokumen_run.bold = True
                dokumen_run.font.name = 'Times New Roman'
                dokumen_run.font.size = Pt(10)
                try:
                    image_data = None
                    if _is_base64_data_url(entry.dokumen_pendukung):
                        raw = entry.dokumen_pendukung.split('base64,', 1)[1] if 'base64,' in entry.dokumen_pendukung else entry.dokumen_pendukung
                        raw = raw.split(',', 1)[1] if ',' in raw else raw
                        raw = raw.strip()
                        image_data = base64.b64decode(raw)
                    else:
                        image_data = download_image_bytes(entry.dokumen_pendukung)
                    if not image_data:
                        raise Exception('No image bytes')
                    with tempfile.NamedTemporaryFile(delete=False, suffix='.png') as tmp_file:
                        tmp_file.write(image_data)
                        tmp_file_path = tmp_file.name
                    kegiatan_paragraph.add_run().add_picture(tmp_file_path, width=Inches(2.5))
                    os.unlink(tmp_file_path)
                except Exception as e:
                    print(f"Error adding image: {e}")
                    kegiatan_paragraph.add_run("[Gambar tidak dapat ditampilkan]")

            for cell in row_cells:
                cell.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
                for paragraph in cell.paragraphs:
                    for run in paragraph.runs:
                        run.font.name = 'Times New Roman'
                        run.font.size = Pt(10)

            row_cells[0].paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
            row_cells[1].paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER
            row_cells[2].paragraphs[0].alignment = WD_ALIGN_PARAGRAPH.CENTER

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


