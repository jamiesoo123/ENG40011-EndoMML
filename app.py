#!/usr/bin/env python3
"""
FastAPI app that serves:
- Static frontend (Home, Survey, Result)
- /predict endpoint to score with your .pkl model
Run locally:
  uvicorn app:app --host 0.0.0.0 --port 8000 --reload
"""

import joblib, pandas as pd, numpy as np
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Dict
from scipy.special import expit

# ---------- Config ----------
MODELS_DIR = Path("models")
MODEL_FILE = "endometriosis_hgb_model.pkl"   # change if your filename differs
MODEL_PATH = MODELS_DIR / MODEL_FILE

if not MODEL_PATH.exists():
    raise RuntimeError(f"Model file not found at {MODEL_PATH}")

model = joblib.load(MODEL_PATH)

# ---------- App ----------
app = FastAPI(title="Endometriosis Predictor (Local)")

# Serve static folders
app.mount("/assets", StaticFiles(directory="frontend"), name="assets")
app.mount("/data",   StaticFiles(directory="data"),     name="data")

# Routes for pages
@app.get("/")
def home():
    return FileResponse("frontend/index.html")

@app.get("/survey")
def survey():
    return FileResponse("frontend/survey.html")

@app.get("/result")
def result():
    return FileResponse("frontend/result.html")

# ---------- API schema ----------
class PredictIn(BaseModel):
    features: Dict[str, float]   # { "FeatureName": value_in_[0,1] or 0/1 }

class PredictOut(BaseModel):
    prob1: float
    pred: int

# ---------- Helpers ----------
def predict_proba_one(m, df: pd.DataFrame) -> float:
    if hasattr(m, "predict_proba"):
        return float(m.predict_proba(df)[0, 1])
    if hasattr(m, "decision_function"):
        score = float(np.asarray(m.decision_function(df)).reshape(-1)[0])
        return float(expit(score))
    # fallback
    return float(m.predict(df)[0])

# ---------- API ----------
@app.post("/predict", response_model=PredictOut)
def predict(payload: PredictIn):
    row = pd.DataFrame([payload.features])

    feats = getattr(model, "feature_names_in_", None)
    if feats is not None:
        for col in feats:
            if col not in row.columns:
                row[col] = 0.0
        row = row[list(feats)]
    else:
        row = row.apply(pd.to_numeric, errors="coerce").fillna(0.0)

    prob1 = predict_proba_one(model, row)
    pred = int(prob1 >= 0.5)
    return {"prob1": prob1, "pred": pred}

@app.get("/health")
def health():
    return {"ok": True}
