package com.email.email_writer_ab.app;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class EmailRequestTest {

    @Test
    void defaultsToneAndLengthWhenNotProvided() {
        EmailRequest request = new EmailRequest();

        request.normalizeAndValidate();

        assertEquals("Professional", request.getTone());
        assertEquals("Medium", request.getLength());
    }

    @Test
    void normalizesSupportedOptionsWithoutCaseSensitivity() {
        EmailRequest request = new EmailRequest();
        request.setTone(" friendly ");
        request.setLength("short");

        request.normalizeAndValidate();

        assertEquals("Friendly", request.getTone());
        assertEquals("Short", request.getLength());
    }

    @Test
    void rejectsUnsupportedTone() {
        EmailRequest request = new EmailRequest();
        request.setTone("Enthusiastic");

        IllegalArgumentException exception = assertThrows(
                IllegalArgumentException.class,
                request::normalizeAndValidate
        );

        assertEquals(
                "Invalid tone. Supported values are: Professional, Friendly, Formal, Casual, Apologetic, Persuasive.",
                exception.getMessage()
        );
    }

    @Test
    void rejectsUnsupportedLength() {
        EmailRequest request = new EmailRequest();
        request.setLength("Very short");

        IllegalArgumentException exception = assertThrows(
                IllegalArgumentException.class,
                request::normalizeAndValidate
        );

        assertEquals("Invalid length. Supported values are: Short, Medium, Detailed.", exception.getMessage());
    }

    @Test
    void acceptsAllSupportedTonesAndLengths() {
        String[] tones = {"Professional", "Friendly", "Formal", "Casual", "Apologetic", "Persuasive"};
        String[] lengths = {"Short", "Medium", "Detailed"};

        for (String tone : tones) {
            for (String length : lengths) {
                EmailRequest request = new EmailRequest();
                request.setTone(tone);
                request.setLength(length);
                request.normalizeAndValidate();

                assertEquals(tone, request.getTone());
                assertEquals(length, request.getLength());
            }
        }
    }
}
