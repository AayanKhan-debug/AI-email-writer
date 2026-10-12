package com.email.email_writer_ab.app;

public class EmailSummarizeRequest {

    public static final int MAX_EMAIL_LENGTH = 50_000;

    private String emailContent;

    public EmailSummarizeRequest() {
    }

    public EmailSummarizeRequest(String emailContent) {
        this.emailContent = emailContent;
    }

    public String getEmailContent() {
        return emailContent;
    }

    public void setEmailContent(String emailContent) {
        this.emailContent = emailContent;
    }

    public void validate() {
        if (emailContent == null || emailContent.trim().isEmpty()) {
            throw new IllegalArgumentException("Email content must not be empty.");
        }
        if (emailContent.length() > MAX_EMAIL_LENGTH) {
            throw new IllegalArgumentException(
                    "Email content exceeds maximum allowed length of " + MAX_EMAIL_LENGTH + " characters."
            );
        }
    }
}
