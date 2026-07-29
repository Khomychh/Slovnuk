import mimetypes

import aioboto3
from botocore.config import Config
from botocore.exceptions import (
    BotoCoreError,
    ClientError,
    ConnectionError,
    HTTPClientError,
    NoCredentialsError,
)

from app.exceptions import (
    S3BucketNotFoundError,
    S3ConnectionError,
    S3FileNotFoundError,
    S3FileUploadError,
    S3PermissionError,
)
from app.storages import S3StorageInterface

DEFAULT_CONTENT_TYPE = "application/octet-stream"


class S3StorageClient(S3StorageInterface):

    def __init__(
        self,
        endpoint_url: str,
        access_key: str,
        secret_key: str,
        public_bucket_name: str,
        private_bucket_name: str,
        public_endpoint_url: str | None = None,
    ):
        """
        Initialize the asynchronous S3 Storage Client using an aioboto3 Session.

        Args:
            endpoint_url (str): Internal S3-compatible endpoint, used for all
                regular client operations (upload/download/delete).
            access_key (str): Access key for authentication.
            secret_key (str): Secret key for authentication.
            public_bucket_name (str): Bucket used when `private=False`; its
                contents are served via a plain, anonymously-readable URL.
            private_bucket_name (str): Bucket used when `private=True`; its
                contents are only reachable via presigned URLs.
            public_endpoint_url (str | None): Externally-reachable endpoint used
                only for presigned URL generation. Falls back to `endpoint_url`
                when omitted.
        """
        self._endpoint_url = endpoint_url
        self._public_endpoint_url = public_endpoint_url or endpoint_url
        self._access_key = access_key
        self._secret_key = secret_key
        self._public_bucket_name = public_bucket_name
        self._private_bucket_name = private_bucket_name

        self._session = aioboto3.Session(
            aws_access_key_id=self._access_key,
            aws_secret_access_key=self._secret_key,
        )
        # Fail fast on a down/unreachable MinIO instead of hanging on retries
        # for tens of seconds (matters most for the app-startup bucket check).
        self._client_config = Config(
            connect_timeout=5,
            read_timeout=15,
            retries={"max_attempts": 2},
        )

    def _client(self):
        return self._session.client(
            "s3", endpoint_url=self._endpoint_url, config=self._client_config
        )

    def _presign_client(self):
        # Потрібний спеціальний клієнт для генерації пресігн-URL,
        # оскільки генерація пресігн-URL вимагає використання public_endpoint_url,
        # а не внутрішнього endpoint_url, який використовується для звичайних операцій з S3
        return self._session.client(
            "s3",
            endpoint_url=self._public_endpoint_url,
            config=self._client_config
        )

    def _bucket_name(self, private: bool) -> str:
        return self._private_bucket_name if private else self._public_bucket_name

    @staticmethod
    def _translate_client_error(error: ClientError, file_name: str) -> Exception:
        error_code = error.response.get("Error", {}).get("Code", "")

        if error_code in ("NoSuchBucket", "404") and "Bucket" in str(error):
            return S3BucketNotFoundError(f"Bucket does not exist: {str(error)}")
        if error_code in ("NoSuchKey", "404"):
            return S3FileNotFoundError(f"File not found: {file_name}")
        if error_code in ("AccessDenied", "403"):
            return S3PermissionError(f"Insufficient permissions for: {file_name}")
        return S3FileUploadError(f"S3 operation failed: {str(error)}")

    async def upload_file(
        self,
        file_name: str,
        file_data: bytes | bytearray,
        content_type: str | None = None,
        private: bool = True,
    ) -> None:
        """
        Asynchronously upload a file to the S3-compatible storage.

        Args:
            file_name (str): The name of the file to be stored.
            file_data (bytes | bytearray): The file data in bytes.
            content_type (str | None): The MIME type of the file. Guessed from
                `file_name` when omitted, falling back to a generic binary type.
            private (bool): If True (default), upload to the private bucket
                instead of the public one.

        Raises:
            S3ConnectionError: If there is a connection error with S3.
            S3BucketNotFoundError: If the target bucket does not exist.
            S3PermissionError: If the client lacks permission to write the file.
            S3FileUploadError: If the file upload otherwise fails.
        """
        resolved_content_type = (
            content_type or mimetypes.guess_type(file_name)[0] or DEFAULT_CONTENT_TYPE
        )
        try:
            async with self._client() as client:
                await client.put_object(
                    Bucket=self._bucket_name(private),
                    Key=file_name,
                    Body=file_data,
                    ContentType=resolved_content_type,
                )
        except (ConnectionError, HTTPClientError, NoCredentialsError) as e:
            raise S3ConnectionError(f"Failed to connect to S3 storage: {str(e)}") from e
        except ClientError as e:
            raise self._translate_client_error(e, file_name) from e
        except BotoCoreError as e:
            raise S3FileUploadError(f"Failed to upload to S3 storage: {str(e)}") from e

    async def download_file(self, file_name: str, private: bool = True) -> bytes:
        """
        Asynchronously download a file from the S3-compatible storage.

        Prefer `get_file_url` when the file just needs to be handed to the
        frontend — this method reads the whole file into memory and should
        only be used when the backend needs to process its contents.

        Args:
            file_name (str): The name (key) of the file stored in the bucket.
            private (bool): If True (default), read from the private bucket
                instead of the public one.

        Returns:
            bytes: The raw contents of the file.

        Raises:
            S3ConnectionError: If there is a connection error with S3.
            S3FileNotFoundError: If the requested file does not exist.
            S3BucketNotFoundError: If the target bucket does not exist.
            S3PermissionError: If the client lacks permission to read the file.
        """
        # Цей метод краще використовувати тільки тоді,
        # коли перед з файлом потрібно щось зробити,
        # а не просто віддати фронтенду
        try:
            async with self._client() as client:
                response = await client.get_object(
                    Bucket=self._bucket_name(private), Key=file_name
                )
                async with response["Body"] as stream:
                    # Читає весь файл відразу, треба бути обережним з великими файлами
                    return await stream.read()
        except (ConnectionError, HTTPClientError, NoCredentialsError) as e:
            raise S3ConnectionError(f"Failed to connect to S3 storage: {str(e)}") from e
        except ClientError as e:
            raise self._translate_client_error(e, file_name) from e
        except BotoCoreError as e:
            raise S3FileUploadError(f"Failed to download from S3 storage: {str(e)}") from e

    async def delete_file(self, file_name: str, private: bool = True) -> None:
        """
        Asynchronously delete a file from the S3-compatible storage.

        Args:
            file_name (str): The name (key) of the file stored in the bucket.
            private (bool): If True (default), delete from the private bucket
                instead of the public one.

        Raises:
            S3ConnectionError: If there is a connection error with S3.
            S3BucketNotFoundError: If the target bucket does not exist.
            S3PermissionError: If the client lacks permission to delete the file.
        """
        try:
            async with self._client() as client:
                await client.delete_object(
                    Bucket=self._bucket_name(private), Key=file_name
                )
        except (ConnectionError, HTTPClientError, NoCredentialsError) as e:
            raise S3ConnectionError(f"Failed to connect to S3 storage: {str(e)}") from e
        except ClientError as e:
            raise self._translate_client_error(e, file_name) from e
        except BotoCoreError as e:
            raise S3FileUploadError(f"Failed to delete from S3 storage: {str(e)}") from e

    async def get_file_url(
            self,
            file_name: str,
            private: bool = True,
            expires_in: int = 3600, # Seconds (1 Hour)
    ) -> str:
        """
        Generate a URL for a file stored in the S3-compatible storage.

        For the public bucket this is a plain static URL. For the private
        bucket it is a presigned URL, generated against `public_endpoint_url`
        (not the internal `endpoint_url`) so it is reachable from outside.

        Args:
            file_name (str): The name of the file stored in the bucket.
            private (bool): If True (default), generate a presigned URL against
                the private bucket instead of a plain public one.
            expires_in (int): Presigned URL lifetime in seconds. Ignored when
                `private` is False.

        Returns:
            str: The full URL to access the file.

        Raises:
            S3FileUploadError: If presigned URL generation fails.
        """
        if not private:
            return f"{self._public_endpoint_url}/{self._bucket_name(private)}/{file_name}"

        try:
            async with self._presign_client() as client:
                return await client.generate_presigned_url(
                    "get_object",
                    Params={"Bucket": self._bucket_name(private), "Key": file_name},
                    ExpiresIn=expires_in,
                )
        except BotoCoreError as e:
            raise S3FileUploadError(f"Failed to generate presigned URL: {str(e)}") from e
