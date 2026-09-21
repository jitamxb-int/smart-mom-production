"""
S3 Utility — Audio file operations.
Uses signed S3 requests (IAM role, env vars, or ~/.aws/credentials).
"""
import boto3
import logging
from botocore.exceptions import ClientError
from app.core.config import settings

logger = logging.getLogger(__name__)

_s3_client = None


def get_s3_client():
    global _s3_client
    if _s3_client is None:
        _s3_client = boto3.client("s3", region_name=settings.aws_region)
        logger.info(f"Created S3 client (region: {settings.aws_region})")
    return _s3_client


def build_audio_s3_key(user_id: str, meeting_id: str) -> str:
    return f"audio/{user_id}/{meeting_id}/{meeting_id}.webm"


def get_presigned_upload_url(s3_key: str, expires_in: int = 3600) -> str:
    """Generate a presigned PUT URL valid for `expires_in` seconds."""
    s3 = get_s3_client()
    url = s3.generate_presigned_url(
        "put_object",
        Params={
            "Bucket": settings.s3_bucket_name,
            "Key": s3_key,
            "ContentType": "audio/webm",
        },
        ExpiresIn=expires_in,
    )
    logger.info(f"Generated presigned upload URL for {s3_key} (expires in {expires_in}s)")
    return url


def get_presigned_download_url(s3_key: str, expires_in: int = 3600) -> str:
    """Generate a presigned GET URL valid for `expires_in` seconds."""
    s3 = get_s3_client()
    url = s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.s3_bucket_name, "Key": s3_key},
        ExpiresIn=expires_in,
    )
    logger.info(f"Generated presigned download URL for {s3_key} (expires in {expires_in}s)")
    return url


def upload_object(s3_key: str, data: bytes, content_type: str = "audio/webm") -> bool:
    s3 = get_s3_client()
    try:
        s3.put_object(
            Bucket=settings.s3_bucket_name,
            Key=s3_key,
            Body=data,
            ContentType=content_type,
        )
        logger.info(f"Uploaded {len(data)} bytes to S3: {s3_key}")
        return True
    except Exception as e:
        logger.error(f"Failed to upload to S3 ({s3_key}): {e}")
        raise


def get_object(s3_key: str) -> bytes:
    s3 = get_s3_client()
    try:
        response = s3.get_object(Bucket=settings.s3_bucket_name, Key=s3_key)
        return response["Body"].read()
    except Exception as e:
        logger.error(f"Failed to download from S3 ({s3_key}): {e}")
        raise


def delete_object(s3_key: str) -> bool:
    s3 = get_s3_client()
    try:
        s3.delete_object(Bucket=settings.s3_bucket_name, Key=s3_key)
        logger.info(f"Deleted S3 object: {s3_key}")
        return True
    except Exception as e:
        logger.error(f"Failed to delete S3 object {s3_key}: {e}")
        return False


def check_object_exists(s3_key: str) -> bool:
    s3 = get_s3_client()
    try:
        s3.head_object(Bucket=settings.s3_bucket_name, Key=s3_key)
        return True
    except ClientError as e:
        if e.response["Error"]["Code"] == "404":
            return False
        logger.error(f"Error checking object existence for {s3_key}: {e}")
        raise
