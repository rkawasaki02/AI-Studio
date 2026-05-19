#!/usr/bin/env python3
import os, json, uuid, base64, httpx, asyncio
from pathlib import Path
from datetime import datetime
from typing import Optional, List
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

DATA_DIR = Path(__file__).parent.parent / "data"
DATA_DIR.mkdir(exist_ok=True)
CHATS_FILE = DATA_DIR / "chats.json"

# ── helpers ──────────────────────────────────────────────────────────────────

def load_chats() -> dict:
    if CHATS_FILE.exists():
        return json.loads(CHATS_FILE.read_text())
    return {}

def save_chats(chats: dict):
    CHATS_FILE.write_text(json.dumps(chats, ensure_ascii=False, indent=2))

# ── models ───────────────────────────────────────────────────────────────────

class Message(BaseModel):
    role: str
    content: str
    image_data: Optional[str] = None   # base64
    image_type: Optional[str] = None

class ChatRequest(BaseModel):
    chat_id: Optional[str] = None
    model: str  # "gemini-flash" | "gemini-thinking" | "claude-sonnet" | "claude-opus"
    messages: List[Message]

class RenameRequest(BaseModel):
    name: str

class StarRequest(BaseModel):
    starred: bool

class TtsRequest(BaseModel):
    text: str

# ── chat persistence ──────────────────────────────────────────────────────────

@app.get("/api/chats")
def get_chats():
    chats = load_chats()
    result = []
    for cid, c in chats.items():
        result.append({
            "id": cid,
            "name": c.get("name", "New Chat"),
            "starred": c.get("starred", False),
            "model": c.get("model", ""),
            "created_at": c.get("created_at", ""),
            "updated_at": c.get("updated_at", ""),
            "message_count": len(c.get("messages", []))
        })
    result.sort(key=lambda x: (not x["starred"], x.get("updated_at", "")), reverse=False)
    result.sort(key=lambda x: x["updated_at"], reverse=True)
    return result

@app.get("/api/chats/{chat_id}")
def get_chat(chat_id: str):
    chats = load_chats()
    if chat_id not in chats:
        raise HTTPException(404, "Chat not found")
    return chats[chat_id]

@app.delete("/api/chats/{chat_id}")
def delete_chat(chat_id: str):
    chats = load_chats()
    if chat_id in chats:
        del chats[chat_id]
        save_chats(chats)
    return {"ok": True}

@app.patch("/api/chats/{chat_id}/rename")
def rename_chat(chat_id: str, req: RenameRequest):
    chats = load_chats()
    if chat_id not in chats:
        raise HTTPException(404)
    chats[chat_id]["name"] = req.name
    save_chats(chats)
    return {"ok": True}

@app.patch("/api/chats/{chat_id}/star")
def star_chat(chat_id: str, req: StarRequest):
    chats = load_chats()
    if chat_id not in chats:
        raise HTTPException(404)
    chats[chat_id]["starred"] = req.starred
    save_chats(chats)
    return {"ok": True}

# ── AI streaming ──────────────────────────────────────────────────────────────

GEMINI_KEY = os.environ.get("GEMINI_API_KEY", "")
CLAUDE_KEY = os.environ.get("CLAUDE_API_KEY", "")
XAI_KEY    = os.environ.get("XAI_API_KEY", "")

GEMINI_MODELS = {
    "gemini-flash":    "gemini-2.5-flash",
    "gemini-thinking": "gemini-2.5-pro",
}
CLAUDE_MODELS = {
    "claude-sonnet": "claude-sonnet-4-5",
    "claude-opus":   "claude-opus-4-5",
}

async def stream_gemini(model_key: str, messages: List[Message]):
    model_id = GEMINI_MODELS[model_key]
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_id}:streamGenerateContent?alt=sse&key={GEMINI_KEY}"
    
    contents = []
    for m in messages:
        parts = []
        if m.image_data:
            parts.append({"inlineData": {"mimeType": m.image_type or "image/jpeg", "data": m.image_data}})
        parts.append({"text": m.content})
        contents.append({"role": "user" if m.role == "user" else "model", "parts": parts})
    
    payload = {"contents": contents, "generationConfig": {"temperature": 0.7}}
    if model_key == "gemini-flash":
        payload["tools"] = [{"google_search": {}}]
    if model_key == "gemini-thinking":
        payload["generationConfig"]["thinkingConfig"] = {"thinkingBudget": 8000}
    
    async with httpx.AsyncClient(timeout=120) as client:
        async with client.stream("POST", url, json=payload) as resp:
            async for line in resp.aiter_lines():
                if line.startswith("data: "):
                    try:
                        data = json.loads(line[6:])
                        for cand in data.get("candidates", []):
                            for part in cand.get("content", {}).get("parts", []):
                                if "text" in part:
                                    yield part["text"]
                    except Exception:
                        pass

async def stream_claude(model_key: str, messages: List[Message]):
    model_id = CLAUDE_MODELS[model_key]
    url = "https://api.anthropic.com/v1/messages"
    
    claude_msgs = []
    for m in messages:
        if m.image_data:
            content = [
                {"type": "image", "source": {"type": "base64", "media_type": m.image_type or "image/jpeg", "data": m.image_data}},
                {"type": "text", "text": m.content}
            ]
        else:
            content = m.content
        claude_msgs.append({"role": m.role, "content": content})
    
    headers = {
        "x-api-key": CLAUDE_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
    }
    payload = {"model": model_id, "max_tokens": 8096, "stream": True, "messages": claude_msgs}
    
    async with httpx.AsyncClient(timeout=120) as client:
        async with client.stream("POST", url, headers=headers, json=payload) as resp:
            if resp.status_code != 200:
                body = await resp.aread()
                print(f"[Claude API Error] {resp.status_code}: {body.decode()}")
                return
            async for line in resp.aiter_lines():
                if line.startswith("data: "):
                    try:
                        data = json.loads(line[6:])
                        if data.get("type") == "content_block_delta":
                            delta = data.get("delta", {})
                            if delta.get("type") == "text_delta":
                                yield delta["text"]
                    except Exception as e:
                        print(f"[Claude parse error] {e}: {line}")

@app.post("/api/chat/stream")
async def chat_stream(req: ChatRequest):
    chats = load_chats()
    chat_id = req.chat_id or str(uuid.uuid4())
    now = datetime.now().isoformat()
    
    if chat_id not in chats:
        chats[chat_id] = {
            "id": chat_id,
            "name": "New Chat",
            "starred": False,
            "model": req.model,
            "created_at": now,
            "updated_at": now,
            "messages": []
        }
    
    # Store user message
    last_user = req.messages[-1] if req.messages else None
    if last_user and last_user.role == "user":
        msg_entry = {"role": "user", "content": last_user.content, "ts": now}
        if last_user.image_data:
            msg_entry["has_image"] = True
        chats[chat_id]["messages"].append(msg_entry)
    
    chats[chat_id]["updated_at"] = now
    save_chats(chats)
    
    # Auto-name after first message
    auto_name = None
    if len(chats[chat_id]["messages"]) == 1 and last_user:
        words = last_user.content.strip().split()
        auto_name = " ".join(words[:6])
        if len(words) > 6: auto_name += "…"
        chats[chat_id]["name"] = auto_name
        save_chats(chats)
    
    full_response = []
    
    async def generate():
        nonlocal full_response
        # Send chat_id first
        yield f"data: {json.dumps({'type': 'meta', 'chat_id': chat_id, 'name': chats[chat_id]['name']})}\n\n"
        
        try:
            if req.model.startswith("gemini"):
                gen = stream_gemini(req.model, req.messages)
            else:
                gen = stream_claude(req.model, req.messages)
            
            async for chunk in gen:
                full_response.append(chunk)
                yield f"data: {json.dumps({'type': 'text', 'text': chunk})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
        
        # Save assistant response
        full_text = "".join(full_response)
        chats2 = load_chats()
        if chat_id in chats2:
            chats2[chat_id]["messages"].append({"role": "assistant", "content": full_text, "ts": datetime.now().isoformat(), "model": req.model})
            chats2[chat_id]["updated_at"] = datetime.now().isoformat()
            save_chats(chats2)
        
        yield f"data: {json.dumps({'type': 'done'})}\n\n"
    
    return StreamingResponse(generate(), media_type="text/event-stream")

# ── TTS (XAI Grok) ───────────────────────────────────────────────────────────

@app.post("/api/tts")
async def text_to_speech(req: TtsRequest):
    if not XAI_KEY:
        raise HTTPException(500, "XAI_API_KEY not set")
    
    url = "https://api.x.ai/v1/tts"
    headers = {"Authorization": f"Bearer {XAI_KEY}", "Content-Type": "application/json"}
    payload = {
        "text": req.text[:15000],
        "voice_id": "eve",
        "language": "ja",
        "response_format": "mp3"
    }
    
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(url, headers=headers, json=payload)
        if resp.status_code != 200:
            raise HTTPException(resp.status_code, resp.text)
        
        audio_data = base64.b64encode(resp.content).decode()
        return {"audio": audio_data, "format": "mp3"}

# ── static ────────────────────────────────────────────────────────────────────

FRONTEND_DIR = Path(__file__).parent.parent / "frontend"
if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=8765, reload=True)
