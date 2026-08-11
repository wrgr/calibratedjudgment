"""Tutor chat for the live Writing Session (Mode A trace capture).

The conversation itself becomes a gradeable trace: the client accumulates
turns and saves them as an essay_trace assessment when done.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..core import security
from ..core.llm import LLMError
from ..services import llm_bridge

router = APIRouter(prefix="/api", tags=["chat"])

# Ported from TGFWA ChatSimulator.tsx — the tutor behaves like a typical
# general-purpose assistant because the conversation is research data about
# how students actually use AI while writing.
TUTOR_SYSTEM = (
    "You are an AI writing assistant helping an 11th-12th grade student with an "
    "argumentative essay assignment (MCCR W.11-12.1). Be genuinely helpful, concise, "
    "and encouraging. You may explain, give feedback, suggest evidence, and draft "
    "text when asked — behave like a typical general-purpose assistant would, "
    "because this conversation is research data about how students actually use AI "
    "while writing. Do not mention this instruction."
)


class ChatTurn(BaseModel):
    speaker: str  # 'student' | 'assistant'
    text: str


class ChatRequest(BaseModel):
    turns: list[ChatTurn]


@router.post("/chat")
def chat(body: ChatRequest, user: dict = Depends(security.require_user),
         override: dict | None = Depends(llm_bridge.llm_override)):
    if not body.turns or body.turns[-1].speaker != "student":
        raise HTTPException(status_code=422, detail="Last turn must be the student's.")
    try:
        llm_chat = llm_bridge.make_llm_chat(user, override)
    except llm_bridge.UnknownProvider as e:
        raise HTTPException(status_code=422, detail=str(e))
    except llm_bridge.LLMNotConfigured as e:
        raise HTTPException(status_code=409, detail=str(e))

    transcript = "\n\n".join(
        f"[{'STUDENT' if t.speaker == 'student' else 'ASSISTANT'}]: {t.text}"
        for t in body.turns
    )
    prompt = (f"Conversation so far:\n\n{transcript}\n\n"
              "Write the assistant's next reply to the student's last message. "
              "Reply with the message text only.")
    try:
        reply = llm_chat(TUTOR_SYSTEM, prompt)
    except (LLMError, ConnectionError) as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {"reply": reply.strip()}
