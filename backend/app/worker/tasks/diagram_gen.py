"""
Diagram Generation Task — NEW v3.0
Classifies meeting structure and generates Mermaid.js diagram using GPT.
Queue: diagram-gen
"""
import re
from datetime import datetime, timezone
from celery import shared_task
from app.worker.celery_app import celery_app
from app.core.config import settings
from app.core.error_logger import log_error
import logging

logger = logging.getLogger(__name__)

VALID_MERMAID_STARTS = [
    "graph ", "flowchart ", "sequenceDiagram", "gantt",
    "timeline", "classDiagram", "stateDiagram", "erDiagram", "journey",
]

CLASSIFICATION_PROMPT = """Analyze the following meeting transcript and determine if it describes a structured
process that can be visualized as a diagram.

Respond with EXACTLY ONE word (no punctuation, no explanation):
  workflow       - series of steps or decisions
  architecture   - system components and relationships
  timeline       - events ordered by time or milestones
  process        - business or operational process
  none           - no clear diagrammatic structure

Transcript (first 3000 chars):
{transcript_excerpt}
"""

GENERATION_PROMPT = """You are a Mermaid.js diagram generator.
Generate a {diagram_type} diagram based on the transcript below.

CRITICAL: Output ONLY raw Mermaid.js syntax.
- NO markdown code fences (no ```mermaid or ```)
- NO explanatory text or whitespace before the diagram
- First character must be the Mermaid diagram type keyword
- Supported starts: graph, flowchart, sequenceDiagram, gantt, timeline, classDiagram
- Max 15 nodes/steps for clarity
- Use descriptive labels

Transcript:
{transcript_text}
"""

GENERATION_STRICT_PROMPT = """Generate a Mermaid.js flowchart diagram from this meeting.
Output ONLY the raw Mermaid syntax. Start with 'flowchart TD' or 'graph TD'.
No fences. No extra text. Max 10 nodes.

Transcript:
{transcript_text}
"""


def get_sync_db():
    from pymongo import MongoClient
    client = MongoClient(settings.mongo_uri)
    return client[settings.mongo_db_name]


def get_openai_client():
    from openai import OpenAI
    return OpenAI(api_key=settings.openai_api_key)


def validate_mermaid(syntax: str) -> bool:
    stripped = syntax.strip()
    return bool(stripped) and any(stripped.startswith(s) for s in VALID_MERMAID_STARTS)


def clean_mermaid(syntax: str) -> str:
    """Remove accidental markdown fences and extra whitespace."""
    syntax = re.sub(r"```mermaid\s*", "", syntax)
    syntax = re.sub(r"```\s*", "", syntax)
    return syntax.strip()


@celery_app.task(bind=True, name="app.worker.tasks.diagram_gen.generate_diagram", max_retries=2)
def generate_diagram(self, meeting_id: str):
    """
    Classify meeting structure, generate Mermaid.js diagram.
    Stores result in meetings.diagram sub-document.
    """
    db            = get_sync_db()
    openai_client = get_openai_client()

    try:
        meeting = db.meetings.find_one({"meeting_id": meeting_id})
        if not meeting:
            logger.error(f"Meeting {meeting_id} not found")
            return

        transcript = meeting.get("transcript", {})
        if not transcript or not transcript.get("text"):
            logger.warning(f"No transcript for diagram generation: {meeting_id}")
            db.meetings.update_one(
                {"meeting_id": meeting_id},
                {"$set": {
                    "diagram.status": "not_applicable",
                    "updated_at":     datetime.now(timezone.utc),
                }},
            )
            return

        # Format transcript with speaker names for better context
        segments = transcript.get("segments", [])
        if segments:
            formatted_lines = []
            for seg in segments:
                speaker_label = seg.get("speaker", "UNKNOWN")
                speaker_name = seg.get("speaker_name", "")
                display_name = speaker_name if speaker_name else speaker_label
                text = seg.get("text", "")
                formatted_lines.append(f"{display_name}: {text}")
            transcript_text = "\n".join(formatted_lines)
        else:
            transcript_text = transcript["text"]
        transcript_excerpt = transcript_text[:3000]

        # Step 1: Classify
        classification_resp = openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{
                "role":    "user",
                "content": CLASSIFICATION_PROMPT.format(transcript_excerpt=transcript_excerpt),
            }],
            max_tokens=10,
            temperature=0,
        )
        diagram_type = classification_resp.choices[0].message.content.strip().lower()
        diagram_type = re.sub(r"[^a-z]", "", diagram_type)

        logger.info(f"Meeting {meeting_id} classified as: {diagram_type}")

        valid_types = {"workflow", "architecture", "timeline", "process"}
        if diagram_type not in valid_types:
            db.meetings.update_one(
                {"meeting_id": meeting_id},
                {"$set": {
                    "diagram": {
                        "status":         "not_applicable",
                        "type":           None,
                        "mermaid_syntax": None,
                        "generated_at":   None,
                        "error":          None,
                    },
                    "updated_at": datetime.now(timezone.utc),
                }},
            )
            logger.info(f"Meeting {meeting_id}: no diagram applicable")
            return

        def try_generate(prompt: str) -> str | None:
            resp = openai_client.chat.completions.create(
                model="gpt-4o",
                messages=[{"role": "user", "content": prompt}],
                max_tokens=800,
                temperature=0.2,
            )
            syntax = clean_mermaid(resp.choices[0].message.content)
            if validate_mermaid(syntax):
                return syntax
            return None

        mermaid_syntax = try_generate(
            GENERATION_PROMPT.format(diagram_type=diagram_type, transcript_text=transcript_text[:4000])
        )

        if not mermaid_syntax:
            logger.warning(f"First Mermaid attempt failed for {meeting_id}, retrying...")
            mermaid_syntax = try_generate(
                GENERATION_STRICT_PROMPT.format(transcript_text=transcript_text[:2000])
            )

        now = datetime.now(timezone.utc)

        if mermaid_syntax:
            db.meetings.update_one(
                {"meeting_id": meeting_id},
                {"$set": {
                    "diagram": {
                        "status":         "ready",
                        "type":           diagram_type,
                        "mermaid_syntax": mermaid_syntax,
                        "generated_at":   now,
                        "error":          None,
                    },
                    "updated_at": now,
                }},
            )
            logger.info(f"Diagram generated for meeting {meeting_id} (type={diagram_type})")
        else:
            db.meetings.update_one(
                {"meeting_id": meeting_id},
                {"$set": {
                    "diagram": {
                        "status":         "failed",
                        "type":           diagram_type,
                        "mermaid_syntax": None,
                        "generated_at":   None,
                        "error":          "Failed to generate valid Mermaid.js syntax after 2 attempts",
                    },
                    "updated_at": now,
                }},
            )
            logger.error(f"Diagram generation failed for meeting {meeting_id}")

    except Exception as exc:
        logger.error(f"diagram_gen error for {meeting_id}: {exc}")
        log_error(exc, db, source="manual:diagram_gen.generate_diagram", context={"meeting_id": meeting_id})
        try:
            db.meetings.update_one(
                {"meeting_id": meeting_id},
                {"$set": {
                    "diagram.status": "failed",
                    "diagram.error":  str(exc),
                    "updated_at":     datetime.now(timezone.utc),
                }},
            )
        except Exception:
            pass
        raise self.retry(exc=exc, countdown=15)
