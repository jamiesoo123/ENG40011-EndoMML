#!/usr/bin/env python3
"""
FastAPI app that serves:
- Static frontend (Home, Survey, Result)
- /predict endpoint to score with your .pkl model
Run locally:
  uvicorn app:app --host 0.0.0.0 --port 8000 --reload
"""

from pathlib import Path
from typing import Dict, List, Tuple

import json
import joblib
import numpy as np
import pandas as pd
import shap
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from scipy.special import expit

# ---------- Config ----------
BASE_DIR = Path(__file__).parent
FRONTEND_DIR = BASE_DIR / "frontend"
DATA_DIR = BASE_DIR / "data"
MODELS_DIR = BASE_DIR / "models"

MODEL_FILE = "endometriosis_mlp_model.pkl"  # change if needed
MODEL_PATH = MODELS_DIR / MODEL_FILE
if not MODEL_PATH.exists():
    raise RuntimeError(f"Model file not found at {MODEL_PATH}")
model = joblib.load(MODEL_PATH)

# ---------- App ----------
app = FastAPI(title="Endometriosis Predictor")

# --- Mounts ---
app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")
app.mount("/data",   StaticFiles(directory=str(DATA_DIR)),   name="data")

# --- Page routes ---
@app.get("/")
def home():
    return FileResponse(str(FRONTEND_DIR / "index.html"))

@app.get("/survey")
def survey():
    return FileResponse(str(FRONTEND_DIR / "survey.html"))

@app.get("/result")
def result():    
    return FileResponse(str(FRONTEND_DIR / "result.html"))


# ---------- Predict Endpoint ----------
class PredictIn(BaseModel):
    features: Dict[str, float]

class PredictOut(BaseModel):
    pred: int
    prob1: float
    label: str

@app.post("/predict", response_model=PredictOut)
def predict(payload: PredictIn):
    """Return prediction and probability for one sample"""
    X = pd.DataFrame([payload.features])
    feats = getattr(model, "feature_names_in_", None)
    if feats is not None:
        for f in feats:
            if f not in X.columns:
                X[f] = 0.0
        X = X[feats]

    # Make predictions
    if hasattr(model, "predict_proba"):
        prob1 = float(model.predict_proba(X)[0, 1])
    else:
        # fallback for models without predict_proba
        prob1 = float(expit(model.decision_function(X)))

    pred = int(prob1 >= 0.5)
    label = "Endometriosis" if pred == 1 else "No Endometriosis"
    return {"pred": pred, "prob1": prob1, "label": label}


# ---------- SHAP Explainability Endpoint ----------
class ExplainIn(BaseModel):
    features: Dict[str, float]
    top_n: int = 10

class ExplainOut(BaseModel):
    base_value: float | None
    shap_values: List[Tuple[str, float]]
    top_contributors: List[Tuple[str, float]]

def _align_row(payload: Dict[str, float]) -> pd.DataFrame:
    """Align a single-row dataframe to the model's expected columns."""
    row = pd.DataFrame([payload])
    feats = getattr(model, "feature_names_in_", None)
    if feats is not None:
        for col in feats:
            if col not in row.columns:
                row[col] = 0.0
        row = row[list(feats)]
    else:
        row = row.apply(pd.to_numeric, errors="coerce").fillna(0.0)
    return row

def _background_matrix(columns: List[str]) -> np.ndarray:
    """Use means from data/feature_means.json if present; otherwise zeros."""
    try:
        with open("data/feature_means.json", "r") as f:
            means = json.load(f)
        vec = np.array([float(means.get(c, 0.0)) for c in columns], dtype=float)
        return vec.reshape(1, -1)
    except Exception:
        return np.zeros((1, len(columns)), dtype=float)

def _pipeline_proba_callable(pipeline, columns: List[str]):
    """
    Returns callable f(X) -> P(class=1) for SHAP.
    SHAP will pass X as numpy or DataFrame; we coerce & align columns.
    """
    def f(X):
        if isinstance(X, np.ndarray):
            df = pd.DataFrame(X, columns=columns if X.shape[1] == len(columns) else None)
        else:
            df = pd.DataFrame(X)

        # Align to training schema if present
        feats = list(getattr(pipeline, "feature_names_in_", [])) or columns
        for c in feats:
            if c not in df.columns:
                df[c] = 0.0
        df = df[feats]
        return pipeline.predict_proba(df)[:, 1]
    return f

@app.post("/explain", response_model=ExplainOut)
def explain(payload: ExplainIn):
    X_row = _align_row(payload.features)
    cols = list(X_row.columns)

    try:
        # Build callable for the whole pipeline
        f = _pipeline_proba_callable(model, cols)

        # Independent masker using a background matrix
        background = _background_matrix(cols)
        masker = shap.maskers.Independent(background)

        # Generic Explainer (Kernel-based under the hood for callable)
        explainer = shap.Explainer(f, masker)

        # Explain the single row; keep runtime reasonable
        sv = explainer(X_row, max_evals=200 * X_row.shape[1] + 1)

        base = float(np.mean(sv.base_values)) if hasattr(sv, "base_values") else None
        vals = np.array(sv.values[0], dtype=float)

        pairs = [(str(ftr), float(val)) for ftr, val in zip(cols, vals)]
        pairs_sorted = sorted(pairs, key=lambda x: abs(x[1]), reverse=True)
        top_n = max(1, int(payload.top_n)) if payload.top_n else 10

        return {
            "base_value": base,
            "shap_values": pairs,
            "top_contributors": pairs_sorted[:top_n]
        }

    except Exception as e:
        import traceback
        print("SHAP failed:\n", traceback.format_exc())
        raise HTTPException(500, f"SHAP failed: {e}")
