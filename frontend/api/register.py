from fastapi import FastAPI, HTTPException, Depends
from sqlalchemy.orm import Session, sessionmaker, declarative_base
from sqlalchemy import create_engine, Column, Integer, String, Boolean
from pydantic import BaseModel
from datetime import datetime
from passlib.context import CryptContext
import os

app = FastAPI()


# Try multiple environment variable sources
DATABASE_URL = (
    os.getenv("DATABASE_URL")
    or os.getenv("POSTGRES_URL")
    or os.getenv("POSTGRES_PRISMA_URL")
    or ""
)

if DATABASE_URL:
    if DATABASE_URL.startswith("postgres://"):
        DATABASE_URL = "postgresql+psycopg://" + DATABASE_URL[len("postgres://"):]
    elif DATABASE_URL.startswith("postgresql://") and "+" not in DATABASE_URL.split("://", 1)[0]:
        DATABASE_URL = "postgresql+psycopg://" + DATABASE_URL[len("postgresql://"):]
else:
    # Fallback: construct from individual env vars
    _pg_user = os.getenv("POSTGRES_USER")
    _pg_pass = os.getenv("POSTGRES_PASSWORD")
    _pg_host = os.getenv("POSTGRES_HOST")
    _pg_db = os.getenv("POSTGRES_DATABASE")
    
    print(f"Env vars - User: {_pg_user}, Host: {_pg_host}, DB: {_pg_db}")  # Debug
    
    # Fix: Use project name from host instead of "postgres"
    if _pg_host and "supabase" in _pg_host:
        # Extract project name from host: db.zrezyxxvnotyxlkrhsvj.supabase.co -> zrezyxxvnotyxlkrhsvj
        project_name = _pg_host.split(".")[1] if "." in _pg_host else _pg_db
        _pg_db = project_name
        print(f"Using project name as database: {_pg_db}")
    
    if _pg_host and _pg_user and _pg_pass and _pg_db:
        DATABASE_URL = f"postgresql+psycopg://{_pg_user}:{_pg_pass}@{_pg_host}:5432/{_pg_db}?sslmode=require"
    else:
        raise Exception("Missing required database environment variables")

print(f"Database URL: {DATABASE_URL[:50]}...")  # Debug: show first 50 chars
engine = create_engine(DATABASE_URL, pool_pre_ping=True, connect_args={})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Ensure tables exist (first-run)
try:
    Base.metadata.create_all(bind=engine)
except Exception:
    pass


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    nim = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    is_admin = Column(Boolean, default=False, nullable=False)
    created_at = Column(String, default=lambda: datetime.utcnow().isoformat(), nullable=False)


class UserCreate(BaseModel):
    nim: str
    password: str
    is_admin: bool | None = False


class UserOut(BaseModel):
    id: int
    nim: str
    is_admin: bool

    class Config:
        from_attributes = True


def hash_password(plain: str) -> str:
    return pwd_context.hash(plain)


@app.post("", response_model=UserOut)
@app.post("/api/register", response_model=UserOut)
async def register(user_in: UserCreate, db: Session = Depends(get_db)):
    try:
        existing = db.query(User).filter(User.nim == user_in.nim).first()
        if existing:
            raise HTTPException(status_code=400, detail="NIM already registered")
        user = User(nim=user_in.nim, password_hash=hash_password(user_in.password), is_admin=bool(user_in.is_admin or False))
        db.add(user)
        db.commit()
        db.refresh(user)
        return user
    except Exception as e:
        print(f"Register error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


@app.get("/")
@app.get("/api/register")
async def ping():
    return {"ok": True}


