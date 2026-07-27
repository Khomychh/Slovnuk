from abc import ABC, abstractmethod
from typing import Optional, Union


class S3StorageInterface(ABC):

    @abstractmethod
    async def upload_file(
        self,
        file_name: str,
        file_data: Union[bytes, bytearray],
        content_type: Optional[str] = None,
        private: bool = True,
    ) -> None:
        """
        Uploads a file to the storage.

        :param file_name: The name (key) of the file to be stored.
        :param file_data: The file data in bytes.
        :param content_type: The MIME type of the file. Guessed from the file name when omitted.
        :param private: If True (default), store in the private (non-anonymous-readable) bucket
            instead of the public one.
        """
        pass

    @abstractmethod
    async def download_file(self, file_name: str, private: bool = True) -> bytes:
        """
        Downloads a file from the storage.

        :param file_name: The name (key) of the file stored in the bucket.
        :param private: If True (default), read from the private bucket instead of the public one.
        :return: The raw bytes of the file.
        """
        pass

    @abstractmethod
    async def delete_file(self, file_name: str, private: bool = True) -> None:
        """
        Deletes a file from the storage.

        :param file_name: The name (key) of the file stored in the bucket.
        :param private: If True (default), delete from the private bucket instead of the public one.
        """
        pass

    @abstractmethod
    async def get_file_url(
        self, file_name: str, private: bool = True, expires_in: int = 3600
    ) -> str:
        """
        Generate a URL for a file stored in the S3-compatible storage.

        Public-bucket URLs are plain static links. Private-bucket URLs are
        presigned and expire after `expires_in` seconds.

        :param file_name: The name of the file stored in the bucket.
        :param private: If True (default), build a presigned URL against the private bucket.
            Note that private-bucket URLs are not anonymously accessible without it.
        :param expires_in: Presigned URL lifetime in seconds. Ignored when `private` is False.
        :return: The full URL to access the file.
        """
        pass
