from fastapi import FastAPI, HTTPException, Depends
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from ..api.generate-word import (
    get_db,
    User,
    Token,
    create_access_token,
    verify_password,
)

app = FastAPI()


@app.post("/", response_model=Token)
async def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    user = db.query(User).filter(User.nim == form.username).first()
    if not user or not verify_password(form.password, user.password_hash):
        raise HTTPException(status_code=400, detail="Incorrect NIM or password")
    token = create_access_token(user.id)
    return {"access_token": token, "token_type": "bearer"}


