"""
Standalone S3 Diagnostic Script
================================
Tests S3 access using signed requests — same pattern as:
    const s3 = new S3Client({ region: process.env.AWS_REGION });
    await s3.send(new PutObjectCommand({ Bucket: process.env.AWS_S3_BUCKET, ... }));

No explicit credentials needed — uses IAM role (EC2), env vars, or ~/.aws/credentials.

Usage:
    python backend/diagnose_s3.py
"""

import sys
import os
import json
from datetime import datetime

# --- CONFIG - Set these via env vars or edit directly -------------------------
AWS_REGION = os.getenv("AWS_REGION", "ap-south-1")
S3_BUCKET = (
    os.getenv("AWS_S3_BUCKET")
    or os.getenv("S3_BUCKET_NAME")
    or os.getenv("S3_BUCKET")
    or "vyom-backend-demo"
)
TEST_KEY = f"_diagnostic/test_upload_{datetime.now().strftime('%Y%m%d_%H%M%S')}.txt"
TEST_DATA = b"Hello from Smart MoM S3 diagnostic script!"

AWS_ACCESS_KEY = os.getenv("AWS_ACCESS_KEY_ID")
AWS_SECRET_KEY = os.getenv("AWS_SECRET_ACCESS_KEY")
AWS_SESSION_TOKEN = os.getenv("AWS_SESSION_TOKEN")

# --- Imports -----------------------------------------------------------------
try:
    import boto3
    from botocore.config import Config
    from botocore.exceptions import ClientError, EndpointConnectionError
except ImportError:
    print("ERROR: boto3 is not installed. Run: pip install boto3")
    sys.exit(1)

GREEN = "\033[92m"
RED = "\033[91m"
YELLOW = "\033[93m"
CYAN = "\033[96m"
BOLD = "\033[1m"
RESET = "\033[0m"

passed = 0
failed = 0
warnings = 0


def log_test(num, name, status, detail=""):
    global passed, failed, warnings
    if status == "PASS":
        passed += 1
        sc = f"{GREEN}PASS{RESET}"
    elif status == "FAIL":
        failed += 1
        sc = f"{RED}FAIL{RESET}"
    else:
        warnings += 1
        sc = f"{YELLOW}WARN{RESET}"
    label = f"[{sc}] [{num}]"
    out = f"\n{label} {BOLD}{name}{RESET}"
    if detail:
        for line in detail.strip().split("\n"):
            out += f"\n        {line}"
    try:
        print(out)
    except UnicodeEncodeError:
        print(out.encode("ascii", errors="replace").decode("ascii"))


def make_s3_client():
    """Creates a signed S3 client (same as `new S3Client({region})` in Node.js)."""
    kwargs = {"region_name": AWS_REGION}
    if AWS_ACCESS_KEY and AWS_SECRET_KEY:
        kwargs["aws_access_key_id"] = AWS_ACCESS_KEY
        kwargs["aws_secret_access_key"] = AWS_SECRET_KEY
        kwargs["aws_session_token"] = AWS_SESSION_TOKEN
    return boto3.client("s3", **kwargs)


def has_credentials():
    if AWS_ACCESS_KEY and AWS_SECRET_KEY:
        return True
    try:
        make_s3_client().list_buckets()
        return True
    except Exception:
        return False


def test_header():
    print("=" * 70)
    print(f"  {BOLD}S3 DIAGNOSTIC SCRIPT{RESET}")
    print(f"  Region: {CYAN}{AWS_REGION}{RESET}")
    print(f"  Bucket: {CYAN}{S3_BUCKET}{RESET}")
    print(f"  Env vars checked: AWS_REGION, AWS_S3_BUCKET, S3_BUCKET_NAME, S3_BUCKET")
    if has_credentials():
        print(f"  Credentials: {GREEN}available (IAM role / env vars){RESET}")
    else:
        print(f"  Credentials: {YELLOW}not found locally — expected if not on EC2{RESET}")
    print("=" * 70)


# ==============================================================================
test_header()

# --- TEST 1: DNS / Connectivity -----------------------------------------------
try:
    import socket
    hostname = f"s3.{AWS_REGION}.amazonaws.com"
    ip = socket.gethostbyname(hostname)
    log_test(1, "DNS Resolution", "PASS", f"{hostname} resolves to {ip}")
except Exception as e:
    log_test(1, "DNS Resolution", "FAIL", f"Cannot resolve s3.{AWS_REGION}.amazonaws.com: {e}")

# --- TEST 2: Bucket exists (HeadBucket) ---------------------------------------
try:
    s3 = make_s3_client()
    s3.head_bucket(Bucket=S3_BUCKET)
    log_test(2, "Bucket HEAD", "PASS", f"Bucket '{S3_BUCKET}' exists and is accessible.")
except ClientError as e:
    code = e.response["Error"]["Code"]
    log_test(2, "Bucket HEAD", "FAIL", f"Error code: {code} -- {e}")
except EndpointConnectionError as e:
    log_test(2, "Bucket HEAD", "FAIL", f"Cannot connect to S3 endpoint: {e}")
except Exception as e:
    log_test(2, "Bucket HEAD", "FAIL", f"Unexpected error: {e}")

# --- TEST 3: PutObject (signed - same as Node.js S3Client) --------------------
try:
    s3 = make_s3_client()
    s3.put_object(Bucket=S3_BUCKET, Key=TEST_KEY, Body=TEST_DATA, ContentType="text/plain")
    log_test(3, "PutObject", "PASS",
             f"Uploaded test object to s3://{S3_BUCKET}/{TEST_KEY} ({len(TEST_DATA)} bytes)")
except ClientError as e:
    code = e.response["Error"]["Code"]
    log_test(3, "PutObject", "FAIL",
             f"Error code: {code} -- {e}\n"
             f"         Match: Node.js:S3Client.putObject -> Python:boto3.client('s3').put_object\n"
             f"         Check that AWS credentials have s3:PutObject permission on this bucket.")
except Exception as e:
    log_test(3, "PutObject", "FAIL", f"Unexpected error: {e}")

# --- TEST 4: GetObject (signed) -----------------------------------------------
try:
    s3 = make_s3_client()
    result = s3.get_object(Bucket=S3_BUCKET, Key=TEST_KEY)
    body = result["Body"].read()
    if body == TEST_DATA:
        log_test(4, "GetObject", "PASS", "Retrieved test object -- content matches.")
    else:
        log_test(4, "GetObject", "FAIL", "Content mismatch!")
except ClientError as e:
    code = e.response["Error"]["Code"]
    log_test(4, "GetObject", "FAIL", f"Error code: {code} -- {e}")
except Exception as e:
    log_test(4, "GetObject", "FAIL", f"Unexpected error: {e}")

# --- TEST 5: Presigned Upload URL ---------------------------------------------
try:
    s3 = make_s3_client()
    presigned_url = s3.generate_presigned_url(
        "put_object",
        Params={"Bucket": S3_BUCKET, "Key": TEST_KEY, "ContentType": "text/plain"},
        ExpiresIn=3600,
    )
    log_test(5, "Presigned Upload URL", "PASS",
             f"Generated presigned PUT URL (expires in 3600s)\n"
             f"         URL (truncated): {presigned_url[:100]}...")
except Exception as e:
    log_test(5, "Presigned Upload URL", "FAIL", f"Error: {e}")

# --- TEST 6: Presigned Download URL -------------------------------------------
try:
    s3 = make_s3_client()
    presigned_url = s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": S3_BUCKET, "Key": TEST_KEY},
        ExpiresIn=3600,
    )
    log_test(6, "Presigned Download URL", "PASS",
             f"Generated presigned GET URL (expires in 3600s)\n"
             f"         URL (truncated): {presigned_url[:100]}...")
except Exception as e:
    log_test(6, "Presigned Download URL", "FAIL", f"Error: {e}")

# --- TEST 7: DeleteObject -----------------------------------------------------
try:
    s3 = make_s3_client()
    s3.delete_object(Bucket=S3_BUCKET, Key=TEST_KEY)
    log_test(7, "DeleteObject", "PASS", f"Cleaned up test object s3://{S3_BUCKET}/{TEST_KEY}")
except ClientError as e:
    code = e.response["Error"]["Code"]
    log_test(7, "DeleteObject", "FAIL", f"Error code: {code} -- {e}")
except Exception as e:
    log_test(7, "DeleteObject", "FAIL", f"Unexpected error: {e}")

# ==============================================================================
# SUMMARY
# ==============================================================================
print("\n" + "=" * 70)
print(f"  {BOLD}SUMMARY{RESET}")
print(f"  {GREEN}PASS{RESET}: {passed}   {RED}FAIL{RESET}: {failed}   {YELLOW}WARN/SKIP{RESET}: {warnings}")
print("=" * 70)

if failed > 0:
    print(f"\n  {RED}{BOLD}ISSUES DETECTED{RESET}")
    print(f"  If running on EC2 with IAM role, verify the role has these permissions:")
    print(f"    - s3:PutObject, s3:GetObject, s3:DeleteObject, s3:HeadBucket")
    print(f"  If running locally, no IAM role is available — this is expected.")
    print(f"\n  {BOLD}Deploy the updated backend to the server and retry.{RESET}")
else:
    print(f"\n  {GREEN}{BOLD}ALL CHECKS PASSED{RESET}")
    print(f"  S3 signed access works. The backend will use the same IAM role.")
    print(f"  The Node.js equivalent is:")
    print(f"    const s3 = new S3Client({{ region: '{AWS_REGION}' }});")
    print(f"    await s3.send(new PutObjectCommand({{ Bucket: '{S3_BUCKET}', ... }}));")
