import smtplib
import imaplib
import time
import os
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import logging
from app.core.config import settings

logger = logging.getLogger(__name__)

class PermanentEmailError(Exception):
    pass

def save_to_sent_folder(msg_string: str):
    """
    Saves a copy of the sent email to the sender's IMAP Sent folder.
    """
    if not settings.imap_enabled or not settings.imap_host:
        return

    try:
        # Clean up any potential extra quotes and re-apply them for the command
        folder_name = settings.imap_sent_folder.strip('"').strip("'")
        quoted_folder = f'"{folder_name}"'

        # Ensure we use the actual email address for IMAP sync
        imap_user = settings.smtp_from_email or settings.smtp_user
        if imap_user == "apikey":
             logger.error("IMAP ERROR | Cannot login with user 'apikey'. Please set SMTP_FROM_EMAIL.")
             return

        # Use specific IMAP password if provided, otherwise fallback
        password = settings.imap_password or settings.smtp_password
        
        logger.info("IMAP sync attempt | host=%s | user=%s | folder=%s", 
                    settings.imap_host, imap_user, quoted_folder)

        # Connect to IMAP server using SSL
        with imaplib.IMAP4_SSL(settings.imap_host, settings.imap_port, timeout=30) as imap:
            imap.login(imap_user, password)
            
            # Append the message to the Sent folder (e.g., "[Gmail]/Sent Mail")
            # We set date_time to None so Gmail uses the current server time
            imap.append(
                quoted_folder, 
                '(\\Seen)', 
                None, 
                msg_string.encode('utf-8')
            )
            logger.info("Email copy saved to IMAP folder: %s", quoted_folder)
    except Exception as e:
        logger.error("IMAP ERROR | Authentication or Upload failed: %s", e)

def send_email(to_email: str, subject: str, body: str, html_content: str = None):
    """
    Sends an email using standard SMTP settings from config.
    """
    if not settings.smtp_host:
        logger.warning("SMTP host not configured. Skipping email send.")
        return False
    
    if not settings.smtp_user or not settings.smtp_password:
        raise PermanentEmailError("SMTP_USER/SMTP_PASSWORD missing")

    from_email = settings.smtp_from_email or settings.smtp_user
    
    try:
        msg = MIMEMultipart("alternative")
        msg["From"] = from_email
        msg["To"] = to_email
        msg["Subject"] = subject
        msg["Reply-To"] = from_email

        msg.attach(MIMEText(body, "plain"))
        if html_content:
            msg.attach(MIMEText(html_content, "html"))

        msg_string = msg.as_string()

        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=30) as server:
            server.ehlo()
            if settings.smtp_port == 587:
                server.starttls()
                server.ehlo()

            # We only use send_message, as sendmail + send_message causes duplicates
            server.login(settings.smtp_user, settings.smtp_password)
            server.send_message(msg)

        logger.info("Email sent | to=%s", to_email)
        
        # Save a copy to the Sent box via IMAP if enabled
        if settings.imap_enabled:
            save_to_sent_folder(msg_string)

        return True

    except Exception as e:
        logger.error("Failed to send email to %s: %s", to_email, e)
        return False

def send_transcription_ready_notification(user_email: str, user_name: str, meeting_id: str, meeting_context: str = "Meeting"):
    """
    Loads email_template.html and replaces the Username placeholder.
    """
    subject = f"Smart MoM-{meeting_context}-Transcription Complete"
    body = f"Dear {user_name},\n\nYour transcription for meeting {meeting_id} ({meeting_context}) is ready."

    # Search in multiple potential locations for the template
    search_paths = [
        os.path.join(os.getcwd(), "email_template.html"),
        os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "email_template.html"),
        "/app/email_template.html" if os.name != 'nt' else "C:\\Users\\Navvidha_Bharech\\Desktop\\Smart-MoM-New\\backend\\email_template.html"
    ]
    
    html_content = None
    template_path = None

    for path in search_paths:
        if os.path.exists(path):
            template_path = path
            break
    
    if template_path:
        try:
            with open(template_path, "r", encoding="utf-8") as f:
                html_content = f.read()
            # Replace the placeholders in your template
            html_content = html_content.replace("Username", user_name)
            html_content = html_content.replace("MeetingContext", meeting_context)
            logger.info("HTML template loaded successfully from: %s", template_path)
        except Exception as e:
            logger.error("Error reading email template file at %s: %s", template_path, e)
    else:
        logger.warning("FAILED TO FIND email_template.html. Searched in: %s", search_paths)

    return send_email(user_email, subject, body, html_content=html_content)
