import logging

import resend
from jinja2 import Environment, FileSystemLoader

from app.exceptions import BaseEmailError
from app.notifications.interfaces import EmailSenderInterface


class EmailSender(EmailSenderInterface):

    def __init__(
        self,
        api_key: str,
        sender_email: str,
        template_dir: str,
        activation_email_template_name: str,
        activation_complete_email_template_name: str,
        password_email_template_name: str,
        password_complete_email_template_name: str,
    ):
        resend.api_key = api_key

        self._sender_email = sender_email
        self._activation_email_template_name = activation_email_template_name
        self._activation_complete_email_template_name = activation_complete_email_template_name
        self._password_email_template_name = password_email_template_name
        self._password_complete_email_template_name = password_complete_email_template_name

        # autoescape увімкнено навмисно: у листи підставляються адреса й посилання,
        # тобто дані ззовні, і без екранування вони потрапляють у розмітку як є.
        self._env = Environment(loader=FileSystemLoader(template_dir), autoescape=True)

    async def _send_email(self, recipient: str, subject: str, html_content: str) -> None:
        """
        Asynchronously send an email with the given subject and HTML content.

        Args:
            recipient (str): The recipient's email address.
            subject (str): The subject of the email.
            html_content (str): The HTML content of the email.

        Raises:
            BaseEmailError: If sending the email fails.
        """
        params: resend.Emails.SendParams = {
            "from": self._sender_email,
            "to": [recipient],
            "subject": subject,
            "html": html_content,
        }

        try:
            await resend.Emails.send_async(params)
        except resend.exceptions.ResendError as error:
            logging.error(f"Failed to send email to {recipient}: {error}")
            raise BaseEmailError(f"Failed to send email to {recipient}: {error}")

    async def send_activation_email(self, email: str, activation_link: str) -> None:
        """
        Send an account activation email asynchronously.

        Args:
            email (str): The recipient's email address.
            activation_link (str): The activation link to be included in the email.
        """
        template = self._env.get_template(self._activation_email_template_name)
        html_content = template.render(email=email, activation_link=activation_link)
        subject = "Підтвердьте пошту в Slovnuk"
        await self._send_email(email, subject, html_content)

    async def send_activation_complete_email(self, email: str, login_link: str) -> None:
        """
        Send an account activation completion email asynchronously.

        Args:
            email (str): The recipient's email address.
            login_link (str): The login link to be included in the email.
        """
        template = self._env.get_template(self._activation_complete_email_template_name)
        html_content = template.render(email=email, login_link=login_link)
        subject = "Обліковий запис у Slovnuk активовано"
        await self._send_email(email, subject, html_content)

    async def send_password_reset_email(self, email: str, reset_link: str) -> None:
        """
        Send a password reset request email asynchronously.

        Args:
            email (str): The recipient's email address.
            reset_link (str): The reset link to be included in the email.
        """
        template = self._env.get_template(self._password_email_template_name)
        html_content = template.render(email=email, reset_link=reset_link)
        subject = "Новий пароль у Slovnuk"
        await self._send_email(email, subject, html_content)

    async def send_password_reset_complete_email(self, email: str, login_link: str) -> None:
        """
        Send a password reset completion email asynchronously.

        Args:
            email (str): The recipient's email address.
            login_link (str): The login link to be included in the email.
        """
        template = self._env.get_template(self._password_complete_email_template_name)
        html_content = template.render(email=email, login_link=login_link)
        subject = "Пароль у Slovnuk змінено"
        await self._send_email(email, subject, html_content)
