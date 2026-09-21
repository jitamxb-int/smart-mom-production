from bson import ObjectId


def serialize_meeting(doc: dict) -> dict:
    """Convert MongoDB document to API-safe dict."""
    if not doc:
        return doc

    result = dict(doc)

    # Convert ObjectId
    if "_id" in result:
        result["_id"] = str(result["_id"])

    # Ensure diagram has safe defaults for pre-v3 docs
    if "diagram" not in result or result["diagram"] is None:
        result["diagram"] = None

    if "rag_indexed" not in result:
        result["rag_indexed"] = False

    if "rag_indexed_at" not in result:
        result["rag_indexed_at"] = None

    # Ensure meet bot fields have safe defaults
    if "meet_link" not in result:
        result["meet_link"] = None
    if "bot_session_id" not in result:
        result["bot_session_id"] = None

    return result


def serialize_processing_item(doc: dict) -> dict:
    """Convert processing_queue document to API-safe dict."""
    if not doc:
        return doc
    result = dict(doc)
    if "_id" in result:
        result["_id"] = str(result["_id"])
    return result
