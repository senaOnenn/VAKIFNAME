from fastapi import FastAPI

app = FastAPI(title="VAKIFNAME API", version="1.0.0")

@app.get("/")
def read_root():
    return {"status": "ok", "message": "VAKIFNAME API Service Active"}
