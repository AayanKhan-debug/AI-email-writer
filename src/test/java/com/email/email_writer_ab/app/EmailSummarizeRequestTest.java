package com.email.email_writer_ab.app;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class EmailSummarizeRequestTest {

    @Test
    void rejectsNullEmailContent() {
        EmailSummarizeRequest request = new EmailSummarizeRequest(null);

        IllegalArgumentException exception = assertThrows(
                IllegalArgumentException.class,
                request::validate
        );

        assertEquals("Email content must not be empty.", exception.getMessage());
    }

    @Test
    void rejectsEmptyEmailContent() {
        EmailSummarizeRequest request = new EmailSummarizeRequest("");

        IllegalArgumentException exception = assertThrows(
                IllegalArgumentException.class,
                request::validate
        );

        assertEquals("Email content must not be empty.", exception.getMessage());
    }

    @Test
    void rejectsWhitespaceOnlyEmailContent() {
        EmailSummarizeRequest request = new EmailSummarizeRequest("   \n\t  ");

        IllegalArgumentException exception = assertThrows(
                IllegalArgumentException.class,
                request::validate
        );

        assertEquals("Email content must not be empty.", exception.getMessage());
    }

    @Test
    void rejectsOversizedEmailContent() {
        String longContent = "A".repeat(EmailSummarizeRequest.MAX_EMAIL_LENGTH + 1);
        EmailSummarizeRequest request = new EmailSummarizeRequest(longContent);

        IllegalArgumentException exception = assertThrows(
                IllegalArgumentException.class,
                request::validate
        );

        assertEquals(
                "Email content exceeds maximum allowed length of " + EmailSummarizeRequest.MAX_EMAIL_LENGTH + " characters.",
                exception.getMessage()
        );
    }

    @Test
    void acceptsValidEmailContentAtBoundary() {
        String boundaryContent = "A".repeat(EmailSummarizeRequest.MAX_EMAIL_LENGTH);
        EmailSummarizeRequest request = new EmailSummarizeRequest(boundaryContent);

        assertDoesNotThrow(request::validate);
        assertEquals(boundaryContent, request.getEmailContent());
    }

    @Test
    void acceptsStandardEmailContent() {
        EmailSummarizeRequest request = new EmailSummarizeRequest("From: Alice\nMeeting at 10 AM.\nFrom: Bob\nSounds good!");

        assertDoesNotThrow(request::validate);
        assertEquals("From: Alice\nMeeting at 10 AM.\nFrom: Bob\nSounds good!", request.getEmailContent());
    }
}
