from fastapi import FastAPI

app = FastAPI()


# Support both when Vercel passes full path and when it strips it
@app.get("/")
@app.get("/api/health")
async def health_check():
    return {"status": "healthy"}


