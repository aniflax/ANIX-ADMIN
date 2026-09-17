"""Create a pg_dump backup and upload it to Cloudflare R2.

Required env:
  DATABASE_URL
  R2_BUCKET_NAME
  R2_ACCESS_KEY_ID
  R2_SECRET_ACCESS_KEY
  R2_ENDPOINT_URL or R2_ACCOUNT_ID

Optional env:
  BACKUP_PREFIX=database-backups
"""
from __future__ import annotations

import gzip
import os
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import boto3


def r2_endpoint_url() -> str:
    explicit = os.getenv("R2_ENDPOINT_URL")
    if explicit:
        return explicit
    account_id = os.environ["R2_ACCOUNT_ID"]
    return f"https://{account_id}.r2.cloudflarestorage.com"


def main() -> None:
    database_url = os.environ["DATABASE_URL"]
    bucket_name = os.environ["R2_BUCKET_NAME"]
    prefix = os.getenv("BACKUP_PREFIX", "database-backups").strip("/")
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    object_key = f"{prefix}/anix-hrms-{timestamp}.sql.gz"

    with tempfile.TemporaryDirectory() as temp_dir:
        dump_path = Path(temp_dir) / "backup.sql"
        gzip_path = Path(temp_dir) / "backup.sql.gz"

        subprocess.run(
            ["pg_dump", "--no-owner", "--no-acl", "--format=plain", database_url, "--file", str(dump_path)],
            check=True,
        )

        with open(dump_path, "rb") as source, gzip.open(gzip_path, "wb") as target:
            target.writelines(source)

        client = boto3.client(
            "s3",
            endpoint_url=r2_endpoint_url(),
            aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
            aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
            region_name="auto",
        )
        client.upload_file(str(gzip_path), bucket_name, object_key)

    print(f"Uploaded backup to r2://{bucket_name}/{object_key}")


if __name__ == "__main__":
    main()
