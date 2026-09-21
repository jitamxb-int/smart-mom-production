"""
LLM Generation Task — EXISTING
Generates MoM, Summary, and Key Points from transcript using gpt-4o.
This is the existing task; do not break it.
"""
import asyncio
from datetime import datetime
from celery import shared_task
from app.worker.celery_app import celery_app
from app.core.config import settings
import logging

logger = logging.getLogger(__name__)


def format_ist_for_display(date_time_input):
    """
    Format date_time (stored as IST) for display in MoM.
    No conversion needed - just format the stored IST time.
    Returns: (date_str, time_str in 24-hour format)
    """
    try:
        if isinstance(date_time_input, datetime):
            dt = date_time_input
        elif isinstance(date_time_input, str):
            # Parse the IST string (format: YYYY-MM-DDTHH:mm:ss)
            dt = datetime.fromisoformat(date_time_input)
        else:
            return "N/A", "N/A"

        # Format for display
        date_str = dt.strftime("%B %d, %Y")
        time_str = dt.strftime("%H:%M")  # 24-hour format
        return date_str, time_str
    except Exception as e:
        logger.warning(f"Failed to format date_time '{date_time_input}': {e}")
        return "N/A", "N/A"


def get_sync_db():
    """Get synchronous MongoDB client for Celery tasks."""
    from pymongo import MongoClient
    client = MongoClient(settings.mongo_uri)
    return client[settings.mongo_db_name]


def get_openai_client():
    from openai import OpenAI
    return OpenAI(api_key=settings.openai_api_key)


MOM_PROMPT = """
You are a senior business analyst and corporate documentation specialist with deep expertise in producing formal, board-ready Minutes of Meeting (MoM) documents.

Your task is to transform the provided meeting transcript into a precise, professional MoM document that strictly follows the structural template defined below — no deviations, no omissions, no invented content.

---

## OUTPUT FORMAT (Follow this EXACTLY)

---

MOM — Meeting | {date} | Smart MoM

# MINUTES OF MEETING
## {context}
### {date} | Smart MoM | General

| Field              | Details                                                                 |
|--------------------|-------------------------------------------------------------------------|
| Date               | {date} at {time}                                                        |
| Title              | {context}                                                               |
| Participants       | {attendees}                                                             |
| Topics Covered     | (Extract from transcript)                                               |

---

## 1. AGENDA

- {Agenda item 1: describe the purpose of each discussion topic as a clear, outcome-oriented statement}
- {Agenda item 2}
- {Agenda item 3}
- {Continue for all identifiable agenda items from the transcript}

---

## 2. DISCUSSION SUMMARY

### 2.1 {First Major Topic Title — Descriptive, Noun-Phrase Format}

{Opening sentence summarising the nature and tone of this discussion in 1–2 sentences.}

- {Specific discussion point — factual, attributed where possible}
- {Specific discussion point — include any data, dates, names, or decisions referenced}
- {Specific discussion point — note concerns, reactions, or positions taken by participants}
- {Continue with all substantive points raised under this topic}

### 2.2 {Second Major Topic Title}

{Opening summary sentence.}

- {Discussion point}
- {Discussion point}
- {Continue...}

### 2.{N} {Nth Major Topic Title}

{Continue for all major discussion areas covered in the transcript.}

---

## 3. DECISIONS MADE

- {Decision 1 — state clearly what was agreed, resolved, or committed to. Be specific and unambiguous.}
- {Decision 2}
- {Decision 3}
- {Continue for all firm decisions reached during the meeting}

---

## 4. ACTION ITEMS

| # | Action Item | Owner | Priority | Status |
|---|-------------|-------|----------|--------|
| 1 | {Specific, verb-led action — what must be done, by whom, and toward what outcome} | {Name / Role} | {Immediate / High / Medium / Low} | {Open / In Progress / Closed / TBD} |
| 2 | {Next action item} | {Owner} | {Priority} | {Status} |
| 3 | {Continue for all action items derived from the transcript} | | | |

---

## 5. OPEN ISSUES & UNRESOLVED ITEMS

| # | Open Issue / Unresolved Item | Context & Risk |
|---|------------------------------|----------------|
| 1 | {Concise label for the issue} | {1–2 sentences: what the issue is, why it matters, and what risk it poses if unresolved} |
| 2 | {Next issue} | {Context & risk} |
| 3 | {Continue for all unresolved or pending items} | |

---

## 6. NEXT STEPS

- {Next step 1 — specific, actionable, owned where possible}
- {Next step 2}
- {Next step 3}
- {Continue for all agreed next steps and follow-up actions}

---

*Note: This MoM captures the key discussion points from the meeting transcript provided. Any items deliberately excluded by the participants have been respected and omitted from this record. Speaker attribution follows the actual speaker names from the transcript.*

*End of Minutes | {date} | Smart MoM | Confidential*

---

## CRITICAL RULES — READ BEFORE GENERATING OUTPUT

### Fidelity Rules
1. **Never fabricate** — only include information explicitly stated or clearly implied in the transcript. Use `[Not mentioned]` or `[To be confirmed]` for genuinely missing fields.
2. **Do not summarise away specifics** — preserve names, numbers, dates, product names, and verbatim decisions where they appear in the transcript.
3. **Attribute correctly** — when a speaker makes a specific point, decision, or commitment, attribute it to them by name as shown in the transcript.

### Structural Rules
4. Follow the **exact section numbering and heading hierarchy** shown above — do not rename, reorder, or collapse sections.
5. The metadata block must be rendered as a **two-column Markdown table**.
6. Action Items and Open Issues must be rendered as **properly formatted Markdown tables** — no prose substitutes.
7. The **header line** (`MOM — ... | ... | ...`) must appear as the very first line of the output.

### Tone & Style Rules
8. Use **formal, third-person corporate prose** — no first-person narration, no casual language.
9. Action items must begin with a **verb in the infinitive form** (e.g., "Review...", "Share...", "Schedule...").
10. Discussion points must be **specific and atomic** — one idea per bullet, no compound statements.
11. Open Issues must include both a **concise label** and a **risk-framed contextual explanation**.

### Priority & Status Vocabulary
- Priority values: `Immediate` | `High` | `Medium` | `Low`
- Status values: `Open` | `In Progress` | `Closed` | `TBD` | `Deferred`

---

## INPUT

**Transcript:**
{transcript}

**Meeting Title:** {context}
**Participants:** {attendees}
**Date:** {date}
**Time:** {time}

---

Now generate the complete MoM document following the format and rules above. Begin immediately with the header line.
"""

SUMMARY_PROMPT = """Provide a concise executive summary (3-5 sentences) of the following meeting:

Transcript:
{transcript}

Context: {context}
"""

KEY_POINTS_PROMPT = """Extract the top 5-10 key points from this meeting transcript as a numbered list:

Transcript:
{transcript}

Context: {context}
"""


@celery_app.task(bind=True, name="app.worker.tasks.llm_generate.generate_llm_output", max_retries=3)
def generate_llm_output(self, meeting_id: str, output_type: str):
    """
    Generate LLM output (mom | summary | key_points) for a meeting.
    output_type: 'mom' | 'summary' | 'key_points'
    """
    db = get_sync_db()
    openai_client = get_openai_client()

    try:
        meeting = db.meetings.find_one({"meeting_id": meeting_id})
        if not meeting:
            logger.error(f"Meeting {meeting_id} not found for llm_generate")
            return

        transcript = meeting.get("transcript", {})
        if not transcript:
            logger.warning(f"No transcript for meeting {meeting_id}")
            return

        # Format transcript with speaker names for better LLM context
        segments = transcript.get("segments", [])
        if segments:
            # Build formatted transcript with speaker names
            formatted_lines = []
            for seg in segments:
                speaker_label = seg.get("speaker", "UNKNOWN")
                speaker_name = seg.get("speaker_name", "")
                display_name = speaker_name if speaker_name else speaker_label
                text = seg.get("text", "")
                formatted_lines.append(f"{display_name}: {text}")
            transcript_text = "\n".join(formatted_lines)
        else:
            transcript_text = transcript.get("text", "")

        # Extract additional meeting metadata for MoM
        context = meeting.get("context", "N/A")
        attendees = meeting.get("attendees", [])
        attendees_str = ", ".join(attendees) if attendees else "N/A"
        date_time = meeting.get("date_time", "")

        # Format date for display (stored as IST, display as-is)
        date_str, time_str = format_ist_for_display(date_time)

        prompts = {
            "mom": MOM_PROMPT.format(
                transcript=transcript_text,
                context=context,
                attendees=attendees_str,
                date=date_str,
                time=time_str
            ),
            "summary": SUMMARY_PROMPT.format(transcript=transcript_text, context=context),
            "key_points": KEY_POINTS_PROMPT.format(transcript=transcript_text, context=context),
        }

        if output_type not in prompts:
            logger.error(f"Unknown output_type: {output_type}")
            return

        # Use higher max_tokens for MoM to accommodate detailed format
        max_tokens_val = 4000 if output_type == "mom" else 2000

        response = openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompts[output_type]}],
            max_tokens=max_tokens_val,
        )

        output_text = response.choices[0].message.content
        field_map   = {"mom": "mom", "summary": "summary", "key_points": "key_points"}
        field       = field_map[output_type]

        db.meetings.update_one(
            {"meeting_id": meeting_id},
            {"$set": {
                field:       output_text,
                "updated_at": datetime.now(timezone.utc),
            }},
        )
        logger.info(f"Generated {output_type} for meeting {meeting_id}")

    except Exception as exc:
        logger.error(f"LLM generate error for {meeting_id}: {exc}")
        raise self.retry(exc=exc, countdown=5)
