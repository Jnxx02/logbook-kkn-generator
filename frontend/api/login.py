from fastapi import FastAPI, HTTPException, Depends
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session, sessionmaker, declarative_base
from sqlalchemy import create_engine, Column, Integer, String, Boolean
from pydantic import BaseModel
from passlib.context import CryptContext
from datetime import datetime, timedelta
from jose import jwt
import os

app = FastAPI()


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
    _pg_user = os.getenv("POSTGRES_USER")
    _pg_pass = os.getenv("POSTGRES_PASSWORD")
    _pg_host = os.getenv("POSTGRES_HOST")
    _pg_db = os.getenv("POSTGRES_DATABASE", "postgres")
    if _pg_host and _pg_user and _pg_pass:
        DATABASE_URL = f"postgresql+psycopg://{_pg_user}:{_pg_pass}@{_pg_host}:6543/{_pg_db}?sslmode=require"

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


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    nim = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    is_admin = Column(Boolean, default=False, nullable=False)


class Token(BaseModel):
    access_token: str
    token_type: str


ALGORITHM = "HS256"
JWT_SECRET = os.getenv("JWT_SECRET", "change-me")


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(user_id: int) -> str:
    payload = {"sub": str(user_id), "exp": datetime.utcnow() + timedelta(minutes=60)}
    return jwt.encode(payload, JWT_SECRET, algorithm=ALGORITHM)


@app.post("", response_model=Token)
@app.post("/", response_model=Token)
async def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.nim == form.username).first()
    if not user or not verify_password(form.password, user.password_hash):
        raise HTTPException(status_code=400, detail="Incorrect NIM or password")
    token = create_access_token(user.id)
    return {"access_token": token, "token_type": "bearer"}


@app.get("")
@app.get("/")
async def ping():
    return {"ok": True}


