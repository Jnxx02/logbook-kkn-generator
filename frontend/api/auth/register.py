from fastapi import FastAPI, HTTPException, Depends
from sqlalchemy.orm import Session

from ..api.generate-word import (
    get_db,
    User,
    UserCreate,
    UserOut,
    hash_password,
)

app = FastAPI()


@app.post("/", response_model=UserOut)
async def register(user_in: UserCreate, db: Session = Depends(get_db)):
    existing = db.query(User).filter(User.nim == user_in.nim).first()
    if existing:
        raise HTTPException(status_code=400, detail="NIM already registered")
    user = User(nim=user_in.nim, password_hash=hash_password(user_in.password), is_admin=bool(user_in.is_admin or False))
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


